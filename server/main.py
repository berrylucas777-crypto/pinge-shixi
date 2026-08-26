from __future__ import annotations

import json
import os
import secrets
import string
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
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
TONES = ["blue", "coral", "violet", "green", "yellow", "gray", "red", "pink", "cyan", "orange"]
CODE_TTL = 10 * 60

def _origins() -> list[str]:
    origins = {
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://shixi.seu-link.fit",
        "https://seu-link.fit",
        "https://www.seu-link.fit",
    }
    app_url = (os.getenv("APP_URL") or "").rstrip("/")
    if app_url:
        origins.add(app_url)
    for item in (os.getenv("CORS_ORIGINS") or "").split(","):
        cleaned = item.strip().rstrip("/")
        if cleaned:
            origins.add(cleaned)
    return sorted(origins)


app = FastAPI(title="拼个实习")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EnterBody(BaseModel):
    email: str
    invite_code: str = ""


class VerifyBody(BaseModel):
    email: str
    code: str


class ProfileBody(BaseModel):
    name: str
    school: str = ""
    grade: str = ""
    city: str = ""
    role: str = ""
    skills: str = ""
    wants: str = ""
    tags: list[str] = Field(default_factory=list)
    intro: str = ""


class ContactBody(BaseModel):
    body: str = ""


def _app_url() -> str:
    return (os.getenv("APP_URL") or "https://shixi.seu-link.fit").rstrip("/")


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
    if "@" not in value or "." not in value.split("@")[-1] or " " in value:
        raise HTTPException(400, "请输入可以接收匹配邮件的邮箱")
    return value


def _referral_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "PINGO-" + "".join(secrets.choice(alphabet) for _ in range(4))


def _user_dict(row) -> dict:
    data = dict(row)
    data["tags"] = json.loads(data.get("tags") or "[]")
    data["profile_complete"] = bool(data.get("name") and data.get("role") and data["tags"])
    data["is_seed"] = bool(data.get("is_seed"))
    return data


def _public_person(user: dict, unlocked: bool) -> dict:
    name = user["name"]
    return {
        "id": user["id"],
        "name": name if unlocked else (name[:1] + " ·" if name else "搭子"),
        "full_name": name if unlocked else None,
        "role": user.get("role") or "",
        "city": user.get("city") or "",
        "school": user.get("school") or "",
        "grade": user.get("grade") or "",
        "skills": user.get("skills") or "",
        "wants": user.get("wants") or "",
        "tags": user.get("tags") or [],
        "letter": user.get("letter") or (name[:1] if name else "P"),
        "tone": user.get("tone") or "blue",
    }


def get_user_by_email(email: str):
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return _user_dict(row) if row else None


def get_user(user_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _user_dict(row) if row else None


def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "请先登录")
    token = authorization.split(" ", 1)[1].strip()
    with connect() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()
    if not row:
        raise HTTPException(401, "登录已失效，请重新进入")
    return _user_dict(row)


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with connect() as conn:
        conn.execute("INSERT INTO sessions(token, user_id) VALUES (?, ?)", (token, user_id))
    return token


def unlock_state(user_id: int) -> dict:
    with connect() as conn:
        contacted = conn.execute(
            "SELECT COUNT(*) AS n FROM contacts WHERE from_user_id = ?", (user_id,)
        ).fetchone()["n"]
        invited = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE invited_by_user_id = ?", (user_id,)
        ).fetchone()["n"]
    return {"email_sent": contacted > 0, "referral_complete": invited > 0}


def seed_if_needed() -> None:
    with connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM users WHERE is_seed = 1").fetchone()["n"]
        if count:
            return
        for person in SEED_USERS:
            conn.execute(
                """
                INSERT INTO users (email, name, school, grade, city, role, skills, wants, tags, intro, letter, tone, referral_code, is_seed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    person["email"],
                    person["name"],
                    person["school"],
                    person["grade"],
                    person["city"],
                    person["role"],
                    person["skills"],
                    person["wants"],
                    json.dumps(person["tags"], ensure_ascii=False),
                    person["intro"],
                    person["letter"],
                    person["tone"],
                    person["referral_code"],
                ),
            )


def list_candidates(exclude_id: int) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM users WHERE id != ? AND name != '' AND role != ''",
            (exclude_id,),
        ).fetchall()
    return [_user_dict(row) for row in rows]


def preferred_id(user_id: int) -> Optional[int]:
    with connect() as conn:
        row = conn.execute("SELECT candidate_id FROM preferences WHERE user_id = ?", (user_id,)).fetchone()
    return row["candidate_id"] if row else None


def recompute_matches(user: dict, force: bool = False) -> list[dict]:
    if not user.get("profile_complete"):
        return []
    with connect() as conn:
        existing = conn.execute(
            "SELECT * FROM matches WHERE user_id = ? ORDER BY rank", (user["id"],)
        ).fetchall()
        if existing and not force:
            return [dict(row) for row in existing]
        conn.execute("DELETE FROM matches WHERE user_id = ?", (user["id"],))

    prefer = preferred_id(user["id"])
    scored = [score_pair(user, candidate, prefer) for candidate in list_candidates(user["id"])]
    scored.sort(key=lambda item: item["score"], reverse=True)
    top = scored[:3]
    saved = []
    with connect() as conn:
        for rank, item in enumerate(top, start=1):
            conn.execute(
                """
                INSERT INTO matches (user_id, rank, candidate_id, score, reason, can_share, wants, shared_tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    rank,
                    item["candidate_id"],
                    item["score"],
                    item["reason"],
                    item["can_share"],
                    item["wants"],
                    json.dumps(item["shared_tags"], ensure_ascii=False),
                ),
            )
        rows = conn.execute("SELECT * FROM matches WHERE user_id = ? ORDER BY rank", (user["id"],)).fetchall()
        saved = [dict(row) for row in rows]
    return saved


def serialize_me(user: dict) -> dict:
    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "school": user["school"],
            "grade": user["grade"],
            "city": user["city"],
            "role": user["role"],
            "skills": user["skills"],
            "wants": user["wants"],
            "tags": user["tags"],
            "intro": user["intro"],
            "letter": user["letter"],
            "referral_code": user["referral_code"],
            "profile_complete": user["profile_complete"],
        },
        "unlock": unlock_state(user["id"]),
        "email_configured": email_configured(),
        "app_url": _app_url(),
    }


def serialize_matches(user: dict) -> list[dict]:
    rows = recompute_matches(user)
    state = unlock_state(user["id"])
    results = []
    with connect() as conn:
        contacted_ids = {
            row["to_user_id"]
            for row in conn.execute("SELECT to_user_id FROM contacts WHERE from_user_id = ?", (user["id"],)).fetchall()
        }
    for row in rows:
        unlocked = row["rank"] == 1 or (row["rank"] == 2 and state["email_sent"]) or (row["rank"] == 3 and state["referral_complete"])
        candidate = get_user(row["candidate_id"])
        results.append(
            {
                "rank": row["rank"],
                "unlocked": unlocked,
                "score": row["score"],
                "reason": row["reason"],
                "can_share": row["can_share"],
                "wants": row["wants"],
                "shared_tags": json.loads(row["shared_tags"] or "[]"),
                "contacted": row["candidate_id"] in contacted_ids,
                "person": _public_person(candidate, unlocked),
            }
        )
    return results


@app.on_event("startup")
def on_startup() -> None:
    _secret_key()
    init_db()
    seed_if_needed()


@app.get("/api/health")
def health():
    return {"ok": True, "email_configured": email_configured()}


@app.get("/api/config")
def config():
    return {"email_configured": email_configured(), "app_url": _app_url()}


@app.post("/api/auth/enter")
def enter(body: EnterBody):
    email = _normalize_email(body.email)
    invite = (body.invite_code or "").strip().upper()
    existing = get_user_by_email(email)
    invited_by = None
    if invite:
        with connect() as conn:
            host = conn.execute("SELECT * FROM users WHERE referral_code = ?", (invite,)).fetchone()
        if not host:
            raise HTTPException(400, "邀请码无效，可留空直接进入")
        if existing is None or existing["id"] != host["id"]:
            invited_by = host["id"]

    if existing is None:
        letter = email[0].upper()
        tone = TONES[sum(ord(ch) for ch in email) % len(TONES)]
        code = _referral_code()
        with connect() as conn:
            while conn.execute("SELECT 1 FROM users WHERE referral_code = ?", (code,)).fetchone():
                code = _referral_code()
            conn.execute(
                """
                INSERT INTO users (email, letter, tone, referral_code, invited_by_user_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (email, letter, tone, code, invited_by if invited_by else None),
            )
        user = get_user_by_email(email)
        if invited_by and email_configured():
            host = get_user(invited_by)
            send_mail(
                host["email"],
                "朋友来了，第 3 位搭子已解锁",
                f"有一位朋友使用你的邀请码 {host['referral_code']} 完成了注册。打开 {_app_url()} 查看新的匹配。",
            )
    else:
        user = existing
        if invited_by and not user.get("invited_by_user_id") and invited_by != user["id"]:
            with connect() as conn:
                conn.execute("UPDATE users SET invited_by_user_id = ? WHERE id = ?", (invited_by, user["id"]))
            user = get_user(user["id"])

    if email_configured():
        code = f"{secrets.randbelow(1000000):06d}"
        with connect() as conn:
            conn.execute(
                "INSERT INTO login_codes(email, code, expires_at) VALUES(?, ?, ?) ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at",
                (email, code, time.time() + CODE_TTL),
            )
        sent = send_mail(email, "拼个实习登录验证码", f"你的验证码是 {code}，10 分钟内有效。")
        if not sent:
            raise HTTPException(500, "验证码发送失败，请稍后重试")
        return {"status": "code_sent", "email_configured": True}

    token = create_session(user["id"])
    return {"status": "ok", "token": token, "email_configured": False, **serialize_me(user)}


@app.post("/api/auth/verify")
def verify(body: VerifyBody):
    email = _normalize_email(body.email)
    with connect() as conn:
        row = conn.execute("SELECT code, expires_at FROM login_codes WHERE email = ?", (email,)).fetchone()
    if not row or row["code"] != body.code.strip() or row["expires_at"] < time.time():
        raise HTTPException(400, "验证码不正确或已过期")
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(400, "请先提交邮箱")
    with connect() as conn:
        conn.execute("DELETE FROM login_codes WHERE email = ?", (email,))
    token = create_session(user["id"])
    return {"status": "ok", "token": token, "email_configured": True, **serialize_me(user)}


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return serialize_me(user)


@app.patch("/api/me")
def update_me(body: ProfileBody, user: dict = Depends(current_user)):
    name = body.name.strip()
    role = body.role.strip()
    tags = [tag.strip() for tag in body.tags if tag.strip()]
    if not name or not role or not tags:
        raise HTTPException(400, "请填写称呼、方向，并至少选一个标签")
    letter = name[:1].upper()
    with connect() as conn:
        conn.execute(
            """
            UPDATE users SET name=?, school=?, grade=?, city=?, role=?, skills=?, wants=?, tags=?, intro=?, letter=?
            WHERE id=?
            """,
            (
                name,
                body.school.strip(),
                body.grade.strip(),
                body.city.strip(),
                role,
                body.skills.strip(),
                body.wants.strip(),
                json.dumps(tags, ensure_ascii=False),
                body.intro.strip(),
                letter,
                user["id"],
            ),
        )
    updated = get_user(user["id"])
    recompute_matches(updated, force=True)
    return serialize_me(updated)


@app.get("/api/matches")
def matches(user: dict = Depends(current_user)):
    if not user.get("profile_complete"):
        return {"matches": [], "unlock": unlock_state(user["id"])}
    return {"matches": serialize_matches(user), "unlock": unlock_state(user["id"])}


@app.post("/api/matches/{candidate_id}/contact")
def contact(candidate_id: int, body: ContactBody, user: dict = Depends(current_user)):
    if not user.get("profile_complete"):
        raise HTTPException(400, "请先完善资料")
    candidate = get_user(candidate_id)
    if not candidate or candidate["id"] == user["id"]:
        raise HTTPException(404, "没有找到这位搭子")
    draft = (body.body or "").strip() or (
        f"Hi {candidate['name']}，\n\n我在「拼个实习」看到我们很匹配。想和你交换一下项目工作流和求职经验。"
        "如果你愿意，我们可以先约 20 分钟线上聊聊。"
    )
    sent = False
    if not candidate.get("is_seed"):
        sent = send_mail(
            candidate["email"],
            f"来自「拼个实习」的认识邮件 · {user['name'] or user['email']}",
            draft,
            reply_to=user["email"],
        )
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO contacts (from_user_id, to_user_id, body, sent)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(from_user_id, to_user_id) DO UPDATE SET body=excluded.body, sent=excluded.sent
            """,
            (user["id"], candidate_id, draft, int(sent)),
        )
    return {"sent": sent, "unlock": unlock_state(user["id"]), "matches": serialize_matches(get_user(user["id"]))}


@app.get("/api/members")
def members(q: str = "", tag: str = "", user: dict = Depends(current_user)):
    query = q.strip().lower()
    tag = tag.strip()
    people = []
    for candidate in list_candidates(user["id"]):
        haystack = " ".join(
            [
                candidate["name"],
                candidate["school"],
                candidate["grade"],
                candidate["role"],
                candidate["skills"],
                candidate["city"],
                " ".join(candidate["tags"]),
            ]
        ).lower()
        if query and query not in haystack:
            continue
        if tag and tag != "全部" and tag not in candidate["tags"] and tag not in haystack:
            continue
        people.append(
            {
                "id": candidate["id"],
                "name": candidate["name"],
                "school": candidate["school"],
                "grade": candidate["grade"],
                "skills": candidate["skills"],
                "tags": candidate["tags"],
                "letter": candidate["letter"],
                "tone": candidate["tone"],
            }
        )
    return {"members": people}


@app.post("/api/members/{candidate_id}/prefer")
def prefer(candidate_id: int, user: dict = Depends(current_user)):
    candidate = get_user(candidate_id)
    if not candidate or candidate["id"] == user["id"]:
        raise HTTPException(404, "没有找到这位成员")
    with connect() as conn:
        conn.execute(
            "INSERT INTO preferences(user_id, candidate_id) VALUES(?, ?) ON CONFLICT(user_id) DO UPDATE SET candidate_id=excluded.candidate_id",
            (user["id"], candidate_id),
        )
    updated = get_user(user["id"])
    if updated.get("profile_complete"):
        recompute_matches(updated, force=True)
    return {"ok": True, "matches": serialize_matches(updated) if updated.get("profile_complete") else []}


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
