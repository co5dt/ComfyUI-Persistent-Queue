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
        self._backfilled_once = False
    
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
            # Thumbnails for job history entries
            conn.execute('''
                CREATE TABLE IF NOT EXISTS history_thumbs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    history_id INTEGER NOT NULL,
                    idx INTEGER NOT NULL,
                    mime TEXT DEFAULT 'image/webp',
                    width INTEGER,
                    height INTEGER,
                    data BLOB NOT NULL,
                    UNIQUE(history_id, idx)
                )
            ''')
            # Helpful indexes for pagination and filtering
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_job_history_status ON job_history(status)')
            except Exception:
                pass
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_job_history_completed_at ON job_history(completed_at)')
            except Exception:
                pass
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_job_history_created_at ON job_history(created_at)')
            except Exception:
                pass
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_job_history_duration ON job_history(duration_seconds)')
            except Exception:
                pass
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_history_thumbs_history_id ON history_thumbs(history_id)')
            except Exception:
                pass
            # No schema migrations for now; keep it simple
    
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
            elif status in ('completed', 'failed', 'interrupted'):
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

    def update_job_name(self, prompt_id: str, new_name: str) -> bool:
        """Update the human-friendly name in the stored workflow JSON.

        Attempts to set either workflow.name (nested) or top-level name, depending on structure.
        Returns True on success, False if no such job.
        """
        with self._get_conn() as conn:
            cur = conn.execute('SELECT workflow FROM queue_items WHERE prompt_id = ? LIMIT 1', (prompt_id,))
            row = cur.fetchone()
            if not row:
                return False
            wf_text = row['workflow']
            try:
                wf = json.loads(wf_text) if isinstance(wf_text, str) else (wf_text or {})
            except Exception:
                wf = {}
            # Prefer nested workflow.name if object contains a workflow field
            if isinstance(wf, dict):
                if isinstance(wf.get('workflow'), dict):
                    wf['workflow']['name'] = str(new_name)
                else:
                    wf['name'] = str(new_name)
            updated = json.dumps(wf) if wf is not None else None
            conn.execute('UPDATE queue_items SET workflow = ? WHERE prompt_id = ?', (updated, prompt_id))
            return True

    def add_history(
        self,
        prompt_id: str,
        workflow: dict,
        outputs: Optional[dict],
        status: str,
        duration_seconds: Optional[float] = None,
    ) -> int:
        with self._get_conn() as conn:
            # Prefer accurate timestamps from queue_items when available
            def _parse_dt(val: Any) -> Optional[datetime]:
                if val is None:
                    return None
                if isinstance(val, datetime):
                    return val
                if isinstance(val, str):
                    try:
                        # sqlite will store Python datetimes as strings like 'YYYY-MM-DD HH:MM:SS[.ffffff]'
                        return datetime.fromisoformat(val)
                    except Exception:
                        return None
                return None

            created_at = None
            completed_at = None
            try:
                cur = conn.execute(
                    'SELECT created_at, started_at, completed_at FROM queue_items WHERE prompt_id = ?',
                    (prompt_id,),
                )
                row = cur.fetchone()
                if row:
                    started = _parse_dt(row['started_at'])
                    created = _parse_dt(row['created_at'])
                    completed = _parse_dt(row['completed_at'])
                    created_at = started or created or datetime.now()
                    completed_at = completed or datetime.now()
                    if duration_seconds is None and created_at and completed_at:
                        try:
                            duration_seconds = max(0.0, (completed_at - created_at).total_seconds())
                        except Exception:
                            duration_seconds = None
            except Exception:
                # Fallback to now if any error occurs
                pass

            if created_at is None:
                created_at = datetime.now()
            if completed_at is None:
                completed_at = created_at

            cur = conn.execute(
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
            return int(cur.lastrowid)

    def save_history_thumbnails(self, history_id: int, thumbs: List[Dict[str, Any]]) -> None:
        """Store one or more thumbnails for a history row. Each item: {idx, mime, width, height, data(bytes)}"""
        if not thumbs:
            return
        with self._get_conn() as conn:
            for t in thumbs:
                conn.execute(
                    '''
                    INSERT OR REPLACE INTO history_thumbs (history_id, idx, mime, width, height, data)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        int(history_id),
                        int(t.get('idx', 0)),
                        t.get('mime', 'image/webp'),
                        int(t.get('width') or 0),
                        int(t.get('height') or 0),
                        t.get('data'),
                    )
                )

    def get_history_thumbnail(self, history_id: int, idx: int = 0) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            cur = conn.execute(
                'SELECT mime, width, height, data FROM history_thumbs WHERE history_id = ? AND idx = ? LIMIT 1',
                (int(history_id), int(idx))
            )
            row = cur.fetchone()
            if not row:
                return None
            return { 'mime': row['mime'], 'width': row['width'], 'height': row['height'], 'data': row['data'] }

    def list_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            # On-the-fly lightweight backfill for rows missing duration or with identical timestamps
            try:
                if not self._backfilled_once:
                    self._backfill_history_rows(conn)
                    self._backfilled_once = True
            except Exception:
                # Non-fatal if backfill fails
                pass

            cur = conn.execute(
                'SELECT * FROM job_history ORDER BY id DESC LIMIT ?', (limit,)
            )
            return [dict(row) for row in cur.fetchall()]

    def list_history_paginated(
        self,
        *,
        limit: int = 50,
        sort_by: str = "id",
        sort_dir: str = "desc",
        cursor_id: Optional[int] = None,
        cursor_value: Optional[Any] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        min_duration: Optional[float] = None,
        max_duration: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Keyset paginated history listing supporting basic filtering and sorting.

        Returns a dict: {
            'history': [...],
            'next_cursor': { 'id': int, 'value': any }|None,
            'has_more': bool,
            'total': int  # total rows matching filters (ignores cursor and limit)
        }
        """
        # Normalize and validate inputs
        sort_by = (sort_by or "id").lower()
        if sort_by not in ("id", "completed_at", "created_at", "duration_seconds"):
            sort_by = "id"
        sort_dir = (sort_dir or "desc").lower()
        if sort_dir not in ("asc", "desc"):
            sort_dir = "desc"
        dir_op = ">" if sort_dir == "asc" else "<"

        where_clauses: List[str] = []
        params: List[Any] = []

        if status:
            where_clauses.append("LOWER(status) = LOWER(?)")
            params.append(status)

        # Time range filters apply to completed_at when available, else created_at
        # For simplicity, filter both columns when provided
        if since:
            where_clauses.append("(completed_at >= ? OR (completed_at IS NULL AND created_at >= ?))")
            params.extend([since, since])
        if until:
            where_clauses.append("(completed_at <= ? OR (completed_at IS NULL AND created_at <= ?))")
            params.extend([until, until])

        if min_duration is not None:
            where_clauses.append("duration_seconds >= ?")
            params.append(float(min_duration))
        if max_duration is not None:
            where_clauses.append("duration_seconds <= ?")
            params.append(float(max_duration))

        if q:
            like = f"%{q}%"
            where_clauses.append("(prompt_id LIKE ? OR (workflow IS NOT NULL AND workflow LIKE ?) OR (outputs IS NOT NULL AND outputs LIKE ?))")
            params.extend([like, like, like])

        # Keyset pagination cursor
        keyset_clause = None
        if sort_by == "id":
            if cursor_id is not None:
                keyset_clause = f"id {dir_op} ?"
                params.append(int(cursor_id))
        else:
            if cursor_value is not None and cursor_id is not None:
                # Composite keyset for stable ordering
                cmp = ">" if sort_dir == "asc" else "<"
                keyset_clause = f"(({sort_by} {cmp} ?) OR ({sort_by} = ? AND id {cmp} ?))"
                params.extend([cursor_value, cursor_value, int(cursor_id)])

        # Preserve filter-only clauses/params for total count
        filter_only_clauses = list(where_clauses)
        filter_only_params = list(params)

        if keyset_clause:
            where_clauses.append(keyset_clause)

        where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        order_sql = f" ORDER BY {sort_by} {sort_dir.upper()}, id {sort_dir.upper()}"

        rows: List[Dict[str, Any]] = []
        has_more = False
        next_cursor: Optional[Dict[str, Any]] = None
        with self._get_conn() as conn:
            # backfill pass once per process lifetime
            try:
                if not self._backfilled_once:
                    self._backfill_history_rows(conn)
                    self._backfilled_once = True
            except Exception:
                pass

            sql = f"SELECT * FROM job_history{where_sql}{order_sql} LIMIT ?"
            try:
                cur = conn.execute(sql, (*params, int(limit) + 1))
                fetched = [dict(row) for row in cur.fetchall()]
            except Exception:
                fetched = []

            if len(fetched) > int(limit):
                has_more = True
                fetched = fetched[: int(limit)]

            rows = fetched
            if rows:
                last = rows[-1]
                val = last.get(sort_by)
                next_cursor = {"id": last.get("id"), "value": val}

            # Compute total count for filters (without keyset and limit)
            total = 0
            try:
                where_only_sql = (" WHERE " + " AND ".join(filter_only_clauses)) if filter_only_clauses else ""
                count_sql = f"SELECT COUNT(*) AS c FROM job_history{where_only_sql}"
                cur = conn.execute(count_sql, (*filter_only_params,))
                row = cur.fetchone()
                if row is not None:
                    # sqlite3.Row supports index and key access
                    total = int(row[0] if 0 in row.keys() else (row["c"] if "c" in row.keys() else row[0]))
            except Exception:
                total = 0

        return {"history": rows, "next_cursor": next_cursor, "has_more": has_more, "total": total}

    def get_job_timestamps_and_workflow(self, prompt_id: str) -> Optional[Dict[str, Any]]:
        """Return created_at/started_at/completed_at and workflow JSON (text) for a given prompt_id."""
        with self._get_conn() as conn:
            cur = conn.execute(
                'SELECT created_at, started_at, completed_at, workflow FROM queue_items WHERE prompt_id = ?',
                (prompt_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_average_duration_for_workflow(self, workflow_text: Optional[str], min_samples: int = 2) -> Optional[float]:
        """Compute an average historical duration for a given workflow text. Returns None if not enough data."""
        if not workflow_text:
            return None
        with self._get_conn() as conn:
            try:
                cur = conn.execute(
                    '''
                    SELECT duration_seconds FROM job_history 
                    WHERE workflow = ? AND duration_seconds IS NOT NULL AND duration_seconds > 0
                    ORDER BY id DESC LIMIT 20
                    ''',
                    (workflow_text,),
                )
                vals = [float(r['duration_seconds']) for r in cur.fetchall()]
                if len(vals) < min_samples:
                    return None
                # Use median for robustness
                vals.sort()
                n = len(vals)
                if n % 2 == 1:
                    return vals[n // 2]
                else:
                    return (vals[n // 2 - 1] + vals[n // 2]) / 2.0
            except Exception:
                return None

    def _backfill_history_rows(self, conn: sqlite3.Connection) -> None:
        """Compute and set duration_seconds/accurate timestamps for existing history rows when possible."""
        try:
            cur = conn.execute(
                '''
                SELECT j.id as jid, j.created_at as j_created, j.completed_at as j_completed, j.duration_seconds as j_dur,
                       j.prompt_id as pid, qi.created_at as qi_created, qi.started_at as qi_started, qi.completed_at as qi_completed
                FROM job_history j
                LEFT JOIN queue_items qi ON qi.prompt_id = j.prompt_id
                WHERE (j.duration_seconds IS NULL OR j.duration_seconds <= 0 OR j.created_at = j.completed_at)
                      AND qi.completed_at IS NOT NULL
                '''
            )
            rows = cur.fetchall()
            if not rows:
                return

            def _parse_dt(val: Any) -> Optional[datetime]:
                if val is None:
                    return None
                if isinstance(val, datetime):
                    return val
                if isinstance(val, str):
                    try:
                        return datetime.fromisoformat(val)
                    except Exception:
                        return None
                return None

            for r in rows:
                started = _parse_dt(r['qi_started']) or _parse_dt(r['qi_created']) or _parse_dt(r['j_created']) or datetime.now()
                completed = _parse_dt(r['qi_completed']) or _parse_dt(r['j_completed']) or started
                try:
                    dur = max(0.0, (completed - started).total_seconds())
                except Exception:
                    dur = None
                conn.execute(
                    'UPDATE job_history SET duration_seconds = ?, created_at = ?, completed_at = ? WHERE id = ?',
                    (dur, started, completed, r['jid'])
                )
        except Exception:
            # Ignore errors; not critical
            return