# STATE — Aegis (live state)

## Last updated
**2026-08-04 (Opus 4.8) — FRONTIER COMPLETE + SYSTEM AUTONOMOUS (D-086…D-093).** The full edge-lens map is swept and the system runs without the operator. **Live public app:** https://syyym0n3y.github.io/aegis-engine/ (GitHub Pages — Vercel create-project is 403-blocked on the operator's role; Supabase edge fns force text/plain so can't serve browser HTML — both worked around, D-086/087). Tabbed SPA: live cockpit + Risk-Xray + Authenticity + Allocator, verified in-browser, CORS-open APIs. **5 autonomous edge fns, all healthy + cronned:** trd-paper-tick (6h), trd-macro-pump (4×/day), trd-prereg-tick (6h), trd-tbr-tick (weekdays 21:00), trd-squeeze-tick (daily 01:30). **3 pre-registered forward hypotheses** (all $0 real money, forward-testing, on the app): btc-sweep-rr3-v1, gold-tbr-v1, btc-squeeze-v1 — all high-RR crypto/Gold vol-liquidity events. **Edge-lens taxonomy (R-003) COMPLETE:** 12 lenses + COT tested (D-090…D-093) — cross-sectional(weak), calendar(dead), event/pre-FOMC(dead, arbitraged away), intermarket(dead), funding(thin), order-flow/CVD(dead via FREE binance klines → paying for tick NOT justified), vol-regime(clustering validates risk-layer + BTC squeeze lead), COT positioning(folklore, no tradeable edge). **Corpus (trd_strategies): 12 rows, 4 hard-DEAD, 0 tradeable survivors.** Cross-cutting law proven across every dimension: the edge is slow factor-premia + risk management; everything fast/directional/anomaly is efficiently priced. Sizing doctrine locked (operating-principle-domination memory): factor book unlevered sized to drawdown tolerance (10% dd → ~33% investable); strategies $0 until forward-clear, ~1% per trade never 10%.

## Prior
**2026-08-04 (Opus 4.8) — PRE-REGISTERED HYPOTHESIS + MACRO CORRELATION (D-083/D-084).** Universe sweep (D-083): 4,320 strategies × 20 markets × 3 timeframes × 8 regimes = **1,010,539 conditional cells over 419,725 real bars → 0 clear DSR** (the mechanical retail genre has no deflation-surviving edge across the tradeable universe; only the global factor book D-077 ever cleared). The one robust lead (BTC 15m liquidity-sweep, EMA20, wide 3:1 targets) is now FROZEN as a pre-registered hypothesis (`trd_prereg` `btc-sweep-rr3-v1`) with an autonomous forward tracker (`trd-prereg-tick`, cron 6h) that counts ONLY post-registration trades → a single un-deflated trial. Honest baseline: its unconditional 60d expectancy is −0.057R (the big numbers were cherry-picked cells); forward test settles it at n≥30. Macro correlation (D-084): chart edges have **near-zero correlation with VIX/yield-curve**; concrete tie found — BTC-sweep degrades when the curve inverts (+0.13R→−0.60R), recorded as its deployment gate. `scripts/trd-refine.sh` reproduces every calculation in one command. `trd_goldmine` persists top candidates. Grammar = 8 trigger classes; 131 tests green.

## Prior
**2026-08-03 (Opus 4.8) — STRATEGY ALGEBRA + MASS SEARCH (D-081).** Aegis can now assess strategies at scale AND falsify them honestly. `_shared/trd-grammar.ts` = a component algebra (trigger × EMA × trend × stop × RR × session = 2160 composed strategies; 4 trigger classes: sweep/fvg/breakout/pullback). `scripts/trd-strategy-search.ts` runs all 2160 × 4 real markets (Gold/BTC/ETH/S&P, keyless Yahoo 15m) and deflates via the existing `deflatedSharpe`(by trial count)+PBO core. Live result: 8,640 trials → 1,613 positive in-sample → 662 positive OOS → **0 clear DSR** (all multiple-testing artifacts; best survivor DSR 63%). Also D-080: faithfully implemented + **falsified** the viral "XAU 15m liquidity-grab 76.53% win" claim (real gold: 44% win, −0.192R, t=−3.34). CC `trd_strategies` corpus table catalogs each assessed strategy + verdict (seeded D-080/D-081). 131 tests green. Honest lead: sweep+rr3+London on crypto is least-overfit (still fails DSR). Bulk YouTube ingest remains gated; scalable path is the grammar (feed strategy → decompose → already in the search space).

## Prior
**2026-08-03 (Opus 4.8) — MACRO-REGIME OVERLAY LIVE (D-079).** Added the top-down layer the platform lacked: `_shared/trd-macro.ts` classifies where an economy sits in its cycle (EXPANSION→LATE_CYCLE→CONTRACTION→RECOVERY) from point-in-time yield-curve / credit / Sahm-unemployment / PMI / vol signals and emits a de-risk MULTIPLIER (0,1] that ONLY shrinks size when the regime is fragile — never predicts direction (macro = fragility, not forecasting; see D-079). Wired LIVE + autonomous, $0/keyless: `trd-macro-pump` (Yahoo curve+vol, since FRED's CDN blocks the Supabase datacenter) → `trd_macro_state` → `trd-paper-tick` throttles every order by the factor → `aegis-cockpit` shows the cycle + de-risk + honest "what to expect". `pg_cron` runs the pump 4×/day, 5 min before each 6h bot tick. Current read: curve +0.99pp, VIX 28th pct → EXPANSION, de-risk 1.0 (overlay a no-op in today's calm tape). 125 tests green; edge-fn deps are now symlinks to the tested `_shared` modules (repo == tested == deployed). Best-effort FRED enrichment (credit/unemployment/CPI) via `scripts/trd-macro-refresh.ts`.

## Prior
**2026-08-03 (Opus 4.8) — PLATFORM SHIPPED (D-078). The full product is built, tested (119/119 green), and LIVE.** Nine engine modules in `supabase/functions/_shared/` — Verify, Protect, Allocate, Normalize, Platform, Uplift, Firewall, Setups, Bot, Paper-Broker — wired into live edge-fn APIs (`trd-api-verify/protect/allocate`, `trd-platform`) + a **public web tool** (`web/aegis-terminal.html`, served at `glzz…supabase.co/functions/v1/aegis-terminal` — client-side, any broker, free). Migration `0003_trd_platform.sql`. Proven end-to-end on real data: the risk firewall KEEPS accounts alive even trading a losing strategy (BTC 15m paper sim: −10%/1.6y but 11% maxDD, no ruin); the adaptive allocator COMPOUNDS when a real edge is in the pool (capstone: 100% weight on the global factor book → 30.8×/36y, Sharpe 1.13). Global factor validation (free Fama-French, D-077) is the compounding engine — a diversified risk-premia book, NOT chart signals (all falsified across D-071..D-077). Data pipelines (`trd-fetch-ff`, `trd-ingest-daily/alpaca/edgar-fund`) + scratch tables on **command-centre (glzz)** — trd_* isolation deferred (2-free-project cost limit). OPEN: teardown of temp research probe fns (no MCP delete → dashboard); branded domain; auth/billing; close risk-inventory gaps (slippage/gap/fat-tail/reconcile). Live broker execution stays paper-first behind the gates.

## Prior (2026-06-07 (Opus 4.8 [1m]) — D-072 SECOND POND PASS: ~16/16 securities strategies rejected; the real edge is the operator's OWN creator business (Pond H), not a trade. Barbell direction: Ireland-UCITS index core (US-situs estate-tax trap is LETHAL for a SA national) + ISA/SIPP tax wrapper (highest-certainty edge) + tiny finite UK-trust-discount tilt + BUILD the creator substrate (unmonetized on the visa; Graduate Route before 31 Dec 2026, then monetize). Aegis pivots: alpha-finder → folklore-falsifier + core-protector. (D-071: first pass, 3/3 real-data kills incl. 18yr trend.) 42 tests, $0.**

## Where we are
- New CC vertical **Aegis**, own repo `/Users/ona/Projects/aegis`. D-070 locked.
  Target re-anchored to "prove a real positive edge net of costs, then scale only
  what's proven" (operator-confirmed).
- **Provisioning: $0 LOCAL-DEV — DB IS UP.** Docker wasn't installed → installed
  **Colima** (free FOSS runtime, `brew install colima docker`; analytics disabled
  in `config.toml` for the Colima docker.sock quirk). `supabase start` runs the
  local stack; **`0001` applied + VERIFIED on live Postgres** (12 tables;
  append-only UPDATE/DELETE both raise; idempotency dup→unique-violation,
  on-conflict→no-op; 4 gate thresholds seeded). **Nothing billed.** Cloud ($10/mo,
  always-on) still required before any real autonomy — local is laptop-only dev.
  Stop the stack with `supabase stop` + `colima stop` (a VM runs while up).
- **Built + verified this session (30 unit tests green, `deno check` clean, all offline, $0):**
  - Honest-stats core (`_shared/trd-stats.ts`): PSR / **Deflated Sharpe** / MinTRL /
    **PBO-via-CSCV** + Sharpe/Sortino/maxDD/Calmar + erf/normalCdf/invNorm.
  - **Backtest core (`_shared/trd-backtest-core.ts`):** OLS factor decomposition
    with per-coef **t-stats** (residual alpha must be statistically SIGNIFICANT,
    not just positive), expanding walk-forward, and the REJECT-by-default gate.
  - **Strategy interpreter + orchestrator (`_shared/trd-strategy.ts`):** declarative
    JSON specs (universe/signal/sizing), point-in-time decision loop (asOf INSIDE
    the loop), bar-N+1 fills, turnover cost, idempotent content-addressed runKey.
  - **Runtime self-test (`_shared/trd-selftest.ts`):** proves the engine still kills
    bad strategies (overfit→PBO, noise→reject, look-ahead→blocked, **congressional
    copycat→unmasked as sector beta & REJECTED**) — the eventual `agent-trd-backtest`
    refuses to run if it fails. **This IS the D-070 Stage-1 success metric, demonstrated.**
  - Pessimistic cost model + point-in-time (look-ahead-fail-closed) modules + tests.
  - `0001_trd_substrate.sql` — 12 `trd_*` tables incl. `trd_manual_trades`
    (manual log), `trd_gate_thresholds` (decision-locked), price-revision
    bitemporality. Append-only triggers + RLS + seeded thresholds. **Written, not
    yet applied** (needs local Docker or the cloud project).
  - Governance: CLAUDE.md, DECISIONS.md (D-070 + adversarial addendum), LADDER.md,
    RISK_POLICY.md, docs/trd/STAGE1.md. Committed (`8291225` + rebrand/backtest-core).
- Design hardened by an 8-agent research+adversarial workflow (`wf_720b2865-2f3`);
  both verify passes returned **sound-with-fixes**; all fixes folded into D-070.

## Stage-1 pipeline — DONE + verified on real data (operator-owned CLIs)
`./scripts/trd-ingest-edgar.ts [YYYYMMDD] [limit]` → `./scripts/trd-build-features.ts`
→ `./scripts/trd-backtest.ts` (self-test gate + persists verdict) → `./scripts/trd-report.ts`.
Proven: 28 real Form-4s → 18 PIT features → copycat REJECTED (r2=0.96, β=0.85,
residual-α t=−0.85). The honest engine, on live data, $0.

## Next moves
The insider cluster-buy backtest is BUILT + executes (`./scripts/trd-insider-backtest.ts`)
but reports INSUFFICIENT DATA — it needs two inputs:
1. **Real prices (OPERATOR, 2 min):** Stooq is dead (JS anti-bot). Create a free
   Alpaca PAPER account (no money) → `APCA_API_KEY_ID/SECRET` → `./scripts/trd-ingest-prices.ts`.
   (Or authorize a different free feed — Yahoo chart API — for the allowlist.)
2. **Buy-event backfill (CLAUDE, free/slow):** our 1-day EDGAR sample had 0
   open-market buys (they're rare). Run `./scripts/trd-ingest-edgar.ts` over ~10-15
   recent days to surface real cluster-buys → rebuild features → real signal.
3. Then: run `trd-insider-backtest` → real verdict (expect REJECTED — small n / no
   significant edge — the honest likely outcome).
4. **Hosted path (cloud-time, deferred — NOT half-built):** thin `agent-trd-*` edge-fn
   wrappers + `cc-trd-report` CC panel + CI `runSelfTest()` ratchet — only matter once
   the $10/mo cloud project exists. Congress ingestion deferred (House PTRs are messy
   PDFs; EDGAR/Form-4 is the cleaner + stronger signal).

## Blocked on operator (free actions / config)
- ✅ ~~Start Docker~~ — Colima installed + local DB up + `0001` verified.
- ✅ ~~Allowlist the 4 legal data-source endpoints~~ — added (House/Senate/SEC/Alpaca).
- **Alpaca paper** account → creds for Vault `cc_trd_alpaca_paper_*` (free, paper only).
  Needed only for `agent-trd-ingest-prices`; congress + EDGAR ingestion don't need it.
- (Later) cloud project for always-on autonomy; broker/budget/475(f) for real money.
- Sign off / amend gate thresholds (D-070 seeds) via a decision-ref row (optional).
- (Later, real-money only) broker choice, R&D budget $ for MICRO/SMALL, IRS
  475(f) timing — flagged in D-070, not blocking Stage 1.

## Parallel track (the financier)
YGS finance channel (honest "we tried to copy Congress, here's why it fails, with
receipts" + the REJECTED list) — funds the R&D budget. Audience → trading, never
reverse. Not yet started; lives in the YGS/CC substrate, consumes
`trd_backtest_runs` as content input.
