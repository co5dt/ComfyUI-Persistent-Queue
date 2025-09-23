import os
import sqlite3
import json
from datetime import datetime
from typing import List, Optional, Dict, Any

import folder_paths

class QueueDatabase:
    def __init__(self, db_path: Optional[str] = None):
        # Default to ComfyUI user directory to ensure write permissions and persistence across updates
        if db_path is None:
            user_dir = folder_paths.get_user_directory()
            os.makedirs(user_dir, exist_ok=True)
            db_path = os.path.join(user_dir, "persistent_queue.sqlite3")
        self.db_path = db_path
        self._init_database()
    
    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        # Improve concurrency and durability for multi-threaded usage
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_database(self):
        """Create tables if they don't exist"""
        with self._get_conn() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS queue_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    prompt_id TEXT UNIQUE,
                    workflow TEXT,
                    priority INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    error TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS job_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    prompt_id TEXT,
                    workflow TEXT,
                    outputs TEXT,
                    duration_seconds REAL,
                    created_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    status TEXT
                )
            ''')
    
    def add_job(self, prompt_id: str, workflow: dict, priority: int = 0) -> None:
        """Add a job to the persistent queue"""
        with self._get_conn() as conn:
            conn.execute(
                '''
                INSERT OR IGNORE INTO queue_items (prompt_id, workflow, priority, created_at)
                VALUES (?, ?, ?, ?)
                ''',
                (prompt_id, json.dumps(workflow), priority, datetime.now()),
            )

    def remove_job(self, prompt_id: str) -> None:
        with self._get_conn() as conn:
            conn.execute('DELETE FROM queue_items WHERE prompt_id = ?', (prompt_id,))

    def get_job(self, prompt_id: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            cur = conn.execute('SELECT * FROM queue_items WHERE prompt_id = ?', (prompt_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_pending_jobs(self) -> List[Dict[str, Any]]:
        """Get all pending jobs ordered by priority (higher first), then created_at"""
        with self._get_conn() as conn:
            cursor = conn.execute(
                '''
                SELECT * FROM queue_items 
                WHERE status = 'pending'
                ORDER BY priority DESC, created_at ASC
                '''
            )
            return [dict(row) for row in cursor.fetchall()]

    def update_job_status(self, prompt_id: str, status: str, error: Optional[str] = None) -> None:
        """Update job status and timestamps"""
        with self._get_conn() as conn:
            if status == 'running':
                conn.execute(
                    '''
                    UPDATE queue_items 
                    SET status = ?, started_at = ?
                    WHERE prompt_id = ?
                    ''',
                    (status, datetime.now(), prompt_id),
                )
            elif status in ('completed', 'failed'):
                conn.execute(
                    '''
                    UPDATE queue_items 
                    SET status = ?, completed_at = ?, error = ?
                    WHERE prompt_id = ?
                    ''',
                    (status, datetime.now(), error, prompt_id),
                )

    def update_job_priority(self, prompt_id: str, new_priority: int) -> None:
        with self._get_conn() as conn:
            conn.execute('UPDATE queue_items SET priority = ? WHERE prompt_id = ?', (new_priority, prompt_id))

    def add_history(
        self,
        prompt_id: str,
        workflow: dict,
        outputs: Optional[dict],
        status: str,
        duration_seconds: Optional[float] = None,
    ) -> None:
        with self._get_conn() as conn:
            now = datetime.now()
            created_at = now
            completed_at = now
            conn.execute(
                '''
                INSERT INTO job_history (prompt_id, workflow, outputs, duration_seconds, created_at, completed_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    prompt_id,
                    json.dumps(workflow) if workflow is not None else None,
                    json.dumps(outputs) if outputs is not None else None,
                    duration_seconds,
                    created_at,
                    completed_at,
                    status,
                ),
            )

    def list_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            cur = conn.execute(
                'SELECT * FROM job_history ORDER BY id DESC LIMIT ?', (limit,)
            )
            return [dict(row) for row in cur.fetchall()]