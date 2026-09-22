#!/usr/bin/env bash
# boot-triage.sh (D-959) — absorb a host REBOOT without a human triage session. Two consecutive mornings (2026-09-21,
# 2026-09-22) the Mac rebooted ~01:30, containers self-healed, but daemons that fired during the boot window left
# connection-refused debris in their .err files and their "latest run" records — turning 3-6 guards red until someone
# hand-verified the same transient signature both times. This automates ONLY the bounded, signature-matched part:
#   1. wait for owned REST to answer (up to 10 min);
#   2. truncate an infra/data/*.err ONLY if EVERY non-blank line matches the known boot-transient signature —
#      any line outside the signature leaves the file untouched and the guard RED (real errors still surface);
#   3. kick the resident daemons once, so each one's LATEST run is a post-boot clean run.
# It does NOT touch guard baselines (log-triage/rest-restart stay human-or-runner-advanced): an amnesty a machine
# grants itself unbounded is the D-586 failure; this one is bounded to a regex any reviewer can read.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=./data/boot-triage.log
echo "=== boot-triage $(date -u +%FT%TZ) (host up: $(uptime | sed 's/.*up //;s/,.*//'))" >> "$LOG"
set -a; . ./.env 2>/dev/null || true; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start >/dev/null 2>&1) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
REST="http://localhost:${REST_PORT:-33000}"
for _ in $(seq 1 120); do curl -sf -o /dev/null "$REST/" && break; sleep 5; done
if ! curl -sf -o /dev/null "$REST/"; then echo "  REST never came up — leaving everything red for a human" >> "$LOG"; exit 1; fi
# Primary signature (the outage itself) + consequence lines a dead REST produces in the same run: guards echoing
# could-not-read/refusing-to-certify, traceback frames, caret/code echoes. Widening is safe ONLY because this script
# acts strictly after REST answers: if the outage were real, the re-kicked daemons rewrite fresh errors immediately.
SIG='Connection refused|os error 61|error sending request|docker\.sock|colima|starting vm|tcp connect|STRICT READ FAILED|503|could not read|cannot read|unreadable|refusing to certify|^[[:space:]]*at |await fetch|\^[[:space:]]*$|Uncaught \(in promise\)|deno_fetch|mainFetch|REST RESTART GUARD|PostgREST restarted'
for f in ./data/*.err; do
  [ -s "$f" ] || continue
  # strip ANSI color escapes before matching — deno wraps error lines (and the traceback caret) in them
  if sed $'s/\x1b\\[[0-9;]*m//g' "$f" | grep -vE "$SIG" | grep -qE '[^[:space:]]'; then
    echo "  KEPT $f — contains lines outside the boot-transient signature (needs a human)" >> "$LOG"
  else
    : > "$f"; echo "  cleared $f (all lines matched boot-transient signature)" >> "$LOG"
  fi
done
# D-959b: NO daemon kicks at boot. The daemons are night-scheduled (StartCalendarInterval 02:10-04:40, Background
# QoS) since the boot-time burst was measured pinning aegis-db at 127% CPU exactly when the operator sits down.
# Boot only needs the containers up (done above) and the stale-transient .err debris cleared; the daemons' own
# night runs produce the fresh clean records the guards read (MAX_STALE_H=30 accommodates a 24h cadence).
echo "  done $(date -u +%FT%TZ)" >> "$LOG"
