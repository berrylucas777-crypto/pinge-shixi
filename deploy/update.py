from pathlib import Path
import subprocess

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
REMOTE = "/opt/pingshixi"
HOST = "122.51.95.61"
UPLOAD = [
    "index.html",
    "styles.css",
    "app.js",
    "review.html",
    "review.js",
    "imports.html",
    "imports.js",
    "requirements.txt",
    "assets/pingo-mascot.webp",
    "server/__init__.py",
    "server/db.py",
    "server/mailer.py",
    "server/matching.py",
    "server/jev.py",
    "server/seed.py",
    "server/main.py",
]
PAYMENT_QR = "assets/pinpin-payment-qr.jpg"
if (ROOT / PAYMENT_QR).exists():
    UPLOAD.append(PAYMENT_QR)

ENV_KEYS = (
    "DISABLE_DOCS",
    "ALLOW_SIMULATED_PAYMENT",
    "MANUAL_PAYMENT_ENABLED",
    "MANUAL_PAYMENT_QR_URL",
    "MANUAL_PAYMENT_CONTACT",
    "PAYMENT_ADMIN_EMAILS",
    "DATA_ADMIN_EMAILS",
    "APP_RELEASE",
    "MATCH_HOUR",
    "MATCH_POOL_MIN",
    "JEV_API_KEY",
    "JEV_MODEL",
)


def run(client, command, timeout=180):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    print(out)
    if err.strip():
        print(err[:2000])
    if code != 0:
        raise SystemExit(f"remote failed ({code}): {command[:160]}")
    return out


def release_id() -> str:
    return subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT, text=True).strip()


def main():
    password = (dotenv_values(ROOT / ".env").get("Sever_Key") or "").strip()
    if not password:
        raise SystemExit("missing Sever_Key")
    prod = dotenv_values(ROOT / ".env.production")
    patch = {
        "DISABLE_DOCS": "true",
        "ALLOW_SIMULATED_PAYMENT": "false",
        "MANUAL_PAYMENT_ENABLED": (prod.get("MANUAL_PAYMENT_ENABLED") or "true").strip() or "true",
        "MANUAL_PAYMENT_QR_URL": (prod.get("MANUAL_PAYMENT_QR_URL") or "/assets/pinpin-payment-qr.jpg").strip(),
        "MANUAL_PAYMENT_CONTACT": (prod.get("MANUAL_PAYMENT_CONTACT") or "").strip(),
        "PAYMENT_ADMIN_EMAILS": (prod.get("PAYMENT_ADMIN_EMAILS") or "").strip(),
        "DATA_ADMIN_EMAILS": (prod.get("DATA_ADMIN_EMAILS") or "").strip(),
        "APP_RELEASE": release_id(),
        "MATCH_HOUR": (prod.get("MATCH_HOUR") or "21").strip() or "21",
        "MATCH_POOL_MIN": (prod.get("MATCH_POOL_MIN") or "2").strip() or "2",
        "JEV_API_KEY": (prod.get("JEV_API_KEY") or "").strip(),
        "JEV_MODEL": (prod.get("JEV_MODEL") or "jev-latest").strip() or "jev-latest",
    }
    if not patch["PAYMENT_ADMIN_EMAILS"]:
        raise SystemExit("missing PAYMENT_ADMIN_EMAILS")
    if not patch["JEV_API_KEY"]:
        raise SystemExit("missing JEV_API_KEY")
    if patch["MANUAL_PAYMENT_ENABLED"].lower() not in {"1", "true", "yes", "on"}:
        raise SystemExit("MANUAL_PAYMENT_ENABLED must be true for this deploy")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=password, timeout=20, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()

    run(client, f"mkdir -p {REMOTE}/server {REMOTE}/assets {REMOTE}/data")
    run(
        client,
        f"if [ -f {REMOTE}/data/pingo.db ]; then cp {REMOTE}/data/pingo.db {REMOTE}/data/pingo.db.predeploy-$(date +%Y%m%d%H%M%S); fi",
    )

    for rel in UPLOAD:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing local file: {rel}")
        remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        print("upload", rel)
        sftp.put(str(local), remote)

    with sftp.file("/tmp/pingo-env-patch.env", "w") as handle:
        handle.write("\n".join(f"{key}={patch[key]}" for key in ENV_KEYS) + "\n")
    sftp.chmod("/tmp/pingo-env-patch.env", 0o600)
    sftp.close()

    run(
        client,
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "p = Path('/opt/pingshixi/.env')\n"
        "patch_path = Path('/tmp/pingo-env-patch.env')\n"
        "patch = {}\n"
        "for line in patch_path.read_text(encoding='utf-8').splitlines():\n"
        "    if '=' in line:\n"
        "        key, value = line.split('=', 1)\n"
        "        patch[key] = value\n"
        "text = p.read_text(encoding='utf-8') if p.exists() else ''\n"
        "lines = [line for line in text.splitlines()]\n"
        "keys = {}\n"
        "for idx, line in enumerate(lines):\n"
        "    if line.strip() and not line.lstrip().startswith('#') and '=' in line:\n"
        "        keys[line.split('=',1)[0]] = idx\n"
        "for key, value in patch.items():\n"
        "    rendered = f'{key}={value}'\n"
        "    if key in keys:\n"
        "        lines[keys[key]] = rendered\n"
        "    else:\n"
        "        lines.append(rendered)\n"
        "smtp_ok = any(line.startswith('SMTP_HOST=') and line.split('=',1)[1].strip() for line in lines)\n"
        "smtp_ok = smtp_ok and any(line.startswith('SMTP_USER=') and line.split('=',1)[1].strip() for line in lines)\n"
        "smtp_ok = smtp_ok and any(line.startswith('SMTP_PASSWORD=') and line.split('=',1)[1].strip() for line in lines)\n"
        "if not smtp_ok:\n"
        "    raise SystemExit('production SMTP incomplete')\n"
        "p.write_text('\\n'.join(lines).rstrip() + '\\n', encoding='utf-8')\n"
        "patch_path.unlink(missing_ok=True)\n"
        "print('env_upserted', ','.join(sorted(patch)))\n"
        "print('smtp_kept', True)\n"
        "PY",
    )
    run(client, f"{REMOTE}/.venv/bin/pip install -r {REMOTE}/requirements.txt")
    run(client, "rm -f '/opt/pingshixi/匹配池/群聊职业经历与供需数据库_OCR初版.json'")
    run(client, "systemctl restart pingshixi")
    run(client, "sleep 2; systemctl is-active pingshixi; curl -sS -m 8 http://127.0.0.1:8000/api/health; echo")
    run(
        client,
        f"{REMOTE}/.venv/bin/python - <<'PY'\n"
        "import sqlite3\n"
        "conn = sqlite3.connect('/opt/pingshixi/data/pingo.db')\n"
        "seed = conn.execute(\"SELECT COUNT(*) FROM users WHERE (IFNULL(is_seed,0)=1 OR email LIKE '%@pingo.local') AND email NOT LIKE 'import-%@pingo.local'\").fetchone()[0]\n"
        "live = conn.execute(\"SELECT COUNT(*) FROM users WHERE IFNULL(is_seed,0)=0 AND IFNULL(experience,'')!='' AND IFNULL(looking_for,'')!=''\").fetchone()[0]\n"
        "print('seed_left', seed, 'live_pool', live)\n"
        "if seed:\n"
        "    raise SystemExit('seed purge failed')\n"
        "PY",
    )
    run(client, "curl -sS -m 8 -o /dev/null -w '%{http_code} %{url_effective}\\n' https://shixi.seu-link.fit/api/health")
    run(client, "curl -sS -m 8 -o /dev/null -w '%{http_code} %{url_effective}\\n' https://shixi.seu-link.fit/")
    run(client, "curl -sS -m 8 -o /dev/null -w 'docs %{http_code}\\n' https://shixi.seu-link.fit/docs")
    run(client, "curl -sS -m 8 -o /dev/null -w 'qr %{http_code}\\n' https://shixi.seu-link.fit/assets/pinpin-payment-qr.jpg")
    run(client, "curl -sS -m 8 -o /dev/null -w 'review %{http_code}\\n' https://shixi.seu-link.fit/review")
    run(
        client,
        "python3 - <<'PY'\n"
        "import json, urllib.error, urllib.request\n"
        "home = urllib.request.urlopen('https://shixi.seu-link.fit/', timeout=8).read().decode('utf-8','replace')\n"
        "js = urllib.request.urlopen('https://shixi.seu-link.fit/app.js', timeout=8).read().decode('utf-8','replace')\n"
        "health = urllib.request.urlopen('https://shixi.seu-link.fit/api/health', timeout=8).read().decode('utf-8','replace')\n"
        "print('home_invite', '点击获得我的邀请码' in home)\n"
        "print('home_21', '21:00' in home or '21 点' in home)\n"
        "print('home_pool', '就差你了' in home)\n"
        "print('single_intro', 'id=\"profileIntro\"' in home and 'id=\"profileExperience\"' not in home and 'id=\"profileLooking\"' not in home)\n"
        "print('compact_intro', 'intro-draft-compact' in home)\n"
        "print('start_code_js', \"inviteInput.value = 'PINGO-START'\" in js or 'PINGO-START' in js)\n"
        "print('no_xhs', '小红书' not in js and '群资料' not in js)\n"
        "print('review_link', \"window.location.href = '/review'\" in js)\n"
        "cfg = urllib.request.urlopen('https://shixi.seu-link.fit/api/config', timeout=8).read().decode('utf-8','replace')\n"
        "print('config_pool', '\"match_hour\": 21' in cfg.replace(' ','') or '\"match_hour\":21' in cfg)\n"
        "print('jev_configured', '\"jev_configured\":true' in health.replace(' ',''))\n"
        "print('release', True)\n"
        "def status(url):\n"
        "    try:\n"
        "        return urllib.request.urlopen(url, timeout=8).status\n"
        "    except urllib.error.HTTPError as exc:\n"
        "        return exc.code\n"
        "docs_code = status('https://shixi.seu-link.fit/docs')\n"
        "review_code = status('https://shixi.seu-link.fit/review')\n"
        "print('docs', docs_code, 'review', review_code)\n"
        "if docs_code == 200 or review_code != 200:\n"
        "    raise SystemExit('docs/review check failed')\n"
        "def post(invite):\n"
        "    req = urllib.request.Request(\n"
        "        'http://127.0.0.1:8000/api/auth/enter',\n"
        "        data=json.dumps({'email':'early-access-check@example.com','invite_code':invite,'remember':True,'accept_terms':False}).encode(),\n"
        "        headers={'Content-Type':'application/json'},\n"
        "        method='POST',\n"
        "    )\n"
        "    try:\n"
        "        with urllib.request.urlopen(req, timeout=8) as resp:\n"
        "            return resp.status, resp.read().decode('utf-8','replace')\n"
        "    except urllib.error.HTTPError as exc:\n"
        "        return exc.code, exc.read().decode('utf-8','replace')\n"
        "bad_code, bad_body = post('PINGO-FAKE')\n"
        "ok_code, ok_body = post('PINGO-START')\n"
        "print('fake_invite', bad_code, '无效' in bad_body)\n"
        "print('start_invite', ok_code, '18' in ok_body)\n"
        "if '点击获得我的邀请码' not in home or '就差你了' not in home or '21' not in home or 'id=\"profileExperience\"' in home or 'PINGO-START' not in js or '小红书' in js or '\"jev_configured\":true' not in health.replace(' ',''):\n"
        "    raise SystemExit('copy check failed')\n"
        "if bad_code != 400 or '无效' not in bad_body or ok_code != 400 or '18' not in ok_body:\n"
        "    raise SystemExit('PINGO-START check failed')\n"
        "PY",
    )
    client.close()
    print("UPDATE_OK")


if __name__ == "__main__":
    main()
