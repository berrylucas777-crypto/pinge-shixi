from test_api import make_client
from test_jobs import job
from server.sync_jobs import store_board


def login(client, email):
    response = client.post('/api/auth/enter', json={'email': email, 'accept_terms': True})
    assert response.status_code == 200


def content(**changes):
    return dict({'role_title': '产品实习生', 'year': 2025,
                 'body': '本人日常负责整理访谈记录、更新需求文档，每周与导师一起复盘需求优先级。',
                 'confirmed': True}, **changes)


def test_experience_moderation_privacy_scope_and_withdrawal(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_ADMIN_EMAILS', 'editor@example.com')
    client, db = make_client(tmp_path, monkeypatch)
    endpoint = '/api/jobs/figma:1/experiences'
    with client:
        store_board('figma', {'jobs': [job(1), job(2)]}, '2026-10-24')
        store_board('stripe', {'jobs': [job(1)]}, '2026-10-24')
        assert client.post(endpoint, json=content()).status_code == 401
        login(client, 'writer@example.com')
        assert client.post(endpoint, json=content(confirmed=False)).status_code == 400
        assert client.post(endpoint, json=content(year=2099)).status_code == 400
        assert client.post(endpoint, json=content(body=' ' * 30)).status_code == 400
        assert client.post('/api/jobs/missing/experiences', json=content()).status_code == 404
        created = client.post(endpoint, json=content()).json()['experience']
        id = created['id']
        assert created['status'] == 'pending'
        assert client.get(endpoint).json()['experiences'] == []
        assert client.get(endpoint + '/mine').json()['experiences'][0]['status'] == 'pending'
        assert client.get('/api/admin/job-experiences').status_code == 403
        assert client.patch(f'/api/admin/job-experiences/{id}', json={'status':'published'}).status_code == 403
        client.post('/api/auth/logout')
        login(client, 'editor@example.com')
        assert len(client.get('/api/admin/job-experiences').json()['experiences']) == 1
        assert client.patch(f'/api/admin/job-experiences/{id}', json={'status':'published'}).status_code == 200
        client.post('/api/auth/logout')
        published = client.get(endpoint).json()['experiences']
        assert len(published) == 1
        assert set(published[0]) == {'id','role_title','year','body','created_at'}
        assert len(client.get('/api/jobs/figma:2/experiences').json()['experiences']) == 1
        assert client.get('/api/jobs/stripe:1/experiences').json()['experiences'] == []
        counts = {row['id']:row['experience_count'] for row in client.get('/api/jobs').json()['jobs']}
        assert counts == {'figma:1':1,'figma:2':1,'stripe:1':0}
        assert client.get(endpoint + '/mine').status_code == 401
        login(client, 'reader@example.com')
        assert client.delete(f'/api/job-experiences/{id}').status_code == 404
        report = f'/api/job-experiences/{id}/report'
        for _ in range(2):
            assert client.post(report, json={'reason':'疑似虚假经历'}).status_code == 200
        client.post('/api/auth/logout')
        login(client, 'editor@example.com')
        reported = client.get('/api/admin/job-experiences?status=reported').json()['experiences']
        assert reported[0]['reports'] == [{'reason':'疑似虚假经历','n':1}]
        assert client.patch(f'/api/admin/job-experiences/{id}', json={'status':'published'}).status_code == 200
        assert client.get('/api/admin/job-experiences?status=reported').json()['experiences'] == []
        assert client.patch(f'/api/admin/job-experiences/{id}', json={'status':'rejected'}).status_code == 200
        assert client.get(endpoint).json()['experiences'] == []
        client.post('/api/auth/logout')
        login(client, 'writer@example.com')
        assert client.get(endpoint + '/mine').json()['experiences'][0]['status'] == 'rejected'
        assert client.delete(f'/api/job-experiences/{id}').status_code == 200
        with db.connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM job_experience_reports').fetchone()[0] == 0


def test_experience_limits_and_account_deletion(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        store_board('figma', {'jobs':[job()]}, '2026-10-24')
        login(client, 'writer@example.com')
        for _ in range(5):
            assert client.post('/api/jobs/figma:1/experiences', json=content()).status_code == 200
        assert client.post('/api/jobs/figma:1/experiences', json=content()).status_code == 429
        assert client.delete('/api/me').status_code == 200
        with db.connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM job_experiences').fetchone()[0] == 0
