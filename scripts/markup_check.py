#!/usr/bin/env python3
"""Count markup items in built pages: HTML comments, inline styles, template-style classes.

Usage:
  python3 scripts/markup_check.py _site                 # built Jekyll output
  python3 scripts/markup_check.py https://example/ ...  # live URLs
  python3 scripts/markup_check.py _site --max-comments 0
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from pathlib import Path

TEMPLATE_CLASSES = {
    "hero-section", "feature-card", "feature-box", "card-container", "section-title",
    "container-fluid", "main-content", "cta-section", "features-grid",
}
UTILITY = re.compile(
    r"^(bg-(white|black|gray|slate|indigo|blue)(-\d+)?|text-(xs|sm|lg|xl|\dxl|gray-\d+)|"
    r"p[xytblr]?-\d+|m[xytblr]?-\d+|rounded-(md|lg|xl)|shadow-(sm|md|lg)|font-bold|(sm|md|lg):[\w-]+)$"
)
BLOCKS = re.compile(r"<script\b.*?</script>|<style\b.*?</style>", re.S | re.I)


def measure(html: str) -> dict:
    body = BLOCKS.sub("", html)
    classes: set[str] = set()
    for m in re.finditer(r'\bclass="([^"]*)"', body):
        classes.update(m.group(1).split())
    comments = [c for c in re.findall(r"<!--(.*?)-->", body, flags=re.S) if not c.lstrip().startswith("[if")]
    return {
        "comments": len(comments),
        "inline": len(re.findall(r'\sstyle="', body)),
        "template": sorted(classes & TEMPLATE_CLASSES),
        "utility": sorted(c for c in classes if UTILITY.match(c)),
    }


def sources(targets: list[str]):
    for t in targets:
        if t.startswith(("http://", "https://")):
            req = urllib.request.Request(t, headers={"User-Agent": "Mozilla/5.0 markup_check"})
            with urllib.request.urlopen(req, timeout=30) as r:
                yield t, r.read().decode("utf-8", "replace")
            continue
        root = Path(t)
        files = sorted(root.rglob("*.html")) if root.is_dir() else [root]
        for f in files:
            yield str(f), f.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="+")
    ap.add_argument("--max-comments", type=int, default=None)
    ap.add_argument("--max-inline", type=int, default=None)
    args = ap.parse_args()

    total = {"comments": 0, "inline": 0, "template": 0, "utility": 0}
    n = 0
    for name, html in sources(args.targets):
        r = measure(html)
        n += 1
        total["comments"] += r["comments"]
        total["inline"] += r["inline"]
        total["template"] += len(r["template"])
        total["utility"] += len(r["utility"])
        if r["comments"] or r["inline"] or r["template"] or r["utility"]:
            extra = ",".join(r["template"] + r["utility"])
            print(f"{r['comments']:4d} comments {r['inline']:4d} inline  {name}" + (f"  [{extra}]" if extra else ""))
    print(f"pages={n} comments={total['comments']} inline={total['inline']} "
          f"template_classes={total['template']} utility_classes={total['utility']}")

    failed = False
    if args.max_comments is not None and total["comments"] > args.max_comments:
        print(f"FAIL: comments {total['comments']} > {args.max_comments}")
        failed = True
    if args.max_inline is not None and total["inline"] > args.max_inline:
        print(f"FAIL: inline styles {total['inline']} > {args.max_inline}")
        failed = True
    if total["template"] or total["utility"]:
        print("FAIL: template-style or utility-framework class names found")
        failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
