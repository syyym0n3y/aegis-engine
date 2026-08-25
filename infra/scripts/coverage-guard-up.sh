#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
while true; do
  if ! deno run --allow-net --allow-env ../scripts/coverage-guard.ts; then
    echo "$(date -u +%FT%TZ) COVERAGE GUARD RED — a factor family lacks adequate data; nulls there are UNTESTED, not NULL"
  fi
  # LIQUIDITY LAW (D-424): two independent panels showed the entire cross-sectional return sits in the illiquid tail
  # (liq:HIGH SR 0.26 and 0.04). A promotion without a liquid-tercile number is a promotion of something that cannot
  # absorb size, so the same daily agent certifies both laws.
  if ! deno run --allow-net --allow-env ../scripts/liquidity-guard.ts; then
    echo "$(date -u +%FT%TZ) LIQUIDITY GUARD RED — a promoted strategy has no demonstrated edge in the liquid tercile"
  fi
  # EFFECT-SIZE LAW (D-429): D-426 produced 20/20 sign consistency at |t| 4.9 on a $523M/hour instrument and was STILL
  # untradable at 0.02-0.14x the fee. Significance answers "is it there"; only fee-multiples answer "is it worth acting on".
  if ! deno run --allow-net --allow-env ../scripts/effect-size-guard.ts; then
    echo "$(date -u +%FT%TZ) EFFECT-SIZE GUARD RED — a promoted strategy has no stated edge larger than its own cost"
  fi
  # BREADTH LAW (D-446): three times a large number came from a CONCENTRATED book and evaporated when the concentration
  # was removed (D-415 pooling, D-423 score-weighting, D-443 a 14-name quintile sort at "SR 1.13"). A t-stat cannot tell
  # a factor from a few idiosyncratic bets; this can.
  if ! deno run --allow-net --allow-env ../scripts/breadth-guard.ts; then
    echo "$(date -u +%FT%TZ) BREADTH GUARD RED — a promoted cross-sectional result was computed on too few names"
  fi
  # EXECUTION LAW (D-449): the strongest candidate in the program (D-447) cleared its bar only under a MAKER assumption,
  # and that assumption was false — measured on 5m bars the passive order fills 92% of the time and those days return
  # -1.85bp, while the +68bp lives in the 8% that never fill. A maker fee is a hypothesis about fills, not a cost.
  if ! deno run --allow-net --allow-env ../scripts/execution-guard.ts; then
    echo "$(date -u +%FT%TZ) EXECUTION GUARD RED — a maker-dependent result has no fill-conditional return"
  fi
  # SELECTION LAW (D-456): D-405 chose WHICH asset classes to overlay using the full sample, then reported an OOS Sharpe
  # of 0.37 on that choice. Re-made on train only, the overlay was negative in every class and the book collapsed onto
  # passive. Look-ahead in the CHOICE is invisible to every other guard — the returns and the split were both correct.
  if ! deno run --allow-net --allow-env ../scripts/selection-guard.ts; then
    echo "$(date -u +%FT%TZ) SELECTION GUARD RED — a promoted result may have chosen its components using the evaluation window"
  fi
  # AGENT OUTPUT GUARD (D-459): every other guard here inspects trd_lineage — the RECORD of what was concluded. None
  # inspected what the agents actually compute and print, and three real defects sat in production while all seven were
  # green (autopilot surfacing a false positive off a ceiling 1,530x too low; positioning claiming "validated edges"
  # against its own stored caveat; discovery ranking a bankrupt strategy by its Sharpe). This one reads the logs.
  if ! deno run --allow-net --allow-env --allow-read ../scripts/agent-output-guard.ts; then
    echo "$(date -u +%FT%TZ) AGENT OUTPUT GUARD RED — a live agent is printing an impossible value or an unsupported claim"
  fi
  # PLUMBING GUARD (D-467): static lint over the repo's own TypeScript — the defect classes that silently distorted
  # recorded numbers (arbitrary truncation, swallowed writes, frozen deflation ceilings). Ratcheted: RED only on NEW
  # violations beyond the committed baseline, so the legacy backlog burns down without ever growing.
  # INSTRUMENT GUARD (D-575): 4 of 4 unstated research->instrument conversions destroyed the edge. Every live return
  # claim must say which space it was measured in.
  if ! deno run --allow-net --allow-env ../scripts/instrument-guard.ts; then
    echo "$(date -u +%FT%TZ) INSTRUMENT GUARD RED — a return is claimed without stating its measurement space"
  fi
  # FORWARD-RULES GUARD (D-571): every forward clock must carry promote/kill conditions written before its data exists.
  if ! deno run --allow-net --allow-env ../scripts/forward-rules-guard.ts; then
    echo "$(date -u +%FT%TZ) FORWARD-RULES GUARD RED — a forward clock lacks a two-sided decision rule"
  fi
  # HOLDABILITY GUARD (D-566): depth without duration hides what actually ends deployments. The crypto candidate
  # survived ten statistical attacks and was disqualified by 42 months underwater — a fact no other gate measured.
  if ! deno run --allow-net --allow-env ../scripts/holdability-guard.ts; then
    echo "$(date -u +%FT%TZ) HOLDABILITY GUARD RED — a live book claims a return without stating its time underwater"
  fi
  # SURVIVOR GUARD (D-557): the survivor flag is a generated column over six gates; it cannot see in-sample component
  # selection. A flagged survivor whose own lineage calls its statistic descriptive is a false positive, not a promotion.
  if ! deno run --allow-net --allow-env ../scripts/survivor-guard.ts; then
    echo "$(date -u +%FT%TZ) SURVIVOR GUARD RED — a flagged survivor is contradicted by its own lineage"
  fi
  # SIGN GUARD (D-554): a direction asserted and never checked is how the D-553 sign error survived to become the
  # session's headline result. Any claimed directional prior must state whether it MATCHED or MISSED.
  if ! deno run --allow-net --allow-env ../scripts/sign-guard.ts; then
    echo "$(date -u +%FT%TZ) SIGN GUARD RED — a directional prior is claimed without stating its outcome"
  fi
  # UNIVERSE GUARD (D-535): a Sharpe that doubles across defensible universe definitions is a choice, not a measurement.
  if ! deno run --allow-net --allow-env ../scripts/universe-guard.ts; then
    echo "$(date -u +%FT%TZ) UNIVERSE GUARD RED — a promoted cross-sectional claim does not state its universe sensitivity"
  fi
  if ! deno run --allow-read --allow-env ../scripts/plumbing-guard.ts; then
    echo "$(date -u +%FT%TZ) PLUMBING GUARD RED — a new instance of a known defect class entered the codebase"
  fi
  # FORWARD SCORER (D-474): scores registered factory leads on completed post-registration months. Exits in ~1s unless a
  # new month needs scoring (~monthly work on a daily cadence). Prints FORWARD STATUS every run so the accrual is visible
  # in this log; WRITE-FAILED markers here page via the agent-output guard. Selftest-verified end-to-end before wiring.
  deno run --v8-flags=--max-old-space-size=7168 --allow-net --allow-env ../scripts/factory-forward-score.ts || echo "$(date -u +%FT%TZ) FORWARD SCORER FAILED"
  # BASIS WATCH (D-432): the quarterly carry is real, needs no forecast, and has decayed to ~0 — but it is CONDITIONAL, not
  # dead. A filed-away research verdict would never notice it returning. DORMANT: surfaces only, nothing armed.
  deno run --allow-net --allow-env ../scripts/basis-watch.ts || true
  # OPTION SKEW COLLECTOR (D-444): Deribit publishes no historical option chain, so skew and term structure are UNTESTED
  # rather than null. The honest response to a genuinely-unavailable history is to start the clock — this snapshots the
  # live surface daily so the series exists to test later. Idempotent (UTC day bucket); measures, never trades.
  deno run --allow-net --allow-env ../scripts/collect-option-skew.ts || true
  # US OPTIONS SURFACE (D-469): CBOE free delayed chains — ATM IV / skew / term / P/C-OI for SPX+majors. Same start-the-
  # clock rationale as the Deribit collector; no free US chain history exists either.
  deno run --allow-net --allow-env ../scripts/collect-us-options.ts || true
  # VX CURVE COLLECTOR (D-487): settlement endpoint serves only ~current-year, so the curve accrues from 2026-08-23.
  deno run --allow-net --allow-env ../scripts/collect-vx-curve.ts || true
  # BINANCE SENTIMENT COLLECTOR (D-502b): API serves ~30d only — the series accrues from 2026-08-23.
  deno run --allow-net --allow-env ../scripts/collect-binance-sentiment.ts || true
  # CAUSAL ATTRIBUTION ENGINE (D-520 P3): daily force decomposition + measured ignorance per instrument.
  deno run --allow-net --allow-env ../scripts/aegis-attribution.ts > ../data/attribution.log 2> ../data/attribution.err || true
  # PAPER RUNG (D-521): monthly French panel refresh (idempotent) + mark the frozen P2 book. $0 at risk, kill-switch honored.
  ONLY=szmom25,dxwml,dxff3,ni10,ind49,mom10,strev10,ltrev10,op10,inv10 deno run --allow-net --allow-env ../scripts/ingest-french-library.ts > ../data/french-refresh.log 2>&1 || true
  deno run --allow-net --allow-env ../scripts/paper-book.ts > ../data/paper-book.log 2> ../data/paper-book.err || true
  sleep 86400
done
