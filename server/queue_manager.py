import asyncio
import json
import logging
import time
import heapq
import copy
from typing import Optional, Any, Dict, Tuple, List, Callable, Set

from aiohttp import web

from .database import QueueDatabase
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from io import BytesIO
import os
import hashlib
import folder_paths
import json
from PIL import ImageDraw, ImageFont


class ThumbnailService:
    """Generates small, web-friendly thumbnails from ComfyUI output descriptors.

    Single responsibility: image IO and thumbnail encoding.
    """

    def __init__(self, max_size: int = 128, quality: int = 60):
        self.max_size = max_size
        self.quality = quality

    def generate_thumbnails_from_outputs(self, outputs: Optional[dict], *, workflow_json: Optional[str] = None, extras: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if not outputs:
            return []
        images: List[Dict[str, Any]] = self._extract_image_descriptors(outputs)
        thumbs: List[Dict[str, Any]] = []
        for idx, desc in enumerate(images[:4]):
            thumb = self._encode_single_thumbnail(desc, idx, workflow_json=workflow_json, extras=extras)
            if thumb is not None:
                thumbs.append(thumb)
        return thumbs

    def generate_placeholder_thumbnail(self, status: str, *, workflow_json: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Create a placeholder WEBP thumbnail for failed/interrupted jobs.

        The placeholder encodes the workflow in EXIF so it can be restored via drag-and-drop.
        """
        try:
            size = int(self.max_size)
            # Locate provided placeholder asset
            placeholder_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'failed.png'))
            use_draw_fallback = True
            if os.path.isfile(placeholder_path):
                try:
                    with Image.open(placeholder_path) as base_img:
                        # Resize to fit within max size, maintain aspect ratio
                        w, h = base_img.size
                        scale = min(size / max(1, w), size / max(1, h), 1.0)
                        new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                        if hasattr(Image, 'Resampling'):
                            resampling = Image.Resampling.LANCZOS
                        else:
                            resampling = Image.LANCZOS
                        img = base_img.convert('RGB').resize(new_size, resampling)
                        use_draw_fallback = False
                except Exception:
                    use_draw_fallback = True

            if use_draw_fallback:
                # Minimal drawn fallback if asset missing/unreadable
                bg = (28, 29, 32)
                color = (239, 68, 68) if (status or '').lower() == 'failed' else (234, 179, 8)
                text = '×' if (status or '').lower() == 'failed' else '!'
                img = Image.new('RGB', (size, size), bg)
                draw = ImageDraw.Draw(img)
                margin = 12
                rect = (margin, margin, size - margin, size - margin)
                try:
                    draw.rounded_rectangle(rect, radius=10, fill=color)
                except Exception:
                    draw.rectangle(rect, fill=color)
                try:
                    font = ImageFont.load_default()
                except Exception:
                    font = None
                if font is not None:
                    try:
                        bbox = draw.textbbox((0, 0), text, font=font)
                        tw = bbox[2] - bbox[0]
                        th = bbox[3] - bbox[1]
                    except Exception:
                        tw, th = draw.textlength(text, font=font), 10
                    tx = (size - tw) // 2
                    ty = (size - th) // 2
                    draw.text((tx, ty), text, font=font, fill=(255, 255, 255))

            buf = BytesIO()
            try:
                pnginfo = PngInfo()
                if workflow_json:
                    pnginfo.add_text('prompt', workflow_json)
                # Save lossless PNG to preserve colors and avoid artifacts
                img.save(buf, format='PNG', pnginfo=pnginfo, compress_level=4)
            except Exception:
                img.save(buf, format='PNG', compress_level=4)
            data = buf.getvalue()
            return {
                'idx': 0,
                'mime': 'image/png',
                'width': img.size[0],
                'height': img.size[1],
                'data': data,
            }
        except Exception:
            return None

    def _extract_image_descriptors(self, outputs: dict) -> List[Dict[str, Any]]:
        images: List[Dict[str, Any]] = []
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
            return []
        return images

    def _encode_single_thumbnail(self, desc: Dict[str, Any], idx: int, *, workflow_json: Optional[str], extras: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        filename = desc.get('filename') or desc.get('name')
        folder_type = desc.get('type') or 'output'
        subfolder = desc.get('subfolder') or ''

        base_dir = folder_paths.get_directory_by_type(folder_type)
        if base_dir is None:
            return None
        img_dir = base_dir
        if subfolder:
            full_output_dir = os.path.join(base_dir, subfolder)
            if os.path.commonpath((os.path.abspath(full_output_dir), base_dir)) != base_dir:
                return None
            img_dir = full_output_dir
        file_path = os.path.join(img_dir, os.path.basename(filename))
        if not os.path.isfile(file_path):
            return None

        try:
            with Image.open(file_path) as img:
                # Resize preserving aspect ratio to fit within max_size
                w, h = img.size
                scale = min(self.max_size / max(1, w), self.max_size / max(1, h), 1.0)
                new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                if hasattr(Image, 'Resampling'):
                    resampling = Image.Resampling.LANCZOS
                else:
                    resampling = Image.LANCZOS
                thumb_img = img.convert('RGB').resize(new_size, resampling)
                buf = BytesIO()
                # Embed workflow metadata into WEBP EXIF so drag-and-drop works
                try:
                    exif = thumb_img.getexif()
                    if workflow_json:
                        # Comfy expects 'prompt:<json>' in 0x0110 for WEBP
                        exif[0x0110] = "prompt:{}".format(workflow_json)
                    if extras:
                        tag = 0x010F
                        for k, v in extras.items():
                            try:
                                exif[tag] = f"{k}:{json.dumps(v)}"
                            except Exception:
                                pass
                            tag -= 1
                    thumb_img.save(buf, format='WEBP', quality=self.quality, exif=exif)
                except Exception:
                    thumb_img.save(buf, format='WEBP', quality=self.quality)
                data = buf.getvalue()
                return {
                    'idx': idx,
                    'mime': 'image/webp',
                    'width': new_size[0],
                    'height': new_size[1],
                    'data': data,
                }
        except Exception:
            return None

class QueueHookManager:
    """Manages installation/uninstallation of queue hooks.

    Responsible for wrapping prompt queue methods to add persistence and pause behavior.
    """

    def __init__(self, *, is_paused_fn: Callable[[], bool], on_job_started: Callable[[str], None], on_task_done: Callable[[Any, Any, Any], None], should_run_when_paused: Optional[Callable[[str], bool]] = None):
        self._original_queue_get = None
        self._original_task_done = None
        self._installed = False
        self._is_paused = is_paused_fn
        self._on_job_started = on_job_started
        self._on_task_done = on_task_done
        self._should_run_when_paused = should_run_when_paused

    def install(self) -> None:
        """Install hooks into execution.PromptQueue if not already installed."""
        if self._installed:
            return
        import execution

        if self._original_queue_get is None:
            self._original_queue_get = execution.PromptQueue.get

            def get_wrapper(q_self, timeout=None):
                # If paused, only allow items explicitly permitted by the manager (run-selected mode)
                try:
                    if self._is_paused():
                        allowed = False
                        if callable(self._should_run_when_paused):
                            try:
                                top = q_self.queue[0] if getattr(q_self, 'queue', None) else None
                            except Exception:
                                top = None
                            if top is not None:
                                try:
                                    top_pid = str(top[1])
                                    allowed = bool(self._should_run_when_paused(top_pid))
                                except Exception:
                                    allowed = False
                        if not allowed:
                            time.sleep(0.1)
                            return None
                except Exception:
                    # If anything goes wrong during checks, be safe and respect pause
                    if self._is_paused():
                        time.sleep(0.1)
                        return None

                result = self._original_queue_get(q_self, timeout=timeout)
                if result is not None:
                    try:
                        item, _item_id = result
                        prompt_id = item[1]
                        # If paused, ensure the popped item is allowed; otherwise, reinsert and yield None
                        if self._is_paused() and callable(self._should_run_when_paused):
                            try:
                                if not self._should_run_when_paused(str(prompt_id)):
                                    try:
                                        q_self.queue.append(item)
                                        heapq.heapify(q_self.queue)
                                    except Exception:
                                        pass
                                    time.sleep(0.05)
                                    return None
                            except Exception:
                                time.sleep(0.05)
                                return None
                        self._on_job_started(prompt_id)
                    except Exception as e:
                        logging.debug(f"QueueHookManager get_wrapper failed: {e}")
                return result

            execution.PromptQueue.get = get_wrapper

        if self._original_task_done is None:
            self._original_task_done = execution.PromptQueue.task_done

            def task_done_wrapper(q_self, item_id, history_result, status):
                try:
                    self._on_task_done((q_self, item_id, history_result, status))
                except Exception as e:
                    logging.debug(f"QueueHookManager task_done on_task_done failed: {e}")
                self._original_task_done(q_self, item_id, history_result, status)

            execution.PromptQueue.task_done = task_done_wrapper

        self._installed = True

    def uninstall(self) -> None:
        """Restore original methods."""
        if not self._installed:
            return
        import execution
        if self._original_queue_get is not None:
            execution.PromptQueue.get = self._original_queue_get
            self._original_queue_get = None
        if self._original_task_done is not None:
            execution.PromptQueue.task_done = self._original_task_done
            self._original_task_done = None
        self._installed = False

class RoutesHelper:
    """Registers HTTP routes for the persistent queue API."""

    def __init__(self, app: Any):
        self.app = app

    def register(self, manager: "PersistentQueueManager") -> None:
        routes = [
            web.get('/api/pqueue', manager._api_get_pqueue),
            web.get('/api/pqueue/history', manager._api_get_history),
            web.get('/api/pqueue/history/thumb/{history_id:\\d+}', manager._api_get_history_thumb),
            web.get('/api/pqueue/preview', manager._api_preview_image),
            web.post('/api/pqueue/pause', manager._api_pause),
            web.post('/api/pqueue/resume', manager._api_resume),
            web.post('/api/pqueue/reorder', manager._api_reorder),
            web.patch('/api/pqueue/priority', manager._api_priority),
            web.post('/api/pqueue/delete', manager._api_delete),
            web.patch('/api/pqueue/rename', manager._api_rename),
            web.post('/api/pqueue/run-selected', manager._api_run_selected),
            web.post('/api/pqueue/skip-selected', manager._api_skip_selected),
        ]
        self.app.add_routes(routes)

class PersistentQueueManager:
    """Coordinator for persistent queue persistence, API handlers, and hooks."""

    def __init__(self):
        self.db: QueueDatabase = QueueDatabase()
        self.thumbs: ThumbnailService = ThumbnailService(max_size=128, quality=60)
        # Default to paused state on startup for safety - user can resume when ready
        self.paused: bool = True
        self.current_job: Optional[Any] = None
        self._installed: bool = False
        self._hooks: Optional[QueueHookManager] = None
        # IDs allowed to run while paused (run-selected mode)
        self._run_selected_remaining: Set[str] = set()

    def initialize(self) -> None:
        """Install hooks and API routes after PromptServer is created."""
        if self._installed:
            return

        # Import here to avoid circular dependencies
        from server import PromptServer

        # Register on-prompt handler to persist incoming prompts
        PromptServer.instance.add_on_prompt_handler(self._on_prompt)

        # Install queue hooks
        self._hooks = QueueHookManager(
            is_paused_fn=lambda: self.paused,
            on_job_started=lambda prompt_id: self.db.update_job_status(prompt_id, 'running'),
            on_task_done=self._on_task_done_persist,
            should_run_when_paused=self._is_prompt_allowed_while_paused,
        )
        self._hooks.install()

        # Add API routes
        try:
            app = PromptServer.instance.app
            RoutesHelper(app).register(self)
        except Exception as e:
            logging.debug(f"PersistentQueue add routes failed: {e}")

        # Restore pending jobs on startup
        self._schedule_restore_pending_jobs()

        self._installed = True
        
        # Log initial state
        logging.info("PersistentQueue initialized in PAUSED state. Use UI to resume queue processing.")

    def _on_task_done_persist(self, args: Tuple[Any, Any, Any]) -> None:
        """Persist history and generate thumbnails before original task_done completes.

        Args:
            args: Tuple of (q_self, item_id, history_result, status) from task_done wrapper.
        """
        try:
            q_self, item_id, history_result, status = args
            item = q_self.currently_running.get(item_id)
            if item is None:
                return
            prompt_id = item[1]
            prompt = item[2]
            status_str = status.status_str if status is not None else 'success'
            completed = (status.completed if status is not None else True)
            cancelled = isinstance(status_str, str) and status_str.lower() in ('cancelled', 'canceled', 'interrupted', 'cancel')
            new_state = 'completed'
            if not completed:
                new_state = 'interrupted' if cancelled else 'failed'
            # Persist history and thumbnails BEFORE notifying original logic, to avoid UI race
            self.db.update_job_status(prompt_id, new_state, error=None if completed else status_str)
            # Ensure any user-provided rename is reflected in the workflow stored to history
            try:
                if isinstance(prompt, dict):
                    # If DB has a more recent renamed workflow JSON, prefer its name field(s)
                    db_row = self.db.get_job(prompt_id)
                    if db_row and db_row.get('workflow'):
                        try:
                            db_wf = json.loads(db_row['workflow']) if isinstance(db_row['workflow'], str) else db_row['workflow']
                        except Exception:
                            db_wf = None
                        if isinstance(db_wf, dict):
                            def _extract_name(wf):
                                try:
                                    return (wf.get('workflow') or {}).get('name') or wf.get('name')
                                except Exception:
                                    return None
                            db_name = _extract_name(db_wf)
                            if isinstance(db_name, str) and db_name.strip():
                                if isinstance(prompt.get('workflow'), dict):
                                    prompt['workflow']['name'] = db_name.strip()
                                else:
                                    prompt['name'] = db_name.strip()
            except Exception:
                pass

            history_id = self.db.add_history(
                prompt_id=prompt_id,
                workflow=prompt,
                outputs=history_result.get('outputs', {}),
                status=status_str,
                duration_seconds=None,
            )
            try:
                workflow_json = json.dumps(prompt) if isinstance(prompt, (dict, list)) else str(prompt)
                outputs = history_result.get('outputs', {})
                thumbs = self.thumbs.generate_thumbnails_from_outputs(outputs, workflow_json=workflow_json, extras=None)
                if not thumbs:
                    ph = self.thumbs.generate_placeholder_thumbnail(new_state, workflow_json=workflow_json)
                    if ph:
                        thumbs = [ph]
                if thumbs:
                    self.db.save_history_thumbnails(history_id, thumbs)
            except Exception as te:
                logging.debug(f"PersistentQueue: failed to save thumbnails: {te}")
        except Exception as e:
            logging.debug(f"PersistentQueue _on_task_done_persist failed: {e}")
        # After persisting, if we are in run-selected mode, update remaining set
        try:
            q_self, item_id, history_result, status = args
            item = q_self.currently_running.get(item_id)
            if item is not None:
                pid = str(item[1])
                if pid in self._run_selected_remaining:
                    self._run_selected_remaining.discard(pid)
                    if not self._run_selected_remaining:
                        # All selected jobs finished; keep queue paused and clear state
                        logging.info("PersistentQueue: Finished all selected jobs; queue remains paused.")
        except Exception:
            pass
    
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
        # Ensure queued list is sorted by execution order (heap array is not fully ordered)
        try:
            queued_sorted = sorted(queued, key=lambda it: (it[0], str(it[1])))
        except Exception:
            queued_sorted = queued
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
            "queue_pending": queued_sorted,
            "running_progress": progress_map,
            # Provide DB rows for ALL visible queue items (pending + running) so UI
            # can derive labels (including renamed names) even after status changes
            "db_by_id": self._build_db_lookup_for_queue_items(running, queued_sorted),
        })

    def _build_db_lookup_for_queue_items(self, running: List[Tuple], queued: List[Tuple]) -> Dict[str, Dict[str, Any]]:
        """Return a mapping of prompt_id -> DB row for all running and queued items.

        Includes at least the workflow text so the UI can derive renamed labels.
        """
        try:
            pids_set: Set[str] = set()
            try:
                for it in running or []:
                    try:
                        pids_set.add(str(it[1]))
                    except Exception:
                        pass
            except Exception:
                pass
            try:
                for it in queued or []:
                    try:
                        pids_set.add(str(it[1]))
                    except Exception:
                        pass
            except Exception:
                pass
            pids = [pid for pid in pids_set if pid]
            if not pids:
                return {}
            rows: Dict[str, Dict[str, Any]] = {}
            # Prefer a single SQL round-trip
            try:
                with self.db._get_conn() as conn:
                    placeholders = ",".join(["?"] * len(pids))
                    cur = conn.execute(f"SELECT * FROM queue_items WHERE prompt_id IN ({placeholders})", tuple(pids))
                    for r in cur.fetchall():
                        try:
                            d = dict(r)
                            pid = str(d.get('prompt_id')) if d.get('prompt_id') is not None else None
                            if pid:
                                rows[pid] = d
                        except Exception:
                            pass
            except Exception:
                # Fallback to per-id lookup if bulk query fails
                for pid in pids:
                    try:
                        row = self.db.get_job(pid)
                        if row:
                            rows[pid] = row
                    except Exception:
                        pass
            return rows
        except Exception:
            return {}

    async def _api_get_history(self, request: web.Request) -> web.Response:
        # Support both simple and paginated calls. Frontend can pass sort/filter + cursor for keyset pagination.
        q = request.rel_url.query
        try:
            limit = int(q.get("limit", "50"))
        except Exception:
            limit = 50

        sort_by = q.get("sort_by") or "id"
        sort_dir = q.get("sort_dir") or "desc"

        # Cursor-based pagination
        cursor_id = None
        cursor_value = None
        try:
            if q.get("cursor_id") is not None:
                cursor_id = int(q.get("cursor_id"))
        except Exception:
            cursor_id = None
        if q.get("cursor_value") is not None:
            cursor_value = q.get("cursor_value")

        status = q.get("status")
        search_q = q.get("q")
        since = q.get("since")
        until = q.get("until")
        try:
            min_duration = float(q.get("min_duration")) if q.get("min_duration") is not None else None
        except Exception:
            min_duration = None
        try:
            max_duration = float(q.get("max_duration")) if q.get("max_duration") is not None else None
        except Exception:
            max_duration = None

        # If only limit is provided and no advanced params, keep legacy behavior
        legacy_mode = (
            (q.keys() <= {"limit"}) or
            (set(q.keys()) == set() )
        )
        if legacy_mode:
            return web.json_response({"history": self.db.list_history(limit=limit)})

        result = self.db.list_history_paginated(
            limit=limit,
            sort_by=sort_by,
            sort_dir=sort_dir,
            cursor_id=cursor_id,
            cursor_value=cursor_value,
            status=status,
            q=search_q,
            since=since,
            until=until,
            min_duration=min_duration,
            max_duration=max_duration,
        )
        return web.json_response(result)

    # _generate_thumbnails_from_outputs removed in favor of ThumbnailService

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

    async def _api_rename(self, request: web.Request) -> web.Response:
        try:
            from server import PromptServer
            body = await request.json()
            prompt_id: str = body.get('prompt_id')
            new_name: str = body.get('name')
            if not prompt_id or new_name is None:
                return web.json_response({"ok": False, "error": "prompt_id and name required"}, status=400)
            # Persist to DB
            ok = self.db.update_job_name(prompt_id, str(new_name))
            if not ok:
                return web.json_response({"ok": False, "error": "job not found"}, status=404)
            # Update in-memory queue copy to reflect quickly
            q = PromptServer.instance.prompt_queue
            with q.mutex:
                for idx, item in enumerate(list(q.queue)):
                    try:
                        if item[1] == prompt_id:
                            # item = (number, prompt_id, prompt, extra_data, outputs_to_execute)
                            prompt = item[2]
                            if isinstance(prompt, dict):
                                if isinstance(prompt.get('workflow'), dict):
                                    prompt['workflow']['name'] = str(new_name)
                                else:
                                    prompt['name'] = str(new_name)
                                q.queue[idx] = (item[0], item[1], prompt, item[3], item[4])
                    except Exception:
                        pass
            return web.json_response({"ok": True})
        except Exception as e:
            logging.warning(f"PersistentQueue rename failed: {e}")
            return web.json_response({"ok": False, "error": str(e)}, status=400)
    
    async def _api_run_selected(self, request: web.Request) -> web.Response:
        """Run selected jobs when queue is paused"""
        try:
            from server import PromptServer
            import execution
            body = await request.json()
            prompt_ids: List[str] = body.get('prompt_ids', [])
            
            logging.info(f"PersistentQueue: run_selected called with {len(prompt_ids)} jobs: {prompt_ids}")
            logging.info(f"PersistentQueue: paused state = {self.paused}")
            
            if not self.paused:
                return web.json_response({"ok": False, "error": "Queue must be paused to run selected jobs"}, status=400)
            
            q = PromptServer.instance.prompt_queue
            server_instance = PromptServer.instance
            
            # First, ensure selected jobs are properly loaded into the queue
            executed_ids = []
            selected_items = []
            
            # Prepare selected items and determine order by queue number (ascending = top-most first)
            missing_ids: List[str] = []
            with q.mutex:
                # Map current queue items by prompt_id
                queue_by_id = {str(item[1]): item for item in q.queue}

                selected_set = set(map(str, prompt_ids))
                # Sort selected that are present by their current number descending (newest/bottom first)
                selected_present = [queue_by_id[pid] for pid in selected_set if pid in queue_by_id]
                selected_present_sorted = sorted(selected_present, key=lambda it: it[0])
                executed_ids = [str(it[1]) for it in selected_present_sorted]

                # Any selected IDs not in queue are missing; handle after lock
                missing_ids = [pid for pid in map(str, prompt_ids) if pid not in queue_by_id]

            # Load and validate any missing selected from DB (outside of queue lock)
            for prompt_id in missing_ids:
                job = self.db.get_job(prompt_id)
                if not job:
                    continue
                try:
                    workflow_json = job["workflow"]
                    prompt = json.loads(workflow_json) if isinstance(workflow_json, str) else workflow_json
                    # Clean rename metadata
                    if isinstance(prompt, dict):
                        if 'workflow' in prompt and isinstance(prompt['workflow'], dict):
                            prompt.pop('workflow', None)
                        if 'name' in prompt and isinstance(prompt['name'], str):
                            prompt.pop('name', None)
                    valid, err, outputs_to_execute, node_errors = await execution.validate_prompt(prompt_id, prompt, None)
                    if valid:
                        number = server_instance.number
                        server_instance.number += 1
                        extra_data = {}
                        item = (number, prompt_id, prompt, extra_data, outputs_to_execute)
                        # Insert this new item at end for now; reorder shortly
                        with q.mutex:
                            q.queue.append(item)
                            heapq.heapify(q.queue)
                        executed_ids.append(prompt_id)
                    else:
                        logging.warning(f"PersistentQueue: Invalid prompt {prompt_id}: {err}")
                except Exception as e:
                    logging.error(f"PersistentQueue: Failed to load job {prompt_id}: {e}")

            # Rebuild queue with selected items first, preserving their relative order by number (desc)
            if executed_ids:
                with q.mutex:
                    # Build final selected from current queue and sort by number asc to preserve queue order
                    current_by_id = {str(item[1]): item for item in q.queue}
                    selected_final = [current_by_id[pid] for pid in executed_ids if pid in current_by_id]
                    selected_final_sorted = sorted(selected_final, key=lambda it: it[0])
                    selected_ids_final = [str(it[1]) for it in selected_final_sorted]
                self._rebuild_queue_by_prompt_ids(selected_ids_final)
            
            # Enable run-selected mode while keeping queue paused so only selected items run
            self._run_selected_remaining = set(map(str, executed_ids))
            logging.info(f"PersistentQueue: Run-selected mode enabled for {len(executed_ids)} jobs; queue remains paused")
            
            return web.json_response({"ok": True, "executed": executed_ids})
        except Exception as e:
            logging.error(f"PersistentQueue run selected failed: {e}", exc_info=True)
            return web.json_response({"ok": False, "error": str(e)}, status=500)
    
    async def _api_skip_selected(self, request: web.Request) -> web.Response:
        """Skip selected jobs (remove from queue)"""
        try:
            from server import PromptServer
            body = await request.json()
            prompt_ids: List[str] = body.get('prompt_ids', [])
            
            if self.paused:
                return web.json_response({"ok": False, "error": "Queue must be running to skip jobs"}, status=400)
            
            q = PromptServer.instance.prompt_queue
            skipped_ids = []
            
            for pid in prompt_ids:
                try:
                    q.delete(pid)
                    self.db.update_job_status(pid, 'cancelled')
                    skipped_ids.append(pid)
                except Exception:
                    pass
                    
            return web.json_response({"ok": True, "skipped": skipped_ids})
        except Exception as e:
            logging.warning(f"PersistentQueue skip selected failed: {e}")
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    def _rebuild_queue_by_prompt_ids(self, selected_ids_in_order: List[str]) -> None:
        """Promote only the selected prompt_ids to the front and leave others unchanged.

        The selected_ids_in_order must be in desired execution order (first executes first).
        We assign them numbers lower than any existing number to ensure they run next,
        while keeping all other items' numbers intact to preserve global order.
        """
        from server import PromptServer
        q = PromptServer.instance.prompt_queue
        with q.mutex:
            # Normalize to strings for safe comparisons
            sel_ids = [str(pid) for pid in selected_ids_in_order]
            pos_map: Dict[str, int] = {pid: idx for idx, pid in enumerate(sel_ids)}
            selected_set = set(sel_ids)

            # Find current minimum number so we can place selected before it
            try:
                min_num = min((it[0] for it in q.queue), default=0)
            except Exception:
                min_num = 0
            new_num_start = min_num - len(sel_ids)

            new_items: List[Tuple] = []
            for old in q.queue:
                pid = str(old[1])
                prompt = old[2]
                # Clean rename metadata for all items to avoid accidental drift
                if isinstance(prompt, dict) and ('workflow' in prompt or 'name' in prompt):
                    prompt = {k: v for k, v in prompt.items() if k not in ['workflow', 'name']}
                if pid in selected_set:
                    idx = pos_map.get(pid, 0)
                    new_num = new_num_start + idx
                    new_items.append((new_num, old[1], prompt, old[3], old[4]))
                else:
                    # Keep existing number to preserve original order
                    new_items.append((old[0], old[1], prompt, old[3], old[4]))

            q.queue = new_items
            heapq.heapify(q.queue)
            q.server.queue_updated()
            try:
                # Nudge workers to pick up newly promoted items immediately
                q.not_empty.notify_all()
            except Exception:
                pass

    def _is_prompt_allowed_while_paused(self, prompt_id: str) -> bool:
        try:
            return str(prompt_id) in self._run_selected_remaining
        except Exception:
            return False

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
                web.patch('/api/pqueue/rename', self._api_rename),
                web.post('/api/pqueue/run-selected', self._api_run_selected),
                web.post('/api/pqueue/skip-selected', self._api_skip_selected),
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
        """Serve cached previews with embedded workflow metadata if available.

        Splits concerns into small helpers to keep logic simple (KISS/DRY).
        """
        try:
            params = self._parse_preview_params(request)
            file = self._resolve_preview_filepath(params)
            if file is None:
                return web.Response(status=400)
            if not os.path.isfile(file):
                return web.Response(status=404)

            cache_path = self._compute_preview_cache_path(file, params)
            if cache_path and os.path.exists(cache_path):
                return web.FileResponse(cache_path, headers={"Content-Disposition": f"filename=\"{params['filename']}\""})

            # Render and cache
            cache_path = self._render_and_cache_preview(file, params, cache_path)
            return web.FileResponse(cache_path, headers={"Content-Disposition": f"filename=\"{params['filename']}\""})
        except Exception:
            return web.Response(status=500)

    def _parse_preview_params(self, request: web.Request) -> Dict[str, Any]:
        preview_q = request.rel_url.query.get('preview', 'webp;50')
        preview_info = preview_q.split(';')
        image_format = preview_info[0] if preview_info else 'webp'
        if image_format not in ['webp', 'jpeg', 'png']:
            image_format = 'webp'
        quality = 90
        if len(preview_info) > 1 and preview_info[-1].isdigit():
            quality = int(preview_info[-1])

        pid = request.rel_url.query.get('pid')
        return {
            'filename': request.rel_url.query.get('filename'),
            'subfolder': request.rel_url.query.get('subfolder', ''),
            'type': request.rel_url.query.get('type', 'output'),
            'pid': pid,
            'image_format': image_format,
            'quality': quality,
            'workflow_json': self._lookup_workflow_json(pid) if pid else None,
        }

    def _lookup_workflow_json(self, pid: Optional[str]) -> Optional[str]:
        if not pid:
            return None
        try:
            with self.db._get_conn() as conn:
                cur = conn.execute('SELECT workflow FROM job_history WHERE prompt_id = ? ORDER BY id DESC LIMIT 1', (pid,))
                row = cur.fetchone()
                if row and row['workflow']:
                    return row['workflow']
        except Exception:
            pass
        job = self.db.get_job(pid)
        if job:
            return job.get('workflow')
        return None

    def _resolve_preview_filepath(self, params: Dict[str, Any]) -> Optional[str]:
        base_dir = folder_paths.get_directory_by_type(params.get('type') or 'output')
        if base_dir is None:
            return None
        output_dir = base_dir
        subfolder = params.get('subfolder') or ''
        if subfolder:
            full_output_dir = os.path.join(base_dir, subfolder)
            if os.path.commonpath((os.path.abspath(full_output_dir), base_dir)) != base_dir:
                return None
            output_dir = full_output_dir
        filename = os.path.basename(params.get('filename') or '')
        return os.path.join(output_dir, filename)

    def _compute_preview_cache_path(self, file: str, params: Dict[str, Any]) -> Optional[str]:
        temp_dir = folder_paths.get_temp_directory()
        cache_dir = os.path.join(temp_dir, 'preview_cache')
        os.makedirs(cache_dir, exist_ok=True)
        wf_hash = hashlib.sha256(((params.get('workflow_json') or '')).encode('utf-8')).hexdigest()[:16]
        stat = os.stat(file)
        cache_key = f"{os.path.abspath(file)}|{stat.st_mtime}|{stat.st_size}|{params['image_format']}|{params['quality']}|{wf_hash}"
        cache_name = hashlib.sha256(cache_key.encode('utf-8')).hexdigest() + f'.{params["image_format"]}'
        return os.path.join(cache_dir, cache_name)

    def _render_and_cache_preview(self, file: str, params: Dict[str, Any], cache_path: Optional[str]) -> str:
        with Image.open(file) as img:
            save_kwargs: Dict[str, Any] = {"format": params['image_format']}
            if params['image_format'] in ['webp', 'jpeg']:
                save_kwargs['quality'] = params['quality']

            # Embed metadata
            workflow_json = params.get('workflow_json')
            if params['image_format'] == 'webp':
                self._embed_webp_metadata(img, save_kwargs, workflow_json)
            elif params['image_format'] == 'png':
                self._embed_png_metadata(img, save_kwargs, workflow_json)

            img.save(cache_path, **save_kwargs)
        return cache_path

    def _embed_webp_metadata(self, img: Image.Image, save_kwargs: Dict[str, Any], workflow_json: Optional[str]) -> None:
        try:
            exif = img.getexif()
            if hasattr(img, 'text'):
                for k in img.text:
                    val = img.text[k]
                    if k == 'prompt':
                        exif[0x0110] = "prompt:{}".format(val)
                    else:
                        tag = 0x010F
                        try:
                            exif[tag] = f"{k}:{val}"
                        except Exception:
                            pass
            if workflow_json:
                try:
                    exif[0x010E] = "workflow:{}".format(workflow_json)
                except Exception:
                    pass
            save_kwargs['exif'] = exif
        except Exception:
            pass

    def _embed_png_metadata(self, img: Image.Image, save_kwargs: Dict[str, Any], workflow_json: Optional[str]) -> None:
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

queue_manager = PersistentQueueManager()