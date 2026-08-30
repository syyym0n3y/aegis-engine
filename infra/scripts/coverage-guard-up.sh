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
  # TRIAL LEDGER (D-628): grammar-search-deep spent 734,400 trials, read the counter, added its spend in memory, printed
  # an honest ceiling of 5.410 — and never wrote those trials down. Every later run computed 5.337 and believed it. The
  # error is silent, cumulative and ALWAYS PERMISSIVE. Nothing was falsely cleared (max psr_z ever is 3.73) but a control
  # that only holds while nothing is close is not a control. This guard REDs on any ceiling nothing paid for.
  # BENCHMARK LAW (D-636): a spread is not a return until its universe is subtracted. D-630's t -7.37 decomposed to
  # an excess of t -0.46 on a flat cross-section. 69 pre-existing rows claim a return with no decomposition; the guard
  # binds new work and reports that backlog every run rather than amnestying it.
  # TURNOVER LAW (D-656): a per-trade cost is not a cost model — the drag is TURNOVER x COST. D-654 is what the
  # omission costs: EM momentum at +4.2%/yr and t 3.98, passing every structural gate, became -0.63%/yr once turnover
  # was measured at 33.5% one-way monthly. 44 of 45 live return claims did not state it.
  # SCHEMA HONESTY (D-671): three columns in one schema were found lying in a single session — g_liquid holding a
  # constant, n_names counting factor streams where it elsewhere counts stocks, gross_ann holding the NET return on
  # 26.7% of specs. The third broke an audit: D-664 bounded cost exposure by gross/net ratios that are 1.0 by
  # construction for a quarter of the board, certifying as clean the families re-running proved were inflated.
  if ! deno run --allow-net --allow-env ../scripts/schema-honesty-guard.ts; then
    echo "$(date -u +%FT%TZ) SCHEMA HONESTY GUARD RED — a column name promises something its values do not deliver"
  fi
  if ! deno run --allow-net --allow-env ../scripts/turnover-guard.ts; then
    echo "$(date -u +%FT%TZ) TURNOVER GUARD RED — a rebalanced return was claimed without stating how often it trades"
  fi
  if ! deno run --allow-net --allow-env ../scripts/benchmark-guard.ts; then
    echo "$(date -u +%FT%TZ) BENCHMARK GUARD RED — a spread was reported as a return without subtracting its universe"
  fi
  if ! deno run --allow-net --allow-env --allow-read ../scripts/trial-ledger-guard.ts; then
    echo "$(date -u +%FT%TZ) TRIAL LEDGER GUARD RED — a deflation ceiling was reported that no recorded trials paid for"
  fi
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
  # TYPECHECK THE WHOLE SCRIPTS TREE (D-693). `recover-delisted-perps.ts` had a `// plumbing-ok:` waiver written
  # INSIDE a fetch() argument list, which swallowed the closing paren and the .then() into the comment. The file has
  # not parsed since — a script written to recover the delisted-perp cohort was dead the whole time and nothing said
  # so, because nothing typechecked this tree. CLAUDE.md requires `deno check` on supabase/functions only.
  if ! deno check ../scripts/*.ts > /tmp/aegis-typecheck.log 2>&1; then
    echo "$(date -u +%FT%TZ) TYPECHECK RED — a script in scripts/ does not compile: $(grep -m1 -E 'error|TS[0-9]+' /tmp/aegis-typecheck.log | cut -c1-140)"
  fi
  # REGISTRY GUARD (D-682): the guard whose subject is the other guards. A census found 24 guard scripts on disk, 21
  # invoked here, and 17 in the operator's one-command view — so four could go RED daily and never reach a human, which
  # is D-586 recurring inside the fix for D-586. Runs FIRST among the additions because if the registry is inconsistent
  # the other greens are a statement about a subset nobody enumerated.
  if ! deno run --allow-read --allow-env ../scripts/registry-guard.ts; then
    echo "$(date -u +%FT%TZ) REGISTRY GUARD RED — a guard exists that nothing runs; enforcement has become documentation"
  fi
  # INFRA GUARD (D-408, WIRED D-682): the substrate probe. It was written to distinguish "the engine is down, so every
  # conclusion is UNKNOWN" from "we measured a null" — and it had been wired into NOTHING since it was built. The guard
  # that detects a dead substrate was itself dead. Non-fatal here: an outage must be LOUD, not a runner that stops.
  if ! deno run --allow-net --allow-env --allow-run ../scripts/infra-guard.ts; then
    echo "$(date -u +%FT%TZ) INFRA GUARD RED — substrate unreachable; today's conclusions are UNKNOWN, not null"
  fi
  # DRIVER REGISTER (D-716): the per-instrument inventory of observable inputs and whether we hold them. It goes RED
  # only on a BROKEN PROBE — a mistyped column, or an empty filter on a populated table — which is a register bug and
  # the D-641 false-MISSING class, not a market finding. Runs here so a newly-added table with a wrong probe, or a
  # feed that has silently emptied, surfaces as a loud error rather than a quiet "we don't hold it" that becomes a
  # narrated coverage conclusion. The MISSING/DEBT tallies it prints are the standing account of what the stack lacks.
  if ! deno run --allow-net --allow-env ../scripts/driver-register.ts >/dev/null; then
    echo "$(date -u +%FT%TZ) DRIVER REGISTER RED — a driver probe is broken (false-MISSING risk); fix the probe before trusting coverage"
  fi
  # DAEMON DRIFT GUARD (D-719c): a long-lived daemon that started before the last commit to its own script is running
  # code the repo no longer contains — the exact condition that made the discovery daemon print two already-fixed
  # write-failures for an hour (D-719b). The agent-output guard reads LOG age; this reads CODE age. RED lists the pid
  # to kill (launchd KeepAlive respawns it on current source).
  if ! deno run --allow-run --allow-env ../scripts/daemon-drift-guard.ts; then
    echo "$(date -u +%FT%TZ) DAEMON DRIFT GUARD RED — a daemon is running stale code; restart the pid(s) it names"
  fi
  # TRIAL IDEMPOTENCY GUARD (D-681): a clock inside run_key defeats the unique constraint that makes the trial counter
  # idempotent, so a daemon recomputing one identical answer forever also grows the ceiling every result must clear.
  if ! deno run --allow-net --allow-env --allow-read ../scripts/trial-idempotency-guard.ts; then
    echo "$(date -u +%FT%TZ) TRIAL IDEMPOTENCY GUARD RED — a re-test of an unchanged spec is counted as a fresh trial"
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
  # THE FIVE UNOWNED FEEDS (D-715). The continuity guard watched six feeds and only ONE had a refresher the runner
  # actually invoked — the one wired in D-683 after the attribution engine spent a week reporting on frozen data.
  # Three of the other five had already gone stale; the remaining two were fresh by luck. A guard that reports
  # staleness while nothing owns the cause trains everyone to read its red as background noise.
  # Each is idempotent and scoped to the recent gap, so a daily run is cheap and an outage self-heals.
  FROM=$(date -u -v-10d +%F 2>/dev/null || date -u -d '10 days ago' +%F)     PAIRS="EURUSD:1e-5,GBPUSD:1e-5,USDJPY:1e-3,AUDUSD:1e-5,XAUUSD:1e-3,USA500IDXUSD:1e-3,USATECHIDXUSD:1e-3,BRENTCMDUSD:1e-3"     python3 ../scripts/ingest-dukascopy.py > ../data/dukascopy.log 2>&1     || echo "$(date -u +%FT%TZ) FX/INDEX HOURLY REFRESH FAILED — the feed the continuity guard watches has no other owner"
  deno run --allow-net --allow-env ../scripts/ingest-funding-full.ts > ../data/funding.log 2>&1     || echo "$(date -u +%FT%TZ) CRYPTO FUNDING REFRESH FAILED"
  bash ../scripts/ingest-cot-disagg.sh > ../data/cot-disagg.log 2>&1 || echo "$(date -u +%FT%TZ) COT DISAGG REFRESH FAILED"
  bash ../scripts/ingest-cot-tff.sh    > ../data/cot-tff.log    2>&1 || echo "$(date -u +%FT%TZ) COT TFF REFRESH FAILED"
  deno run --allow-net --allow-env ../scripts/ingest-earnings.ts > ../data/earnings.log 2>&1     || echo "$(date -u +%FT%TZ) EARNINGS REFRESH FAILED"
  # EQUITY BREADTH (D-717): recompute the five breadth_* series in-DB from the panel. Idempotent (ON CONFLICT DO
  # UPDATE). Must run AFTER refresh-bars.ts below so breadth reflects the freshest panel — but the recompute reads the
  # whole panel regardless, so ordering only affects same-day freshness, not correctness. Owns the 'equity breadth'
  # feed the continuity guard watches; without this line that feed would red in ten days per the D-715 rule.
  bash ../scripts/refresh-breadth.sh > ../data/breadth.log 2>&1 || echo "$(date -u +%FT%TZ) BREADTH REFRESH FAILED — the continuity-watched breadth feed has no other owner"
  # NQ INTRADAY ACCRUAL (D-709). Yahoo serves NQ=F 1-minute bars for only ~7 days and 5-minute for ~60, and both
  # windows ROLL — a day not fetched is permanently unrecoverable. The cache is append-only and merges on timestamp,
  # so running it daily accumulates a minute history Yahoo itself will not serve twice. This is the data that decides
  # D-708: the NQ Motion Model is UNTESTED only because the intrabar ordering inside the opening hour is unobservable
  # at the resolution held, and one minute bar resolves it.
  deno run --allow-net --allow-env --allow-write --allow-read ../scripts/ingest-nq-yahoo.ts > ../data/nq-intraday.log 2>&1 \
    || echo "$(date -u +%FT%TZ) NQ INTRADAY ACCRUAL FAILED — a rolling window was missed and cannot be refetched"
  # BAR REFRESH (D-683) — MUST PRECEDE THE ATTRIBUTION ENGINE. There was no scheduled ingest for the attribution
  # universe at all: bars were refreshed by hand, last on 2026-08-21, and the engine below ran every morning writing
  # 27 clean rows dated a week earlier while its log said "27 attribution rows written". Fetches only what is stale
  # (~13s when due, ~2s when not), sequentially, from an allowlisted keyless endpoint, and exits RED if any symbol
  # the engine reads is still stale afterwards — success is "the consumer's data is fresh", not "the fetches 200'd".
  deno run --allow-net --allow-env --allow-read ../scripts/refresh-bars.ts > ../data/refresh-bars.log 2> ../data/refresh-bars.err \
    || echo "$(date -u +%FT%TZ) BAR REFRESH RED — the attribution universe is stale; today's decomposition describes a frozen market"
  # CAUSAL ATTRIBUTION ENGINE (D-520 P3): daily force decomposition + measured ignorance per instrument.
  deno run --allow-net --allow-env ../scripts/aegis-attribution.ts > ../data/attribution.log 2> ../data/attribution.err || true
  # PAPER RUNG (D-521): monthly French panel refresh (idempotent) + mark the frozen P2 book. $0 at risk, kill-switch honored.
  ONLY=szmom25,dxwml,dxff3,ni10,ind49,mom10,strev10,ltrev10,op10,inv10 deno run --allow-net --allow-env ../scripts/ingest-french-library.ts > ../data/french-refresh.log 2>&1 || true
  deno run --allow-net --allow-env ../scripts/paper-book.ts > ../data/paper-book.log 2> ../data/paper-book.err || true
  # PRE-COMMITMENT LAW, second half (D-613): the rules table was never SCORED. A registered-but-unscored rule
  # produces the feeling of discipline while leaving the discretion in place. This records an append-only mark per
  # clock and goes RED when one MATURES without a verdict, so maturity cannot pass silently.
  if ! deno run --allow-net --allow-env --allow-read --allow-run ../scripts/forward-scorer.ts; then
    echo "$(date -u +%FT%TZ) FORWARD SCORER RED — a pre-registered clock has matured with no verdict recorded"
  fi
  # W3: spec-specific forward scoring. The D-613 tracker records elapsed time and reds on matured-without-verdict;
  # this computes the statistic each rule actually names, so maturity produces a NUMBER rather than a flag.
  deno run --allow-net --allow-env --allow-read --allow-run ../scripts/forward-score-specs.ts || true
  # CONTINUITY (D-613): a stopped ingest fails silently — old rows remain and every query still answers, from a
  # frozen snapshot. This is the check that the whole board is still being fed.
  if ! deno run --allow-net --allow-env --allow-read --allow-run ../scripts/continuity-guard.ts; then
    echo "$(date -u +%FT%TZ) CONTINUITY GUARD RED — data has stopped arriving or a scheduled job is gone"
  fi
  # MECHANISM LAW (D-597): the other guards inspect a CONCLUSION already in the ledger. D-590 failed one step
  # earlier — in the move from a pooled number to a story about it — and no gate existed there. A causal claim must
  # now cite a pre-registration whose kill condition predates the data, or mark itself DESCRIPTIVE ONLY.
  if ! deno run --allow-net --allow-env ../scripts/mechanism-guard.ts; then
    echo "$(date -u +%FT%TZ) MECHANISM GUARD RED — a causal claim was asserted without a pre-registration"
  fi
  # GAP REGISTER (W2): a gap marked FILLED whose data has gone stale is worse than an unfilled one — it silently
  # licenses conclusions the data no longer supports. Reds only on regressions, reports open engine gaps.
  if ! deno run --allow-net --allow-env ../scripts/gap-register-guard.ts; then
    echo "$(date -u +%FT%TZ) GAP REGISTER RED — a gap marked filled is empty or stale"
  fi
  # D-586: print the cycle summary LAST so the state of the whole suite is the final thing in the log, rather than
  # six RED lines buried mid-file with no reader. This is the line a human actually reads.
  ../scripts/guard-status.sh || true
  sleep 86400
done

