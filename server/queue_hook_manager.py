import time
import heapq
import logging
from typing import Optional, Any, Callable


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


