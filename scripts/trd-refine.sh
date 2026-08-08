#!/usr/bin/env bash
# trd-refine — one reproducible harness to re-run and refine EVERY calculation/test in the engine.
# Run it after any change to confirm the whole honest pipeline still holds. All offline except the
# search/correlation steps (keyless Yahoo). Nothing spends money; nothing places an order.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "═══ 1. Unit test suite (honest-stats core + grammar + strategy modules) ═══"
deno test --allow-read supabase/functions/_shared/

echo; echo "═══ 2. Type check (all edge fns + shared) ═══"
deno check supabase/functions/_shared/*.ts

echo; echo "═══ 3. Falsify a named viral strategy (Pranam XAU liquidity-grab, D-080) ═══"
deno run --allow-net scripts/trd-liquidity-grab-verify.ts | tail -6

echo; echo "═══ 4. Deflation-aware mass search (D-081) ═══"
deno run --allow-net scripts/trd-strategy-search.ts | tail -6

echo; echo "═══ 5. Conditional-edge search — WHEN they work (D-082) ═══"
deno run --allow-net scripts/trd-conditional-search.ts | tail -6

echo; echo "═══ 6. Macro correlation — do the patterns tie to the economy? (D-084) ═══"
deno run --allow-net scripts/trd-macro-correlation.ts | tail -8

echo; echo "═══ 7. Universe sweep (D-083) is heavy (~minutes); run explicitly with:"
echo "        OUT_FILE=/tmp/u.json deno run --allow-net --allow-write --allow-env scripts/trd-universe-search.ts"
echo
echo "REFINE COMPLETE. Pre-registered hypotheses accrue their forward verdict autonomously"
echo "(trd-prereg-tick, cron every 6h). Read them:  curl -s .../functions/v1/trd-prereg-tick | jq"
