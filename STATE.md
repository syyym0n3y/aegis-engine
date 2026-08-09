# STATE — Aegis (live state)

## Last updated
**2026-08-08 (Opus 4.8) — ANOMALY SPACE EXHAUSTED: 7 setup edges + 3 factor premia; live app at 7 (D-210…214).**
Term-structure roll (6th, USCI Sharpe 0.37 vs naive 0.02, roll drag 7-13%/yr) + cross-sectional momentum (7th, t=2.61)
added. Documented factors confirmed via ETFs: momentum/quality/min-vol REAL (corrects D-212 low-vol mega-cap artifact);
value/size decayed. Rejected: TS-momentum, pre-FOMC (decayed t=1.14), seasonality, lead-lag, carry. PEAD RUN (D-215, inconclusive on 1yr free Nasdaq data — fails magnitude signature; deep 20yr test needs keyed feed).
**7 discrete edges: rip-short · bbfade_lo/bear · crypto momentum · VRP · pairs/stat-arb · term-structure roll ·
cross-sectional momentum. + factor book (momentum/quality/min-vol).** Live app deployed at 7 edges via git pipeline
(github syyym0n3y/aegis-engine → aegis-engine-psi.vercel.app, dpl 6c87287 READY). Pattern definitive: risk premia +
conditioned technicals survive, folklore dies. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — QUEUE COMPLETE: FIVE verified edge families + live app deployed (D-208/209).** Research
queue run: seasonality REJECTED (arbitraged out), pairs/stat-arb VERIFIED (5th edge — market-neutral spread reversion,
24/24 pairs net-positive both-halves at pessimistic cost), lead-lag REJECTED (0/16), carry REJECTED (DBV Sharpe 0.03),
term-structure = VRP (no new edge). **FIVE verified edges: rip-short · bbfade_lo/bear · crypto momentum · variance
risk premium (options) · pairs/stat-arb.** Everything else rejects. LIVE APP DEPLOYED via git pipeline: github
syyym0n3y/aegis-engine main ← merged content commits (a6a455b 4-edges, a62a333 5-edges); Vercel auto-deployed to
aegis-engine-psi.vercel.app (dpl READY, tools intact, your 8 commits preserved). Remote `origin` now configured here.
↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — FOUR verified edge families + options wall OVERCOME + merged to main (D-206/207).** Framework
grid completed (weekly+4h, D-206): commodity momentum leans on weekly, nothing else new. OPTIONS now testable for free
(D-207): variance risk premium is real at every horizon/asset (implied>realized 80-87%), and CBOE's 34yr option-selling
indices (PutWrite/BuyWrite) beat SPY risk-adjusted (Sharpe 0.71/0.61 vs 0.55) — a 4th edge family (variance-premium
harvest, crash-gated). Overnight-drift anomaly tested (real for ETFs +10.3% vs +0.7% intraday, cost-gated). **Verified
edge families = 4: rip-short · bbfade_lo/bear · crypto momentum · variance-risk-premium (option-selling).** Research arc
D-146→D-207 MERGED to main (537e217) — main now holds all research + the updated live app (web/aegis-app/index.html,
3-edges content, checksum 7d3124d6; deploys via Vercel git pipeline on push to main). NEXT research agenda (queued, not
blocked): pairs/cointegration, seasonality, carry, term-structure roll-yield. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — THREE verified edges + the capped-stop survivorship principle (D-202…D-205).** Operator
caught a real bias (SPY-regime imposed on all assets + pooling dictating individuals); de-biased to per-instrument-own-
regime + count-inference (D-202). All timeframes tested (D-204, 5m→1h ladder): cost wall kills PROFIT not SKILL (5m
mean-rev beats random but nets negative; edges daily-locked). Crypto momentum survivorship-STRESSED (D-205): holds on
coins that cratered 54–100% (p=1.4e-10) → **the 1R-capped stop is STRUCTURALLY survivorship-proof in ANY direction**
(corrects my over-caution). **Verified tradeable set = 3: rip-short (equity daily, p=1e-7) · bbfade_lo/bear (equity
daily) · crypto momentum (daily Donchian-L, survivorship-checked; also 1h net+0.05R).** Crypto=momentum, equities=mean-
reversion (opposite). Status artifact: claude.ai/code/artifact/0874b850-4772-489b-9fbf-6e3aad33d34f. Live app is on
Vercel: aegis-engine-psi.vercel.app. Residual limiter: fully-delisted-to-zero names untestable free, but capped-stop
bounds that exposure structurally. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — COMPLETE MULTI-ASSET PICTURE (D-200/201).** Built the per-instance "trade the chart" engine
(`trd-instances.ts`, D-200): 240 instances/8 charts → 0 survive program-wide deflation — per-instance is the DEPLOYMENT
model (=trd_forward), a false-positive factory as naive discovery. Then the COMPLETE SWEEP (`trd-complete.ts`, D-201):
154 instruments × 9 asset classes (equities mega/mid/battered, sector+intl ETFs, commodities, FX, crypto, rates) × 6
setups, gated+deflated+both-halves. Funnel 132 cells→32 raw→10 deflated→**4 robust (all rip-short**, now proven across
cap tiers incl the battered tail, both-halves stable = capped-short survivorship-immunity confirmed). Crypto momentum
t=6.17 EXPOSED as survivorship/era mirage (both-halves half-flip) — the trap the gate caught. One new lead: etf-intl
donch_L/bear (t=4.43, both-halves ✓, needs survivorship-free check). Updated status artifact:
claude.ai/code/artifact/0874b850-4772-489b-9fbf-6e3aad33d34f. Thesis CONFIRMED not overturned: across the whole tested
market, ONE edge family (rip-short) clears every honest filter. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — BOTH edges wired + verified dormant-by-market (D-197…D-199).** Two survivorship-checked
edges now run live on the $0 virtual forward tracker (cron 6h): rip-short (bull-regime short) + bbfade_lo/bear
(bear-regime long, D-197 — edge GROWS on a battered universe, opposite of dip-buy's mirage; 8 legs registered,
detector extended with band-mode + SPY-bear regime gate, 9/9 tests green). Demo BROKER (Alpaca paper) executor
deployed DORMANT (arm=false, killswitch=false) + owner-run `scripts/demo-exec.sh` {status|arm|disarm|kill|tick|forward}
— Claude does NOT arm; one operator command goes live. VERIFIED (D-199): 0 forward trades = honest scarcity — 9/10
rip-short names above their 200MA in this bull tape, so the overbought-in-downtrend signal cannot fire; bbfade needs
SPY<200MA. Both edges dormant-BY-MARKET; arming now places 0 trades (correct, D-070). Next signal comes from the
MARKET (a regime that offers a setup) or the operator arming demo — NOT more backtests. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — AUGMENTATION program CLOSED + 3rd social decode (D-193…D-196).** Confluence question fully
answered: it does NOT help — correlated (D-194) OR orthogonal (D-195, zero incremental lift; stacking stress axes is
net-negative → selects bear regime). rip-short's "when" = one regime filter (bull+high-vol), not a stack. DECODED
Trades By Sci (@tradesbysci, 539k subs, $199 course): 6/6 method pillars (S&D, liquidity, market-structure/BOS,
order-blocks/FVG, trend, "no-trade-until-break") all land in already-falsified space; the exact demand-zone gold long
(`scripts/trd-gold-sr.ts`) = random (+0.25R setupR is pure gold drift, NEGATIVE edge in its own downtrend regime); the
$8.5M panel = drift×leverage (260% margin level), not edge. `DECODE_tradesbysci.md` + `AUGMENTATION.md` are the
deliverables. Tests are FINISHED (only untested lever = a non-stress orthogonal axis e.g. flow/positioning — no free
source in hand). $0, no order path touched. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — PIVOT to AUGMENTATION (D-193/194).** Engine reframed from "falsify" to "tell the trader
when/what/which-regime." Two builds: (1) the PRECISE 7-step ICT composition (`trd-alpaca-ict`, ~4,800 setups on
GLD/SLV/SPY/QQQ) is REJECTED and *worse than random* (t=−3 to −7) — FVG/BOS confirmation makes you enter late, after
the reversion is spent. (2) The AUGMENTATION MAP (`scripts/trd-augment.ts`, `AUGMENTATION.md`) gates each family per
regime×vol cell, deflated: **regime-conditioning works** (rip-short +0.057R→+0.109R restricted to high-vol bull);
**confluence-stacking FAILS** (correlated setups agreeing = weaker, not stronger — redundant confirmation destroys
power); **two falsified families hold a conditional edge** (Bollinger-fade-LONG in bear = deflated +0.078R t=3.69
n=7,230; dip-buy in bear/stress = +0.215R raw t=2.24, promising-not-proven). bbfade_lo/bear = new forward candidate.
$0, no order path touched. ↓ prior program-complete status stands underneath. ↓

**2026-08-08 (Opus 5) — PROGRAM COMPLETE: every PLAYBOOK gap closed; ONE edge fully characterized (D-146…D-192).**
Exhaustive falsification done end-to-end for $0. THE ANSWER: exactly one edge survives every test —
**rip-short** (short RSI>70 while <200MA), a SMALL BULL-REGIME mean-reversion short on liquid equities (D-179
t=7.23; survives program-wide deflation to N=100k, D-191), corroborated independently on crypto 5m (D-170). Its
full deployment envelope is now known: **liquid + easy-to-borrow names, SPY>200MA regime only, small size,
hedged/market-neutral** (standalone short book = 32% DD from bear squeezes, D-189/191; slippage-robust to ~28bp
and liquids 100% ETB, D-190). **dip-buy** hourly FAILS program-wide deflation → false positive (D-191, demoted).
Everything momentum / breakout / cross-sectional reversal (D-188) / minute (D-187) is DEAD. Gaps all closed:
fills+capacity (D-190), concurrency (D-189), regime (D-191), cross-sectional (D-188), look-ahead + crypto-
survivorship (D-192). Forward paper: 24 candidates live, borrow-modeled (D-185), cron 6h. Real-fills path built
DORMANT (`trd-alpaca-paper-exec`, armed-OFF via trd_exec_arm; kill-switch+regime+ETB+heat gated) — operator arms
it to cross into execution; Claude does not. Free-solution map exercised (Alpaca minute, Dukascopy, Stooq
allowlisted). PLAYBOOK.md = the transferable buy/sell patterns. 234 TS + 3 Py tests green. $0 spent, no order
placed. Next signal comes from TIME (forward clocks / arming the paper executor), not more backtests.

## Prior
**2026-08-08 (Opus 5) — MULTI-TIMEFRAME SWEEP COMPLETE + 2 SURVIVORS IN FORWARD PAPER (D-170…D-186).** The LEAN+gate
port (D-174) ran the survivorship-free US-equity universe across DAILY (top-500), HOUR (top-200) and attempted
MINUTE (free-node ceiling, D-181), plus BTC/ETH crypto and all intraday SESSIONS (D-170) — every gate: random-
control (D-146) + Bonferroni deflation + both-halves + real borrow. **Two timeframe-locked mean-reversion edges
survived, both now in forward paper (24 candidates, $0, no order path, cron 6h):**
  • **rip-short** (RSI>70 & <200MA, short) — DAILY equities (D-179, t=7.23) AND crypto 5m (D-170, t=8.07). Robustness
    D-184: sign-robust 39/54 variants, PBO 40% (NOT overfit) — a real but SMALL cross-sectional/breadth edge; trade
    wide-and-thin, never concentrated. THE stronger survivor. Forward: 10 per-symbol legs + crypto legs.
  • **dip-buy** (RSI<30 & >200MA, long) — HOURLY equities (D-180, t=3.73, modest). Robustness D-186: FRAGILE out-of-
    window (17/54 positive on recent 2y) → regime-suspect, LOW confidence. Weak link; in forward paper but do not size.
Everything momentum/breakout is DEAD at every timeframe. Survivorship bias was the source of the curated-data false
positives (D-176/177). Borrow now modeled in the tracker (D-185, v2). Free-solution map for every "paid" frontier in
FREE_SOLUTIONS.md — minute-universe (local LEAN + Alpaca-free/Dukascopy), futures/FX (Dukascopy), global (Stooq,
survivorship-biased-but-quantified); the only remaining steps are operator-gated CREDENTIALS (Alpaca key / Dukascopy
endpoint), not effort. Promotion gate unchanged: >=30 forward trades, positive mean consistent with in-sample, before
micro. 234 TS + 3 Py tests green. $0 spent this entire arc.

## Prior
**2026-08-07 (Opus 4.8) — FORWARD PAPER LIVE for the first-ever gate survivor (D-171).** The D-170 full sweep (92 cells across NASDAQ/S&P500/BTC/ETH × 5 TFs × sessions × long/short, each vs its own random control) found exactly ONE survivor of random-control + trial-deflation + both-halves + walk-forward OOS: **BTC/5m mean-reversion short** (t=8.07; OOS +0.29R/t4.7; real at ≤5bp/side, dead at 10bp retail spot). It is now under autonomous forward PAPER: migration `0013_trd_forward_paper.sql` (general registry `trd_forward` + append-only ledger `trd_forward_trade` + rollup `trd_forward_state`), edge fn `trd-forward-tick` (kill-switch-gated, Yahoo feed, keyless, verify_jwt=false), cron `trd-forward-forward` @ 43 */6 (jobid 24). Seeded with the survivor + two near-miss controls (eth-5m-short, btc-5m-long) so "all instruments/TFs considered" is a one-row insert and the controls falsify our deflation threshold. Verified live end-to-end: append-only trigger blocks DELETE, idempotency holds (probe 11 trades → re-tick N=11), ledger clean, forward clock started 2026-08-07. Promotion gate: ≥30 forward trades + positive mean consistent with in-sample, ≤5bp exec — still behind every LADDER rung. $0, no order path. Operator surface: `scripts/trd-forward-status.sh`. 234 tests green.

## Prior
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
