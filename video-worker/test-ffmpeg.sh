#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for spec in "portrait:1080x1920" "landscape:1920x1080" "square:1080x1080"; do
  name="${spec%%:*}"
  size="${spec#*:}"
  input="$tmp_dir/source-$name.mp4"
  output="$tmp_dir/compatible-$name.mp4"

  echo "Testing $name ($size)"
  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=$size:rate=30" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000" \
    -t 2 -c:v libx264 -profile:v high -pix_fmt yuv420p \
    -c:a aac -profile:a aac_low -b:a 160k \
    -movflags +faststart -y "$input"

  ffmpeg -hide_banner -loglevel error -y -i "$input" \
    -map 0:v:0 -map '0:a:0?' -sn -dn \
    -vf "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2" \
    -r 30 -c:v libx264 -profile:v baseline -level:v 3.1 \
    -pix_fmt yuv420p -preset veryfast -crf 23 \
    -maxrate 2M -bufsize 4M -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000 \
    -movflags +faststart "$output"

  video_info="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,profile,level,pix_fmt,width,height \
    -of default=noprint_wrappers=1 "$output")"
  echo "$video_info"
  grep -q '^codec_name=h264$' <<<"$video_info"
  grep -Eiq '^profile=.*baseline' <<<"$video_info"
  grep -q '^level=31$' <<<"$video_info"
  grep -q '^pix_fmt=yuv420p$' <<<"$video_info"

  width="$(awk -F= '$1=="width" {print $2}' <<<"$video_info")"
  height="$(awk -F= '$1=="height" {print $2}' <<<"$video_info")"
  if (( width > 1280 || height > 1280 || width * height > 921600 )); then
    echo "Output dimensions exceed H.264 Level 3.1 frame-size limits: ${width}x${height}" >&2
    exit 1
  fi

  audio_info="$(ffprobe -v error -select_streams a:0 \
    -show_entries stream=codec_name,profile,sample_rate,channels \
    -of default=noprint_wrappers=1 "$output")"
  grep -q '^codec_name=aac$' <<<"$audio_info"
  grep -q '^profile=LC$' <<<"$audio_info"
  grep -q '^sample_rate=48000$' <<<"$audio_info"
  grep -q '^channels=2$' <<<"$audio_info"
done

echo "All FFmpeg compatibility profile tests passed."
