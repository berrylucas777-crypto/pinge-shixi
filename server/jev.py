from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

JEV_URL = "https://api.typesafe.ai/v1/systemone"


def api_key() -> str:
    return (os.getenv("JEV_API_KEY") or os.getenv("TYPESAFE_API_KEY") or "").strip()


def configured() -> bool:
    return bool(api_key())


def model_name() -> str:
    return (os.getenv("JEV_MODEL") or "jev-latest").strip() or "jev-latest"


def ask(state: Any, questions: dict, timeout: int = 20) -> dict:
    payload = json.dumps({"model": model_name(), "state": state, "questions": questions}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        (os.getenv("JEV_API_URL") or JEV_URL).strip() or JEV_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"jev http {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"jev unreachable: {exc.reason}") from exc
    if not isinstance(body, dict) or "answers" not in body:
        raise RuntimeError("jev response missing answers")
    return body
