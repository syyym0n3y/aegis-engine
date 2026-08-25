#!/bin/bash
# guard-status.sh (D-586) — the operator's one-command view of guard state. No Claude required.
#
# WHY THIS EXISTS: on 2026-08-25 four guards had been RED since the 14:40 cycle (agent-output, holdability,
# universe, plumbing) and nobody knew, because the only record was six lines buried in a 1,125-line append-only
# log that nothing read. This program has already written down that exact failure once — "every one was visible
# in a log file that nothing was reading" — and then reproduced it one level up, on the guards themselves.
# A guard whose RED has no reader is decorative.
cd "$(dirname "$0")/.."
LOG=infra/data/coverage.log
if [ ! -f "$LOG" ]; then echo "no guard log at $LOG — the daily runner has never completed a cycle"; exit 1; fi

# The LAST complete cycle only. Scanning the whole tail reports defects that were already FIXED, which is how a
# guard stops being believed (the agent-output guard shipped with exactly that flaw and had to be corrected).
START=$(grep -n "==> COVERAGE GUARD" "$LOG" | tail -1 | cut -d: -f1)
[ -z "$START" ] && { echo "no complete cycle in the log yet"; exit 1; }
CYCLE=$(tail -n +"$START" "$LOG")

TS=$(echo "$CYCLE" | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z" | tail -1)
echo "== AEGIS GUARD STATUS — last cycle ${TS:-unknown} =="
RED=$(echo "$CYCLE" | grep "GUARD RED" | sed 's/^[0-9T:-]*Z //')
if [ -z "$RED" ]; then
  echo "  ALL GUARDS GREEN"
else
  echo "$RED" | sed 's/^/  RED  /'
  echo
  echo "  -- offending rows --"
  echo "$CYCLE" | grep -E "^  RED " | sed 's/^/  /' | sort -u
fi
N=$(echo "$RED" | grep -c . )
echo
echo "-- $N guard(s) red; log age: $(( ($(date +%s) - $(stat -f %m "$LOG")) / 3600 ))h"
# Non-zero exit so this is usable in CI or a hook, not just by eye.
[ "$N" -gt 0 ] && exit 1 || exit 0
