import asyncio
import json
import logging
import time
import heapq
import copy
from typing import Optional, Any, Dict, Tuple, List

from aiohttp import web

from .database import QueueDatabase
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from io import BytesIO
import os
import hashlib
import folder_paths
import json

class PersistentQueueManager:
    def __init__(self):
        self.db = QueueDatabase()
        self.paused = False
        self.current_job = None
        self._installed = False
        self._original_send_sync = None
        self._original_queue_get = None
        self._original_task_done = None
        
    def initialize(self):
        """Install hooks and API routes after PromptServer is created."""
        if self._installed:
            return

        # Import here to avoid circular dependencies
        from server import PromptServer
        import execution

        server_instance = PromptServer.instance

        # Register on-prompt handler to persist incoming prompts
        server_instance.add_on_prompt_handler(self._on_prompt)

        # Monkey-patch PromptQueue.get to support pause and mark jobs running
        if self._original_queue_get is None:
            self._original_queue_get = execution.PromptQueue.get

            def get_wrapper(q_self, timeout=None):
                if self.paused:
                    time.sleep(0.1)
                    return None
                result = self._original_queue_get(q_self, timeout=timeout)
                if result is not None:
                    try:
                        item, item_id = result
                        # item: (number, prompt_id, prompt, extra_data, outputs_to_execute)
                        prompt_id = item[1]
                        self.db.update_job_status(prompt_id, 'running')
                    except Exception as e:
                        logging.debug(f"PersistentQueue get_wrapper mark running failed: {e}")
                return result

            execution.PromptQueue.get = get_wrapper

        # Monkey-patch PromptQueue.task_done to persist results/history
        if self._original_task_done is None:
            self._original_task_done = execution.PromptQueue.task_done

            def task_done_wrapper(q_self, item_id, history_result, status):
                # Capture before original pops it
                item = q_self.currently_running.get(item_id)
                try:
                    if item is not None:
                        prompt_id = item[1]
                        prompt = item[2]
                        status_str = status.status_str if status is not None else 'success'
                        completed = (status.completed if status is not None else True)
                        new_state = 'completed' if completed else 'failed'
                        # Persist history and thumbnails BEFORE notifying original logic, to avoid UI race
                        self.db.update_job_status(prompt_id, new_state, error=None if completed else status_str)
                        history_id = self.db.add_history(
                            prompt_id=prompt_id,
                            workflow=prompt,
                            outputs=history_result.get('outputs', {}),
                            status=status_str,
                            duration_seconds=None,
                        )
                        try:
                            thumbs = self._generate_thumbnails_from_outputs(history_result.get('outputs', {}))
                            if thumbs:
                                self.db.save_history_thumbnails(history_id, thumbs)
                        except Exception as te:
                            logging.debug(f"PersistentQueue: failed to save thumbnails: {te}")
                except Exception as e:
                    logging.debug(f"PersistentQueue task_done wrapper persist failed: {e}")
                # Call original last so websocket updates happen after persistence
                self._original_task_done(q_self, item_id, history_result, status)

            execution.PromptQueue.task_done = task_done_wrapper

        # Add API routes
        self._install_api_routes()

        # Restore pending jobs on startup
        self._schedule_restore_pending_jobs()

        self._installed = True
    
    def _on_prompt(self, json_data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if "prompt" in json_data:
                prompt = json_data["prompt"]
                prompt_id = str(json_data.get("prompt_id")) if json_data.get("prompt_id") else None
                if prompt_id is None:
                    import uuid
                    prompt_id = uuid.uuid4().hex
                    json_data["prompt_id"] = prompt_id
                # Priority scaffold (0 default)
                priority = 0
                self.db.add_job(prompt_id, prompt, priority=priority)
        except Exception as e:
            logging.debug(f"PersistentQueue on_prompt persist failed: {e}")
        return json_data
    
    def pause_queue(self):
        """Pause queue execution"""
        self.paused = True
    
    def resume_queue(self):
        """Resume queue execution"""
        self.paused = False
    
    def reorder_job(self, prompt_id: str, new_priority: int):
        """Change job priority"""
        self.db.update_job_priority(prompt_id, new_priority)
    
    def _schedule_restore_pending_jobs(self):
        try:
            from server import PromptServer
            loop = PromptServer.instance.loop
            loop.create_task(self._restore_pending_jobs_async())
        except Exception as e:
            logging.debug(f"PersistentQueue schedule restore failed: {e}")

    async def _restore_pending_jobs_async(self):
        from server import PromptServer
        import execution
        server_instance = PromptServer.instance

        pending_jobs = self.db.get_pending_jobs()
        for job in pending_jobs:
            try:
                prompt_id = job["prompt_id"]
                workflow_json = job["workflow"]
                prompt = json.loads(workflow_json) if isinstance(workflow_json, str) else workflow_json
                valid, err, outputs_to_execute, node_errors = await execution.validate_prompt(prompt_id, prompt, None)
                if valid:
                    number = server_instance.number
                    server_instance.number += 1
                    extra_data = {}
                    server_instance.prompt_queue.put((number, prompt_id, prompt, extra_data, outputs_to_execute))
                else:
                    self.db.update_job_status(prompt_id, 'failed', error=(err or {}).get('message') if isinstance(err, dict) else str(err))
            except Exception as e:
                logging.debug(f"PersistentQueue restore job failed: {e}")

    # API Routes
    async def _api_get_pqueue(self, request: web.Request) -> web.Response:
        from server import PromptServer
        running, queued = PromptServer.instance.prompt_queue.get_current_queue_volatile()
        # Compute per-prompt progress (0..1) using global progress registry when available
        progress_map = {}
        try:
            from comfy_execution.progress import get_progress_state
            reg = get_progress_state()
            if reg is not None and getattr(reg, 'nodes', None) and reg.prompt_id:
                total_max = 0.0
                total_val = 0.0
                for st in reg.nodes.values():
                    try:
                        mv = float(st.get('max', 1.0) or 1.0)
                        vv = float(st.get('value', 0.0) or 0.0)
                    except Exception:
                        mv = 1.0
                        vv = 0.0
                    if mv <= 0:
                        mv = 1.0
                    total_max += mv
                    total_val += max(0.0, min(vv, mv))
                frac = (total_val / total_max) if total_max > 0 else 0.0
                progress_map[reg.prompt_id] = max(0.0, min(1.0, frac))
        except Exception:
            pass

        return web.json_response({
            "paused": self.paused,
            "db_pending": self.db.get_pending_jobs(),
            "queue_running": running,
            "queue_pending": queued,
            "running_progress": progress_map,
        })

    async def _api_get_history(self, request: web.Request) -> web.Response:
        limit = int(request.rel_url.query.get("limit", "50"))
        return web.json_response({"history": self.db.list_history(limit=limit)})

    def _generate_thumbnails_from_outputs(self, outputs: Optional[dict]) -> List[Dict[str, Any]]:
        if not outputs:
            return []
        images = []
        try:
            for v in (outputs or {}).values():
                if isinstance(v, dict):
                    imgs = v.get('images') or (v.get('ui') or {}).get('images') or []
                    if isinstance(imgs, list):
                        for i in imgs:
                            if isinstance(i, dict) and (i.get('filename') or i.get('name')):
                                images.append(i)
                elif isinstance(v, list):
                    for i in v:
                        if isinstance(i, dict) and (i.get('filename') or i.get('name')):
                            images.append(i)
        except Exception:
            images = []

        thumbs: List[Dict[str, Any]] = []
        max_thumbs = 4
        for idx, i in enumerate(images[:max_thumbs]):
            filename = i.get('filename') or i.get('name')
            ftype = i.get('type') or 'output'
            subfolder = i.get('subfolder') or ''
            base_dir = folder_paths.get_directory_by_type(ftype)
            if base_dir is None:
                continue
            img_dir = base_dir
            if subfolder:
                full_output_dir = os.path.join(base_dir, subfolder)
                if os.path.commonpath((os.path.abspath(full_output_dir), base_dir)) != base_dir:
                    continue
                img_dir = full_output_dir
            file_path = os.path.join(img_dir, os.path.basename(filename))
            if not os.path.isfile(file_path):
                continue
            try:
                with Image.open(file_path) as img:
                    # Contain to 128x128 and encode WEBP with quality 60
                    if hasattr(Image, 'Resampling'):
                        resampling = Image.Resampling.LANCZOS
                    else:
                        resampling = Image.LANCZOS
                    w, h = img.size
                    scale = min(128 / max(1, w), 128 / max(1, h), 1.0)
                    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                    thumb_img = img.convert('RGB').resize(new_size, resampling)
                    buf = BytesIO()
                    thumb_img.save(buf, format='WEBP', quality=60)
                    data = buf.getvalue()
                    thumbs.append({
                        'idx': idx,
                        'mime': 'image/webp',
                        'width': new_size[0],
                        'height': new_size[1],
                        'data': data,
                    })
            except Exception:
                continue
        return thumbs

    async def _api_pause(self, request: web.Request) -> web.Response:
        self.pause_queue()
        return web.json_response({"paused": True})

    async def _api_resume(self, request: web.Request) -> web.Response:
        self.resume_queue()
        return web.json_response({"paused": False})

    async def _api_reorder(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            order: List[str] = body.get("order", [])
            self._rebuild_queue_by_prompt_ids(order)
            return web.json_response({"ok": True})
        except Exception as e:
            logging.warning(f"PersistentQueue reorder failed: {e}")
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    async def _api_priority(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            prompt_id: str = body.get("prompt_id")
            priority: int = int(body.get("priority"))
            if not prompt_id:
                return web.json_response({"ok": False, "error": "prompt_id required"}, status=400)
            self.db.update_job_priority(prompt_id, priority)
            # Apply DB priority to in-memory queue
            self._apply_priority_to_pending()
            return web.json_response({"ok": True})
        except Exception as e:
            logging.warning(f"PersistentQueue set priority failed: {e}")
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    async def _api_delete(self, request: web.Request) -> web.Response:
        try:
            from server import PromptServer
            body = await request.json()
            prompt_ids: List[str] = body.get("prompt_ids", [])
            q = PromptServer.instance.prompt_queue
            for pid in prompt_ids:
                self.db.remove_job(pid)
                def match(item):
                    return item[1] == pid
                q.delete_queue_item(match)
            return web.json_response({"ok": True})
        except Exception as e:
            logging.warning(f"PersistentQueue delete failed: {e}")
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    def _rebuild_queue_by_prompt_ids(self, ordered_prompt_ids: List[str]) -> None:
        from server import PromptServer
        q = PromptServer.instance.prompt_queue
        with q.mutex:
            # Map current pending items by prompt_id
            by_id: Dict[str, Tuple] = {}
            for item in q.queue:
                # item: (number, prompt_id, prompt, extra_data, outputs_to_execute)
                by_id[item[1]] = item

            # Build new ordered list; preserve items not specified at the end by current order
            specified = [pid for pid in ordered_prompt_ids if pid in by_id]
            unspecified = [it for it in q.queue if it[1] not in set(specified)]

            # Assign new numbers so the new order executes first
            new_items: List[Tuple] = []
            next_num = -len(specified) if len(specified) > 0 else 0
            for pid in specified:
                old = by_id[pid]
                new_items.append((next_num, old[1], old[2], old[3], old[4]))
                next_num += 1

            # Append unspecified with their existing relative order but after specified
            base = next_num
            for idx, old in enumerate(sorted(unspecified, key=lambda x: x[0])):
                new_items.append((base + idx, old[1], old[2], old[3], old[4]))

            q.queue = new_items
            heapq.heapify(q.queue)
            q.server.queue_updated()

    def _apply_priority_to_pending(self) -> None:
        """Rebuild in-memory queue using DB priority DESC, then created_at ASC."""
        from server import PromptServer
        q = PromptServer.instance.prompt_queue
        pending = self.db.get_pending_jobs()
        # order prompt_ids by priority desc, created_at asc
        ordered_ids = [row["prompt_id"] for row in sorted(pending, key=lambda r: (-int(r.get("priority", 0)), r.get("created_at") or ""))]
        self._rebuild_queue_by_prompt_ids(ordered_ids)

    def _install_api_routes(self):
        try:
            from server import PromptServer
            app = PromptServer.instance.app
            app.add_routes([
                web.get('/api/pqueue', self._api_get_pqueue),
                web.get('/api/pqueue/history', self._api_get_history),
                web.get('/api/pqueue/history/thumb/{history_id:\\d+}', self._api_get_history_thumb),
                web.get('/api/pqueue/preview', self._api_preview_image),
                web.post('/api/pqueue/pause', self._api_pause),
                web.post('/api/pqueue/resume', self._api_resume),
                web.post('/api/pqueue/reorder', self._api_reorder),
                web.patch('/api/pqueue/priority', self._api_priority),
                web.post('/api/pqueue/delete', self._api_delete),
            ])
        except Exception as e:
            logging.debug(f"PersistentQueue add routes failed: {e}")

    async def _api_get_history_thumb(self, request: web.Request) -> web.Response:
        try:
            history_id = int(request.match_info.get('history_id', '0'))
            idx = int(request.rel_url.query.get('idx', '0'))
            row = self.db.get_history_thumbnail(history_id, idx)
            if not row:
                return web.Response(status=404)
            return web.Response(body=row['data'], content_type=row.get('mime') or 'image/webp')
        except Exception:
            return web.Response(status=500)

    async def _api_preview_image(self, request: web.Request) -> web.Response:
        try:
            filename = request.rel_url.query.get('filename')
            subfolder = request.rel_url.query.get('subfolder', '')
            folder_type = request.rel_url.query.get('type', 'output')
            pid = request.rel_url.query.get('pid')
            preview_q = request.rel_url.query.get('preview', 'webp;50')
            preview_info = preview_q.split(';')
            image_format = preview_info[0] if preview_info else 'webp'
            if image_format not in ['webp', 'jpeg', 'png']:
                image_format = 'webp'
            quality = 90
            if len(preview_info) > 1 and preview_info[-1].isdigit():
                quality = int(preview_info[-1])

            # Resolve file path similar to /view
            base_dir = folder_paths.get_directory_by_type(folder_type)
            if base_dir is None:
                return web.Response(status=400)
            output_dir = base_dir
            if subfolder:
                full_output_dir = os.path.join(base_dir, subfolder)
                if os.path.commonpath((os.path.abspath(full_output_dir), base_dir)) != base_dir:
                    return web.Response(status=403)
                output_dir = full_output_dir
            filename = os.path.basename(filename or '')
            file = os.path.join(output_dir, filename)

            if not os.path.isfile(file):
                return web.Response(status=404)

            # Build a cache path based on file + params + workflow hash
            temp_dir = folder_paths.get_temp_directory()
            cache_dir = os.path.join(temp_dir, 'preview_cache')
            os.makedirs(cache_dir, exist_ok=True)

            workflow_json = None
            if pid:
                # Prefer workflow from history if available, else from queue
                # Try job_history first
                try:
                    # Direct DB access to last history for pid
                    with self.db._get_conn() as conn:
                        cur = conn.execute('SELECT workflow FROM job_history WHERE prompt_id = ? ORDER BY id DESC LIMIT 1', (pid,))
                        row = cur.fetchone()
                        if row and row['workflow']:
                            workflow_json = row['workflow']
                except Exception:
                    workflow_json = None
                if workflow_json is None:
                    job = self.db.get_job(pid)
                    if job:
                        workflow_json = job.get('workflow')

            # Include workflow_json in cache key so regenerated when workflow changes
            wf_hash = hashlib.sha256((workflow_json or '').encode('utf-8')).hexdigest()[:16]
            stat = os.stat(file)
            cache_key = f"{os.path.abspath(file)}|{stat.st_mtime}|{stat.st_size}|{image_format}|{quality}|{wf_hash}"
            cache_name = hashlib.sha256(cache_key.encode('utf-8')).hexdigest() + f'.{image_format}'
            cache_path = os.path.join(cache_dir, cache_name)

            if os.path.exists(cache_path):
                return web.FileResponse(cache_path, headers={"Content-Disposition": f"filename=\"{filename}\""})

            with Image.open(file) as img:
                save_kwargs: Dict[str, Any] = {"format": image_format}
                if image_format in ['webp', 'jpeg']:
                    save_kwargs['quality'] = quality

                # Embed metadata if WEBP or PNG
                if image_format == 'webp':
                    try:
                        exif = img.getexif()
                        # Copy existing PNG text into WEBP EXIF
                        if hasattr(img, 'text'):
                            for k in img.text:
                                val = img.text[k]
                                # Preserve both prompt and other keys
                                if k == 'prompt':
                                    exif[0x0110] = "prompt:{}".format(val)
                                else:
                                    tag = 0x010F
                                    try:
                                        exif[tag] = f"{k}:{val}"
                                    except Exception:
                                        pass
                        # Also embed provided workflow explicitly if given
                        if workflow_json:
                            try:
                                exif[0x010E] = "workflow:{}".format(workflow_json)  # 0x010E = ImageDescription
                            except Exception:
                                pass
                        save_kwargs['exif'] = exif
                    except Exception:
                        pass
                elif image_format == 'png':
                    try:
                        pnginfo = PngInfo()
                        if hasattr(img, 'text'):
                            for k in img.text:
                                pnginfo.add_text(k, img.text[k])
                        if workflow_json:
                            pnginfo.add_text('workflow', workflow_json)
                        save_kwargs['pnginfo'] = pnginfo
                    except Exception:
                        pass

                img.save(cache_path, **save_kwargs)

            return web.FileResponse(cache_path, headers={"Content-Disposition": f"filename=\"{filename}\""})
        except Exception:
            return web.Response(status=500)

queue_manager = PersistentQueueManager()