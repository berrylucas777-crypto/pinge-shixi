"""Read public careers pages through normal, unauthenticated browser navigation."""
import os
import time
from urllib.parse import urlparse


DOMESTIC = {
    'xiaomi': ('小米', 'https://xiaomi.jobs.f.mioffice.cn/internship/position'),
    'bytedance': ('字节跳动', 'https://jobs.bytedance.com/campus/position?keywords=%E5%AE%9E%E4%B9%A0'),
}


def parse_page(payload):
    data = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(payload, dict) or payload.get('code') != 0 or not isinstance(data, dict):
        raise ValueError('Careers page did not return public listings')
    rows = data.get('job_post_list')
    total = data.get('count')
    if not isinstance(rows, list) or not isinstance(total, int) or total < len(rows):
        raise ValueError('Unexpected careers response')
    if any(not isinstance(row, dict) or not row.get('id') for row in rows):
        raise ValueError('Invalid careers listing')
    return rows, total


def fetch_domestic(source, max_pages=5):
    # No credential reuse, signature generation, CAPTCHA solving or arbitrary URLs.
    from playwright.sync_api import sync_playwright

    url = DOMESTIC[source][1]
    host = urlparse(url).hostname
    rows, seen = [], set()
    with sync_playwright() as playwright:
        launch = {'headless': True}
        if os.environ.get('JOB_BROWSER_EXECUTABLE'):
            launch['executable_path'] = os.environ['JOB_BROWSER_EXECUTABLE']
        browser = playwright.chromium.launch(**launch)
        try:
            page = browser.new_page(locale='zh-CN', viewport={'width': 1280, 'height': 900})
            page.set_default_timeout(45000)

            def is_list(response):
                parsed = urlparse(response.url)
                return parsed.hostname == host and parsed.path == '/api/v1/search/job/posts'

            with page.expect_response(is_list) as pending:
                page.goto(url, wait_until='domcontentloaded', timeout=60000)
            response = pending.value
            for number in range(max_pages):
                if response.status != 200:
                    raise ValueError('Public careers page unavailable')
                items, total = parse_page(response.json())
                ids = {str(item['id']) for item in items}
                if (not items and len(rows) < total) or (items and ids <= seen):
                    raise ValueError('Incomplete or repeated careers page')
                rows.extend(item for item in items if str(item['id']) not in seen)
                seen.update(ids)
                if len(seen) >= total:
                    return rows, True
                if number + 1 == max_pages:
                    break
                # Only dismiss the ordinary product-introduction overlay, never verification.
                dismiss = page.get_by_role('button', name='稍后再说', exact=True)
                if dismiss.is_visible():
                    dismiss.click()
                time.sleep(1.5)
                with page.expect_response(is_list) as pending:
                    page.get_by_role('listitem', name='下一页', exact=True).click()
                response = pending.value
            return rows, False
        finally:
            browser.close()
