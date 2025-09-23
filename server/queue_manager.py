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

    def _install_api_routes(self):
        try:
            from server import PromptServer
            app = PromptServer.instance.app
            app.add_routes([
                web.get('/api/pqueue', self._api_get_pqueue),
                web.get('/api/pqueue/history', self._api_get_history),
                web.post('/api/pqueue/pause', self._api_pause),
                web.post('/api/pqueue/resume', self._api_resume),
            ])
        except Exception as e:
            logging.debug(f"PersistentQueue add routes failed: {e}")

queue_manager = PersistentQueueManager()