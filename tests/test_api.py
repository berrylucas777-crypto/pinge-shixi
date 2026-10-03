import importlib
import json
import sqlite3

from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_URL", "http://testserver")
    monkeypatch.setenv("SMTP_PASSWORD", "")
    db = importlib.import_module("server.db")
    db.DB_PATH = tmp_path / "pingo-test.db"
    main = importlib.import_module("server.main")
    main._auth_attempts.clear()
    return TestClient(main.app), db


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
    with client:
        me = register_and_onboard(client)
        assert me["user"]["profile_complete"] is True

        match_response = client.get("/api/matches")
        assert match_response.status_code == 200
        matches = match_response.json()["matches"]
        assert len(matches) == 3
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


def test_school_is_never_exposed_in_member_payload(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        register_and_onboard(client, "privacy@example.com")
        with db.connect() as conn:
            candidate = conn.execute("SELECT id FROM users WHERE is_seed=1 LIMIT 1").fetchone()
            conn.execute("UPDATE users SET school='不应公开的学校' WHERE id=?", (candidate["id"],))
        detail = client.get(f"/api/members/{candidate['id']}")
        assert detail.status_code == 200
        assert "school" not in json.dumps(detail.json(), ensure_ascii=False)
        assert "不应公开的学校" not in json.dumps(detail.json(), ensure_ascii=False)


def test_simulated_payment_is_disabled_by_default(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    monkeypatch.delenv("ALLOW_SIMULATED_PAYMENT", raising=False)
    with client:
        register_and_onboard(client, "payment@example.com")
        response = client.post("/api/pinpin/simulate")
        assert response.status_code == 503


def test_early_access_invite_does_not_require_an_existing_referrer(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/auth/enter",
            json={"email": "early-access@example.com", "invite_code": "PINGO-START", "remember": True, "accept_terms": True},
        )
        assert response.status_code == 200, response.text
        assert response.json()["user"]["referral_code"].startswith("PINGO-")


def test_health_reports_release(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_RELEASE", "test-release")
    client, _ = make_client(tmp_path, monkeypatch)
    with client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["release"] == "test-release"


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
