#!/usr/bin/env python3
"""Tile out/stills/*.png into a labelled contact sheet for review."""
import sys, glob
from pathlib import Path
from PIL import Image, ImageDraw
d = Path(__file__).resolve().parents[1] / 'out' / 'stills'
files = sorted(glob.glob(str(d / 't*.png')))
if len(sys.argv) > 2:
    lo, hi = float(sys.argv[1]), float(sys.argv[2])
    files = [f for f in files if lo <= float(Path(f).stem[1:]) <= hi]
cols, tw = 3, 640
th = tw * 9 // 16
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 4)), (40, 40, 40))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS)
    ImageDraw.Draw(im).text((8, 6), Path(f).stem, fill=(255, 0, 120))
    sheet.paste(im, ((i % cols) * tw, (i // cols) * (th + 4)))
out = d.parent / (sys.argv[3] if len(sys.argv) > 3 else 'contact.png')
sheet.save(out); print(out)
