#!/usr/bin/env python3
"""Shared helpers for X / note social publishing."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
KEYWORDS_PATH = ROOT / "_data" / "ai_search_partner_keywords.yml"
CONFIG_PATH = ROOT / "_data" / "social_publish.yml"
OUTBOX = ROOT / "ops" / "social-publisher" / "outbox"
STATE_PATH = ROOT / "ops" / "social-publisher" / "state" / "posted.json"
TBNEWS = ROOT / "_tbnews"


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_config() -> dict[str, Any]:
    return load_yaml(CONFIG_PATH)


def load_keywords() -> list[dict[str, Any]]:
    data = load_yaml(KEYWORDS_PATH)
    return list(data.get("keywords") or [])


def article_index() -> dict[str, dict[str, str]]:
    """Map slug -> {title, url, path, direct_answer, date}."""
    index: dict[str, dict[str, str]] = {}
    for path in TBNEWS.glob("*.md"):
        text = path.read_text(encoding="utf-8")
        if not re.search(r"(?m)^insight:\s*true\s*$", text):
            continue
        slug = path.stem
        slug_key = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", slug)
        title_m = re.search(r'(?m)^title:\s*"(.*)"\s*$', text)
        da_m = re.search(r'(?m)^direct_answer:\s*"(.*)"\s*$', text)
        date_m = re.search(r"(?m)^date:\s*(\d{4}-\d{2}-\d{2})\s*$", text)
        index[slug_key] = {
            "slug": slug_key,
            "title": title_m.group(1) if title_m else slug_key,
            "direct_answer": da_m.group(1) if da_m else "",
            "date": date_m.group(1) if date_m else "",
            "path": path.as_posix(),
            "url": f"https://trillion-bank.jp/trillionbank/news/{slug_key}/",
        }
    return index


def contains_forbidden(text: str, terms: list[str]) -> str | None:
    for term in terms:
        if term and term in text:
            return term
    return None


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"posted": []}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def already_posted(channel: str, keyword: str, article_slug: str) -> bool:
    state = load_state()
    for row in state.get("posted", []):
        if (
            row.get("channel") == channel
            and row.get("keyword") == keyword
            and row.get("article_slug") == article_slug
        ):
            return True
    return False


def mark_posted(channel: str, keyword: str, article_slug: str, meta: dict[str, Any] | None = None) -> None:
    state = load_state()
    state.setdefault("posted", []).append(
        {
            "channel": channel,
            "keyword": keyword,
            "article_slug": article_slug,
            "at": datetime.now(timezone.utc).isoformat(),
            **(meta or {}),
        }
    )
    save_state(state)


def match_article(kw: dict[str, Any], articles: dict[str, dict[str, str]]) -> dict[str, str] | None:
    slug = str(kw.get("slug") or "").strip()
    if slug in articles:
        return articles[slug]

    # Longest article slug that is a prefix of the keyword slug (or equal).
    if slug:
        prefixes = [art_slug for art_slug in articles if slug == art_slug or slug.startswith(art_slug + "-")]
        if prefixes:
            best = max(prefixes, key=len)
            return articles[best]

    # Explicit override field if present.
    override = str(kw.get("article_slug") or "").strip()
    if override and override in articles:
        return articles[override]

    # Contiguous keyword phrase must appear in title (avoid partial token collisions).
    keyword = str(kw.get("keyword") or "").strip()
    if keyword:
        for art in articles.values():
            if keyword in art["title"]:
                return art
    return None


def select_candidates(limit: int = 10) -> list[dict[str, Any]]:
    cfg = load_config()
    prefer_groups = set(cfg.get("selection", {}).get("prefer_groups") or [])
    prefer_status = set(cfg.get("selection", {}).get("prefer_status") or ["published"])
    skip_status = set(cfg.get("selection", {}).get("skip_status") or [])
    articles = article_index()
    rows: list[dict[str, Any]] = []
    for kw in load_keywords():
        status = str(kw.get("status") or "")
        if status in skip_status:
            continue
        art = match_article(kw, articles)
        if cfg.get("selection", {}).get("require_article_url") and not art:
            continue
        group = str(kw.get("group") or "")
        score = 0
        if group in prefer_groups:
            score += 10
        if status in prefer_status:
            score += 5
        if status == "published":
            score += 5
        if art:
            score += 3
        rows.append({"keyword": kw, "article": art, "score": score})
    rows.sort(key=lambda r: (-r["score"], int(r["keyword"].get("priority") or 9999)))
    return rows[:limit]


def build_x_post(keyword: str, title: str, url: str, direct_answer: str, hashtags: list[str], max_chars: int) -> str:
    tip = direct_answer.strip()
    if len(tip) > 120:
        tip = tip[:117] + "…"
    tags = " ".join("#" + h.lstrip("#") for h in hashtags[:4])
    header = "【" + keyword + "】"
    cta = "https://trillion-bank.jp/trillionbank/contact/#form"
    parts = [header, tip, "", "詳しく: " + url, "お問い合わせ: " + cta, tags]
    body = "\n".join(parts)
    if len(body) <= max_chars:
        return body
    overflow = len(body) - max_chars
    tip2 = tip[: max(40, len(tip) - overflow - 1)] + "…"
    parts[1] = tip2
    return "\n".join(parts)


def build_note_markdown(keyword: str, title: str, url: str, direct_answer: str, cluster: str) -> str:
    today = date.today().isoformat()
    lines = [
        "# " + title,
        "",
        "## この記事で分かること",
        "",
        "- 対策キーワード: **" + keyword + "**",
        "- クラスター: " + (cluster or "AI検索"),
        "- 結論: " + direct_answer,
        "",
        "## 本文（サイト版）",
        "",
        "詳細な解説・FAQ・参考文献は、Trillion Bank Insights の公開ページを正本としてください。",
        "",
        "→ " + url,
        "",
        "## 未着手の中小企業向けまとめ",
        "",
        "1. 重要質問を決める",
        "2. 主要AIで現状を記録する",
        "3. 定義文・FAQ・表記ゆれを直す",
        "4. 同じ条件で再計測する",
        "",
        "掲載・順位・問い合わせや売上を保証するものではありません。",
        "",
        "## 販売代理店を検討される方へ",
        "",
        "Trillion Bankサービスの販売代理店・共同提案は相談を受け付けています。",
        "他社商材の代理販売依頼はお受けしていません。",
        "",
        "→ お問い合わせ: https://trillion-bank.jp/trillionbank/contact/#form",
        "",
        "---",
        "下書き生成日: " + today,
        "※ note へは自動投稿せず、内容確認後に手動公開してください。",
        "",
    ]
    return "\n".join(lines)
