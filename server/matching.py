from __future__ import annotations

import json
import re
from typing import Optional

from . import jev

FAMILIES = {
    "ai": ("ai", "算法", "模型", "多模态", "vlm", "vla", "推荐", "搜推", "微调", "评测", "agent", "rag"),
    "product": ("产品", "需求", "访谈", "tob", "toB", "商业化", "客户"),
    "eng": ("开发", "工程", "全栈", "落地", "工作流", "rag", "agent"),
    "growth": ("增长", "出海", "投放", "裂变"),
    "job": ("求职", "面试", "复盘"),
}


def _split(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"[\s,，、/|；;]+", text or "") if part.strip()]


def _norm_tags(tags) -> list[str]:
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = _split(tags)
    return [str(tag).strip() for tag in (tags or []) if str(tag).strip()]


def _blob(*parts: str) -> str:
    return " ".join(part for part in parts if part).lower()


def _family_hits(text: str) -> set[str]:
    hits = set()
    lowered = text.lower()
    for name, words in FAMILIES.items():
        if any(word.lower() in lowered for word in words):
            hits.add(name)
    return hits


def score_pair(user: dict, candidate: dict, preferred_id: Optional[int] = None) -> dict:
    user_tags = _norm_tags(user.get("tags"))
    cand_tags = _norm_tags(candidate.get("tags"))
    shared = [tag for tag in cand_tags if tag in user_tags or tag.lower() in {t.lower() for t in user_tags}]
    tag_score = 38 * (len(shared) * 2) / (len(user_tags) + len(cand_tags) or 1)

    user_wants_text = user.get("looking_for") or user.get("wants", "")
    cand_skills_text = candidate.get("experience") or candidate.get("skills", "")
    cand_wants_text = candidate.get("looking_for") or candidate.get("wants", "")
    user_skills_text = user.get("experience") or user.get("skills", "")
    user_wants = set(_split(user_wants_text))
    cand_skills = set(_split(cand_skills_text))
    cand_wants = set(_split(cand_wants_text))
    user_skills = set(_split(user_skills_text))
    give = len(user_wants & cand_skills) + len({w for w in user_wants if any(w in s or s in w for s in cand_skills)})
    take = len(cand_wants & user_skills)
    comp_score = 28 * min(1.0, (give + take) / 4)

    families = _family_hits(_blob(user.get("role", ""), " ".join(user_tags), user_skills_text, user_wants_text))
    cand_families = _family_hits(_blob(candidate.get("role", ""), " ".join(cand_tags), cand_skills_text, cand_wants_text))
    family_score = 14 * (len(families & cand_families) / max(len(families | cand_families), 1))
    city_score = 8 if user.get("prefer_same_city", True) and user.get("city") and user.get("city") == candidate.get("city") else 0
    prefer_score = 10 if preferred_id and preferred_id == candidate["id"] else 0
    boost_score = 2 if candidate.get("boost_active") else 0

    raw = 58 + tag_score + comp_score + family_score + city_score + prefer_score + boost_score
    score = int(max(72, min(96, round(raw))))

    pronoun = "对方"

    if shared:
        reason = (
            f"你们都在做 {shared[0]}，你熟悉{user_skills_text or user.get('role') or '自己的项目'}，"
            f"{pronoun}能补上{cand_skills_text or candidate.get('role')}。"
        )
    elif give or take:
        reason = f"你们的经验互补：你想了解的{user_wants_text or '方向'}，正是{pronoun}擅长的。"
    else:
        reason = f"{pronoun}在做{candidate.get('role') or '实习项目'}，和你的方向可以认真交换工作流。"

    return {
        "candidate_id": candidate["id"],
        "score": score,
        "reason": reason,
        "can_share": cand_skills_text or candidate.get("role"),
        "wants": cand_wants_text or "彼此的实习工作流和面试准备",
        "shared_tags": shared[:4] or cand_tags[:3],
    }


SHORTLIST = 8
FIT_LEVELS = [
    "20 分钟聊下来几乎没有可交换的具体经验",
    "只有一点共同话题，帮不了对方推进实习",
    "能认真交换工作流，至少一方能带走一个可执行做法",
    "互补很强：一方缺的正是另一方刚做过的，约下来大概率有用",
]


def _card(person: dict) -> dict:
    return {
        "id": person.get("id"),
        "role": (person.get("role") or "")[:80],
        "city": person.get("city") or "",
        "grade": person.get("grade") or "",
        "experience": (person.get("experience") or person.get("skills") or "")[:400],
        "looking_for": (person.get("looking_for") or person.get("wants") or "")[:400],
        "tags": _norm_tags(person.get("tags"))[:8],
    }


def _answer(payload: dict, key: str) -> dict:
    answers = payload.get("answers") or {}
    item = answers.get(key) or {}
    return item if isinstance(item, dict) else {}


def _noul(payload: dict, key: str, default: float = 0.5) -> float:
    try:
        return max(0.0, min(1.0, float(_answer(payload, key).get("noul", default))))
    except (TypeError, ValueError):
        return default


def _score_level(payload: dict, key: str, levels: int) -> float:
    raw = _answer(payload, key).get("score")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.5
    top = max(1, levels - 1)
    return max(0.0, min(1.0, value / top))


def _jev_reason(user: dict, candidate: dict, exchange: float, clone: float, fit: float, base: dict) -> str:
    want = (user.get("looking_for") or user.get("wants") or "想补的方向").strip()[:36]
    give = (candidate.get("experience") or candidate.get("skills") or candidate.get("role") or "对方的项目").strip()[:36]
    if exchange >= 0.62 and fit >= 0.55:
        return f"这是互补匹配：你想补的{want}，正是对方做过的{give}。"
    if clone >= 0.62 and exchange < 0.45:
        return "你们方向很近，适合对照工作流，但短板未必能互相补上。"
    if fit < 0.34:
        return "共同话题有限。先看档案，再决定要不要发认识邮件。"
    return base.get("reason") or f"对方在做{candidate.get('role') or '实习项目'}，可以交换具体做法。"


def _jev_rerank(user: dict, shortlist: list[dict], people: dict[int, dict], preferred_id: Optional[int]) -> list[dict]:
    options = {}
    questions = {}
    for item in shortlist:
        person = people[item["candidate_id"]]
        key = f"p{person['id']}"
        options[key] = (
            f"{person.get('role') or '实习生'}。"
            f"做过：{(person.get('experience') or '')[:120]}。"
            f"想补：{(person.get('looking_for') or '')[:120]}"
        )
        questions[f"fit_{key}"] = {
            "type": "score",
            "instructions": f"If the seeker spent 20 minutes with candidate {key}, how useful would the internship-experience exchange be?",
            "criteria": FIT_LEVELS,
        }
        questions[f"exchange_{key}"] = {
            "type": "noul",
            "instructions": (
                f"Would candidate {key} and the seeker help each other because one can teach what the other wants, "
                "not merely because they share a job title?"
            ),
        }
        questions[f"clone_{key}"] = {
            "type": "noul",
            "instructions": f"Are the seeker and candidate {key} too similar, so the slot would be wasted on a near-duplicate?",
        }
    questions["best"] = {
        "type": "choice",
        "instructions": "Who should get the first match slot for a useful 20-minute internship exchange?",
        "criteria": {
            **options,
            "none": "None of these people would make a useful exchange tonight",
        },
    }
    state = {
        "goal": "Match interns who can swap real project workflow, not lookalike profiles.",
        "seeker": _card(user),
        "candidates": [_card(people[item["candidate_id"]]) for item in shortlist],
    }
    payload = jev.ask(state, questions)
    best = str(_answer(payload, "best").get("choice") or "")
    ranked = []
    for item in shortlist:
        person = people[item["candidate_id"]]
        key = f"p{person['id']}"
        fit = _score_level(payload, f"fit_{key}", len(FIT_LEVELS))
        exchange = _noul(payload, f"exchange_{key}", 0.45)
        clone = _noul(payload, f"clone_{key}", 0.2)
        value = 0.42 * fit + 0.40 * exchange + 0.10 * (1.0 - clone)
        if preferred_id and preferred_id == person["id"]:
            value += 0.08
        if person.get("boost_active"):
            value += 0.03
        if best == key:
            value += 0.12
        if best == "none":
            value -= 0.06
        score = int(max(62, min(98, round(70 + 28 * max(0.0, min(1.0, value))))))
        ranked.append({
            **item,
            "score": score,
            "reason": _jev_reason(user, person, exchange, clone, fit, item),
        })
    ranked.sort(key=lambda row: row["score"], reverse=True)
    if best.startswith("p"):
        winner = int(best[1:])
        ranked.sort(key=lambda row: (row["candidate_id"] != winner, -row["score"]))
    return ranked


def rank_matches(user: dict, candidates: list[dict], preferred_id: Optional[int] = None) -> list[dict]:
    recalled = [score_pair(user, candidate, preferred_id) for candidate in candidates]
    recalled.sort(key=lambda item: item["score"], reverse=True)
    if not recalled or not jev.configured():
        return recalled
    people = {person["id"]: person for person in candidates}
    shortlist = recalled[:SHORTLIST]
    try:
        reranked = _jev_rerank(user, shortlist, people, preferred_id)
    except Exception:
        return recalled
    kept = {item["candidate_id"] for item in reranked}
    return reranked + [item for item in recalled if item["candidate_id"] not in kept]
