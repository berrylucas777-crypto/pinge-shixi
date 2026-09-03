from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import string
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import connect, init_db
from .mailer import email_configured, send_mail
from .matching import score_pair
from .seed import SEED_USERS

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("Asia/Shanghai")
TONES = ["blue", "coral", "violet", "green", "yellow", "gray", "red", "pink", "cyan", "orange"]
CODE_TTL = 10 * 60
SESSION_SHORT = 12 * 60 * 60
SESSION_LONG = 30 * 24 * 60 * 60
COOKIE_NAME = "pingo_session"
PINPIN_CAP = 500
_auth_attempts: dict[str, deque[float]] = defaultdict(deque)


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _app_url() -> str:
    return (os.getenv("APP_URL") or "http://127.0.0.1:8000").rstrip("/")


def _origins() -> list[str]:
    origins = {"http://localhost:8000", "http://127.0.0.1:8000", _app_url()}
    for item in (os.getenv("CORS_ORIGINS") or "").split(","):
        if item.strip():
            origins.add(item.strip().rstrip("/"))
    return sorted(origins)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _secret_key()
    init_db()
    seed_if_needed()
    yield


app = FastAPI(
    title="拼个实习",
    version="1.0.0",
    docs_url=None if _bool_env("DISABLE_DOCS") else "/docs",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Pingo-Client"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if _app_url().startswith("https://"):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


class EnterBody(BaseModel):
    email: str = Field(max_length=254)
    invite_code: str = Field(default="", max_length=32)
    remember: bool = True
    accept_terms: bool = False


class VerifyBody(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=8)
    remember: bool = True


class OnboardBody(BaseModel):
    experience: str = Field(min_length=2, max_length=2000)
    looking_for: str = Field(min_length=2, max_length=2000)
    intro: str = Field(default="", max_length=3000)
    content_confirmed: bool = False


class IntroBody(BaseModel):
    text: str = Field(default="", max_length=3000)


class ProfileBody(BaseModel):
    name: str = Field(default="", max_length=40)
    school: str = Field(default="", max_length=80)
    grade: str = Field(default="", max_length=30)
    city: str = Field(default="", max_length=40)
    major: str = Field(default="", max_length=80)
    role: str = Field(default="", max_length=100)
    skills: str = Field(default="", max_length=1000)
    wants: str = Field(default="", max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    learn_tags: list[str] = Field(default_factory=list, max_length=20)
    intro: str = Field(default="", max_length=3000)
    experience: str = Field(default="", max_length=2000)
    looking_for: str = Field(default="", max_length=2000)
    prefer_same_city: bool = True


class ContactBody(BaseModel):
    body: str = Field(default="", max_length=2000)


class ReportBody(BaseModel):
    target_user_id: Optional[int] = None
    reason: str = Field(min_length=2, max_length=80)
    detail: str = Field(default="", max_length=1000)


def _secret_key() -> str:
    env = os.getenv("SECRET_KEY", "").strip()
    if env:
        return env
    path = ROOT / "data" / "secret.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(32)
    path.write_text(key, encoding="utf-8")
    return key


def _normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise HTTPException(400, "请输入可以接收匹配邮件的邮箱")
    return value


def _referral_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "PINGO-" + "".join(secrets.choice(alphabet) for _ in range(6))


def _clean_tags(values: list[str]) -> list[str]:
    result = []
    for value in values:
        tag = str(value).strip()[:24]
        if tag and tag not in result:
            result.append(tag)
    return result[:20]


def _infer_tags(text: str) -> list[str]:
    mapping = {
        "AI": ("ai", "算法", "模型", "大模型", "多模态"),
        "产品": ("产品", "需求", "prd"),
        "开发": ("开发", "工程", "全栈", "代码"),
        "增长": ("增长", "运营", "投放", "营销"),
        "求职交流": ("求职", "面试", "简历"),
        "ToB": ("tob", "客户", "商业化"),
        "Agent": ("agent", "智能体"),
        "推荐": ("推荐", "搜推", "召回"),
    }
    lowered = text.lower()
    return [tag for tag, words in mapping.items() if any(word.lower() in lowered for word in words)] or ["求职交流"]


def _user_dict(row) -> Optional[dict]:
    if not row:
        return None
    data = dict(row)
    for key in ("tags", "learn_tags"):
        try:
            data[key] = json.loads(data.get(key) or "[]")
        except json.JSONDecodeError:
            data[key] = []
    data["profile_complete"] = bool(data.get("experience") and data.get("looking_for"))
    data["is_seed"] = bool(data.get("is_seed"))
    data["is_pro"] = bool(data.get("is_pro"))
    data["prefer_same_city"] = bool(data.get("prefer_same_city"))
    data["boost_active"] = float(data.get("boost_until") or 0) > time.time()
    return data


def get_user_by_email(email: str) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return _user_dict(row)


def get_user(user_id: int) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _user_dict(row)


def _session_token(request: Request, authorization: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return request.cookies.get(COOKIE_NAME, "")


def current_user(request: Request, authorization: Optional[str] = Header(default=None)) -> dict:
    token = _session_token(request, authorization)
    if not token:
        raise HTTPException(401, "请先登录")
    now = time.time()
    with connect() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND (s.expires_at=0 OR s.expires_at>?)",
            (token, now),
        ).fetchone()
        if not row:
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    user = _user_dict(row)
    if not user:
        raise HTTPException(401, "登录已失效，请重新进入")
    return user


def _set_session(response: Response, user_id: int, remember: bool) -> str:
    token = secrets.token_urlsafe(32)
    ttl = SESSION_LONG if remember else SESSION_SHORT
    with connect() as conn:
        conn.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)", (token, user_id, time.time() + ttl))
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=ttl,
        httponly=True,
        secure=_app_url().startswith("https://"),
        samesite="lax",
        path="/",
    )
    return token


def _rate_limit(key: str, limit: int = 6, window: int = 600) -> None:
    now = time.time()
    queue = _auth_attempts[key]
    while queue and queue[0] < now - window:
        queue.popleft()
    if len(queue) >= limit:
        raise HTTPException(429, "操作太频繁，请稍后再试")
    queue.append(now)


def _period(now: Optional[datetime] = None) -> str:
    current = now or datetime.now(TZ)
    day = current.date() if current.hour >= 12 else (current - timedelta(days=1)).date()
    return day.isoformat()


def _next_refresh_label() -> str:
    now = datetime.now(TZ)
    target = now.replace(hour=12, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return target.strftime("%m-%d 12:00")


def quota_state(user: dict) -> dict:
    period = _period()
    with connect() as conn:
        used = conn.execute("SELECT COUNT(*) n FROM member_views WHERE user_id=? AND period=?", (user["id"], period)).fetchone()["n"]
        sold = conn.execute("SELECT COUNT(*) n FROM users WHERE is_pro=1").fetchone()["n"]
    limit = 100 if user.get("is_pro") else 20
    return {
        "details_used": used,
        "details_limit": limit,
        "next_refresh_label": _next_refresh_label(),
        "is_pro": bool(user.get("is_pro")),
        "pinpin_sold": sold,
        "pinpin_cap": PINPIN_CAP,
        "pinpin_open": _bool_env("ALLOW_SIMULATED_PAYMENT", False) and sold < PINPIN_CAP,
        "can_boost": bool(user.get("is_pro")) and user.get("boost_period") != period,
        "boost_active": bool(user.get("boost_active")),
    }


def unlock_state(user_id: int) -> dict:
    with connect() as conn:
        contacted = conn.execute("SELECT COUNT(*) n FROM contacts WHERE from_user_id=?", (user_id,)).fetchone()["n"]
        invited = conn.execute("SELECT COUNT(*) n FROM users WHERE invited_by_user_id=?", (user_id,)).fetchone()["n"]
    return {"email_sent": contacted > 0, "referral_complete": invited > 0}


def _pool_users() -> list[dict]:
    files = sorted((ROOT / "匹配池").glob("*.json"))
    if not files:
        return []
    try:
        records = json.loads(files[0].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    people = []
    for item in records if isinstance(records, list) else []:
        name = str(item.get("nickname") or "").strip()
        if not name:
            continue
        digest = hashlib.sha256((name + str(item.get("raw_ocr") or "")).encode()).hexdigest()[:12]
        role_tags = item.get("role_tags") or []
        domain_tags = item.get("domain_tags") or []
        tags = _clean_tags([*role_tags, *domain_tags])
        people.append({
            "email": f"pool-{digest}@pingo.local",
            "name": name,
            "school": "",
            "grade": "",
            "city": str(item.get("city") or ""),
            "major": "",
            "role": " / ".join(role_tags[:2]) or "经验交换",
            "skills": str(item.get("supply") or item.get("experience") or ""),
            "wants": str(item.get("demand") or ""),
            "experience": str(item.get("experience") or item.get("supply") or ""),
            "looking_for": str(item.get("demand") or ""),
            "tags": tags or ["求职交流"],
            "learn_tags": _infer_tags(str(item.get("demand") or "")),
            "intro": str(item.get("cleaned_message") or ""),
            "xhs": name,
            "letter": name[:1].upper(),
            "tone": TONES[int(digest[:2], 16) % len(TONES)],
            "referral_code": "POOL-" + digest[:8].upper(),
        })
    return people


def seed_if_needed() -> None:
    people = _pool_users() or SEED_USERS
    with connect() as conn:
        for person in people:
            tags = person.get("tags") or []
            experience = person.get("experience") or person.get("skills") or ""
            looking_for = person.get("looking_for") or person.get("wants") or ""
            conn.execute(
                """
                INSERT INTO users(email,name,school,grade,city,major,role,skills,wants,tags,learn_tags,intro,experience,looking_for,xhs,letter,tone,referral_code,is_seed)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                ON CONFLICT(email) DO UPDATE SET name=excluded.name,city=excluded.city,role=excluded.role,skills=excluded.skills,
                  wants=excluded.wants,tags=excluded.tags,learn_tags=excluded.learn_tags,intro=excluded.intro,
                  experience=excluded.experience,looking_for=excluded.looking_for,xhs=excluded.xhs,letter=excluded.letter,tone=excluded.tone
                """,
                (
                    person["email"], person["name"], person.get("school", ""), person.get("grade", ""),
                    person.get("city", ""), person.get("major", ""), person.get("role", ""), person.get("skills", ""),
                    person.get("wants", ""), json.dumps(tags, ensure_ascii=False),
                    json.dumps(person.get("learn_tags") or [], ensure_ascii=False), person.get("intro", ""),
                    experience, looking_for, person.get("xhs", ""), person.get("letter") or person["name"][:1],
                    person.get("tone", "blue"), person["referral_code"],
                ),
            )


def list_candidates(exclude_id: int) -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM users WHERE id!=? AND name!='' AND experience!=''", (exclude_id,)).fetchall()
    return [_user_dict(row) for row in rows]


def preferred_id(user_id: int) -> Optional[int]:
    with connect() as conn:
        row = conn.execute("SELECT candidate_id FROM preferences WHERE user_id=?", (user_id,)).fetchone()
    return row["candidate_id"] if row else None


def recompute_matches(user: dict, force: bool = False) -> list[dict]:
    if not user.get("profile_complete"):
        return []
    with connect() as conn:
        existing = conn.execute("SELECT * FROM matches WHERE user_id=? ORDER BY rank", (user["id"],)).fetchall()
        if existing and not force and "period" in existing[0].keys() and existing[0]["period"] == _period():
            return [dict(row) for row in existing]
        conn.execute("DELETE FROM matches WHERE user_id=?", (user["id"],))
    prefer = preferred_id(user["id"])
    scored = [score_pair(user, candidate, prefer) for candidate in list_candidates(user["id"])]
    scored.sort(key=lambda item: item["score"], reverse=True)
    with connect() as conn:
        for rank, item in enumerate(scored[:5], 1):
            conn.execute(
                "INSERT INTO matches(user_id,rank,candidate_id,score,reason,can_share,wants,shared_tags,period) VALUES(?,?,?,?,?,?,?,?,?)",
                (user["id"], rank, item["candidate_id"], item["score"], item["reason"], item["can_share"], item["wants"], json.dumps(item["shared_tags"], ensure_ascii=False), _period()),
            )
        return [dict(row) for row in conn.execute("SELECT * FROM matches WHERE user_id=? ORDER BY rank", (user["id"],))]


def _public_person(user: dict, viewer: dict, unlocked: bool = True) -> dict:
    name = user.get("name") or "搭子"
    return {
        "id": user["id"],
        "name": name if unlocked else name[:1] + " ·",
        "full_name": name if unlocked else None,
        "role": user.get("role") or "",
        "city": user.get("city") or "",
        "grade": user.get("grade") or "",
        "major": user.get("major") or "",
        "skills": user.get("skills") or user.get("experience") or "",
        "experience": user.get("experience") or "",
        "looking_for": user.get("looking_for") or "",
        "tags": user.get("tags") or [],
        "letter": user.get("letter") or name[:1],
        "tone": user.get("tone") or "blue",
        "xhs": user.get("xhs") if unlocked else "",
        "is_seed": bool(user.get("is_seed")),
        "same_city": bool(viewer.get("city") and viewer.get("city") == user.get("city")),
        "similar_background": bool(viewer.get("major") and viewer.get("major") == user.get("major")),
        "boost_active": bool(user.get("boost_active")),
    }


def serialize_me(user: dict) -> dict:
    return {
        "user": {key: user.get(key) for key in (
            "id", "email", "name", "school", "grade", "city", "major", "role", "skills", "wants",
            "tags", "learn_tags", "intro", "experience", "looking_for", "prefer_same_city", "referral_code",
            "profile_complete", "is_pro",
        )},
        "unlock": unlock_state(user["id"]),
        "quota": quota_state(user),
        "email_configured": email_configured(),
        "app_url": _app_url(),
    }


def serialize_matches(user: dict) -> list[dict]:
    rows = recompute_matches(user)
    state = unlock_state(user["id"])
    with connect() as conn:
        contacted = {row["to_user_id"] for row in conn.execute("SELECT to_user_id FROM contacts WHERE from_user_id=?", (user["id"],))}
    results = []
    for row in rows[: 5 if user.get("is_pro") else 3]:
        unlocked = bool(user.get("is_pro") or row["rank"] == 1 or (row["rank"] == 2 and state["email_sent"]) or (row["rank"] == 3 and state["referral_complete"]))
        candidate = get_user(row["candidate_id"])
        if not candidate:
            continue
        results.append({
            "rank": row["rank"], "unlocked": unlocked, "score": row["score"], "reason": row["reason"],
            "can_share": row["can_share"], "wants": row["wants"],
            "shared_tags": json.loads(row["shared_tags"] or "[]"), "contacted": candidate["id"] in contacted,
            "person": _public_person(candidate, user, unlocked),
        })
    return results


@app.get("/api/health")
def health():
    return {"ok": True, "email_configured": email_configured(), "payment_configured": False}


@app.get("/api/config")
def config():
    return {"email_configured": email_configured(), "app_url": _app_url(), "simulated_payment": _bool_env("ALLOW_SIMULATED_PAYMENT", False)}


@app.post("/api/auth/enter")
def enter(body: EnterBody, request: Request, response: Response):
    email = _normalize_email(body.email)
    _rate_limit(f"enter:{request.client.host if request.client else 'unknown'}:{email}")
    existing = get_user_by_email(email)
    invite = body.invite_code.strip().upper()
    invited_by = None
    if invite:
        with connect() as conn:
            host = conn.execute("SELECT id FROM users WHERE referral_code=?", (invite,)).fetchone()
        if not host:
            raise HTTPException(400, "邀请码无效，可留空直接进入")
        invited_by = host["id"]
    if not existing:
        if not body.accept_terms:
            raise HTTPException(400, "请确认已满 18 周岁并同意用户协议与隐私政策")
        code = _referral_code()
        with connect() as conn:
            while conn.execute("SELECT 1 FROM users WHERE referral_code=?", (code,)).fetchone():
                code = _referral_code()
            conn.execute(
                "INSERT INTO users(email,name,letter,tone,referral_code,invited_by_user_id,consent_version,consented_at) VALUES(?,?,?,?,?,?,?,datetime('now'))",
                (email, email.split("@", 1)[0][:20], email[0].upper(), TONES[sum(map(ord, email)) % len(TONES)], code, invited_by, "2026-09-03"),
            )
        existing = get_user_by_email(email)
    elif invited_by and not existing.get("invited_by_user_id") and invited_by != existing["id"]:
        with connect() as conn:
            conn.execute("UPDATE users SET invited_by_user_id=? WHERE id=?", (invited_by, existing["id"]))
        existing = get_user(existing["id"])
    if email_configured():
        code = f"{secrets.randbelow(1000000):06d}"
        with connect() as conn:
            conn.execute(
                "INSERT INTO login_codes(email,code,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(email) DO UPDATE SET code=excluded.code,expires_at=excluded.expires_at,attempts=0",
                (email, code, time.time() + CODE_TTL),
            )
        if not send_mail(email, "拼个实习登录验证码", f"你的验证码是 {code}，10 分钟内有效。请勿转发给他人。"):
            raise HTTPException(503, "验证码发送失败，请稍后重试")
        return {"status": "code_sent", "email_configured": True}
    token = _set_session(response, existing["id"], body.remember)
    return {"status": "ok", "token": token, **serialize_me(existing)}


@app.post("/api/auth/verify")
def verify(body: VerifyBody, request: Request, response: Response):
    email = _normalize_email(body.email)
    _rate_limit(f"verify:{request.client.host if request.client else 'unknown'}:{email}", 10)
    with connect() as conn:
        row = conn.execute("SELECT code,expires_at,attempts FROM login_codes WHERE email=?", (email,)).fetchone()
        if row and row["attempts"] >= 6:
            conn.execute("DELETE FROM login_codes WHERE email=?", (email,))
            raise HTTPException(429, "验证码尝试次数过多，请重新获取")
        if not row or not secrets.compare_digest(row["code"], body.code.strip()) or row["expires_at"] < time.time():
            if row:
                conn.execute("UPDATE login_codes SET attempts=attempts+1 WHERE email=?", (email,))
            raise HTTPException(400, "验证码不正确或已过期")
        conn.execute("DELETE FROM login_codes WHERE email=?", (email,))
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(400, "请先提交邮箱")
    token = _set_session(response, user["id"], body.remember)
    return {"status": "ok", "token": token, **serialize_me(user)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, authorization: Optional[str] = Header(default=None)):
    token = _session_token(request, authorization)
    if token:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return serialize_me(user)


def _save_profile(user_id: int, values: dict) -> dict:
    tags = _clean_tags(values.get("tags") or [])
    learn_tags = _clean_tags(values.get("learn_tags") or [])
    experience = (values.get("experience") or values.get("skills") or "").strip()
    looking_for = (values.get("looking_for") or values.get("wants") or "").strip()
    if not experience or not looking_for:
        raise HTTPException(400, "请填写经历与项目，以及想找的人")
    if not tags:
        tags = _infer_tags(" ".join([experience, looking_for, values.get("role", "")]))
    with connect() as conn:
        conn.execute(
            """
            UPDATE users SET name=?,school=?,grade=?,city=?,major=?,role=?,skills=?,wants=?,tags=?,learn_tags=?,intro=?,
              experience=?,looking_for=?,prefer_same_city=?,letter=?,updated_at=datetime('now') WHERE id=?
            """,
            (
                values.get("name", "").strip() or "同学", values.get("school", "").strip(), values.get("grade", "").strip(),
                values.get("city", "").strip(), values.get("major", "").strip(), values.get("role", "").strip() or tags[0],
                (values.get("skills") or experience).strip(), (values.get("wants") or looking_for).strip(),
                json.dumps(tags, ensure_ascii=False), json.dumps(learn_tags, ensure_ascii=False), values.get("intro", "").strip(),
                experience, looking_for, int(values.get("prefer_same_city", True)),
                (values.get("name", "").strip() or "同")[:1].upper(), user_id,
            ),
        )
    updated = get_user(user_id)
    recompute_matches(updated, force=True)
    return updated


@app.post("/api/me/onboard")
def onboard(body: OnboardBody, user: dict = Depends(current_user)):
    if not body.content_confirmed:
        raise HTTPException(400, "请确认内容已脱敏且不包含第三方隐私或商业秘密")
    values = dict(user)
    values.update({"experience": body.experience, "looking_for": body.looking_for, "intro": body.intro})
    values["tags"] = _infer_tags(f"{body.experience} {body.looking_for}")
    values["learn_tags"] = _infer_tags(body.looking_for)
    updated = _save_profile(user["id"], values)
    with connect() as conn:
        conn.execute("UPDATE users SET content_confirmed_at=datetime('now') WHERE id=?", (user["id"],))
    return serialize_me(updated)


@app.patch("/api/me")
def update_me(body: ProfileBody, user: dict = Depends(current_user)):
    return serialize_me(_save_profile(user["id"], body.model_dump()))


@app.delete("/api/me")
def delete_me(request: Request, response: Response, user: dict = Depends(current_user)):
    with connect() as conn:
        conn.execute("UPDATE users SET invited_by_user_id=NULL WHERE invited_by_user_id=?", (user["id"],))
        conn.execute("DELETE FROM member_views WHERE user_id=? OR candidate_id=?", (user["id"], user["id"]))
        conn.execute("DELETE FROM reports WHERE reporter_user_id=? OR target_user_id=?", (user["id"], user["id"]))
        conn.execute("DELETE FROM preferences WHERE user_id=? OR candidate_id=?", (user["id"], user["id"]))
        conn.execute("DELETE FROM contacts WHERE from_user_id=? OR to_user_id=?", (user["id"], user["id"]))
        conn.execute("DELETE FROM matches WHERE user_id=? OR candidate_id=?", (user["id"], user["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        conn.execute("DELETE FROM login_codes WHERE email=?", (user["email"],))
        conn.execute("DELETE FROM users WHERE id=?", (user["id"],))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/me/parse-intro")
def parse_intro(body: IntroBody, user: dict = Depends(current_user)):
    text = body.text.strip()
    if len(text) < 4:
        raise HTTPException(400, "请先粘贴一段群聊自我介绍")
    lines = [line.strip(" -•") for line in text.splitlines() if line.strip()]
    demand_markers = ("想找", "寻找", "求", "蹲", "想了解", "希望")
    demand = next((line for line in lines if any(mark in line for mark in demand_markers)), "")
    experience = "\n".join(line for line in lines if line != demand) or text
    return {"profile": {"intro": text, "experience": experience[:2000], "looking_for": demand[:2000], "tags": _infer_tags(text), "source": "rules"}}


@app.get("/api/matches")
def matches(user: dict = Depends(current_user)):
    if not user.get("profile_complete"):
        return {"matches": [], "unlock": unlock_state(user["id"]), "quota": quota_state(user)}
    return {"matches": serialize_matches(user), "unlock": unlock_state(user["id"]), "quota": quota_state(user)}


@app.post("/api/matches/{candidate_id}/contact")
def contact(candidate_id: int, body: ContactBody, user: dict = Depends(current_user)):
    allowed = next((item for item in serialize_matches(user) if item["person"]["id"] == candidate_id and item["unlocked"]), None)
    if not allowed:
        raise HTTPException(403, "这位搭子尚未解锁")
    candidate = get_user(candidate_id)
    draft = body.body.strip() or f"Hi {candidate['name']}，我在「拼个实习」看到我们很匹配，想约 20 分钟交换项目工作流和求职经验。"
    sent = False
    if not candidate.get("is_seed") and not candidate["email"].endswith(".local"):
        sent = send_mail(candidate["email"], f"来自「拼个实习」的认识邮件 · {user['name']}", draft, reply_to=user["email"])
    with connect() as conn:
        conn.execute(
            "INSERT INTO contacts(from_user_id,to_user_id,body,sent) VALUES(?,?,?,?) ON CONFLICT(from_user_id,to_user_id) DO UPDATE SET body=excluded.body,sent=excluded.sent",
            (user["id"], candidate_id, draft, int(sent)),
        )
    refreshed = get_user(user["id"])
    return {"sent": sent, "unlock": unlock_state(user["id"]), "matches": serialize_matches(refreshed)}


def _member_payload(candidate: dict, user: dict) -> dict:
    return _public_person(candidate, user, True)


@app.get("/api/members")
def members(q: str = "", tag: str = "", city: str = "", grade: str = "", major: str = "", user: dict = Depends(current_user)):
    query = q.strip().lower()
    if (city or grade or major) and not user.get("is_pro"):
        raise HTTPException(403, "精确筛选需要拼拼卡")
    candidates = list_candidates(user["id"])
    filtered = []
    for candidate in candidates:
        haystack = " ".join([candidate.get("name", ""), candidate.get("role", ""), candidate.get("skills", ""), candidate.get("city", ""), " ".join(candidate.get("tags") or [])]).lower()
        if query and query not in haystack:
            continue
        if tag and tag != "全部" and tag.lower() not in haystack:
            continue
        if city and candidate.get("city") != city:
            continue
        if grade and candidate.get("grade") != grade:
            continue
        if major and candidate.get("major") != major:
            continue
        filtered.append(candidate)
    filtered.sort(key=lambda item: (not item.get("boost_active"), item.get("name", "")))
    options = {
        "cities": sorted({item["city"] for item in candidates if item.get("city")}),
        "grades": sorted({item["grade"] for item in candidates if item.get("grade")}),
        "majors": sorted({item["major"] for item in candidates if item.get("major")}),
        "pro": bool(user.get("is_pro")),
    }
    return {"members": [_member_payload(item, user) for item in filtered], "filters": options, "quota": quota_state(user)}


@app.get("/api/members/{candidate_id}")
def member_detail(candidate_id: int, user: dict = Depends(current_user)):
    candidate = get_user(candidate_id)
    if not candidate or candidate_id == user["id"]:
        raise HTTPException(404, "没有找到这位成员")
    period = _period()
    state = quota_state(user)
    with connect() as conn:
        viewed = conn.execute("SELECT 1 FROM member_views WHERE user_id=? AND candidate_id=? AND period=?", (user["id"], candidate_id, period)).fetchone()
        if not viewed and state["details_used"] >= state["details_limit"]:
            return {"paywall": True, "reason": "details_quota", "quota": state}
        if not viewed:
            conn.execute("INSERT INTO member_views(user_id,candidate_id,period) VALUES(?,?,?)", (user["id"], candidate_id, period))
    updated = quota_state(user)
    updated["just_hit_limit"] = updated["details_used"] == updated["details_limit"]
    return {"person": _member_payload(candidate, user), "quota": updated}


@app.post("/api/members/{candidate_id}/prefer")
def prefer(candidate_id: int, user: dict = Depends(current_user)):
    if not get_user(candidate_id) or candidate_id == user["id"]:
        raise HTTPException(404, "没有找到这位成员")
    with connect() as conn:
        conn.execute("INSERT INTO preferences(user_id,candidate_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET candidate_id=excluded.candidate_id", (user["id"], candidate_id))
    recompute_matches(user, force=True)
    return {"ok": True, "matches": serialize_matches(get_user(user["id"]))}


@app.post("/api/reports")
def report(body: ReportBody, user: dict = Depends(current_user)):
    if body.target_user_id and not get_user(body.target_user_id):
        raise HTTPException(404, "没有找到被举报成员")
    with connect() as conn:
        cursor = conn.execute("INSERT INTO reports(reporter_user_id,target_user_id,reason,detail) VALUES(?,?,?,?)", (user["id"], body.target_user_id, body.reason.strip(), body.detail.strip()))
    return {"ok": True, "report_id": cursor.lastrowid}


@app.post("/api/pinpin/simulate")
def simulate_pinpin(user: dict = Depends(current_user)):
    if not _bool_env("ALLOW_SIMULATED_PAYMENT", False):
        raise HTTPException(503, "真实支付尚未开放，当前不会产生扣款")
    with connect() as conn:
        conn.execute("UPDATE users SET is_pro=1,pro_purchased_at=datetime('now') WHERE id=?", (user["id"],))
    updated = get_user(user["id"])
    data = serialize_me(updated)
    data["matches"] = serialize_matches(updated)
    return data


@app.post("/api/pinpin/boost")
def boost(user: dict = Depends(current_user)):
    if not user.get("is_pro"):
        return {"paywall": True, "reason": "boost", "quota": quota_state(user)}
    period = _period()
    if user.get("boost_period") == period:
        raise HTTPException(409, "今天的加急曝光已经使用")
    with connect() as conn:
        conn.execute("UPDATE users SET boost_until=?,boost_period=? WHERE id=?", (time.time() + 24 * 60 * 60, period, user["id"]))
    updated = get_user(user["id"])
    return {"ok": True, "me": serialize_me(updated), "quota": quota_state(updated)}


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/styles.css")
def styles():
    return FileResponse(ROOT / "styles.css")


@app.get("/app.js")
def script():
    return FileResponse(ROOT / "app.js")


app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
