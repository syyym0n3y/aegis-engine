#!/usr/bin/env bash
# decode-channel.sh — pull a trading channel's teaching transcripts for free, so any strategy can be decoded and run
# through the Aegis gate. Usage:
#   scripts/decode-channel.sh list  @handle                 # list videos (title ::: id)
#   scripts/decode-channel.sh grab  <id> [<id> ...]         # download + clean transcripts to research/<handle>/
#   scripts/decode-channel.sh grep  <pattern>               # search downloaded transcripts for a rule/keyword
# Requires yt-dlp (brew install yt-dlp). $0 — no API, no LLM. Decode-to-verdict is then a human read + the gate scripts.
set -euo pipefail
OUT="${DECODE_OUT:-research/_decode}"; mkdir -p "$OUT"
clean(){ sed -E '/-->/d;/^WEBVTT/d;/^Kind:/d;/^Language:/d;/^[0-9]+$/d;s/<[^>]*>//g;/^\s*$/d' "$1" | awk '!seen[$0]++' | tr '\n' ' ' | sed -E 's/  +/ /g'; }
case "${1:-}" in
  list) yt-dlp --flat-playlist --print "%(title)s ::: %(id)s" "https://www.youtube.com/${2}/videos" ;;
  grab) shift; for id in "$@"; do
          yt-dlp --skip-download --write-auto-sub --sub-lang "en.*" --sub-format vtt -o "$OUT/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=$id" >/dev/null 2>&1 || true
          f=$(ls "$OUT/$id".*.vtt 2>/dev/null | head -1); [ -n "$f" ] && { clean "$f" > "$OUT/$id.txt"; echo "ok: $OUT/$id.txt ($(wc -w < "$OUT/$id.txt") words)"; } || echo "no subs: $id"
        done ;;
  grep) shift; grep -rhoiE "[^.]*(${1})[^.]*\." "$OUT"/*.txt | sort -u | head -40 ;;
  *) echo "usage: decode-channel.sh {list @handle | grab <id...> | grep <pattern>}"; exit 1 ;;
esac
