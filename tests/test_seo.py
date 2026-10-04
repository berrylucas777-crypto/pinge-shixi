from html.parser import HTMLParser
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

from test_api import make_client


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.links = {}
        self.itemprops = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            self.meta[attrs.get("name") or attrs.get("property")] = attrs.get("content")
        if tag == "link":
            self.links[attrs.get("rel")] = attrs.get("href")
        if "itemprop" in attrs:
            self.itemprops.add(attrs["itemprop"])


def test_public_pages_have_metadata_and_crawlable_content(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    for path in ("/", "/about"):
        response = client.get(path)
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        parsed = MetadataParser()
        parsed.feed(response.text)
        assert parsed.links["canonical"] == "https://shixi.seu-link.fit" + path
        assert parsed.meta["og:url"] == parsed.links["canonical"]
        assert parsed.meta["description"]
        assert parsed.meta["robots"].startswith("index,follow")
        assert "unsafe-inline" not in response.headers["content-security-policy"]
    about = client.get("/about").text
    parsed = MetadataParser()
    parsed.feed(about)
    assert {"name", "description", "url", "image"} <= parsed.itemprops
    assert "周一、周三 21:00" in about
    assert "不保证" in about
    assert 'href="/about"' in client.get("/").text


def test_robots_allow_search_only_public_content(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    robots = RobotFileParser()
    robots.parse(response.text.splitlines())
    for bot in ("Googlebot", "bingbot", "Baiduspider", "OAI-SearchBot"):
        for path in ("/", "/about", "/assets/pingo-mascot.webp", "/styles.css", "/app.js"):
            assert robots.can_fetch(bot, "https://shixi.seu-link.fit" + path)
        for path in ("/api/me", "/api/members", "/ops", "/review", "/imports", "/openapi.json"):
            assert not robots.can_fetch(bot, "https://shixi.seu-link.fit" + path)
    assert robots.site_maps() == ["https://shixi.seu-link.fit/sitemap.xml"]


def test_sitemap_and_optional_ai_summary_are_public_only(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    assert "application/xml" in response.headers["content-type"]
    sitemap = ElementTree.fromstring(response.text)
    urls = [node.text for node in sitemap.findall("{*}url/{*}loc")]
    assert urls == ["https://shixi.seu-link.fit/", "https://shixi.seu-link.fit/about"]
    summary = client.get("/llms.txt")
    assert summary.status_code == 200
    assert "text/plain" in summary.headers["content-type"]
    assert "不保证" in summary.text
    assert "周一、周三 21:00" in summary.text


def test_private_endpoints_noindex_and_still_require_auth(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch)
    for path in ("/api/me", "/api/members", "/api/admin/pinpin-orders"):
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["x-robots-tag"] == "noindex, nofollow, noarchive"
        assert response.headers["cache-control"] == "no-store"
    for path in ("/review", "/imports", "/ops", "/openapi.json"):
        assert "noindex" in client.get(path).headers["x-robots-tag"]
