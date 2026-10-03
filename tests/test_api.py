import importlib
import json
import sqlite3
from datetime import datetime

from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_URL", "http://testserver")
    monkeypatch.setenv("SMTP_PASSWORD", "")
    monkeypatch.setenv("MATCH_HOUR", "21")
    monkeypatch.setenv("MATCH_POOL_MIN", "2")
    monkeypatch.setenv("JEV_API_KEY", "")
    db = importlib.import_module("server.db")
    db.DB_PATH = tmp_path / "pingo-test.db"
    main = importlib.import_module("server.main")
    main._auth_attempts.clear()
    return TestClient(main.app), db


def freeze_clock(monkeypatch, hour, minute=0):
    main = importlib.import_module("server.main")
    frozen = datetime(2026, 10, 3, hour, minute, tzinfo=main.TZ)
    monkeypatch.setattr(main, "_now", lambda: frozen)


def extra_client():
    main = importlib.import_module("server.main")
    return TestClient(main.app)


def register_and_onboard(client, email="tester@example.com"):
    entered = client.post("/api/auth/enter", json={"email": email, "remember": True, "accept_terms": True})
    assert entered.status_code == 200, entered.text
    assert entered.json()["status"] == "ok"
    onboarded = client.post(
        "/api/me/onboard",
        json={
            "experience": "做过 AI 产品需求拆解与工程落地",
            "looking_for": "寻找 Agent 算法和模型评测经验",
            "intro": "AI 产品实习生，想交换工作流",
            "content_confirmed": True,
        },
    )
    assert onboarded.status_code == 200, onboarded.text
    return onboarded.json()


def test_end_to_end_matching_and_account_deletion(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    freeze_clock(monkeypatch, 21, 30)
    with client:
        me = register_and_onboard(client)
        assert me["user"]["profile_complete"] is True
        assert me["pool"]["count"] >= 1

        bob = extra_client()
        cara = extra_client()
        with bob:
            register_and_onboard(bob, "bob@example.com")
        with cara:
            register_and_onboard(cara, "cara@example.com")

        match_response = client.get("/api/matches")
        assert match_response.status_code == 200
        payload = match_response.json()
        assert payload["pool"]["waiting"] is False
        matches = payload["matches"]
        assert len(matches) >= 2
        assert matches[0]["unlocked"] is True
        assert matches[1]["unlocked"] is False
        first_id = matches[0]["person"]["id"]

        contact = client.post(f"/api/matches/{first_id}/contact", json={"body": "想和你交换 Agent 项目经验与面试复盘。"})
        assert contact.status_code == 200, contact.text
        assert contact.json()["unlock"]["email_sent"] is True
        assert contact.json()["matches"][1]["unlocked"] is True

        detail = client.get(f"/api/members/{first_id}")
        assert detail.status_code == 200
        assert detail.json()["quota"]["details_used"] == 1
        repeated = client.get(f"/api/members/{first_id}")
        assert repeated.json()["quota"]["details_used"] == 1

        report = client.post("/api/reports", json={"target_user_id": first_id, "reason": "资料需要复核"})
        assert report.status_code == 200

        deleted = client.delete("/api/me")
        assert deleted.status_code == 200
        assert client.get("/api/me").status_code == 401


def test_users_join_pool_before_nine_pm(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    freeze_clock(monkeypatch, 10, 0)
    with client:
        me = register_and_onboard(client, "early@example.com")
        assert me["pool"]["waiting"] is True
        data = client.get("/api/matches").json()
        assert data["matches"] == []
        assert data["pool"]["waiting"] is True
        assert data["pool"]["count"] >= 1
        assert data["pool"]["match_hour"] == 21
        public = client.get("/api/config").json()
        assert public["pool"]["count"] >= 1
        assert public["pool"]["next_match_label"].endswith("21:00")


def test_school_is_never_exposed_in_member_payload(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    other = extra_client()
    with client:
        register_and_onboard(client, "privacy@example.com")
        with other:
            register_and_onboard(other, "peer@example.com")
        with db.connect() as conn:
            peer = conn.execute("SELECT id FROM users WHERE email=?", ("peer@example.com",)).fetchone()
            conn.execute("UPDATE users SET school='不应公开的学校' WHERE id=?", (peer["id"],))
        detail = client.get(f"/api/members/{peer['id']}")
        assert detail.status_code == 200
        dumped = json.dumps(detail.json(), ensure_ascii=False)
        assert "school" not in dumped
        assert "不应公开的学校" not in dumped
        assert "xhs" not in dumped


def test_simulated_payment_is_disabled_by_default(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    monkeypatch.delenv("ALLOW_SIMULATED_PAYMENT", raising=False)
    with client:
        register_and_onboard(client, "payment@example.com")
        response = client.post("/api/pinpin/simulate")
        assert response.status_code == 503


def test_contact_mail_includes_matched_email(tmp_path, monkeypatch):
    captured = []

    def fake_send(to, subject, body, reply_to=None):
        captured.append({"to": to, "subject": subject, "body": body, "reply_to": reply_to})
        return True

    client, _ = make_client(tmp_path, monkeypatch)
    freeze_clock(monkeypatch, 21, 30)
    main = importlib.import_module("server.main")
    monkeypatch.setattr(main, "send_mail", fake_send)
    other = TestClient(main.app)
    with client:
        register_and_onboard(client, "alice@example.com")
        with other:
            register_and_onboard(other, "bob@example.com")
            matches = other.get("/api/matches").json()["matches"]
            assert matches
            response = other.post(
                f"/api/matches/{matches[0]['person']['id']}/contact",
                json={"body": "想和你交换项目经验。"},
            )
            assert response.status_code == 200, response.text
    bodies = "\n".join(item["body"] for item in captured)
    recipients = {item["to"] for item in captured}
    assert "alice@example.com" in bodies
    assert "bob@example.com" in bodies
    assert "匹配到的对方邮箱" in bodies
    assert "alice@example.com" in recipients
    assert "bob@example.com" in recipients


def test_early_access_invite_does_not_require_an_existing_referrer(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/auth/enter",
            json={"email": "early-access@example.com", "invite_code": "PINGO-START", "remember": True, "accept_terms": True},
        )
        assert response.status_code == 200, response.text
        assert response.json()["user"]["referral_code"].startswith("PINGO-")


def test_data_admin_can_preview_and_import_authorized_ocr_text(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_ADMIN_EMAILS", "data-admin@example.com")
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        entered = client.post("/api/auth/enter", json={"email": "data-admin@example.com", "remember": True, "accept_terms": True})
        assert entered.status_code == 200
        preview = client.post(
            "/api/admin/imports/preview",
            json={
                "source_name": "授权社群资料",
                "source_format": "ocr_text",
                "content": "昵称：小北\n方向：AI 产品\n自我介绍：做过 Agent 项目，想交流产品落地\n小红书：xiaobei",
            },
        )
        assert preview.status_code == 200, preview.text
        row = preview.json()["rows"][0]
        committed = client.post(
            "/api/admin/imports/commit",
            json={"source_name": "授权社群资料", "source_format": "ocr_text", "consent_confirmed": True, "rows": [row]},
        )
        assert committed.status_code == 200, committed.text
        assert committed.json()["imported_count"] == 1
        with db.connect() as conn:
            imported = conn.execute("SELECT email,xhs,is_seed FROM users WHERE name='小北'").fetchone()
            assert imported["email"].endswith("@pingo.local")
            assert imported["xhs"] == "xiaobei"
            assert imported["is_seed"] == 1


def test_seed_profiles_are_purged(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    other = extra_client()
    with client:
        register_and_onboard(client, "real@example.com")
        with other:
            register_and_onboard(other, "peer@example.com")
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO users(email,name,experience,looking_for,referral_code,is_seed,xhs)
                VALUES (?,?,?,?,?,?,?)
                """,
                ("pool-x@pingo.local", "假资料", "做过算法实习", "找产品搭子", "POOL-FAKE", 1, "假昵称"),
            )
        main = importlib.import_module("server.main")
        main.purge_seed_users()
        members = client.get("/api/members").json()["members"]
        dumped = json.dumps(members, ensure_ascii=False)
        assert "假资料" not in dumped
        assert "xhs" not in dumped
        assert "群资料" not in dumped
        with db.connect() as conn:
            leftover = conn.execute(
                """
                SELECT COUNT(*) n FROM users
                WHERE (IFNULL(is_seed,0)=1 OR email LIKE '%@pingo.local')
                  AND email NOT LIKE 'import-%@pingo.local'
                """
            ).fetchone()["n"]
        assert leftover == 0


def test_health_reports_release(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_RELEASE", "test-release")
    client, _ = make_client(tmp_path, monkeypatch)
    with client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["release"] == "test-release"
        assert response.json()["jev_configured"] is False


def test_jev_rerank_puts_choice_winner_first(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-key")
    matching = importlib.import_module("server.matching")

    def fake_ask(state, questions, timeout=20):
        keys = [key[4:] for key in questions if key.startswith("fit_")]
        winner = keys[-1]
        answers = {
            "best": {"type": "choice", "choice": winner, "confidence": 0.92, "probabilities": {winner: 0.92, "none": 0.08}},
        }
        for key in keys:
            answers[f"fit_{key}"] = {"type": "score", "score": 3.0 if key == winner else 0.8}
            answers[f"exchange_{key}"] = {"type": "noul", "noul": 0.88 if key == winner else 0.18}
            answers[f"clone_{key}"] = {"type": "noul", "noul": 0.08}
        return {"model": "jev-latest", "answers": answers}

    monkeypatch.setattr(matching.jev, "ask", fake_ask)
    ranked = matching.rank_matches(
        {"id": 1, "experience": "做过 AI 产品需求拆解", "looking_for": "Agent 评测", "role": "产品", "tags": ["产品"]},
        [
            {"id": 2, "experience": "也在做 AI 产品需求", "looking_for": "产品工作流", "role": "产品", "tags": ["产品"]},
            {"id": 3, "experience": "做过 Agent 评测与模型边界", "looking_for": "产品落地", "role": "算法", "tags": ["AI"]},
        ],
    )
    assert ranked[0]["candidate_id"] == 3
    assert "互补" in ranked[0]["reason"]


def test_manual_payment_can_be_reviewed_and_approved(tmp_path, monkeypatch):
    monkeypatch.setenv("MANUAL_PAYMENT_ENABLED", "true")
    monkeypatch.setenv("MANUAL_PAYMENT_QR_URL", "/assets/pinpin-payment-qr.png")
    monkeypatch.setenv("PAYMENT_ADMIN_EMAILS", "payment@example.com")
    client, _ = make_client(tmp_path, monkeypatch)
    with client:
        register_and_onboard(client, "payment@example.com")
        created = client.post("/api/pinpin/manual-order", json={"payer_nickname": "测试同学"})
        assert created.status_code == 200, created.text
        assert created.json()["order"]["status"] == "pending"

        orders = client.get("/api/admin/pinpin-orders")
        assert orders.status_code == 200, orders.text
        order = orders.json()["orders"][0]
        assert order["payer_nickname"] == "测试同学"

        approved = client.post(f"/api/admin/pinpin-orders/{order['id']}/approve")
        assert approved.status_code == 200, approved.text
        assert client.get("/api/me").json()["user"]["is_pro"] is True


def test_existing_database_receives_compatible_columns(tmp_path, monkeypatch):
    _, db = make_client(tmp_path, monkeypatch)
    legacy = db.DB_PATH
    with sqlite3.connect(legacy) as conn:
        conn.executescript(
            """
            CREATE TABLE users (
              id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT DEFAULT '', school TEXT DEFAULT '',
              grade TEXT DEFAULT '', city TEXT DEFAULT '', role TEXT DEFAULT '', skills TEXT DEFAULT '',
              wants TEXT DEFAULT '', tags TEXT DEFAULT '[]', intro TEXT DEFAULT '', letter TEXT DEFAULT 'P',
              tone TEXT DEFAULT 'blue', referral_code TEXT UNIQUE, invited_by_user_id INTEGER,
              is_seed INTEGER DEFAULT 0, created_at TEXT
            );
            CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT);
            CREATE TABLE login_codes (email TEXT PRIMARY KEY, code TEXT, expires_at REAL);
            CREATE TABLE matches (
              id INTEGER PRIMARY KEY, user_id INTEGER, rank INTEGER, candidate_id INTEGER,
              score INTEGER, reason TEXT, can_share TEXT, wants TEXT, shared_tags TEXT,
              UNIQUE(user_id, rank)
            );
            """
        )
    db.init_db()
    with db.connect() as conn:
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        match_columns = {row["name"] for row in conn.execute("PRAGMA table_info(matches)")}
    assert {"experience", "looking_for", "consent_version", "content_confirmed_at"} <= user_columns
    assert "period" in match_columns
