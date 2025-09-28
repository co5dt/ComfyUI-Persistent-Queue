from typing import Any
from aiohttp import web


class RoutesHelper:
    """Registers HTTP routes for the persistent queue API."""

    def __init__(self, app: Any):
        self.app = app

    def register(self, manager: "PersistentQueueManager") -> None:
        routes = [
            web.get('/api/pqueue', manager._api_get_pqueue),
            web.get('/api/pqueue/export', manager._api_export_queue),
            web.post('/api/pqueue/import', manager._api_import_queue),
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


