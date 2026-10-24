"""First-person work accounts, kept separate from recruiting copy and matching."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .db import connect


class ExperienceBody(BaseModel):
    role_title: str = Field(default='', max_length=100)
    year: int
    body: str = Field(min_length=20, max_length=1600)
    confirmed: bool = False


class ExperienceReview(BaseModel):
    status: Literal['published', 'rejected']


class ExperienceReport(BaseModel):
    reason: Literal['包含隐私或机密', '疑似虚假经历', '攻击或广告', '其他问题']


def _job(conn, job_id):
    row = conn.execute('SELECT company,category,title FROM jobs WHERE id=?', (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, '岗位不存在')
    return row


def _public(row):
    # Moderation is not employment verification. Never expose contributor identity.
    return {key: row[key] for key in ('id', 'role_title', 'year', 'body', 'created_at')}


def create_router(current_user, data_admin, rate_limit):
    router = APIRouter()

    @router.get('/api/jobs/{job_id}/experiences')
    def experiences(job_id: str):
        with connect() as conn:
            job = _job(conn, job_id)
            rows = conn.execute(
                "SELECT * FROM job_experiences WHERE company=? AND category=? AND status='published' ORDER BY year DESC,id DESC LIMIT 100",
                (job['company'], job['category']),
            ).fetchall()
        return {'experiences': [_public(row) for row in rows], 'scope': 'company_category'}

    @router.get('/api/jobs/{job_id}/experiences/mine')
    def my_experiences(job_id: str, user=Depends(current_user)):
        with connect() as conn:
            job = _job(conn, job_id)
            rows = conn.execute(
                'SELECT * FROM job_experiences WHERE user_id=? AND company=? AND category=? ORDER BY id DESC',
                (user['id'], job['company'], job['category']),
            ).fetchall()
        return {'experiences': [{**_public(row), 'status': row['status']} for row in rows]}

    @router.post('/api/jobs/{job_id}/experiences')
    def submit_experience(job_id: str, body: ExperienceBody, user=Depends(current_user)):
        if not body.confirmed:
            raise HTTPException(400, '请确认这是本人经历，且不含他人隐私或未公开业务信息')
        if not 2000 <= body.year <= datetime.now().year or len(body.body.strip()) < 20:
            raise HTTPException(400, '请填写真实经历年份及至少 20 字的工作内容')
        rate_limit(f"experience:{user['id']}", 5, 86400)
        with connect() as conn:
            job = _job(conn, job_id)
            cursor = conn.execute(
                'INSERT INTO job_experiences(user_id,company,category,role_title,year,body) VALUES(?,?,?,?,?,?)',
                (user['id'], job['company'], job['category'], body.role_title.strip() or job['title'][:100], body.year, body.body.strip()),
            )
            row = conn.execute('SELECT * FROM job_experiences WHERE id=?', (cursor.lastrowid,)).fetchone()
        return {'experience': {**_public(row), 'status': row['status']}}

    @router.delete('/api/job-experiences/{experience_id}')
    def withdraw_experience(experience_id: int, user=Depends(current_user)):
        with connect() as conn:
            row = conn.execute('SELECT user_id FROM job_experiences WHERE id=?', (experience_id,)).fetchone()
            if not row or row['user_id'] != user['id']:
                raise HTTPException(404, '经历不存在或不属于当前账号')
            conn.execute('DELETE FROM job_experiences WHERE id=?', (experience_id,))
        return {'ok': True}

    @router.post('/api/job-experiences/{experience_id}/report')
    def report_experience(experience_id: int, body: ExperienceReport, user=Depends(current_user)):
        rate_limit(f"experience-report:{user['id']}", 10, 3600)
        with connect() as conn:
            row = conn.execute("SELECT id FROM job_experiences WHERE id=? AND status='published'", (experience_id,)).fetchone()
            if not row:
                raise HTTPException(404, '经历不存在')
            conn.execute(
                'INSERT INTO job_experience_reports(experience_id,user_id,reason) VALUES(?,?,?) ON CONFLICT(experience_id,user_id) DO UPDATE SET reason=excluded.reason,resolved=0',
                (experience_id, user['id'], body.reason),
            )
        return {'ok': True}

    @router.get('/api/admin/job-experiences')
    def review_experiences(status: Literal['pending', 'published', 'rejected', 'reported'] = 'pending', admin=Depends(data_admin)):
        with connect() as conn:
            condition = "e.status='published' AND EXISTS(SELECT 1 FROM job_experience_reports r WHERE r.experience_id=e.id AND r.resolved=0)" if status == 'reported' else 'e.status=?'
            rows = conn.execute(
                f'SELECT e.* FROM job_experiences e WHERE {condition} ORDER BY e.id DESC LIMIT 100',
                () if status == 'reported' else (status,),
            ).fetchall()
            items = []
            for row in rows:
                reports = conn.execute('SELECT reason,COUNT(*) n FROM job_experience_reports WHERE experience_id=? AND resolved=0 GROUP BY reason', (row['id'],)).fetchall()
                items.append({**_public(row), 'company': row['company'], 'category': row['category'], 'status': row['status'],
                              'reports': [dict(report) for report in reports]})
        return {'experiences': items}

    @router.patch('/api/admin/job-experiences/{experience_id}')
    def review_experience(experience_id: int, body: ExperienceReview, admin=Depends(data_admin)):
        with connect() as conn:
            changed = conn.execute('UPDATE job_experiences SET status=?,reviewed_by=? WHERE id=?', (body.status, admin['email'], experience_id))
            if not changed.rowcount:
                raise HTTPException(404, '经历不存在')
            conn.execute('UPDATE job_experience_reports SET resolved=1 WHERE experience_id=?', (experience_id,))
        return {'ok': True}

    return router
