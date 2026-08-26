import os
import smtplib
from email.message import EmailMessage


def email_configured() -> bool:
    return bool(
        (os.getenv("SMTP_HOST") or "").strip()
        and (os.getenv("SMTP_USER") or "").strip()
        and (os.getenv("SMTP_PASSWORD") or "").strip()
    )


def send_mail(to: str, subject: str, body: str, reply_to: str | None = None) -> bool:
    if not email_configured() or not to or to.endswith(".local"):
        return False
    host = (os.getenv("SMTP_HOST") or "").strip()
    port = int((os.getenv("SMTP_PORT") or "465").strip())
    user = (os.getenv("SMTP_USER") or "").strip()
    password = (os.getenv("SMTP_PASSWORD") or "").strip()
    from_addr = (os.getenv("SMTP_FROM") or user).strip()
    use_ssl = os.getenv("SMTP_SSL", "true").lower() in {"1", "true", "yes"}
    if reply_to is None:
        reply_to = (os.getenv("SMTP_REPLY_TO") or "").strip() or None

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_addr
    message["To"] = to
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
                smtp.login(user, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(user, password)
                smtp.send_message(message)
        return True
    except Exception as exc:
        print(f"[mailer] send failed: {exc}", flush=True)
        return False
