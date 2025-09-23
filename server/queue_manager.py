import asyncio
import json
import logging
import time
from typing import Optional, Any, Dict, Tuple

from aiohttp import web

from .database import QueueDatabase

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
                self._original_task_done(q_self, item_id, history_result, status)
                try:
                    if item is not None:
                        prompt_id = item[1]
                        prompt = item[2]
                        status_str = status.status_str if status is not None else 'success'
                        completed = (status.completed if status is not None else True)
                        new_state = 'completed' if completed else 'failed'
                        self.db.update_job_status(prompt_id, new_state, error=None if completed else status_str)
                        self.db.add_history(
                            prompt_id=prompt_id,
                            workflow=prompt,
                            outputs=history_result.get('outputs', {}),
                            status=status_str,
                            duration_seconds=None,
                        )
                except Exception as e:
                    logging.debug(f"PersistentQueue task_done wrapper persist failed: {e}")

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
        return web.json_response({
            "paused": self.paused,
            "db_pending": self.db.get_pending_jobs(),
            "queue_running": running,
            "queue_pending": queued,
        })

    async def _api_get_history(self, request: web.Request) -> web.Response:
        limit = int(request.rel_url.query.get("limit", "50"))
        return web.json_response({"history": self.db.list_history(limit=limit)})

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
                web.post('/api/pqueue/pause', self._api_pause),
                web.post('/api/pqueue/resume', self._api_resume),
                web.post('/api/pqueue/reorder', self._api_reorder),
                web.patch('/api/pqueue/priority', self._api_priority),
                web.post('/api/pqueue/delete', self._api_delete),
            ])
        except Exception as e:
            logging.debug(f"PersistentQueue add routes failed: {e}")

queue_manager = PersistentQueueManager()