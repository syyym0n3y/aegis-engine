# DEVIATION REGISTER — everything the record planned, queued, or left open, with a verified disposition (D-806, 2026-09-06)

> Operator instruction: "everything we have deviated from needs to be addressed, blocked or unblocked." Every row below was
> checked against LIVE state tonight (a query, a run under the runner's exact line, or the entry's own text), not against a
> doc. Dispositions: **DONE** (verified), **DONE-IN-OTHER-FORM** (the intent is met by something else, named),
> **UNBLOCKED TONIGHT** (was blocked, now held/fixed, with the evidence), **BLOCKED — <barrier>** (named, not "impossible"),
> **OPERATOR** (only the operator can move it), **BY DESIGN** (an invariant, deliberately not moved).

## 1. The original queues (NEXT.md as of 2026-08-14; STAGE1 spec steps 2–9)

| item | disposition | evidence |
|---|---|---|
| Extend the grammar algebra (more triggers, composites) | DONE and CLOSED | 34 triggers by D-331; lane DRAINED at D-342, yield 0/1,023 |
| Corpus ingest loop (operator-fed strategies → grammar → verdict) | DONE-IN-OTHER-FORM | `docs/UPLOAD_REGISTER.md`: every upload (9 reels, 5 MT5 binaries) decomposed and tested (D-77x) |
| Macro enrichment (FRED credit / Sahm / CPI; other economies) | DONE | FRED keyless from the owned node since D-729; 14 currencies' short rates, breakevens, BAA, NFCI in the daily runner |
| Close risk-inventory gaps (slippage, gap-through-stop, fat tail, cross-account, durable kill-switch, reconcile) | PARTLY DONE / BY DESIGN | `trd_kill_switch` holds a durable row (account paper, state armed, 2026-08-24); the rest belong to an order path that does not exist (Stage 1 has no broker route, by invariant) |
| Live real-money bridge | BY DESIGN | held behind the gates; no clock has matured (17 clocks, 0 verdicts) |
| Productionise the APIs (auth, billing, PDF, domain) | OPERATOR | the platform lives on CC's Supabase, which is unpaid (D-408); the engine moved to the owned node |
| Prop-firm pilot (`docs/product/PILOT-propfirm.md`) | SUPERSEDED → OPERATOR | `docs/PROP_FIRM_PLAN.md` (D-796/797/802): priced, −EV for futures props, utc16 alone at 0.5× the only 2026-positive row; ready-to-sign clock; **fee is the operator's decision** |
| 1b. Provision Supabase + apply 0001 | DONE-IN-OTHER-FORM | owned Postgres + PostgREST node (`infra/`), all `trd_*` migrations applied there |
| 2. Congressional ingest + signal | DONE (REJECTED) | tested on real data in the D-070 era: sector beta, priced out (NANC/KRUZ literature); tables never built because the verdict closed it |
| 3. EDGAR Form 3/4/5 + 13F ingest | DONE | `trd_insider` 278k buys (+ 660k sells to a file tonight, D-805); 13F ownership NULL at 13 years (D-499) |
| 4. Prices, delisting-inclusive | DONE with a stated limit | 19,531 equities; delisted cohort filled from Alpaca IEX (D-723/724) — IEX history reaches ~2016–2020, earlier delistings are NOT recoverable there (stated in the register) |
| 5. `trd_features` point-in-time store | SUPERSEDED (0 rows) | D-704: every fundamental read goes through `asOf()`/`ttm()` or `period_end`+lag, enforced by plumbing-guard RULE 4 |
| 6. Backtest engine | DONE | `aegis-factory.ts` + the honest-stats core; every Sharpe carries N |
| 7. Architect gate (default REJECT) | DONE-IN-OTHER-FORM | 29 machine guards; 0 promoted; the gate is the board |
| 8. CC oversight panel | DONE | `cockpit-render.ts` → `data/cockpit.html` (passes its positive control under the runner's exact line tonight: 28/28, live trial count) |
| 9. CI self-test harness | DONE-IN-OTHER-FORM | every guard self-tests (RED/GREEN/exempt), verified by breaking inputs; registry guard keeps the board complete |
| Wyckoff evolutionary track (real-data sim on Alpaca creds) | DONE-IN-OTHER-FORM | grammar + factory searches on the owned panel replaced it; creds exist (`APCA_*`, used by the delisted ingest) |
| TRUE CVD / OI feed (tick data) | BLOCKED — paid (Databento/Polygon/Rithmic) | real taker delta is held for crypto (1h and 1hSF payloads); equities: bar proxies only |
| bbfade forward rows / regime gate / widen stop geometry / HTF variant | DONE and CLOSED | bbfade refuted D-443/452/453; stop geometry became a grammar axis D-305; HTF via the hourly sweeps D-77x |

## 2. The gold-path obstacles (GOLD_PATH §3) — updated

| # | obstacle | disposition |
|---|---|---|
| 1 | wealth ledger EMPTY | OPERATOR — three rows (`ADD_DEPOSIT`, `SET_WRAPPER`, `SET_CCY_LEAK_BP`); nothing more to build |
| 2 | every clock pre-horizon | BY DESIGN — 17 clocks, scorer daily, continuity guard reds on lapse |
| 3 | 2026 crypto regime break unexplained | **DESCRIBED TONIGHT** (`crypto-2026-break.ts`, D-806): the flip is PANEL-WIDE — all 4 constructions, every tier, both funding signs, both BTC-prior signs — and the raw hour-of-day drift profile reshuffles every year (20:00 UTC: +13.7bp t 18 in 2024, −2.1 in 2025, +4.2 in 2026; 21:00 + → −; 01:00 + → −). The clocks were registered on a seasonality that was already unstable between 2024 and 2025. DESCRIPTIVE ONLY; no mechanism claimed |
| 4 | clock #18 weak in calm regimes | BY DESIGN — immutable rule; v2 only after this clock ends |
| 5 | prop decision | CLOCK SIGNED + REGISTERED (D-807); the FEE remains OPERATOR |
| 6 | dark data spaces | **MOSTLY UNBLOCKED** — see §3 |
| 7 | reliability debt | **CLOSED** — see §4 |
| 8 | decisions drifting to research-for-its-own-sake | DONE — decisions guard (D-804) |

## 3. Data barriers — re-verified against the register and the tables

| driver | old label | live state tonight |
|---|---|---|
| borrow fee / availability | "IBKR FTP blocked" (my memory note) | **HELD** — iBorrowDesk, 212 names, 113k rows, fresh to 09-04, in the runner (the register was right; the note was stale — corrected) |
| dealer gamma | "all-NULL table" | **UNBLOCKED TONIGHT** — naive gamma exposure per underlying from CBOE free chains, 20 underlyings daily (`trd_perp_oi` venue cboe, interval `naive_gex_usd`; SPX $30.7bn per 1% move); register 47 HELD / 4 blocked (was 45 / 6) |
| per-strike equity option OI | "gap" | HELD for 20 underlyings (aggregates + naive GEX daily); options-pressure HISTORY now HELD: CBOE daily put/call ratios 2020→ (`ingest-cboe-putcall.ts`, D-809); full-universe surface BLOCKED — paid |
| delisted equity cohort | "27.3% missing" | FILLED to IEX's limit (D-723/724); pre-2016 delistings BLOCKED — no free source found |
| crypto delisted cohort | "no reachable endpoint enumerates it" (D-639) | **UNBLOCKED TONIGHT** — `data.binance.vision` allowlisted (operator-authorized free host): 874 USDT-M contracts ever = 510 held + 352 currently listed under the 400-day threshold + **12 delisted**; 2 had usable history and are ingested (BLUEBIRD, FOOTBALL), 10 have <400 usable bars (recorded, not written). The cohort is CLOSED with a coverage statement |
| L2 order-book depth | OFF (2026-09-05) → requested (2026-09-06) | **CRYPTO HELD** (D-808): Binance mirror per-minute depth bands ±1–5%, positioning/OI/taker metrics, 5-min taker klines, BTC/ETH/SOL 2023→; tested SUB-FEE. **FX footprint: BUILT (D-811)** from Dukascopy tick side-volume, EURUSD/XAUUSD 2026-03→, pre-registered. **Equities L2: BLOCKED — paid** |
| earnings revisions | licensed | BLOCKED — paid |
| central-bank reserves | quarterly, lagged | BLOCKED — cadence (explanatory only) |
| gold options surface | paid | BLOCKED — paid |

## 4. Reliability debt — closed or honestly left

| item | disposition |
|---|---|
| cockpit-render positive control | PASSES under the runner's exact line (28/28 shown, 29 on disk with 1 declared exemption, live trial count) — the earlier failure was the board-count mismatch of the night the 28th guard landed |
| `refresh-bars.ts` writes bars only | FIXED (writes first/last_date, n_bars, updated_at) + `backfill-bars-metadata.ts` corrected 32 stale consumer rows (SPY last_date 08-28 → 09-04). Non-consumer, non-decile names keep stale metadata; scope stated, no consumer reads it |
| transient RED ~1 min after kickstart | NOT REPRODUCED in two controlled attempts; recorded as unreproduced |
| PostgREST restarts under panel reads (15 starts; RED-in-loop/GREEN-on-board) | **CAUSE ESTABLISHED (D-812):** kernel OOM kill (signal 9) of the Postgres backend building a whole-panel jsonb response in a 3.8GB Docker VM at 2.84GB; the idle `supabase_*_aegis` stack stopped (−940MB, volumes kept); `rest-restart-guard.ts` prints the killed statement; rule: page ≤ 25 symbols, never a whole panel |
| `wealth-ledger.ts` "18 clocks" literal | FIXED (live count, D-804) |
| permissions class (D-801) | GUARDED (D-803) |
| decisions without a mechanism line | GUARDED (D-804) |

## 5. Still open, and whose it is

- **OPERATOR:** the prop FEE (clock registered D-807; ledger via `scripts/prop-ledger.ts`) · three wealth-ledger rows · CC Supabase invoices (cockpit/platform only) · capital beyond the current budget.
- **BLOCKED — paid, now PRICED (D-815, `docs/PAID_DATA_PLAN.md`):** equity tick/L2 (Databento $125 free credit, then per GB) · options surface (Theta Options Value $40/mo) · earnings revisions (EODHD €59.99/mo) · gold options (inside the options surface). Operator's purchase; tests pre-registered before the first byte.
- **BLOCKED — no source found:** pre-2016 delisted equity history.
- **BY DESIGN:** real-money bridge · clock rules · the calm-regime weakness of clock #18.
- **RESEARCH (unblocked, $0):** nothing queued — the D-804 queue is closed (D-805), the break is described (D-806), and the operator's order-flow/confluence stack is measured (D-808/809: 7 pre-registrations, 7 retractions). Registered forward test: index/Deribit options positioning at ≥ 250 daily points. New leads enter only with a PREREG.
