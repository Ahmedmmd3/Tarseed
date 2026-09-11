#!/usr/bin/env bash
set -e

MP4_FILE=$1

if [ -z "$MP4_FILE" ]; then
  echo "Usage: $0 path/to/rendered.mp4"
  exit 1
fi

echo "Validating frames for: $MP4_FILE"

# Extract specific frames
mkdir -p /tmp/tarseed-frames
ffmpeg -v error -y -i "$MP4_FILE" -ss 00:00:05.000 -vframes 1 /tmp/tarseed-frames/frame_5s.png
ffmpeg -v error -y -i "$MP4_FILE" -ss 00:00:11.000 -vframes 1 /tmp/tarseed-frames/frame_11s.png
ffmpeg -v error -y -i "$MP4_FILE" -ss 00:00:13.000 -vframes 1 /tmp/tarseed-frames/frame_13s.png
ffmpeg -v error -y -i "$MP4_FILE" -ss 00:00:21.000 -vframes 1 /tmp/tarseed-frames/frame_21s.png
ffmpeg -v error -y -i "$MP4_FILE" -ss 00:00:25.000 -vframes 1 /tmp/tarseed-frames/frame_25s.png

# Simple check: the frames should differ substantially in file size if they show different content.
# Also, they should not be very small (like a plain black frame might be 1-5KB, a complex UI frame > 50KB).

check_size() {
  local file=$1
  local min_size=$2
  local size=$(stat -c%s "$file")
  
  echo "Frame $file size: $size bytes"
  
  if [ "$size" -lt "$min_size" ]; then
    echo "ERROR: Frame $file is suspiciously small ($size bytes). Likely an empty background or failed render!"
    exit 1
  fi
}

# The complex app frames and Tarseed frames should be large (rich UI + noise + blur).
# The black interstitial (11s) will be smaller but still has text.
check_size /tmp/tarseed-frames/frame_5s.png 50000
check_size /tmp/tarseed-frames/frame_11s.png 10000
check_size /tmp/tarseed-frames/frame_13s.png 50000
check_size /tmp/tarseed-frames/frame_21s.png 50000
check_size /tmp/tarseed-frames/frame_25s.png 30000

echo "Frame integrity check PASSED! The scenes have content."
