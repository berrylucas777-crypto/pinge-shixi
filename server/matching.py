import json
import re

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


def score_pair(user: dict, candidate: dict, preferred_id: int | None = None) -> dict:
    user_tags = _norm_tags(user.get("tags"))
    cand_tags = _norm_tags(candidate.get("tags"))
    shared = [tag for tag in cand_tags if tag in user_tags or tag.lower() in {t.lower() for t in user_tags}]
    tag_score = 38 * (len(shared) * 2) / (len(user_tags) + len(cand_tags) or 1)

    user_wants = set(_split(user.get("wants", "")))
    cand_skills = set(_split(candidate.get("skills", "")))
    cand_wants = set(_split(candidate.get("wants", "")))
    user_skills = set(_split(user.get("skills", "")))
    give = len(user_wants & cand_skills) + len({w for w in user_wants if any(w in s or s in w for s in cand_skills)})
    take = len(cand_wants & user_skills)
    comp_score = 28 * min(1.0, (give + take) / 4)

    families = _family_hits(_blob(user.get("role", ""), " ".join(user_tags), user.get("skills", ""), user.get("wants", "")))
    cand_families = _family_hits(_blob(candidate.get("role", ""), " ".join(cand_tags), candidate.get("skills", ""), candidate.get("wants", "")))
    family_score = 14 * (len(families & cand_families) / max(len(families | cand_families), 1))
    city_score = 8 if user.get("city") and user.get("city") == candidate.get("city") else 0
    prefer_score = 10 if preferred_id and preferred_id == candidate["id"] else 0

    raw = 58 + tag_score + comp_score + family_score + city_score + prefer_score
    score = int(max(72, min(96, round(raw))))

    pronoun = "他"
    if candidate.get("name", "").startswith(("陈", "唐", "苏", "闻")):
        pronoun = "她"

    if shared:
        reason = (
            f"你们都在做 {shared[0]}，你熟悉{user.get('skills') or user.get('role') or '自己的项目'}，"
            f"{pronoun}能补上{candidate.get('skills') or candidate.get('role')}。"
        )
    elif give or take:
        reason = f"你们的经验互补：你想了解的{user.get('wants') or '方向'}，正是{pronoun}擅长的。"
    else:
        reason = f"{pronoun}在做{candidate.get('role') or '实习项目'}，和你的方向可以认真交换工作流。"

    return {
        "candidate_id": candidate["id"],
        "score": score,
        "reason": reason,
        "can_share": candidate.get("skills") or candidate.get("role"),
        "wants": candidate.get("wants") or "彼此的实习工作流和面试准备",
        "shared_tags": shared[:4] or cand_tags[:3],
    }
