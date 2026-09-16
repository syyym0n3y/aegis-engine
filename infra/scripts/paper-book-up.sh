#!/usr/bin/env bash
# paper-book-up.sh (D-586) — the paper rung's own runner. Until now the rung was "armed" only in the sense that the
# table and the executor existed: NOTHING scheduled it, so it would never have marked a month even once the panel
# caught up. Runs daily, marks any complete month at or after the arm month, and is a no-op otherwise (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
echo "=== paper-book run $(date -u +%FT%TZ) ==="
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/paper-book.ts
echo "=== three-factor blend paper mark (D-926) — DORMANT, $0, marks fwd-three-factor-blend ==="
echo "=== refresh going-concern short universe (D-930/931/932, efts.sec.gov) ==="
TO_Y=2026 deno run --allow-net --allow-env --allow-write ../scripts/goingconcern-test.ts >/dev/null 2>&1 || true
echo "=== FOUR-sleeve blend paper mark (D-932, DORMANT $0) — the deployable candidate ==="
PAPER=1 SLEEVES=trend,long,cryptomom,gcshort PAPER_RULE=fwd-fourfactor-blend-gcshort PAPER_SPEC=four-factor-blend deno run --allow-net --allow-env --allow-read --allow-write ../scripts/multistrategy-blend.ts 2>&1 | grep -E "PAPER|RISK-PARITY BLEND at" || true
echo "=== refresh current opportunities (both directions, global) ==="
deno run --allow-net --allow-env --allow-write ../scripts/opportunities.ts 2>&1 | grep -E "==>|TOP" || true
echo "=== attribution refresh (own log: the agent-output guard reads one file per agent) ==="
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/aegis-attribution.ts > ./data/attribution.log 2>./data/attribution.err
tail -5 ./data/attribution.log
echo "=== done $(date -u +%FT%TZ) ==="
