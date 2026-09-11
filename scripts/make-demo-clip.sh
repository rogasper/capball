#!/usr/bin/env bash
#
# Generate synthetic test footage for capball development and tests.
#
# The repository ships no real match footage, so this script creates clips from
# FFmpeg's built-in test source:
#   demo-match.mp4       H.264/AAC in MP4   — plays directly
#   demo-match.mkv       the same streams remuxed into Matroska — exercises the
#                        remux path, since WebViews cannot play MKV directly
#
# It deliberately avoids optional FFmpeg filters (such as drawtext) so it works
# on minimal FFmpeg builds.
#
# Usage:
#   ./scripts/make-demo-clip.sh [output-dir] [duration-seconds]

set -euo pipefail

OUT_DIR="${1:-tmp/demo}"
DURATION="${2:-180}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg not found on PATH. Install it and try again." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Writing MP4 (H.264/AAC, ${DURATION}s) to ${OUT_DIR}/demo-match.mp4"
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=1280x720:rate=30:duration=${DURATION}" \
  -f lavfi -i "sine=frequency=440:duration=${DURATION}" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "${OUT_DIR}/demo-match.mp4"

echo "Writing MKV (stream copy H.264/AAC) to ${OUT_DIR}/demo-match.mkv"
ffmpeg -y -loglevel error \
  -i "${OUT_DIR}/demo-match.mp4" \
  -c copy \
  "${OUT_DIR}/demo-match.mkv"

echo "Done. Files in ${OUT_DIR}/"
ls -lh "${OUT_DIR}"
