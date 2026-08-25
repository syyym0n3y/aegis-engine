#!/bin/bash
# guard-status.sh (D-586) — the operator's one-command view of guard state. No Claude required.
#
# WHY THIS EXISTS: on 2026-08-25 four guards had been RED since the 14:40 cycle and nobody knew, because the only
# record was six lines buried in a 1,125-line append-only log that nothing read. This program had already written
# that failure down once — "every one was visible in a log file that nothing was reading" — and then reproduced it
# one level up, on the guards themselves.
#
# IT RUNS THE GUARDS. The first version parsed the daily log instead, and so kept reporting four REDs that were
# already fixed, unable to go green until the next 24h cycle. A status surface that cannot reflect a fix is the
# same defect the agent-output guard shipped with (D-XXX) and it is how a guard stops being believed.
# Use --log for the cached view of the last scheduled cycle.
cd "$(dirname "$0")/.."
set -a; . infra/.env 2>/dev/null; set +a
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
DENO=/Users/ona/.deno/bin/deno

if [ "${1:-}" = "--log" ]; then
  LOG=infra/data/coverage.log
  START=$(grep -n "==> COVERAGE GUARD" "$LOG" 2>/dev/null | tail -1 | cut -d: -f1)
  [ -z "$START" ] && { echo "no complete cycle logged yet"; exit 1; }
  echo "== last SCHEDULED cycle (cached; run without --log for live state) =="
  tail -n +"$START" "$LOG" | grep "GUARD RED" | sed 's/^/  /'
  exit 0
fi

echo "== AEGIS GUARD STATUS — live, $(date -u +%FT%TZ) =="
RED=0; N=0
for g in coverage liquidity effect-size breadth execution selection universe sign survivor \
         holdability instrument mechanism agent-output plumbing forward-rules; do
  [ -f "scripts/${g}-guard.ts" ] || continue
  N=$((N+1))
  out=$($DENO run --allow-net --allow-env --allow-read --allow-run "scripts/${g}-guard.ts" 2>&1); c=$?
  if [ $c -eq 0 ]; then
    printf "  GREEN %-14s %s\n" "$g" "$(echo "$out" | tail -1 | sed 's/^ *//' | cut -c1-58)"
  else
    RED=$((RED+1))
    printf "  RED   %-14s %s\n" "$g" "$(echo "$out" | tail -1 | sed 's/^ *//' | cut -c1-58)"
    echo "$out" | grep -E "^\s+RED " | sed 's/^/          /' | head -6
  fi
done
echo
if [ "$RED" -eq 0 ]; then echo "-- all $N guards green"; else echo "-- $RED of $N guards RED"; fi
[ "$RED" -gt 0 ] && exit 1 || exit 0
