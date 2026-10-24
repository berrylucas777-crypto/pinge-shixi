from pathlib import Path

import pytest

from test_api import make_client, freeze_clock, register_and_onboard
from server import matching


def add_members(db, count):
    with db.connect() as conn:
        for i in range(count):
            conn.execute(
                """INSERT INTO users
                (email,name,referral_code,city,grade,major,experience,looking_for)
                VALUES(?,?,?,?,?,?,?,?)""",
                (f"peer-{i}@example.com", f"Peer {i:03}", f"PEER-{i}",
                 "上海", "研一", "计算机", "Agent 评测", "产品需求"),
            )
        return [row["id"] for row in conn.execute(
            "SELECT id FROM users WHERE email LIKE 'peer-%@example.com' ORDER BY name"
        )]


def test_legacy_payment_flags_cannot_reenable_sales(tmp_path, monkeypatch):
    for key in ("PINPIN_SALES_ENABLED", "MANUAL_PAYMENT_ENABLED", "ALLOW_SIMULATED_PAYMENT"):
        monkeypatch.setenv(key, "true")
    monkeypatch.setenv("MANUAL_PAYMENT_QR_URL", "/assets/old-qr.jpg")
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        config = client.get("/api/config").json()
        assert config["simulated_payment"] is False
        assert config["manual_payment"] == {
            "enabled": False, "accepting_new_orders": False, "qr_url": "",
        }
        me = register_and_onboard(client)
        for path in ("simulate", "manual-order", "boost"):
            response = client.post(f"/api/pinpin/{path}", json={"payer_nickname": "Test"})
            assert response.status_code == 410
        with db.connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM pinpin_payment_requests").fetchone()[0] == 0
            user = conn.execute("SELECT * FROM users WHERE id=?", (me["user"]["id"],)).fetchone()
            assert user["is_pro"] == 0
            assert user["boost_until"] == 0
        assert client.get("/api/me").json()["quota"]["pinpin_open"] is False


def test_historical_orders_remain_private_read_only_and_unchanged(tmp_path, monkeypatch):
    monkeypatch.setenv("PAYMENT_ADMIN_EMAILS", "admin@example.com")
    client, db = make_client(tmp_path, monkeypatch)
    freeze_clock(monkeypatch, 10)
    with client:
        assert client.get("/api/admin/pinpin-orders").status_code == 401
        buyer = register_and_onboard(client, "buyer@example.com")["user"]["id"]
        with db.connect() as conn:
            conn.execute(
                """INSERT INTO pinpin_payment_requests
                (user_id,order_code,payer_nickname,status) VALUES(?,?,?,?)""",
                (buyer, "PP-LEGACY", "Original", "approved"),
            )
            conn.execute("UPDATE users SET is_pro=1,pro_purchased_at='2026-10-01' WHERE id=?", (buyer,))
            before = dict(conn.execute("SELECT * FROM pinpin_payment_requests").fetchone())
        assert client.get("/api/pinpin/manual-order").json()["order"]["order_code"] == "PP-LEGACY"
        assert client.get("/api/me").json()["quota"]["details_limit"] is None
        assert client.get("/api/admin/pinpin-orders").status_code == 403
        assert client.post("/api/pinpin/manual-order", json={"payer_nickname": "Changed"}).status_code == 410
        assert client.post(f"/api/admin/pinpin-orders/{before['id']}/approve").status_code == 403
        client.post("/api/auth/logout")
        admin_id = register_and_onboard(client, "admin@example.com")["user"]["id"]
        assert client.get("/api/pinpin/manual-order").json()["order"] is None
        with db.connect() as conn:
            conn.execute(
                """INSERT INTO pinpin_payment_requests
                (user_id,order_code,payer_nickname) VALUES(?,?,?)""",
                (admin_id, "PP-PENDING", "Pending"),
            )
        records = client.get("/api/admin/pinpin-orders?status=all").json()["orders"]
        assert {row["status"] for row in records} == {"approved", "pending"}
        for row in records:
            assert client.post(f"/api/admin/pinpin-orders/{row['id']}/approve").status_code == 410
        assert len(client.get("/api/admin/pinpin-orders?status=approved").json()["orders"]) == 1
        assert client.get("/api/admin/pinpin-orders?status=invalid").status_code == 400
        with db.connect() as conn:
            assert dict(conn.execute("SELECT * FROM pinpin_payment_requests WHERE id=?", (before["id"],)).fetchone()) == before
            assert conn.execute("SELECT status FROM pinpin_payment_requests WHERE order_code='PP-PENDING'").fetchone()[0] == "pending"
            assert conn.execute("SELECT pro_purchased_at FROM users WHERE id=?", (buyer,)).fetchone()[0] == "2026-10-01"


@pytest.mark.parametrize("historical_pro", [0, 1])
def test_matching_filters_and_detail_access_are_equal(tmp_path, monkeypatch, historical_pro):
    client, db = make_client(tmp_path, monkeypatch)
    freeze_clock(monkeypatch, 10)
    monkeypatch.setattr("server.main.send_mail", lambda *args, **kwargs: True)
    with client:
        uid = register_and_onboard(client)["user"]["id"]
        ids = add_members(db, 101)
        with db.connect() as conn:
            conn.execute("UPDATE users SET is_pro=? WHERE id=?", (historical_pro, uid))
            # A historical exposure purchase must not change discovery ordering.
            conn.execute("UPDATE users SET is_pro=1,boost_until=9999999999 WHERE id=?", (ids[-1],))
        response = client.get("/api/members", params={"city": "上海", "grade": "研一", "major": "计算机"})
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["members"]] == ids
        assert client.get("/api/members?city=北京").json()["members"] == []
        for id in ids:
            response = client.get(f"/api/members/{id}")
            assert response.status_code == 200
            assert response.json()["person"]["id"] == id
            assert response.json()["quota"]["details_limit"] is None
            assert "paywall" not in response.json()
            assert not {"school", "email", "xhs"} & response.json()["person"].keys()
        assert response.json()["quota"]["details_used"] == 101
        assert client.get(f"/api/members/{ids[0]}").json()["quota"]["details_used"] == 101
        assert client.get("/api/matches").json()["matches"] == []
        early = client.post("/api/matches/early")
        assert early.status_code == 200
        matches = early.json()["matches"]
        assert len(matches) == 5
        assert all(row["unlocked"] and row["person"]["full_name"] for row in matches)
        assert client.get("/api/matches").json()["matches"] == matches
        assert client.get("/api/me").json()["unlock"] == {"email_sent": False, "referral_complete": False}
        # Contact the fifth recommendation directly, without contacting the first or inviting.
        assert client.post(f"/api/matches/{matches[4]['person']['id']}/contact", json={"body": "你好"}).json()["sent"] is True
        assert client.post(f"/api/matches/{uid}/contact", json={"body": "你好"}).status_code == 403
        freeze_clock(monkeypatch, 21, 30)
        scheduled = client.get("/api/matches").json()["matches"]
        assert len(scheduled) == 5 and all(row["unlocked"] for row in scheduled)
        client.post("/api/auth/logout")
        assert client.get("/api/members").status_code == 401
        assert client.get(f"/api/members/{ids[0]}").status_code == 401


def test_paid_exposure_does_not_affect_either_ranker(monkeypatch):
    seeker = {"id": 1, "role": "产品", "experience": "访谈", "looking_for": "模型"}
    peer = {"id": 2, "role": "算法", "experience": "模型", "looking_for": "业务"}
    boosted = {**peer, "boost_active": True}
    assert matching.score_pair(seeker, peer) == matching.score_pair(seeker, boosted)
    monkeypatch.setattr(matching.jev, "ask", lambda *args: {})
    shortlist = [matching.score_pair(seeker, peer)]
    assert matching._jev_rerank(seeker, shortlist, {2: peer}, None) == matching._jev_rerank(seeker, shortlist, {2: boosted}, None)


def test_frontend_has_no_payment_entry_or_unlock_funnel():
    root = Path(__file__).resolve().parents[1]
    for file in ("index.html", "app.js", "jobs.js", "styles.css", "jobs.css"):
        content = (root / file).read_text()
        for removed in ("pinpin", "paywall", "isPro(", "付费", "拼拼卡", "解锁", "payment-qr"):
            assert removed not in content, (file, removed)
    review = (root / "review.js").read_text()
    assert "/approve" not in review
    assert "status=all" in review
