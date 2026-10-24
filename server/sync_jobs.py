"""Run `python -m server.sync_jobs` to refresh configured public Greenhouse boards."""
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

# Explicit company boards keep collection bounded and avoid arbitrary URL fetches.
SOURCES = {'figma': 'Figma', 'cloudflare': 'Cloudflare', 'stripe': 'Stripe', 'databricks': 'Databricks'}
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
    for key, pattern in [('AI / 数据', r'machine learning|\bAI\b|data|research'), ('产品 / 设计', r'product|design'), ('运营 / 市场', r'market|sales|operation|business')]:
        if re.search(pattern, title, re.I):
            return key
    return '技术 / 工程'


def normalize(source, item, now):
    title = item.get('title', '')
    url = item.get('absolute_url', '')
    parsed = urlparse(url)
    if not INTERN.search(title) or parsed.scheme != 'https' or not parsed.hostname or parsed.username:
        return None
    location = item.get('location', {}).get('name', '') or '地点待确认'
    return (f'{source}:{item["id"]}', source, SOURCES[source], title, location, category(title),
            int(bool(re.search(r'remote|远程', location, re.I))), url, clean_text(item.get('content', '')),
            item.get('updated_at') or now, now)


def store_board(source, payload, now):
    if not isinstance(payload, dict) or not isinstance(payload.get('jobs'), list):
        raise ValueError('Invalid job board response')
    rows = [row for item in payload['jobs'] if (row := normalize(source, item, now))]
    with connect() as conn:
        conn.execute('UPDATE jobs SET active=0 WHERE source=?', (source,))
        conn.executemany('''INSERT INTO jobs(id,source,company,title,location,category,remote,url,description,updated_at,checked_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, location=excluded.location, category=excluded.category, remote=excluded.remote,
            url=excluded.url, description=excluded.description, updated_at=excluded.updated_at, checked_at=excluded.checked_at, active=1''', rows)
        conn.execute('INSERT OR REPLACE INTO job_sync_runs(source,checked_at,count,error) VALUES(?,?,?,?)', (source, now, len(rows), ''))
    return len(rows)


def sync(sources):
    result = []
    for source in sources:
        now = datetime.now(timezone.utc).isoformat()
        try:
            request = Request(f'https://boards-api.greenhouse.io/v1/boards/{source}/jobs?content=true', headers={'User-Agent': 'PingeShixi-JobSync/1.0'})
            with urlopen(request, timeout=25) as response:
                payload = json.load(response)
            result.append({'source': source, 'count': store_board(source, payload, now)})
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
    args = parser.parse_args()
    if args.interval and args.interval < 3600:
        parser.error('--interval must be at least 3600 seconds')
    init_db()
    while True:
        result = sync(args.source or list(SOURCES))
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        if not args.interval:
            break
        time.sleep(args.interval)
    raise SystemExit(1 if any('error' in row for row in result) else 0)
