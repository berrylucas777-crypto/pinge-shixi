from unittest.mock import patch

import pytest

from test_api import make_client
from server.sync_jobs import clean_text, normalize, store_board, sync


def job(id=1, title='Software Engineer Intern', url='https://example.com/job/1'):
    return {'id': id, 'title': title, 'absolute_url': url, 'location': {'name': 'Remote, London'},
            'content': '&lt;p&gt;Build useful products.&lt;/p&gt;', 'updated_at': '2026-10-24T10:00:00Z'}


def test_sync_filters_and_safely_extracts_content():
    assert normalize('figma', job(title='Internal Systems Engineer'), 'now') is None
    assert normalize('figma', job(url='javascript:alert(1)'), 'now') is None
    row = normalize('figma', job(), 'now')
    assert row[6] == 1
    assert row[8] == 'Build useful products.'
    assert clean_text('<script>bad()</script><p>Hello &amp; welcome</p>') == 'Hello & welcome'


def test_refresh_expires_missing_jobs_but_failure_keeps_existing(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        store_board('figma', {'jobs': [job(1), job(2)]}, '2026-10-24')
        store_board('figma', {'jobs': [job(2)]}, '2026-10-25')
        rows = client.get('/api/jobs').json()['jobs']
        assert [row['id'] for row in rows] == ['figma:2']
        with patch('server.sync_jobs.urlopen', side_effect=TimeoutError):
            assert sync(['figma'])[0]['error'] == 'TimeoutError'
        assert len(client.get('/api/jobs').json()['jobs']) == 1
        with pytest.raises(ValueError):
            store_board('figma', {'error': 'temporary'}, '2026-10-26')
        assert len(client.get('/api/jobs').json()['jobs']) == 1
        store_board('figma', {'jobs': [job(1), job(2)]}, '2026-10-27')
        assert len(client.get('/api/jobs').json()['jobs']) == 2


def test_tracking_is_private_persistent_and_survives_job_expiry(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        store_board('figma', {'jobs': [job()]}, '2026-10-24')
        endpoint = '/api/jobs/figma:1/action'
        assert client.patch(endpoint, json={'saved': True}).status_code == 401
        assert client.get('/api/jobs/mine').status_code == 401
        assert client.post('/api/auth/enter', json={'email':'jobs-one@example.com','accept_terms':True}).status_code == 200
        assert client.patch(endpoint, json={'saved': True}).json()['saved'] == 1
        assert client.patch(endpoint, json={'stage':'interview'}).json()['saved'] == 1
        assert client.patch(endpoint, json={'stage':'invented'}).status_code == 422
        assert client.patch('/api/jobs/missing/action', json={'saved':True}).status_code == 404
        mine = client.get('/api/jobs/mine').json()['jobs']
        assert mine[0]['stage'] == 'interview'
        assert 'saved' not in client.get('/api/jobs').json()['jobs'][0]
        store_board('figma', {'jobs': []}, '2026-10-25')
        assert client.get('/api/jobs').json()['jobs'] == []
        assert client.get('/api/jobs/mine').json()['jobs'][0]['active'] == 0
        client.post('/api/auth/logout')
        client.post('/api/auth/enter', json={'email':'jobs-two@example.com','accept_terms':True})
        assert client.get('/api/jobs/mine').json()['jobs'] == []
