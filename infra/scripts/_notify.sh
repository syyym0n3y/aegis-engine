#!/usr/bin/env bash
# _notify.sh (D-854) — the operator must never have to ask "is anything red?". Keyless, local, no account:
# a macOS notification plus a marker file the next session (or a glance at the folder) sees first.
# usage: _notify.sh "title" "message"   — creates data/BOARD_RED.txt; call _notify.sh --clear when green.
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$1" = "--clear" ]; then rm -f "$DIR/data/BOARD_RED.txt"; exit 0; fi
T="$1"; M="$2"
printf "%s  %s — %s\n" "$(date -u +%FT%TZ)" "$T" "$M" >> "$DIR/data/BOARD_RED.txt"
osascript -e "display notification \"$(printf '%s' "$M" | tr '"' "'" | cut -c1-200)\" with title \"$(printf '%s' "$T" | tr '"' "'")\" sound name \"Basso\"" >/dev/null 2>&1 || true
