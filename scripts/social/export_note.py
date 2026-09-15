#!/usr/bin/env python3
"""List / validate note drafts in outbox. Note.com posting stays manual."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from lib import OUTBOX, already_posted, mark_posted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mark-exported", action="store_true", help="Mark latest note drafts as exported")
    args = parser.parse_args()

    if not OUTBOX.exists():
        print("No outbox. Run generate_queue.py first.")
        return 1

    days = sorted([p for p in OUTBOX.iterdir() if p.is_dir()], reverse=True)
    if not days:
        print("No dated outbox folders.")
        return 1

    day = days[0]
    notes = sorted(day.glob("*.note.md"))
    print(f"note drafts in {day}:")
    for note in notes:
        meta_path = note.with_suffix("").with_suffix(".json")
        # stem is like 001-slug.note -> need 001-slug.json
        meta_path = Path(str(note).replace(".note.md", ".json"))
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        print(f"- {note.name} | keyword={meta.get('keyword')} | url={meta.get('article_url')}")
        print(f"  open: {note}")
        if args.mark_exported and meta:
            if not already_posted("note", meta["keyword"], meta["article_slug"]):
                mark_posted("note", meta["keyword"], meta["article_slug"], {"file": note.name})
                meta["status"] = "note_exported"
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\nnote.com は安定した公開投稿APIが無いため、上記 Markdown を確認後に手動公開してください。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
