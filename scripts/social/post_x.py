#!/usr/bin/env python3
"""Post the newest approved X draft. Dry-run by default."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from lib import OUTBOX, already_posted, contains_forbidden, load_config, mark_posted


def latest_drafts() -> list[Path]:
    if not OUTBOX.exists():
        return []
    days = sorted([p for p in OUTBOX.iterdir() if p.is_dir()], reverse=True)
    drafts: list[Path] = []
    for day in days:
        drafts.extend(sorted(day.glob("*.json")))
        if drafts:
            break
    return drafts


def post_tweet(text: str) -> dict:
    """Post via Twitter API v2 using requests-oauthlib style env credentials."""
    try:
        from requests_oauthlib import OAuth1Session
    except ImportError as exc:
        raise SystemExit(
            "requests-oauthlib is required for --publish. pip install requests-oauthlib requests"
        ) from exc

    api_key = os.environ.get("X_API_KEY")
    api_secret = os.environ.get("X_API_SECRET")
    access_token = os.environ.get("X_ACCESS_TOKEN")
    access_secret = os.environ.get("X_ACCESS_TOKEN_SECRET")
    missing = [n for n, v in [
        ("X_API_KEY", api_key),
        ("X_API_SECRET", api_secret),
        ("X_ACCESS_TOKEN", access_token),
        ("X_ACCESS_TOKEN_SECRET", access_secret),
    ] if not v]
    if missing:
        raise SystemExit(f"Missing secrets: {', '.join(missing)}")

    session = OAuth1Session(api_key, api_secret, access_token, access_secret)
    response = session.post(
        "https://api.twitter.com/2/tweets",
        json={"text": text},
        timeout=30,
    )
    if response.status_code not in (200, 201):
        raise SystemExit(f"X API error {response.status_code}: {response.text[:500]}")
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=None)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--file", help="Specific .json meta file to post")
    args = parser.parse_args()

    cfg = load_config()
    dry_run = True
    if args.publish:
        dry_run = False
    elif args.dry_run is True:
        dry_run = True
    elif cfg.get("x", {}).get("dry_run_default", True):
        dry_run = True

    forbidden = list(cfg.get("guardrails", {}).get("forbidden_terms") or [])
    metas = [Path(args.file)] if args.file else latest_drafts()
    if not metas:
        print("No drafts found. Run generate_queue.py first.")
        return 1

    for meta_path in metas:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        x_path = meta_path.with_name(meta["x_file"])
        text = x_path.read_text(encoding="utf-8").strip()
        bad = contains_forbidden(text, forbidden)
        if bad:
            print(f"blocked forbidden term: {bad}")
            continue
        if already_posted("x", meta["keyword"], meta["article_slug"]):
            print(f"skip already posted: {meta['keyword']}")
            continue

        print("--- X draft ---")
        print(text)
        print("---------------")
        if dry_run:
            print("dry-run: not posted")
            return 0

        result = post_tweet(text)
        tweet_id = (result.get("data") or {}).get("id")
        mark_posted(
            "x",
            meta["keyword"],
            meta["article_slug"],
            {"tweet_id": tweet_id, "meta_file": str(meta_path.relative_to(OUTBOX.parent.parent.parent)) if False else meta_path.name},
        )
        meta["status"] = "posted"
        meta["tweet_id"] = tweet_id
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"posted tweet_id={tweet_id}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
