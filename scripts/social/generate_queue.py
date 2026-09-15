#!/usr/bin/env python3
"""Generate X and note drafts from keyword queue + published articles."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from lib import (
    OUTBOX,
    already_posted,
    build_note_markdown,
    build_x_post,
    contains_forbidden,
    load_config,
    select_candidates,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    cfg = load_config()
    forbidden = list(cfg.get("guardrails", {}).get("forbidden_terms") or [])
    hashtags = list(cfg.get("x", {}).get("hashtags_default") or [])
    max_chars = int(cfg.get("x", {}).get("max_chars") or 260)

    OUTBOX.mkdir(parents=True, exist_ok=True)
    day_dir = OUTBOX / args.date
    day_dir.mkdir(parents=True, exist_ok=True)

    generated = []
    for row in select_candidates(limit=args.limit * 3):
        kw = row["keyword"]
        art = row["article"]
        if not art:
            continue
        keyword = str(kw.get("keyword") or "")
        if already_posted("x", keyword, art["slug"]) and already_posted("note", keyword, art["slug"]):
            continue

        x_text = build_x_post(
            keyword=keyword,
            title=art["title"],
            url=art["url"],
            direct_answer=art.get("direct_answer") or art["title"],
            hashtags=hashtags,
            max_chars=max_chars,
        )
        note_md = build_note_markdown(
            keyword=keyword,
            title=art["title"],
            url=art["url"],
            direct_answer=art.get("direct_answer") or art["title"],
            cluster=str(kw.get("cluster") or ""),
        )
        bad = contains_forbidden(x_text + note_md, forbidden)
        if bad:
            print(f"skip forbidden:{bad} keyword={keyword}")
            continue

        stem = f"{kw.get('priority', 0):03d}-{art['slug']}"
        x_path = day_dir / f"{stem}.x.txt"
        note_path = day_dir / f"{stem}.note.md"
        meta_path = day_dir / f"{stem}.json"
        x_path.write_text(x_text + "\n", encoding="utf-8")
        note_path.write_text(note_md, encoding="utf-8")
        meta = {
            "date": args.date,
            "keyword": keyword,
            "priority": kw.get("priority"),
            "group": kw.get("group"),
            "cluster": kw.get("cluster"),
            "article_slug": art["slug"],
            "article_url": art["url"],
            "x_file": x_path.name,
            "note_file": note_path.name,
            "status": "draft",
        }
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        generated.append(meta)
        if len(generated) >= args.limit:
            break

    summary = day_dir / "summary.json"
    summary.write_text(json.dumps({"date": args.date, "items": generated}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(generated)} drafts -> {day_dir}")
    for item in generated:
        print(f"- {item['keyword']} -> {item['article_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
