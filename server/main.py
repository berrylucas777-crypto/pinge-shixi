from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import string
import time
import asyncio
from csv import DictReader
from io import StringIO
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import connect, init_db
from .jev import configured as jev_configured
from .mailer import email_configured, send_mail
from .matching import rank_matches

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("Asia/Shanghai")
TONES = ["blue", "coral", "violet", "green", "yellow", "gray", "red", "pink", "cyan", "orange"]
CODE_TTL = 10 * 60
SESSION_SHORT = 12 * 60 * 60
SESSION_LONG = 30 * 24 * 60 * 60
COOKIE_NAME = "pingo_session"
PINPIN_CAP = 500
EARLY_ACCESS_INVITE_CODE = (os.getenv("EARLY_ACCESS_INVITE_CODE") or "PINGO-START").strip().upper()
_auth_attempts: dict[str, deque[float]] = defaultdict(deque)


def _now() -> datetime:
    return datetime.now(TZ)


def _match_hour() -> int:
    try:
        return max(0, min(23, int((os.getenv("MATCH_HOUR") or "21").strip())))
    except ValueError:
        return 21


def _pool_min() -> int:
    try:
        return max(2, int((os.getenv("MATCH_POOL_MIN") or "2").strip()))
    except ValueError:
        return 2


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _app_url() -> str:
    return (os.getenv("APP_URL") or "http://127.0.0.1:8000").rstrip("/")


def _app_release() -> str:
    return (os.getenv("APP_RELEASE") or "dev").strip()


def _manual_payment_enabled() -> bool:
    return _bool_env("MANUAL_PAYMENT_ENABLED", False) and bool(os.getenv("MANUAL_PAYMENT_QR_URL", "").strip())


def _payment_admin_emails() -> set[str]:
    return {item.strip().lower() for item in os.getenv("PAYMENT_ADMIN_EMAILS", "").split(",") if "@" in item}


def _is_payment_admin(user: dict) -> bool:
    return str(user.get("email", "")).strip().lower() in _payment_admin_emails()


def _data_admin_emails() -> set[str]:
    configured = {item.strip().lower() for item in os.getenv("DATA_ADMIN_EMAILS", "").split(",") if "@" in item}
    return configured or _payment_admin_emails()


def _is_data_admin(user: dict) -> bool:
    return str(user.get("email", "")).strip().lower() in _data_admin_emails()


def _manual_payment_config() -> dict:
    return {
        "enabled": _manual_payment_enabled(),
        "amount_cents": 1000,
        "qr_url": os.getenv("MANUAL_PAYMENT_QR_URL", "").strip(),
        "contact": os.getenv("MANUAL_PAYMENT_CONTACT", "").strip(),
    }


def _origins() -> list[str]:
    origins = {"http://localhost:8000", "http://127.0.0.1:8000", _app_url()}
    for item in (os.getenv("CORS_ORIGINS") or "").split(","):
        if item.strip():
            origins.add(item.strip().rstrip("/"))
    return sorted(origins)


def _allowed_hosts() -> list[str]:
    configured = [item.strip() for item in os.getenv("ALLOWED_HOSTS", "").split(",") if item.strip()]
    if configured:
        return configured
    hostname = urlparse(_app_url()).hostname
    return [host for host in (hostname, "localhost", "127.0.0.1", "testserver") if host]


@asynccontextmanager
async def lifespan(_: FastAPI):
    _secret_key()
    init_db()
    purge_seed_users()
    try:
        _maintain_pool()
    except Exception:
        pass
    task = asyncio.create_task(_pool_maintenance())
    try:
        yield
    finally:
        task.cancel()


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
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts())


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if _app_url().startswith("https://"):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/") or request.url.path in {"/review", "/imports"}:
        response.headers["Cache-Control"] = "no-store"
    if request.url.path.startswith("/api/") or request.url.path in {
        "/ops", "/review", "/review.js", "/imports", "/imports.js", "/docs", "/redoc", "/openapi.json"
    }:
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
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


class PinpinPaymentRequestBody(BaseModel):
    payer_nickname: str = Field(min_length=1, max_length=64)


class ImportPreviewBody(BaseModel):
    source_name: str = Field(min_length=2, max_length=80)
    source_format: str = Field(pattern="^(csv|json|ocr_text)$")
    content: str = Field(min_length=2, max_length=300000)


class ImportCommitBody(BaseModel):
    source_name: str = Field(min_length=2, max_length=80)
    source_format: str = Field(pattern="^(csv|json|ocr_text)$")
    consent_confirmed: bool = False
    rows: list[dict] = Field(min_length=1, max_length=2000)


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


IMPORT_ALIASES = {
    "name": ("name", "姓名", "昵称", "小红书昵称", "用户名"),
    "role": ("role", "岗位", "方向", "目标岗位"),
    "city": ("city", "城市", "所在地"),
    "school": ("school", "学校"),
    "grade": ("grade", "年级"),
    "major": ("major", "专业"),
    "skills": ("skills", "擅长", "技能", "经历", "项目经历"),
    "wants": ("wants", "想找", "需求", "想学习"),
    "intro": ("intro", "自我介绍", "介绍", "内容", "文本"),
    "xhs": ("xhs", "小红书", "小红书号", "xhs号"),
}


def _import_value(row: dict, key: str) -> str:
    normalized = {str(name).strip().lower(): value for name, value in row.items()}
    for alias in IMPORT_ALIASES[key]:
        value = normalized.get(alias.lower())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _normalize_import_row(row: dict) -> Optional[dict]:
    name = _import_value(row, "name")[:40]
    intro = _import_value(row, "intro")[:3000]
    skills = _import_value(row, "skills")[:1000]
    wants = _import_value(row, "wants")[:1000]
    role = _import_value(row, "role")[:100]
    if not name and not intro:
        return None
    if not name:
        name = (role or "匿名同学")[:40]
    if not intro:
        intro = "；".join(part for part in (skills, wants, role) if part)[:3000]
    if len(intro) < 2:
        return None
    return {
        "name": name,
        "role": role,
        "city": _import_value(row, "city")[:40],
        "school": _import_value(row, "school")[:80],
        "grade": _import_value(row, "grade")[:30],
        "major": _import_value(row, "major")[:80],
        "skills": skills or intro[:1000],
        "wants": wants or "交流实习经验",
        "intro": intro,
        "xhs": _import_value(row, "xhs")[:100],
    }


def _ocr_blocks(content: str) -> list[dict]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", content) if block.strip()]
    rows = []
    for block in blocks:
        values = {}
        free_lines = []
        for line in block.splitlines():
            match = re.match(r"\s*([^:：]{1,20})\s*[:：]\s*(.+)", line)
            if match:
                values[match.group(1)] = match.group(2)
            else:
                free_lines.append(line.strip())
        if free_lines:
            values.setdefault("昵称", free_lines[0])
            values.setdefault("自我介绍", " ".join(free_lines[1:]) or free_lines[0])
        rows.append(values)
    return rows


def _parse_import_content(source_format: str, content: str) -> tuple[list[dict], int]:
    if source_format == "json":
        payload = json.loads(content)
        raw_rows = payload.get("rows", []) if isinstance(payload, dict) else payload
        if not isinstance(raw_rows, list):
            raise HTTPException(400, "JSON 需要是数组，或包含 rows 数组")
    elif source_format == "csv":
        raw_rows = list(DictReader(StringIO(content.lstrip("\ufeff"))))
    else:
        raw_rows = _ocr_blocks(content)
    if not raw_rows:
        raise HTTPException(400, "没有找到可导入的资料")
    normalized = [_normalize_import_row(row) for row in raw_rows if isinstance(row, dict)]
    rows = [row for row in normalized if row]
    return rows[:2000], max(0, len(raw_rows) - len(rows))


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


WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _match_weekdays() -> set[int]:
    days = set()
    for item in (os.getenv("MATCH_WEEKDAYS") or "0,2").split(","):
        item = item.strip()
        if item.lstrip("-").isdigit():
            days.add(int(item) % 7)
    return days or {0, 2}


def _round_limit() -> int:
    try:
        return max(1, int((os.getenv("MATCH_ROUND_LIMIT") or "4").strip()))
    except ValueError:
        return 4


def _schedule_label() -> str:
    names = "、".join(WEEKDAY_LABELS[day] for day in sorted(_match_weekdays()))
    return f"每{names} {_match_hour():02d}:00"


def _slot_on(day) -> datetime:
    return datetime(day.year, day.month, day.day, _match_hour(), 0, tzinfo=TZ)


def _slot_period(slot: datetime) -> str:
    return slot.strftime("%Y-%m-%d-%H")


def _next_match_at(now: Optional[datetime] = None) -> datetime:
    current = now or _now()
    for offset in range(8):
        day = (current + timedelta(days=offset)).date()
        if day.weekday() not in _match_weekdays():
            continue
        slot = _slot_on(day)
        if slot > current:
            return slot
    return _slot_on(current.date() + timedelta(days=7))


def _latest_due_slot(now: Optional[datetime] = None) -> Optional[datetime]:
    current = now or _now()
    for offset in range(8):
        day = (current - timedelta(days=offset)).date()
        if day.weekday() not in _match_weekdays():
            continue
        slot = _slot_on(day)
        if slot <= current:
            return slot
    return None


def _period(now: Optional[datetime] = None) -> str:
    current = now or _now()
    hour = _match_hour()
    day = current.date() if current.hour >= hour else (current - timedelta(days=1)).date()
    return f"{day.isoformat()}-{hour:02d}"


def _next_refresh_label() -> str:
    target = _next_match_at()
    return f"{WEEKDAY_LABELS[target.weekday()]} {target.strftime('%H:%M')}"


def _pool_active_clause() -> str:
    return "IFNULL(pool_status,'active')='active'"


def live_pool_count() -> int:
    with connect() as conn:
        return conn.execute(
            "SELECT COUNT(*) n FROM users WHERE IFNULL(is_seed,0)=0 "
            "AND IFNULL(experience,'')!='' AND IFNULL(looking_for,'')!='' "
            f"AND {_pool_active_clause()}"
        ).fetchone()["n"]


def pool_pass(user: dict) -> dict:
    limit = _round_limit()
    used = int(user.get("rounds_used") or 0)
    paused = user.get("pool_status") == "paused"
    return {
        "rounds_used": used,
        "rounds_limit": limit,
        "rounds_left": 0 if paused else max(0, limit - used),
        "paused": paused,
        "active": not paused,
    }


def early_match_hint(count: int) -> dict:
    people = max(0, int(count))
    if people > 25:
        return {"level": "ready", "count": people, "text": "现在匹配人数充足，可以提前优先匹配。"}
    if people >= 10:
        return {"level": "choice", "count": people, "text": f"池里现在有 {people} 人。可以现在配，也可以再等等，人会更多。"}
    return {"level": "wait", "count": people, "text": f"池里现在只有 {people} 人。建议再等等，周一、周三晚上人会多一些。"}


def pool_state() -> dict:
    latest = _latest_due_slot()
    settled = False
    if latest:
        with connect() as conn:
            settled = conn.execute(
                "SELECT 1 FROM match_slots WHERE period=?", (_slot_period(latest),)
            ).fetchone() is not None
    nxt = _next_match_at()
    count = live_pool_count()
    return {
        "count": count,
        "min": _pool_min(),
        "match_hour": _match_hour(),
        "schedule_label": _schedule_label(),
        "matching_open": bool(settled),
        "ready": bool(settled) and count >= _pool_min(),
        "waiting": not settled,
        "next_match_at": nxt.isoformat(),
        "next_match_label": nxt.strftime("%m-%d %H:%M"),
        "countdown_seconds": max(0, int((nxt - _now()).total_seconds())),
        "round_limit": _round_limit(),
        "early_match": early_match_hint(count),
    }


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
        "pinpin_open": (_bool_env("ALLOW_SIMULATED_PAYMENT", False) or _manual_payment_enabled()) and sold < PINPIN_CAP,
        "can_boost": bool(user.get("is_pro")) and user.get("boost_period") != period,
        "boost_active": bool(user.get("boost_active")),
    }


def unlock_state(user_id: int) -> dict:
    with connect() as conn:
        contacted = conn.execute("SELECT COUNT(*) n FROM contacts WHERE from_user_id=?", (user_id,)).fetchone()["n"]
        invited = conn.execute("SELECT COUNT(*) n FROM users WHERE invited_by_user_id=?", (user_id,)).fetchone()["n"]
    return {"email_sent": contacted > 0, "referral_complete": invited > 0}


def purge_seed_users() -> None:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id FROM users
            WHERE (IFNULL(is_seed,0)=1 OR email LIKE '%@pingo.local')
              AND email NOT LIKE 'import-%@pingo.local'
            """
        ).fetchall()
        ids = [row["id"] for row in rows]
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if ids:
            placeholders = ",".join("?" * len(ids))
            conn.execute(
                f"UPDATE users SET invited_by_user_id=NULL WHERE invited_by_user_id IN ({placeholders})",
                ids,
            )
            for table, left, right in (
                ("matches", "user_id", "candidate_id"),
                ("contacts", "from_user_id", "to_user_id"),
                ("member_views", "user_id", "candidate_id"),
                ("preferences", "user_id", "candidate_id"),
            ):
                if table in tables:
                    conn.execute(
                        f"DELETE FROM {table} WHERE {left} IN ({placeholders}) OR {right} IN ({placeholders})",
                        (*ids, *ids),
                    )
            if "reports" in tables:
                conn.execute(f"DELETE FROM reports WHERE reporter_user_id IN ({placeholders})", ids)
                conn.execute(f"UPDATE reports SET target_user_id=NULL WHERE target_user_id IN ({placeholders})", ids)
            for table, column in (
                ("sessions", "user_id"),
                ("pinpin_payment_requests", "user_id"),
                ("pinpin_orders", "user_id"),
            ):
                if table in tables:
                    conn.execute(f"DELETE FROM {table} WHERE {column} IN ({placeholders})", ids)
            conn.execute(f"DELETE FROM users WHERE id IN ({placeholders})", ids)


def list_candidates(exclude_id: int, *, live_only: bool = True) -> list[dict]:
    query = "SELECT * FROM users WHERE id!=? AND name!='' AND experience!=''"
    if live_only:
        query += f" AND IFNULL(is_seed,0)=0 AND email NOT LIKE '%@pingo.local' AND {_pool_active_clause()}"
    with connect() as conn:
        rows = conn.execute(query, (exclude_id,)).fetchall()
    return [_user_dict(row) for row in rows]


def preferred_id(user_id: int) -> Optional[int]:
    with connect() as conn:
        row = conn.execute("SELECT candidate_id FROM preferences WHERE user_id=?", (user_id,)).fetchone()
    return row["candidate_id"] if row else None


def _store_matches(user: dict, period: str) -> list[dict]:
    prefer = preferred_id(user["id"])
    scored = rank_matches(user, list_candidates(user["id"], live_only=True), prefer)
    with connect() as conn:
        conn.execute("DELETE FROM matches WHERE user_id=?", (user["id"],))
        for rank, item in enumerate(scored[:5], 1):
            conn.execute(
                "INSERT INTO matches(user_id,rank,candidate_id,score,reason,can_share,wants,shared_tags,period) VALUES(?,?,?,?,?,?,?,?,?)",
                (user["id"], rank, item["candidate_id"], item["score"], item["reason"], item["can_share"], item["wants"], json.dumps(item["shared_tags"], ensure_ascii=False), period),
            )
        return [dict(row) for row in conn.execute("SELECT * FROM matches WHERE user_id=? ORDER BY rank", (user["id"],))]


def settle_due_round() -> None:
    now = _now()
    slot = _latest_due_slot(now)
    if not slot or slot.date() != now.date():
        return
    period = _slot_period(slot)
    with connect() as conn:
        if conn.execute("SELECT 1 FROM match_slots WHERE period=?", (period,)).fetchone():
            return
        rows = conn.execute(
            "SELECT id FROM users WHERE IFNULL(is_seed,0)=0 AND IFNULL(experience,'')!='' "
            "AND IFNULL(looking_for,'')!='' AND IFNULL(pool_status,'active')='active'"
        ).fetchall()
        ids = [row["id"] for row in rows]
        if len(ids) < _pool_min():
            return
        conn.execute("INSERT INTO match_slots(period, participant_count) VALUES(?,?)", (period, len(ids)))
    for user_id in ids:
        profile = get_user(user_id)
        if profile:
            _store_matches(profile, period)
    ended_on = slot.date().isoformat()
    with connect() as conn:
        for user_id in ids:
            used = int(conn.execute("SELECT rounds_used FROM users WHERE id=?", (user_id,)).fetchone()["rounds_used"] or 0) + 1
            if used >= _round_limit():
                conn.execute(
                    """
                    UPDATE users
                    SET rounds_used=?, last_round_period=?, pool_status='paused',
                        cycle_ended_on=?, verify_token=?, reminder_count=0
                    WHERE id=?
                    """,
                    (used, period, ended_on, secrets.token_urlsafe(24), user_id),
                )
            else:
                conn.execute(
                    "UPDATE users SET rounds_used=?, last_round_period=? WHERE id=?",
                    (used, period, user_id),
                )


def _renew_user(user_id: int) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE users
            SET pool_status='active', rounds_used=0, cycle_ended_on='', verify_token='', reminder_count=0
            WHERE id=?
            """,
            (user_id,),
        )


def renew_by_token(token: str) -> bool:
    token = (token or "").strip()
    if len(token) < 16:
        return False
    with connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE verify_token=? AND pool_status='paused'", (token,)).fetchone()
    if not row:
        return False
    _renew_user(row["id"])
    return True


def send_cycle_reminders() -> int:
    sent = 0
    today = _now().date()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, email, name, verify_token, cycle_ended_on, reminder_count
            FROM users
            WHERE pool_status='paused' AND cycle_ended_on!='' AND IFNULL(reminder_count,0)<3
              AND IFNULL(verify_token,'')!=''
            """
        ).fetchall()
    for row in rows:
        try:
            ended = datetime.strptime(row["cycle_ended_on"], "%Y-%m-%d").date()
        except ValueError:
            continue
        days = (today - ended).days
        if not (1 <= days <= 3) or int(row["reminder_count"] or 0) >= days:
            continue
        url = f"{_app_url()}/verify?token={row['verify_token']}"
        body = (
            f"{row['name'] or '你好'}，这 4 轮匹配已经用完。\n\n"
            "还想继续的话，点下面确认。确认后，再给你 4 轮，时间还是周一、周三晚上 9 点。\n"
            "不点的话，就不会再被配出去，也不会再配到你。\n\n"
            f"确认继续：{url}\n"
        )
        if not send_mail(row["email"], "还想继续匹配吗 · 拼个实习", body):
            continue
        with connect() as conn:
            conn.execute("UPDATE users SET reminder_count=? WHERE id=? AND pool_status='paused'", (days, row["id"]))
        sent += 1
    return sent


def _maintain_pool() -> None:
    settle_due_round()
    send_cycle_reminders()


async def _pool_maintenance() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            _maintain_pool()
        except Exception:
            continue


def recompute_matches(user: dict, force: bool = False) -> list[dict]:
    settle_due_round()
    fresh = get_user(user["id"]) or user
    if not fresh.get("profile_complete"):
        return []
    latest = _latest_due_slot()
    period = _slot_period(latest) if latest else ""
    if period and fresh.get("last_round_period") == period:
        with connect() as conn:
            existing = conn.execute("SELECT * FROM matches WHERE user_id=? AND period=? ORDER BY rank", (fresh["id"], period)).fetchall()
        if existing and not force:
            return [dict(row) for row in existing]
        if fresh.get("pool_status") == "paused":
            return [dict(row) for row in existing]
        return _store_matches(fresh, period)
    if fresh.get("is_pro"):
        with connect() as conn:
            early = conn.execute(
                "SELECT * FROM matches WHERE user_id=? AND period LIKE 'early-%' ORDER BY rank",
                (fresh["id"],),
            ).fetchall()
        if early:
            return [dict(row) for row in early]
    return []


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
        "is_payment_admin": _is_payment_admin(user),
        "is_data_admin": _is_data_admin(user),
        "unlock": unlock_state(user["id"]),
        "quota": quota_state(user),
        "email_configured": email_configured(),
        "app_url": _app_url(),
        "pool": pool_state(),
        "pool_pass": pool_pass(user),
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
    return {
        "ok": True,
        "release": _app_release(),
        "email_configured": email_configured(),
        "jev_configured": jev_configured(),
        "payment_configured": False,
    }


@app.get("/api/config")
def config():
    return {
        "email_configured": email_configured(),
        "app_url": _app_url(),
        "simulated_payment": _bool_env("ALLOW_SIMULATED_PAYMENT", False),
        "manual_payment": _manual_payment_config(),
        "pool": pool_state(),
    }


@app.get("/verify", response_class=HTMLResponse)
def verify_pool_link(token: str = ""):
    ok = renew_by_token(token)
    if not ok:
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><title>链接无效</title>"
            "<body style='font-family:sans-serif;padding:48px'><h1>这个确认链接无效，或已经用过了。</h1>"
            "<p><a href='/'>回首页</a></p></body>",
            status_code=400,
        )
    return HTMLResponse(
        "<!doctype html><meta charset='utf-8'><title>已确认</title>"
        "<body style='font-family:sans-serif;padding:48px'><h1>已确认，接下来再给你 4 轮。</h1>"
        "<p>匹配还是周一、周三晚上 9 点。这 4 轮用完后，会再发邮件问你一次。</p>"
        "<p><a href='/'>回首页</a></p></body>"
    )


@app.post("/api/pool/renew")
def renew_pool(user: dict = Depends(current_user)):
    if user.get("pool_status") != "paused":
        return {"ok": True, "pool_pass": pool_pass(get_user(user["id"])), "pool": pool_state()}
    _renew_user(user["id"])
    refreshed = get_user(user["id"])
    return {"ok": True, "pool_pass": pool_pass(refreshed), "pool": pool_state()}


@app.post("/api/auth/enter")
def enter(body: EnterBody, request: Request, response: Response):
    email = _normalize_email(body.email)
    _rate_limit(f"enter:{request.client.host if request.client else 'unknown'}:{email}")
    existing = get_user_by_email(email)
    invite = body.invite_code.strip().upper()
    invited_by = None
    if invite and invite != EARLY_ACCESS_INVITE_CODE:
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
        return {"matches": [], "pool": pool_state(), "unlock": unlock_state(user["id"]), "quota": quota_state(user)}
    return {"matches": serialize_matches(user), "pool": pool_state(), "unlock": unlock_state(user["id"]), "quota": quota_state(user)}


@app.post("/api/matches/early")
def early_match(user: dict = Depends(current_user)):
    fresh = get_user(user["id"]) or user
    if not fresh.get("is_pro"):
        raise HTTPException(403, "开通拼拼卡后可以马上匹配")
    if not fresh.get("profile_complete"):
        raise HTTPException(400, "先写一句经历，再匹配")
    if fresh.get("pool_status") == "paused":
        raise HTTPException(403, "这 4 轮用完了，先去邮箱确认")
    latest = _latest_due_slot()
    if latest and fresh.get("last_round_period") == _slot_period(latest):
        return {"matches": serialize_matches(fresh), "pool": pool_state(), "already": True}
    if live_pool_count() < _pool_min():
        raise HTTPException(409, "池里还不到 2 人，先等等")
    _store_matches(fresh, "early-" + _now().strftime("%Y-%m-%d-%H%M"))
    refreshed = get_user(user["id"])
    return {"matches": serialize_matches(refreshed), "pool": pool_state()}


def _can_email_user(person: dict) -> bool:
    email = (person.get("email") or "").strip()
    return bool(email) and not email.endswith(".local") and not person.get("is_seed")


def _contact_messages(draft: str, sender: dict, candidate: dict) -> tuple[str, str]:
    sender_email = (sender.get("email") or "").strip()
    candidate_email = (candidate.get("email") or "").strip()
    sender_name = (sender.get("name") or "发起人").strip() or "发起人"
    candidate_name = (candidate.get("name") or "搭子").strip() or "搭子"
    text = draft.rstrip()
    to_candidate = (
        f"{text}\n\n"
        "——\n"
        f"我的联系方式：{sender_name}\n"
        f"{sender_email}\n"
        "直接回复这封邮件，也会发到这个邮箱。\n"
    )
    to_sender = (
        f"{text}\n\n"
        "——\n"
        f"这封信已经发给 {candidate_name}。\n"
        f"对方邮箱：{candidate_email}\n"
        f"你的邮箱 {sender_email} 也写在给对方的信里了。\n"
    )
    return to_candidate, to_sender


@app.post("/api/matches/{candidate_id}/contact")
def contact(candidate_id: int, body: ContactBody, user: dict = Depends(current_user)):
    allowed = next((item for item in serialize_matches(user) if item["person"]["id"] == candidate_id and item["unlocked"]), None)
    if not allowed:
        raise HTTPException(403, "这位搭子尚未解锁")
    candidate = get_user(candidate_id)
    draft = body.body.strip() or f"Hi {candidate['name']}，我在「拼个实习」看到我们很匹配，想约 20 分钟交换项目工作流和求职经验。"
    to_candidate, to_sender = _contact_messages(draft, user, candidate)
    sent = False
    if _can_email_user(candidate):
        sent = send_mail(candidate["email"], f"来自「拼个实习」的认识邮件 · {user['name']}", to_candidate, reply_to=user["email"])
        if _can_email_user(user):
            send_mail(
                user["email"],
                f"你匹配到的搭子邮箱 · {candidate['name']}",
                to_sender,
                reply_to=candidate["email"],
            )
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
    if (
        not candidate
        or candidate_id == user["id"]
        or candidate.get("is_seed")
        or str(candidate.get("email") or "").endswith("@pingo.local")
    ):
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


def data_admin(user: dict = Depends(current_user)) -> dict:
    if not _is_data_admin(user):
        raise HTTPException(403, "此账号没有资料同步权限")
    return user


@app.post("/api/admin/imports/preview")
def preview_import(body: ImportPreviewBody, admin: dict = Depends(data_admin)):
    _rate_limit(f"import-preview:{admin['id']}", 30, 3600)
    try:
        rows, skipped = _parse_import_content(body.source_format, body.content)
    except json.JSONDecodeError:
        raise HTTPException(400, "JSON 格式不正确")
    if not rows:
        raise HTTPException(400, "没有找到至少包含昵称或自我介绍的有效资料")
    return {"source_name": body.source_name.strip(), "rows": rows, "skipped_count": skipped}


def _import_candidate(source_name: str, row: dict) -> None:
    normalized = _normalize_import_row(row)
    if not normalized:
        return
    identity = "|".join([source_name, normalized["name"], normalized["xhs"], normalized["intro"]])
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    email = f"import-{digest[:32]}@pingo.local"
    referral = f"IMPORT-{digest[:10].upper()}"
    tags = _infer_tags(" ".join([normalized["role"], normalized["skills"], normalized["wants"], normalized["intro"]]))
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO users(email,name,school,grade,city,major,role,skills,wants,tags,intro,experience,looking_for,xhs,letter,tone,referral_code,is_seed)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
            ON CONFLICT(email) DO UPDATE SET name=excluded.name,school=excluded.school,grade=excluded.grade,city=excluded.city,
              major=excluded.major,role=excluded.role,skills=excluded.skills,wants=excluded.wants,tags=excluded.tags,intro=excluded.intro,
              experience=excluded.experience,looking_for=excluded.looking_for,xhs=excluded.xhs,letter=excluded.letter,updated_at=datetime('now')
            """,
            (
                email, normalized["name"], normalized["school"], normalized["grade"], normalized["city"], normalized["major"],
                normalized["role"] or tags[0], normalized["skills"], normalized["wants"], json.dumps(tags, ensure_ascii=False),
                normalized["intro"], normalized["skills"], normalized["wants"], normalized["xhs"], normalized["name"][:1].upper(),
                TONES[int(digest[:2], 16) % len(TONES)], referral,
            ),
        )


@app.post("/api/admin/imports/commit")
def commit_import(body: ImportCommitBody, admin: dict = Depends(data_admin)):
    _rate_limit(f"import-commit:{admin['id']}", 12, 3600)
    if not body.consent_confirmed:
        raise HTTPException(400, "请确认资料已获得授权或来自可公开使用的来源")
    rows = [_normalize_import_row(row) for row in body.rows]
    rows = [row for row in rows if row]
    if not rows:
        raise HTTPException(400, "没有可写入的有效资料")
    for row in rows:
        _import_candidate(body.source_name.strip(), row)
    with connect() as conn:
        conn.execute(
            "INSERT INTO import_batches(source_name,source_format,imported_count,skipped_count,imported_by) VALUES(?,?,?,?,?)",
            (body.source_name.strip(), body.source_format, len(rows), len(body.rows) - len(rows), admin["email"]),
        )
        profile_ids = [row["id"] for row in conn.execute("SELECT id FROM users WHERE experience!='' AND is_seed=0").fetchall()]
    for user_id in profile_ids:
        profile = get_user(user_id)
        if profile:
            recompute_matches(profile, force=True)
    return {"ok": True, "imported_count": len(rows), "skipped_count": len(body.rows) - len(rows)}


@app.get("/api/admin/imports/batches")
def import_batches(admin: dict = Depends(data_admin)):
    with connect() as conn:
        rows = conn.execute("SELECT source_name,source_format,imported_count,skipped_count,imported_by,created_at FROM import_batches ORDER BY id DESC LIMIT 20").fetchall()
    return {"batches": [dict(row) for row in rows]}


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


def _payment_request_payload(row) -> dict:
    return {
        "id": row["id"],
        "order_code": row["order_code"],
        "payer_nickname": row["payer_nickname"],
        "amount_cents": row["amount_cents"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "reviewed_at": row["reviewed_at"],
    }


def _next_payment_order_code(conn) -> str:
    while True:
        code = "PP-" + secrets.token_hex(4).upper()
        if not conn.execute("SELECT 1 FROM pinpin_payment_requests WHERE order_code=?", (code,)).fetchone():
            return code


@app.get("/api/pinpin/manual-order")
def manual_payment_order(user: dict = Depends(current_user)):
    with connect() as conn:
        row = conn.execute("SELECT * FROM pinpin_payment_requests WHERE user_id=?", (user["id"],)).fetchone()
    return {"payment": _manual_payment_config(), "order": _payment_request_payload(row) if row else None}


@app.post("/api/pinpin/manual-order")
def submit_manual_payment_order(body: PinpinPaymentRequestBody, user: dict = Depends(current_user)):
    if not _manual_payment_enabled():
        raise HTTPException(503, "内测收款暂未开放")
    _rate_limit(f"manual-payment:{user['id']}", 8, 3600)
    nickname = body.payer_nickname.strip()
    if not nickname:
        raise HTTPException(400, "请填写付款时显示的微信昵称")
    with connect() as conn:
        row = conn.execute("SELECT * FROM pinpin_payment_requests WHERE user_id=?", (user["id"],)).fetchone()
        if row:
            conn.execute(
                "UPDATE pinpin_payment_requests SET payer_nickname=?,status=CASE WHEN status='approved' THEN status ELSE 'pending' END,updated_at=datetime('now') WHERE id=?",
                (nickname, row["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO pinpin_payment_requests(user_id,order_code,payer_nickname) VALUES(?,?,?)",
                (user["id"], _next_payment_order_code(conn), nickname),
            )
        row = conn.execute("SELECT * FROM pinpin_payment_requests WHERE user_id=?", (user["id"],)).fetchone()
    return {"ok": True, "order": _payment_request_payload(row)}


def payment_admin(user: dict = Depends(current_user)) -> dict:
    if not _is_payment_admin(user):
        raise HTTPException(403, "此账号没有核账权限")
    return user


@app.get("/api/admin/pinpin-orders")
def admin_pinpin_orders(status: str = "pending", admin: dict = Depends(payment_admin)):
    if status not in {"pending", "approved"}:
        raise HTTPException(400, "不支持的订单状态")
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT p.*,u.email,u.name FROM pinpin_payment_requests p
            JOIN users u ON u.id=p.user_id
            WHERE p.status=? ORDER BY p.updated_at DESC
            """,
            (status,),
        ).fetchall()
    return {
        "orders": [
            {**_payment_request_payload(row), "email": row["email"], "name": row["name"]}
            for row in rows
        ]
    }


@app.post("/api/admin/pinpin-orders/{order_id}/approve")
def approve_pinpin_order(order_id: int, admin: dict = Depends(payment_admin)):
    with connect() as conn:
        row = conn.execute("SELECT * FROM pinpin_payment_requests WHERE id=?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(404, "订单不存在")
        if row["status"] == "approved":
            return {"ok": True, "already_approved": True}
        if row["status"] != "pending":
            raise HTTPException(409, "订单当前不能开通")
        conn.execute(
            "UPDATE pinpin_payment_requests SET status='approved',reviewed_by=?,reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
            (admin["email"], order_id),
        )
        conn.execute("UPDATE users SET is_pro=1,pro_purchased_at=datetime('now') WHERE id=?", (row["user_id"],))
    user = get_user(row["user_id"])
    email_sent = send_mail(
        user["email"],
        "你的拼拼卡已开通",
        f"你好，\n\n你的 ¥10 拼拼卡内测终身版已开通。现在可以直接查看更多匹配、使用组合筛选与每日加急曝光。\n\n进入拼个实习：{_app_url()}\n\n拼个实习",
    )
    return {"ok": True, "email_sent": email_sent}


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


@app.get("/about", include_in_schema=False)
def about_page():
    return FileResponse(ROOT / "about.html")


@app.get("/robots.txt", include_in_schema=False)
def robots_file():
    return FileResponse(ROOT / "robots.txt", media_type="text/plain")


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_file():
    return FileResponse(ROOT / "sitemap.xml", media_type="application/xml")


@app.get("/llms.txt", include_in_schema=False)
def llms_file():
    return FileResponse(ROOT / "llms.txt", media_type="text/plain")


@app.get("/styles.css")
def styles():
    return FileResponse(ROOT / "styles.css")


@app.get("/app.js")
def script():
    return FileResponse(ROOT / "app.js")


@app.get("/review")
def review_page():
    return FileResponse(ROOT / "review.html")


@app.get("/review.js")
def review_script():
    return FileResponse(ROOT / "review.js")


@app.get("/imports")
def imports_page():
    return FileResponse(ROOT / "imports.html")


@app.get("/imports.js")
def imports_script():
    return FileResponse(ROOT / "imports.js")


app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
