"""Public job discovery and private application tracking."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .db import connect


class JobAction(BaseModel):
    saved: Optional[bool] = None
    stage: Optional[Literal['none', 'applied', 'interview', 'offer', 'rejected']] = None


def create_router(current_user):
    router = APIRouter()

    @router.get('/api/jobs')
    def list_jobs():
        with connect() as conn:
            rows = conn.execute('SELECT * FROM jobs WHERE active=1 ORDER BY updated_at DESC, id LIMIT 500').fetchall()
            sources = conn.execute('SELECT source, checked_at, count, error FROM job_sync_runs ORDER BY source').fetchall()
        return {'jobs': [dict(row) for row in rows], 'sources': [dict(row) for row in sources]}

    @router.get('/api/jobs/mine')
    def my_jobs(user=Depends(current_user)):
        with connect() as conn:
            rows = conn.execute('SELECT j.*, a.saved, a.stage FROM job_actions a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=?', (user['id'],)).fetchall()
        return {'jobs': [dict(row) for row in rows]}

    @router.patch('/api/jobs/{job_id}/action')
    def update_action(job_id: str, body: JobAction, user=Depends(current_user)):
        with connect() as conn:
            if not conn.execute('SELECT id FROM jobs WHERE id=?', (job_id,)).fetchone():
                raise HTTPException(404, '岗位不存在')
            conn.execute('INSERT OR IGNORE INTO job_actions(user_id,job_id) VALUES(?,?)', (user['id'], job_id))
            if body.saved is not None:
                conn.execute('UPDATE job_actions SET saved=?,updated_at=datetime(\'now\') WHERE user_id=? AND job_id=?', (int(body.saved), user['id'], job_id))
            if body.stage is not None:
                conn.execute('UPDATE job_actions SET stage=?,updated_at=datetime(\'now\') WHERE user_id=? AND job_id=?', (body.stage, user['id'], job_id))
            row = conn.execute('SELECT job_id,saved,stage FROM job_actions WHERE user_id=? AND job_id=?', (user['id'], job_id)).fetchone()
        return dict(row)

    return router
