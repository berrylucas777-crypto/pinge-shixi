"""Refresh allowlisted public careers sources, separately from web requests."""
import argparse
import html
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .db import connect, init_db
from .job_sources import DOMESTIC, fetch_domestic

# Explicit company boards keep collection bounded and avoid arbitrary URL fetches.
SOURCES = {'figma': 'Figma', 'cloudflare': 'Cloudflare', 'stripe': 'Stripe', 'databricks': 'Databricks'}
SOURCES.update({key: value[0] for key, value in DOMESTIC.items()})
INTERN = re.compile(r'\bintern(?:ship)?\b|\bco[ -]?op\b|实习', re.I)


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1
        if tag in {'p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'h4'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.skip = max(0, self.skip - 1)
        if tag in {'p', 'div', 'li'}:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def clean_text(value):
    parser = PlainText()
    parser.feed(html.unescape(value))
    return '\n\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())[:30000]


def category(title):
    for key, pattern in [('运营 / 市场', r'运营|市场|营销|人力|财务|商务|销售|HRBP|market|sales|operation|business'), ('产品 / 设计', r'产品|设计|策划|product|design'), ('AI / 数据', r'算法|大模型|机器学习|数据|人工智能|智能体|machine learning|\bAI\b|data|research|agent|LLM'), ('技术 / 工程', r'开发|研发|工程|测试|运维|软件|硬件|芯片|安全|engineer|develop|software|security')]:
        if re.search(pattern, title, re.I):
            return key
    return '其他方向'


def domestic_item(source, item):
    recruit = item.get('recruit_type') or {}
    if not INTERN.search(recruit.get('name', '') + ' ' + recruit.get('en_name', '')):
        return None
    cities = item.get('city_list') or [item.get('city_info') or {}]
    addresses = (item.get('job_post_info') or {}).get('address_list') or []
    countries = {a.get('country', {}).get('name', '') for a in addresses if a.get('country')}
    location = '、'.join(dict.fromkeys(c.get('name', '') for c in cities if c.get('name')))
    if countries == {'中国大陆'}:
        location = '中国大陆 · ' + location
    timestamp = item.get('publish_time')
    updated = datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat() if timestamp else None
    return {'id': str(item['id']), 'title': item['title'], 'internship': True,
            'location': {'name': location}, 'absolute_url': DOMESTIC[source][1].split('?')[0] + '/' + str(item['id']) + '/detail',
            'content': '\n\n'.join([item.get('description') or '', '任职要求', item.get('requirement') or '以原站为准']),
            'updated_at': updated}


def normalize(source, item, now):
    title = item.get('title', '')
    url = item.get('absolute_url', '')
    parsed = urlparse(url)
    if not (INTERN.search(title) or (source in DOMESTIC and item.get('internship'))) or parsed.scheme != 'https' or not parsed.hostname or parsed.username:
        return None
    location = item.get('location', {}).get('name', '') or '地点待确认'
    return (f'{source}:{item["id"]}', source, SOURCES[source], title, location, category(title),
            int(bool(re.search(r'remote|远程', location, re.I))), url, clean_text(item.get('content', '')),
            item.get('updated_at') or now, now)


def store_board(source, payload, now, complete=True):
    if not isinstance(payload, dict) or not isinstance(payload.get('jobs'), list):
        raise ValueError('Invalid job board response')
    rows = list({row[0]: row for item in payload['jobs'] if (row := normalize(source, item, now))}.values())
    with connect() as conn:
        if complete:
            conn.execute('UPDATE jobs SET active=0 WHERE source=?', (source,))
        conn.executemany('''INSERT INTO jobs(id,source,company,title,location,category,remote,url,description,updated_at,checked_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, location=excluded.location, category=excluded.category, remote=excluded.remote,
            url=excluded.url, description=excluded.description, updated_at=excluded.updated_at, checked_at=excluded.checked_at, active=1''', rows)
        conn.execute('INSERT OR REPLACE INTO job_sync_runs(source,checked_at,count,error,complete) VALUES(?,?,?,?,?)', (source, now, len(rows), '', int(complete)))
    return len(rows)


def sync(sources, max_pages=5):
    result = []
    for source in sources:
        now = datetime.now(timezone.utc).isoformat()
        try:
            if source not in SOURCES:
                raise ValueError('Unknown source')
            complete = True
            if source in DOMESTIC:
                items, complete = fetch_domestic(source, max_pages)
                payload = {'jobs': [row for item in items if (row := domestic_item(source, item))]}
            else:
                request = Request(f'https://boards-api.greenhouse.io/v1/boards/{source}/jobs?content=true', headers={'User-Agent': 'PingeShixi-JobSync/1.0'})
                with urlopen(request, timeout=25) as response:
                    payload = json.load(response)
            result.append({'source': source, 'count': store_board(source, payload, now, complete), 'complete': complete})
        except Exception as exc:
            # A failed request must not expire previously verified listings.
            with connect() as conn:
                conn.execute('INSERT INTO job_sync_runs(source,checked_at,error) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error', (source, now, type(exc).__name__))
            result.append({'source': source, 'error': type(exc).__name__})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', choices=list(SOURCES), action='append')
    parser.add_argument('--interval', type=int, default=0, help='Repeat every N seconds (minimum 3600); default runs once')
    parser.add_argument('--max-pages', type=int, default=5, help='Maximum public pages per domestic source (1-100)')
    args = parser.parse_args()
    if args.interval and args.interval < 3600:
        parser.error('--interval must be at least 3600 seconds')
    if not 1 <= args.max_pages <= 100:
        parser.error('--max-pages must be between 1 and 100')
    init_db()
    while True:
        result = sync(args.source or list(SOURCES), args.max_pages)
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        if not args.interval:
            break
        time.sleep(args.interval)
    raise SystemExit(1 if any('error' in row for row in result) else 0)
