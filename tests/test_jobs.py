from unittest.mock import patch

import pytest

from test_api import make_client
from server.sync_jobs import clean_text, normalize, store_board, sync, domestic_item, category
from server.job_sources import parse_page


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


def domestic_job(id='123'):
    return {'id': id, 'title': 'Agent评测产品经理-2027届', 'recruit_type': {'name': '实习'},
            'city_list': [{'name': '武汉'}], 'publish_time': 1792745650028,
            'description': '研究用户需求。', 'requirement': '在校生。',
            'job_post_info': {'address_list': [{'country': {'name': '中国大陆'}}]}}


def test_domestic_requires_internship_type_and_preserves_requirements():
    item = domestic_job()
    result = domestic_item('xiaomi', item)
    row = normalize('xiaomi', result, 'now')
    assert row[2] == '小米'
    assert row[4] == '中国大陆 · 武汉'
    assert row[5] == '产品 / 设计'
    assert row[7] == 'https://xiaomi.jobs.f.mioffice.cn/internship/position/123/detail'
    assert '任职要求' in row[8] and '在校生' in row[8]
    item['recruit_type'] = {'name': '正式'}
    assert domestic_item('xiaomi', item) is None
    assert category('AI 产品实习生') == '产品 / 设计'
    assert category('大模型算法实习生') == 'AI / 数据'
    assert category('后端开发实习生') == '技术 / 工程'
    assert category('HRBP实习生') == '运营 / 市场'
    assert category('法务实习生') == '其他方向'


@pytest.mark.parametrize('payload', [None, [], {}, {'code': 403}, {'code': 0, 'data': {}},
    {'code': 0, 'data': {'job_post_list': [{}], 'count': 1}}])
def test_invalid_domestic_response_is_not_empty_snapshot(payload):
    with pytest.raises(ValueError):
        parse_page(payload)


def test_domestic_partial_sync_never_expires_unseen_jobs(tmp_path, monkeypatch):
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        with patch('server.sync_jobs.fetch_domestic', return_value=([domestic_job('1'), domestic_job('2')], False)):
            assert sync(['xiaomi'])[0]['count'] == 2
        with patch('server.sync_jobs.fetch_domestic', return_value=([domestic_job('2')], False)):
            sync(['xiaomi'])
        response = client.get('/api/jobs').json()
        assert len(response['jobs']) == 2
        assert response['sources'][0]['complete'] == 0
        assert response['sources'][0]['name'] == '小米'
        with patch('server.sync_jobs.fetch_domestic', side_effect=TimeoutError):
            assert sync(['xiaomi'])[0]['error'] == 'TimeoutError'
        assert len(client.get('/api/jobs').json()['jobs']) == 2
        with patch('server.sync_jobs.fetch_domestic', return_value=([domestic_job('2')], True)):
            sync(['xiaomi'])
        assert [j['id'] for j in client.get('/api/jobs').json()['jobs']] == ['xiaomi:2']


def test_page_validation_and_atomic_write(tmp_path, monkeypatch):
    items, total = parse_page({'code': 0, 'data': {'job_post_list': [domestic_job()], 'count': 5}})
    assert total == 5 and len(items) == 1
    client, db = make_client(tmp_path, monkeypatch)
    with client:
        store_board('figma', {'jobs': [job()]}, '2026-10-24')
        with pytest.raises(AttributeError):
            store_board('figma', {'jobs': [None]}, '2026-10-25')
        assert len(client.get('/api/jobs').json()['jobs']) == 1
