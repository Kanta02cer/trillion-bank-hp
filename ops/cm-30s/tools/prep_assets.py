#!/usr/bin/env python3
"""Derive animatable layers from the official wordmark (images/hero/tb-logo-hero.webp).

Outputs (ops/cm-30s/assets/):
  wordmark-ink.png   black parts of the wordmark (alpha preserved)
  wordmark-blue.png  the blue bar of the "A" (alpha preserved)
  wordmark.json      per-letter column ranges, used for staggered reveals
No pixels are redrawn; the layers are masks of the official artwork.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parents[1] / "assets"
src = np.array(Image.open(ROOT / "images/hero/tb-logo-hero.webp").convert("RGBA")).astype(np.int32)
h, w = src.shape[:2]
alpha = src[..., 3]
rgb = src[..., :3]
# edge artifacts at the extreme left/right columns of the source file
alpha[:, :6] = 0
alpha[:, w - 4:] = 0
blue = (rgb[..., 2] > rgb[..., 0] + 60) & (alpha > 0)
blue[:, :1500] = False
blue[:, 1700:] = False
# soften: include anti-aliased fringe around the blue bar
by, bx = np.where(blue)
y0, y1, x0, x1 = by.min() - 2, by.max() + 3, bx.min() - 2, bx.max() + 3
region = np.zeros_like(blue)
region[y0:y1, x0:x1] = True
bluish = region & (rgb[..., 2] > rgb[..., 0] + 25)

ink = np.zeros((h, w, 4), np.uint8)
ink[..., :3] = 11
ink[..., 3] = np.where(bluish, 0, alpha).astype(np.uint8)
bl = np.zeros((h, w, 4), np.uint8)
bl[..., 0], bl[..., 1], bl[..., 2] = 3, 63, 250
bl[..., 3] = np.where(bluish, alpha, 0).astype(np.uint8)

ys, xs = np.where(alpha > 30)
top, bottom = int(ys.min()), int(ys.max()) + 1
left, right = int(xs.min()), int(xs.max()) + 1
pad = 4
box = (left - pad, top - pad, right + pad, bottom + pad)
Image.fromarray(ink).crop(box).save(OUT / "wordmark-ink.png", optimize=True)
Image.fromarray(bl).crop(box).save(OUT / "wordmark-blue.png", optimize=True)

colany = (alpha > 30).any(0)
segs, inside = [], False
for x, v in enumerate(colany):
    if v and not inside:
        s, inside = x, True
    elif not v and inside:
        segs.append([s, x - 1]); inside = False
# merge split glyphs (O and K are drawn as two strokes)
merged = []
for s, e in segs:
    if merged and s - merged[-1][1] < 20:
        merged[-1][1] = e
    else:
        merged.append([s, e])
letters = "TRILLIONBANK"
assert len(merged) == len(letters), merged
json.dump({
    "width": box[2] - box[0], "height": box[3] - box[1],
    "letters": [{"ch": c, "x0": s - box[0] - 3, "x1": e - box[0] + 4} for c, (s, e) in zip(letters, merged)],
}, open(OUT / "wordmark.json", "w"), indent=1)
print("ok", box, merged)
