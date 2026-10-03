import os
import secrets
import subprocess
from pathlib import Path

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
    "server/seed.py",
    "server/main.py",
    "匹配池/群聊职业经历与供需数据库_OCR初版.json",
]
PAYMENT_QR = "assets/pinpin-payment-qr.jpg"
if (ROOT / PAYMENT_QR).exists():
    UPLOAD.append(PAYMENT_QR)
NGINX = """
server {
    listen 80;
    listen [::]:80;
    server_name shixi.seu-link.fit;
    client_max_body_size 8m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""
SERVICE = """
[Unit]
Description=Pingo Shixi
After=network.target

[Service]
WorkingDirectory=/opt/pingshixi
EnvironmentFile=/opt/pingshixi/.env
ExecStart=/opt/pingshixi/.venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""


def run(client, command):
    stdin, stdout, stderr = client.exec_command(command, timeout=300)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    print(out)
    if err.strip():
        print(err[:2000])
    if code != 0:
        raise SystemExit(f"remote failed ({code}): {command[:120]}")
    return out


def main():
    local_env = dotenv_values(ROOT / ".env")
    password = (local_env.get("Sever_Key") or "").strip()
    prod = dotenv_values(ROOT / ".env.production")
    secret = (prod.get("SECRET_KEY") or "").strip() or secrets.token_urlsafe(32)
    release = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT, text=True).strip()
    if subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip():
        release = f"{release}-dirty"
    remote_env = "\n".join(
        [
            "APP_URL=https://shixi.seu-link.fit",
            f"APP_RELEASE={release}",
            f"SECRET_KEY={secret}",
            "DISABLE_DOCS=true",
            "ALLOW_SIMULATED_PAYMENT=false",
            f"MANUAL_PAYMENT_ENABLED={prod.get('MANUAL_PAYMENT_ENABLED', '').strip()}",
            f"MANUAL_PAYMENT_QR_URL={prod.get('MANUAL_PAYMENT_QR_URL', '').strip()}",
            f"MANUAL_PAYMENT_CONTACT={prod.get('MANUAL_PAYMENT_CONTACT', '').strip()}",
            f"PAYMENT_ADMIN_EMAILS={prod.get('PAYMENT_ADMIN_EMAILS', '').strip()}",
            f"DATA_ADMIN_EMAILS={prod.get('DATA_ADMIN_EMAILS', '').strip()}",
            "SMTP_HOST=smtpdm.aliyun.com",
            "SMTP_PORT=465",
            "SMTP_USER=no-reply@seu-link.fit",
            f"SMTP_PASSWORD={prod.get('SMTP_PASSWORD', '').strip()}",
            "SMTP_FROM=拼个实习 <no-reply@seu-link.fit>",
            "SMTP_SSL=true",
            "SMTP_REPLY_TO=1450616433@qq.com",
            "",
        ]
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=password, timeout=20, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()

    run(client, f"mkdir -p {REMOTE}/server {REMOTE}/assets {REMOTE}/data {REMOTE}/匹配池")
    run(client, f"if [ -f {REMOTE}/data/pingo.db ]; then cp {REMOTE}/data/pingo.db {REMOTE}/data/pingo.db.predeploy; fi")
    for rel in UPLOAD:
        local = ROOT / rel
        remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        print("upload", rel)
        sftp.put(str(local), remote)

    with sftp.file(f"{REMOTE}/.env", "w") as handle:
        handle.write(remote_env)
    with sftp.file("/etc/nginx/sites-available/shixi.seu-link.fit.conf", "w") as handle:
        handle.write(NGINX.strip() + "\n")
    with sftp.file("/etc/systemd/system/pingshixi.service", "w") as handle:
        handle.write(SERVICE.strip() + "\n")
    sftp.close()

    run(client, f"ln -sfn /etc/nginx/sites-available/shixi.seu-link.fit.conf /etc/nginx/sites-enabled/shixi.seu-link.fit.conf")
    run(client, f"python3 -m venv {REMOTE}/.venv")
    run(client, f"{REMOTE}/.venv/bin/pip install -r {REMOTE}/requirements.txt")
    run(client, "nginx -t")
    run(client, "systemctl daemon-reload && systemctl enable --now pingshixi && systemctl restart pingshixi")
    run(client, "systemctl reload nginx")
    run(client, "sleep 1; curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/health; echo; curl -sS http://127.0.0.1:8000/api/health")
    run(client, "test \"$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/docs)\" != 200")
    run(client, "curl -sS http://127.0.0.1:8000/api/health | grep -Fq '\"release\":\"%s\"'" % release)
    run(
        client,
        "certbot --nginx -d shixi.seu-link.fit --non-interactive --agree-tos --email 1450616433@qq.com --redirect",
    )
    run(client, "curl -sS -o /dev/null -w '%{http_code} %{url_effective}\\n' https://shixi.seu-link.fit/api/health")
    run(client, "test \"$(curl -sS -o /dev/null -w '%{http_code}' https://shixi.seu-link.fit/docs)\" != 200")
    run(client, "curl -sS https://shixi.seu-link.fit/api/health | grep -Fq '\"release\":\"%s\"'" % release)
    client.close()
    print("DEPLOY_OK")


if __name__ == "__main__":
    main()
