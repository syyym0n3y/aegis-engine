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
echo "=== refresh distress short universe (D-930/935/936, efts.sec.gov) — going-concern UNION late-filing ==="
TO_Y=2026 deno run --allow-net --allow-env --allow-write ../scripts/goingconcern-test.ts >/dev/null 2>&1 || true
TO_Y=2026 deno run --allow-net --allow-env --allow-write ../scripts/latefiling-test.ts >/dev/null 2>&1 || true
# D-936: combine both triggers into the single deployable distress short (d931 = the "gcshort" sleeve the blend reads)
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/distress-sleeve.ts 2>&1 | grep -E "==>|late-filing added|combined liquid" || true
echo "=== refresh IVOL anomaly sleeve (D-939, held bars; D-939c borrow avoid-filter days_cover<5) — the 5th sleeve ==="
SIGNAL=ivol MAX_NAMES=3000 CROWD_DC=5 DUMP=1 deno run --v8-flags=--max-old-space-size=7168 --allow-net --allow-env --allow-read --allow-write ../scripts/volatility-anomaly.ts 2>&1 | grep -E "NET |CLEARS|AVOID-FILTER" | grep -vE "deno \+|0x0000" || true
echo "=== FIVE-sleeve blend paper mark (D-939 distress+IVOL, DORMANT \$0) — the deployable candidate ==="
PAPER=1 SLEEVES=trend,long,cryptomom,gcshort,ivol PAPER_START=2026-09-16 PAPER_RULE=fwd-distress-ivol-blend-5 PAPER_SPEC=distress-ivol-blend-5 deno run --allow-net --allow-env --allow-read --allow-write ../scripts/multistrategy-blend.ts 2>&1 | grep -E "PAPER|RISK-PARITY BLEND at" || true
echo "=== refresh current opportunities (both directions, global) ==="
deno run --allow-net --allow-env --allow-write ../scripts/opportunities.ts 2>&1 | grep -E "==>|TOP" || true
echo "=== attribution refresh (own log: the agent-output guard reads one file per agent) ==="
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/aegis-attribution.ts > ./data/attribution.log 2>./data/attribution.err
tail -5 ./data/attribution.log
echo "=== done $(date -u +%FT%TZ) ==="
