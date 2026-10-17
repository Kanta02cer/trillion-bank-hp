#!/usr/bin/env bash
# Contact sheet (2 frames/s) + motion-blur spot checks from a rendered MP4.
set -euo pipefail
cd "$(dirname "$0")/.."
VID=${1:-out/trillion-bank-cm-30s.mp4}
ffmpeg -loglevel error -y -i "$VID" -vf "fps=2,scale=384:-1,tile=6x10:padding=4:color=0x202020" -frames:v 1 out/review_sheet.png
for t in ${SPOT:-3.9 6.8 12.62 14.45 20.0 23.9}; do
  ffmpeg -loglevel error -y -ss "$t" -i "$VID" -frames:v 1 "out/spot_${t}.png"
done
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,sample_rate,channels -of compact "$VID"
ffmpeg -hide_banner -nostats -i "$VID" -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -2
