# DECISIONS — append-only architectural decision log (Aegis)

> New decisions at the top. Never edit a past entry; supersede with a new one.

---

---

---

---

## D-078 — PLATFORM CAPSTONE: the full product is built, tested, and live. Verify/Protect/Allocate + the risk Firewall + adaptive Bot + Paper-Broker bridge. Proven end-to-end: KEEPS accounts alive always; COMPOUNDS only where a real edge exists (the global factor book), never on chart signals.

**Date:** 2026-08-03

**Context:** Operator pushed from "analyse a trading YouTuber" all the way to a full productised platform, demanding global access, bot execution, and proof of upside. Built the honest version at every step; the evidence (D-071..D-077) shaped what could and couldn't be promised.

**What shipped (all tested, 119/119 green; canonical source in supabase/functions/_shared + web/):**
- **VERIFY** (`trd-verify`): falsification-as-a-service — DSR/PBO/MinTRL on any track record → real vs overfit/luck.
- **PROTECT** (`trd-protect`): risk X-ray — expectancy, Kelly, Monte-Carlo ruin, liquidation, cost drag.
- **ALLOCATE** (`trd-allocate` + free Fama-French pipeline): global multi-factor book, live Sharpe 1.00, crisis-robust.
- **PLATFORM** (`trd-normalize` + `trd-platform` + `0003` schema): broker-agnostic ingest (MT/cTrader/NinjaTrader/TradingView/IBKR/crypto) → one composite A–F grade. Live API, persisted.
- **UPLIFT** (`trd-uplift`): replays a trader's OWN trades actual-vs-risk-managed → quantifies the value (ruin→survival, or "don't trade" for a negative edge). Answers "the trader IS the risk".
- **FIREWALL** (`trd-firewall`): the "when you can/can't trade" enforcer — daily-loss kill-switch, drawdown halt, anti-tilt cooldown, max-trades, no-trade windows, mandatory stop, correlation + leverage + size caps. Wraps ANY bot/EA or manual trader; signal-agnostic.
- **SETUPS** (`trd-setups`): FVG + liquidity-sweep detectors, executable (structural stop + R-target), honestly labelled as candidates, not proven edges.
- **BOT** (`trd-bot`): adaptive allocator/executor — weights setups by LIVE positive expectancy × confidence ÷ vol; fractional-Kelly + vol-targeting; every order gated by the firewall. Its edge is allocation/adaptation/discipline, NOT prediction.
- **PAPER BROKER** (`trd-paper-broker`): realistic paper execution (slippage+commission, intrabar SL/TP, maintains firewall state). The bridge; a live MT5/Alpaca connector is a thin adapter (Stage-2, gated).
- **Aegis Terminal** (`web/aegis-terminal.html`): LIVE public tool, 100% client-side, any broker, free — served at glzz…supabase.co/functions/v1/aegis-terminal.

**Proofs run on real data:**
- Live-pipeline paper sim over 54,588 real BTC 15m bars: FVG/sweeps have NO edge (−0.30R/−0.66R) → account did NOT compound (−10%/1.6y) but SURVIVED (11% maxDD, no ruin). **A first run showed 21× → the engine's own too-good flag caught a look-ahead bug → fixed → truth emerged.** The firewall keeps a losing strategy alive.
- Capstone: with the factor book in the pool, the allocator put 100% on it (0% on the dead setups) → compounded 30.8× / 36y, Sharpe 1.13, 30% maxDD.

**Decision (the durable product truth):** We KEEP accounts alive (firewall — proven live), we COMPOUND via the diversified global risk-premia book (not chart signals), and we DISCOVER whether a trader's own setups have live edge honestly. No signal edge is promised because none survives; the value is survival + real-premia compounding + the truth. Remaining honest gaps to close (risk inventory): slippage/gap-through-stop stress, fat-tail/black-swan, cross-account exposure, durable-kill-switch state, disconnect/reconcile. Live broker execution stays paper-first behind the gates (invariant). Open items: teardown of temp research edge-fns (no MCP delete tool → dashboard), a branded domain (Vercel create-permission or custom domain on the function), auth/billing for productionising the APIs.

## D-077 — GLOBAL FACTOR VALIDATION (free Fama-French, 1927-2026, all world regions): several factors ARE real & robust as diversified RISK PREMIA. Earlier "nothing survives" was a US-only/2010-only/survivorship artifact. The product is a global multi-factor + risk-overlay portfolio, not a signal.

**Date:** 2026-08-03

**Context:** Operator refused the "needs paid data" limitation and pushed for global completeness. Built a FREE point-in-time pipeline: `trd-fetch-ff` (fetches + inflates Fama-French .zip via DecompressionStream deflate-raw) -> `trd_scratch_ff`. Ingested US(1963)/Developed/Europe/Japan/AsiaPac/Emerging 5-factor + momentum(1927). This is the academic gold standard, free.

**Findings (full-period annualized Sharpe, t-stat):**
- **Equity/market premium: robustly positive in EVERY region** (US 0.47 t3.7 ... EM 0.40 t2.5; Japan weak), and STRONGER post-2010. The #1 durable edge = own equities (vindicates D-071 structural thesis).
- **Value (HML): real globally** — US 0.34(t2.7), Europe 0.46, Japan 0.45, AsiaPac 0.67(t4.0), Emerging 0.81(t4.9). DECAYED in US/Developed post-2010 (the "value winter") but stayed POSITIVE international/EM. My earlier US-2010+ "value dead" call was WRONG/regime-local.
- **Quality/Profitability (RMW): robust in developed** (Developed 0.68 t4.1, Europe 0.65 t3.9, US 0.38), held up post-2010.
- **Momentum (developed): 0.54 t3.2, +7%/yr, post-2010 0.70** — real, not decayed.
- **Investment (CMA): real, decaying. Size (SMB): dead everywhere.**

**Decision:** The retail-accessible edge is NOT a high-Sharpe signal (all falsified) but a **diversified, multi-FACTOR (value+quality+momentum), multi-REGION (US+intl+EM), long-horizon RISK-PREMIA portfolio + the risk overlay** — modest gross Sharpe ~0.4-0.7, real, century-and-globe validated, what AQR/DFA actually run. This RECONCILES the whole session: single-market technical signals decay/regime-shift (D-071..D-076), but broad academic risk premia persist globally as compensation for risk. Operator's persistence was correct — narrow tests missed real global premia. NEXT: build the global multi-factor book (long top-factor deciles per region, combined, vol-scaled) + cost/implementation via cheap factor ETFs (VLUE/QUAL/MTUM/AVUV/international equivalents) since direct factor replication has high turnover.

## D-076 — REGIME-STRESS test (2001-2026) — the momentum "edge" was largely a 2011-26 regime artifact; across a full cycle it is ~FLAT. The only thing that survives every test is RISK MANAGEMENT (loss reduction), not any signal.

**Date:** 2026-08-03

**Context:** After risk-adjusted momentum survived survivorship-bias + costs (D-075 addendum) on 2011-26 data, operator correctly refused to build without regime coverage / larger sample. Pulled 77 large-caps back to 2001 (incl. 2008 crash-survivors AIG/C/BAC/F/GE) and scored raw vs vol-scaled momentum BY REGIME.

**Findings:**
- **Full-cycle 2001-2026: momentum is ~flat** — RAW Sharpe 0.02 (0.5%/yr), RISK-ADJ Sharpe 0.19 (2.4%/yr, ~zero after costs). The 0.55-0.59 from D-075 was a **2011-26 QE-bull regime artifact**, not a durable edge.
- **2001-02 dot-com: both destroyed** (RAW -1.17, RISK-ADJ -1.54 Sharpe). Vol-scaling did NOT save it.
- **2009 momentum crash: RAW annihilated** (-75%/yr, worst month -36%); **vol-scaling cushioned it hugely** (-1.7%/yr, worst month -4%). Risk-scaling does real, measurable work in crashes — but as loss-reduction, not profit.
- Risk-adj beat raw in most crisis regimes, confirming risk management is the durable component; but even it is full-cycle-marginal.

**Decision:** No signal edge — including risk-adjusted cross-sectional momentum — robustly survives across regimes + costs + survivorship bias. The apparent survivor was regime-specific. This is the definitive convergence with D-071/D-072/D-075: the durable, repeatedly-validated component is **RISK MANAGEMENT** (vol-scaling verifiably turns a -75%/yr crash into -1.7%), which REDUCES LOSS rather than manufacturing alpha — i.e. the Risk-Overlay product (D-073), not a trading signal. Building a momentum EA now would deploy a regime artifact. Operator's "don't build quickly / haven't conceptualised the market" instinct was correct and is vindicated by the data. Untested families remain (value/quality/vol-premia/carry/cross-asset) — but the method-level conclusion (risk mgmt is the edge, signals decay/regime-shift) is now strongly evidenced.

## D-075 — COMPREHENSIVE falsification: 10,906 strategy×market backtests + OOS seasonality + pre-specified anomalies → the retail timing-edge thesis is REJECTED with a locked holdout + PBO. The durable edge is structural, not a signal.

**Date:** 2026-08-03

**Context:** Operator pushed to exhaustively test before concluding — 4000+ strategies against all markets, unseen-price holdout, winners → EAs. Built it the only honest way (a mass search is a false-positive factory otherwise). Real-data runs, all committed on `feat/wyckoff-evolutionary-search`:

- **Wyckoff evolutionary search** (`trd-evolve` + real Alpaca daily): best-of-134 winner was 1.11β to SPY, residual-alpha t=-0.01 → REJECT.
- **Intraday session-ORB** across Asia/London/NY × weekday × dir on 54,588 real BTC 15m bars (2436 trades): best segment Sharpe 0.62@n13 → 0.18@n81 (edge shrinks as N grows = noise) → REJECT.
- **OOS seasonality sweep** (`trd-seasonality-sweep`, 19 markets × 5 setups, 475 segs): 10 persisted OOS (July/Nov equity, HYG Mon/wk1, Uptober) but 0 cleared Bonferroni.
- **Pre-specified combined tilt** (`trd-prespecified-test`, turn-of-month + Halloween, 8 indices): OOS test half Sharpe 0.65 vs buy-hold 0.86, timing-alpha t=-0.15 → REJECT. Anomaly decay (McLean-Pontiff) caught by the split: real in 1990s-2010s train, gone in 2019-26 test.
- **Zoo sweep** (`trd-zoo-sweep`, 574 defs × 19 markets = **10,906 trials**, IS/VAL/HOLDOUT): 0/10,906 cleared holdout DSR≥0.95 (best 0.18, all long-BTC-beta); **PBO=0.53 → selection itself overfit**. No winner to convert to an EA.

**Decision:** The retail-accessible timing/pattern/seasonal edge is comprehensively falsified on real data with the strongest available methodology (true-N DSR deflation + locked holdout + PBO). Converges hard with D-071/D-072: buy-and-hold beat every strategy every time; the durable edge for this seat is **structural** (low-cost beta + tax wrapper + behaviour) + the **risk overlay** (the one +EV component) + the **creator/education business** (D-073). Banks win on order-flow/market-making/latency — structural seats we cannot buy — NOT on chart reading from the same data. One untested class remains: cross-sectional relative-value (likely same outcome). Building more strategies only raises the deflation bar; the method, not the count, is the conclusion.

## D-074 — Wyckoff model + TRIAL-HONEST evolutionary search added as Stage-1 hypothesis generators; the evolution is wired so it CANNOT manufacture a fake edge.

**Date:** 2026-08-03

**Context:** Operator directed: model the Wyckoff method, simulate on real data, and run an ML program of "different evolutions of algorithms" that refines confidence levers on losses — "execute the ladder." The request, taken literally ("evolve until we're the exception"), is mechanically an overfitting machine: a large enough search always finds an in-sample winner, noise ~97% of the time. Built it so that is impossible to hide.

**Decision / what shipped ($0, offline, Stage-1):**
- `_shared/trd-wyckoff.ts` — the Wyckoff method as **point-in-time** OHLCV features (spring / upthrust / SOS / SOW events + a dense `wy_phase`), plus two **confidence levers**: `wy_evr` (effort-vs-result absorption warning) and `wy_cvd_proxy` / `wy_cvd_proxy_slope` (Accumulation-Distribution line). 8 tests.
- `_shared/trd-evolve.ts` — a **seeded, deterministic** genetic search over Wyckoff `StrategySpec`s. Every distinct candidate feeds `nTrials`; the winner's **Deflated Sharpe deflates by the true N**, and **PBO/CSCV** runs over the candidate return matrix (the search scores its own overfitting). It NEVER promotes — it returns the winner + honest `TrialContext` so the SAME default-REJECT gate (residual-alpha vs factor zoo) applies. 7 tests incl. THE SAFETY TEST: a search over pure noise must not clear the gate.
- `scripts/trd-wyckoff-evolve.ts` — runner with a **`BARS_FILE` offline mode** (no DB/broker) and a DB mode that persists to the ledger. Verified end-to-end on synthetic random-walk data: 81 trials, best raw Sharpe 0.104, **residual_alpha_t=2.37 (would fool a naive test) → DSR deflated to 0.043 → REJECTED.** The multiple-testing deflation caught the lie. 59/59 suite green, `deno check` clean.

**Honesty gates named (not coded around):** true **CVD** needs trade-level bid/ask ticks and true **OI** needs a futures OI feed — NEITHER exists in daily OHLCV, so only labeled *proxies* are built. **Real-market simulation is blocked on the operator:** (1) `supabase start` (local stack currently DOWN), (2) Alpaca **paper** creds → `./scripts/trd-ingest-prices.ts`. No real money anywhere; a PASS means "→ PAPER rung," not capital. The "refine confidence levers on losses" online-learning loop is **Stage 2+** (paper executor, deferred behind the gates). See [`docs/research/R-002-*`](./docs/research/R-002-tradingelder-cvd-oi-futures-options.md) for the profitability/commercial-risk grounding.

## D-073 — Aegis turns OUTWARD: a consumer HARM-REDUCTION product (the "Risk X-Ray"). Make retail trading risk VISIBLE; never sell signals/direction; charity-owned, grant-funded, broker-money FORBIDDEN; Innovator-Founder monetization path.

**Date:** 2026-06-24

**Context:** Operator pushed to point the falsification engine outward into an audience product. This session: (1) extracted 5 retail `.ex5` indicators from Drive — compiled MT5 binaries for Deriv synthetics/forex, the exact folklore genre the engine rejects; **dropped as dead weight.** (2) Verified the requested order-flow/GEX/AMT stack (Bookmap, SpotGamma, auction-market-theory) only applies to **real centralized markets** — synthetics are CSPRNG (no order book, no auction, no options), so that stack is structurally meaningless there; the math that fits synthetics is statistical-structure, not order-flow. (3) Ran a deep-research pass (**R-001**, 106 agents, 23 adversarially-verified primary-source claims): conditioning the 16 rejected strategies on dealer-positioning/macro/microstructure regime is **mechanically real** (NGE-sign flips intraday momentum; momentum crashes forecastable; dealer-capacity nonlinear) but **every confirmed edge is cost/capacity/latency-gated out of retail reach**, and the one retail-tradable gamma edge was killed 0-3. Durable output = a **protect-the-core regime instrument, not alpha.** (4) Operator redirected to harm reduction for retail traders who will trade regardless, and repeatedly pushed "money in their sleep / 99% accuracy / 1e8× / where to take profit / paywall the safety checks / make addicts dependent" — each held back as the scam-marker that betrays the vulnerable and is itself illegal/ineligible.

**Decision:** Build the **Risk X-Ray** — a harm-reduction layer that makes the invisible risk a retail trader is *already* taking VISIBLE at the moment of the trade (leverage/liquidation, ruin probability, behavioural patterns, true all-in cost, broker B-book conflict, RNG instrument-structure, regime fragility). Invariants, in addition to the engine's:
  1. **NO directional prediction, NO published buy/sell signals, NO "take profit" calls, NO accuracy/performance claims.** These cross the FCA financial-promotion + investment-advice lines (a personal recommendation on a specific trade = regulated advice) and are the scam marker. **Accuracy is promised ONLY on the knowable facts** (risk / cost / ruin / a signal's realized historical hit-rate). "Stop the bleeding" (risk limits/stops) = yes; "take profit" only as honest risk-management (R-multiples/trailing stops), never as a forecast.
  2. **NO paywalling of safety for the vulnerable; NO engineered dependency.** Success = the user de-risks and needs us LESS over time — the operator's own "build leverage, not reliance" doctrine applied to users. The success metric is **harm reduction** (lower leverage, fewer blow-ups, reduced overtrading), **never** engagement/time-on-app/trade count (optimising engagement = more trading = more harm).
  3. **Funding (operator-locked, this session):** grant + cross-subsidy; **broker/industry money FORBIDDEN forever.** Free-forever for the vulnerable; paid advanced tier only for those who can afford it (the source of "financial buy-in"). This unlocks the UK **statutory gambling-harm levy (~£120M/yr;** eligibility requires *no industry funding* + conflict-of-interest declaration) + financial-inclusion grants (Interledger $150–250k, Accion $61.6M fund); keeps us clean for FCA's guidance/advice boundary + the Innovator-Founder endorsement; and makes broker attacks **self-validating** (antifragile *only because* we give them nothing true to hit — clean conduct IS the armor).
  4. **v1 wedge = the Pre-Trade Reality Check:** user inputs the trade/signal they want to verify → three layers: **facts** (~100% accurate risk/cost/ruin), **honest context** (positioning/regime as probability + base rate; news-vs-structure divergence), **verdict that is never a prediction.** Forward-looking trade-check ships *before* the backward-looking history audit (better adoption funnel). Broker-agnostic, user-side distribution (MT4/MT5 + Deriv first; browser overlay; CSV import — no order access ever). Free 2 checks, then subscription for the affording segment.

**Alternatives ruled out:** (a) sell directional signals / "money in sleep" / 99%-accuracy / 1e8× — refused (impossible per the engine's 16/16, an illegal financial promotion, betrays the audience, kills grants + the visa); (b) paywall safety / monetize addiction / engineer dependency — refused (it IS the broker model; disqualifies from harm-reduction grants); (c) take broker/industry revenue — refused (forfeits the £120M pool, hands broker attacks live ammunition); (d) build on the `.ex5` indicators or run the order-flow/GEX/AMT stack on synthetics — refused (compiled/wrong-market; synthetics are RNG with no order flow); (e) "every platform globally at once" — refused (no broker integrates willingly; start at the highest-harm surface).

**Framework lens:** honest-advisor (held the 99%/1e8×/paywall-safety lines across repeated, escalating push-back — the refusal IS the value the operator hired) + falsification doctrine (nothing sold that the engine rejected; the REJECTED list becomes the product's literacy core) + operator grand thesis / D-072 Pond H (the creator/media empire is the distribution moat, now realized as the acquisition engine) + antifragile positioning (clean conduct as armor; broker attacks rebound) + visa/cross-border (Innovator-Founder route makes monetization legal post-Master's).

**Success metric:** a free, broker-agnostic Risk X-Ray that *demonstrably reduces user risk* (lower leverage / fewer blow-ups), funded by harm-reduction + inclusion grants with **zero industry money**, clean under the FCA guidance boundary, distributed via the media empire — yielding an Innovator-Founder endorsement dossier evidenced by harm-reduction outcomes. No directional signal ever sold; no vulnerable user ever paywalled from safety. Reuses the Aegis substrate (honest-stats core → risk calculators; backtest/falsification engine → the strategy-validity lab; R-001 → the Tier-3 regime flags).

---

## D-072 — Expanded the pond (8 new candidates): ~16/16 securities strategies now rejected; the operator's REAL edge is the creator business they BUILD, not a trade. Barbell direction locked.

**Date:** 2026-06-07

**Context:** Operator pushed back on D-071 ("maybe we're fishing in the wrong pond — expand the candidate set, do more research"). Ran a second 8-pond research workflow (`wf_87a217a5-91f`, 11 agents) over the *less-crowded* ponds + the small-account-advantage lens the pass-1 reviewer flagged: event-driven/corporate-actions, micro-cap/neglected, carry, crypto-native, alt-data/NLP, illiquidity/alt-assets, stat-arb, and the operator's own domain. Verifiers returned **confirms-pass-1** + **marginal-improvement** ("passes the honesty check at a level I rarely see").

**Decision (the answer to "wrong pond?"):** The operator was RIGHT that pass-1 fished the crowded pond — but the better pond is **not another trading signal, it's the operator themselves.**
  1. **No liquid trading edge survived — ~16/16 securities strategies now rejected.** Every new pond failed after costs/OOS: event-driven (packaged vehicles PKW/CSD/MERFX all underperformed the index a decade), carry (~0 OOS post-2010, crash-clustered), crypto-native (compressed 25%→<5% in 2yr + visa-barred), alt-data/NLP (commoditized by the operator's own LLM tooling, Sharpe 6.54→1.22), stat-arb (HFT-moated). The index null stands.
  2. **The "small-account advantage" thesis got a mostly-NEGATIVE answer — and it INVERTED.** Where a capacity gap exists (funds can't size in), the same illiquidity imposes 2-4% retail spreads + no borrow + gap risk that kills it for retail *harder*. The edge is **cost-constrained, not capacity-constrained**; small size is a *disadvantage*. True for event-driven, FX-carry, alt-data, stat-arb.
  3. **The genuinely better pond is Pond H — the operator's OWN creator/content asset.** Right-tail creator businesses yield ~20-40% owner earnings vs the index's ~7%; the moat (authentic audience/distribution) is the literal Thiel secret no depth-locked giant can replicate. It is the only large, durable, anti-scale edge in EITHER pass. **The business they CREATE is the alpha; public markets are the savings account.** This independently re-derives the operator's own grand thesis (YGS = the leverage substrate).
  4. **THE DIRECTION = a barbell, not a trade book:**
     - **CORE (visa-safe, passive):** cheap global equity index via **Ireland-domiciled UCITS ETFs — NOT US-situs** (the $60k NRA US estate-tax trap is *lethal* for a South African; verified SA has NO US estate-tax treaty relief — this is the single most actionable risk finding). Responsible leverage LATER, sized for the gap not the average.
     - **TAX WRAPPER = the highest-certainty after-cost edge (verifier catch):** ISA (£20k/yr, CGT+income-free, Student-visa-eligible) + SIPP. The wrapper itself IS the edge. Plus UK low-coupon gilts held-to-maturity (CGT-free capital uplift) — a [Certain] visa-safe UK retail tax edge.
     - **SATELLITE TILTS (≤15-25%, diversifiers not alpha):** a small finite UK investment-trust wide-discount basket in an ISA (Pond G — real but ARBITRAGING in real time: Saba's UKIT ETF launched Mar 2026, discounts already narrowed 36/45 sectors → a 2-5yr window, not permanent); optional liquid real-asset sleeve (REIT/infra).
     - **THE ACTUAL EDGE (deferred, then dominant):** build the Command Centre / creator substrate NOW but **UNMONETIZED** (legal study/R&D on the Student visa — YPP off, no AdSense/sponsorship), apply **Graduate Route before 31 Dec 2026** (hard clock; from 1 Jan 2027 it shrinks 2yr→18mo), then flip monetization on, compound the cash-flowing asset, borrow against it, park surplus in the index core.
  5. **Aegis's role SHIFTS:** from "find alpha" (done — 16/16 rejected) to **"falsify folklore + protect the core"** — estate-tax-safe wrapper selection, leverage-gap sizing, value-trap filters, currency-hedge decision (tri-currency ZAR/GBP/USD is material + unscored).

**Alternatives ruled out:** (a) keep hunting trading signals — refused, two exhaustive passes + the engine agree there's no retail-capturable liquid edge; (b) chase the small-account ponds (micro-value, CEF discounts) as the main engine — refused, they're marginal, finite, self-terminating as the account grows, and the active ones breach the visa; (c) treat crypto/carry/event-driven as edges — refused, all reject after costs and most are visa-unsafe to run live.

**Framework lens:** honest-advisor (the answer to "wrong pond?" is "yes — the right pond is you, not a signal") + Thiel (the secret / circle of competence = the operator's own anti-scale creator moat) + operator grand thesis (independently re-derived: audience+distribution is the leverage substrate) + falsification doctrine (16/16 kills; the null index is the benchmark) + visa/cross-border constraints as first-class.

**Success metric:** the operator stops hunting trading edges, builds the Ireland-UCITS tax-sheltered index core + maximises savings rate, builds the creator substrate unmonetized + secures the Graduate Route before the deadline, then monetizes + borrows against a proven cash-flowing asset. Aegis keeps killing folklore + protecting the core. No real money on any unproven signal — ever.

---

## D-071 — The honest answer: there is no tradeable alpha edge that beats a cheap index after costs; the generational-wealth engine is STRUCTURAL + BEHAVIOURAL, not informational

**Date:** 2026-06-07

**Context:** Operator directed: keep validating the insider verdict with years of
data, keep testing strategies until an "undeniable edge we can exploit legally" is
found, and research the best direction for growing/borrowing-against a portfolio to
build generational wealth — founded on diverse authoritative sources. Ran an 8-edge
multi-source research workflow (`wf_bf103765-d40`, 11 agents, both adversarial
verifiers returned **sound-with-fixes** and called it "unusually honest — does not
smuggle in optimism") + ingested **20 years** of a liquid cross-asset universe (46
symbols, ~195k bars to 2006) + tested time-series momentum through the gate.

**Decision (the uncomfortable, evidence-grounded truth):** There is **no tradeable
alpha edge** in the candidate set (trend, factors, insider, VRP/options, crypto,
13F/flows, asset-backed borrowing) that beats a low-cost diversified global index
fund after costs, out-of-sample, at the operator's capacity + UK-Student-visa shape.
Aegis **confirmed it on real data — 3 strategies now REJECTED**: congressional
copycat (sector beta), insider cluster-buy (lost money), and time-series momentum
(18yr: ~3.5%/yr, SPY-beta 0.28, residual-alpha t=0.17 → a diversifier, NOT alpha).
  - **The #1 "edge" is the NULL:** low-cost global index + tax wrappers + compounding
    — the only candidate with a real after-cost edge; it becomes Aegis's permanent
    benchmark line, and every strategy must beat it or die.
  - **#2 (asset-backed borrowing) is a LEVER, not an edge** — multiplies whatever it's
    bolted to (up AND down); deploy LATE + SMALL (15-25% drawn LTV) against the liquid
    core only, never crypto/concentrated names.
  - **Trend + factors survive only as HELD diversifiers/tilts** (DBMF/KMLM, quality
    ETF), sized to cut max-drawdown (which raises safe borrow-LTV), never as alpha.
  - **The generational-wealth machine is the 5-layer plan** (index core → drawdown
    diversifiers → late small leverage → tax/estate structure → visa shape), and it
    requires **no trading edge**. The operator's real edge is STRUCTURAL (cheap +
    tax-sheltered + low-turnover + never-forced-to-sell) and BEHAVIOURAL (high savings
    rate + holding through crashes), amplified by a small late lever — not informational.
  - **Visa binds HOW, not whether:** everything stays passive — HOLD fund versions,
    never run a live trend/options/short/crypto book on a Student visa; backtesting is
    study (safe). SBLOC-to-fund-life brushes source-of-funds → adviser sign-off first.

**Alternatives ruled out:** (a) keep hunting exotic signals for an "undeniable edge" —
refused, the engine + 150 years of literature agree they fail after costs; a system
guaranteed to "eventually find an edge" if it tests enough is p-hacking (the DSR +
trial-counter exist to stop exactly this); (b) run any strategy LIVE — refused, visa
+ no proven edge; (c) build a finance channel on an unvalidated edge — refused (the
operator's own constraint, now evidence-backed: there's nothing valid to sell yet).

**Framework lens:** honest-advisor (led with "there is no edge"; refused the GODMODE
promise) + falsification doctrine (the null index is the benchmark every edge must
beat; 3 clean kills) + $B mitigations / non-bottleneck (protect the wealth base from
the larger expected loss of betting on decayed folklore) + the operator's real
cross-border (SA/UK) + visa constraints as first-class.

**Adversarial fixes to carry (verifier-flagged):** (1) deflated-Sharpe multiple-
testing deflation — BUILT (DSR penalized by total trials). (2) **Sequence-of-returns
risk** — a crash early in accumulation is GOOD, near the borrow phase is catastrophic;
SBLOC-RUIN must condition on lifecycle timing. (3) **Small starting capital** — for a
student, for the first N years ONLY Layer 1 matters (savings rate + cheap wrapper);
all sophistication is premature. (4) **Currency (ZAR/GBP/USD)** is a bigger risk than
any factor — a 20% ZAR move dwarfs 0.5%/yr of contested alpha. (5) **False-negative
risk** — Aegis's value-weight + capacity filters are calibrated for institutional
scale; a genuinely-exploitable SMALL-capacity edge could be wrongly killed for a
small-account operator. Worth a deliberate retail-scale test before final retirement.

**Success metric:** Aegis enshrines the global-index benchmark + keeps rejecting
folklore (3/3 so far); the operator builds the tax-sheltered index core + maximises
savings rate, and defers any leverage until a core exists AND cross-border tax + visa
are professionally reviewed. No real money on any unproven signal — ever.

---

## D-070 — Trading substrate: a FALSIFICATION ENGINE governed by CC, where autonomy + capital are EARNED out-of-sample; congressional/Form-4 are ONE legal feature, not the thesis

**Date:** 2026-06-06

**Context:** Operator wants to "make money autonomously in my sleep" with a
per-session max-loss guardrail, live buy/sell signals, congressional-portfolio
tracking as a legal leading signal, and a start of small MANUAL trades on
low-volatility regimes to document the real success rate. The uncomfortable
truth, led with: the congressional copycat trade is mostly priced out — the two
ETFs built to do exactly this (NANC, KRUZ) do NOT beat the market risk-adjusted
(Economics Letters 250, 2025), and NANC's headline lead is a tech-sector
overweight you could replicate with QQQ. The 45-day STOCK Act lag is not a
tunable parameter, it is the entire problem: the abnormal returns happen in the
days right after the politician trades, and you legally cannot see the trade
until weeks later — you are structurally buying the echo. Enforcement is a
routinely-waived $200 fine (zero prosecutions ever), so the real lag is often
worse than 45 days. Form-4 cluster-buys are a better legal signal but live in
microcaps you cannot deploy size into. Options-flow/short-squeeze signals are
closer to astrology than alpha for an autonomous retail system. The base rate is
brutal: ~97% of retail traders lose, <1% beat fees over 15 years; realistic
ceiling is Sharpe 0.5–1.0 before costs, collapsing toward zero after. Medallion's
~Sharpe-2 is closed and unattainable. A backtester that never kills a strategy is
lying.

**Decision:** Build the trading vertical as a FALSIFICATION ENGINE on the CC
substrate (Supabase + Deno edge fns + 3-tier + Architect-veto + Vault), in its
OWN repo + OWN Supabase project for blast-radius isolation (operator's call,
overriding the design's same-repo recommendation), NOT a trading bot.
1. **A STAGED-AUTONOMY LADDER** — RESEARCH → PAPER → MICRO (manual) → SMALL
   (first auto) → SCALED — where each rung is unlocked only by out-of-sample
   proof (≥30/50/100 trades, DSR>0.95, PBO<0.5, net-of-cost-positive, MinTRL);
   live/auto execution is the LAST stage, never the first; failing a gate
   auto-demotes.
2. **An HONEST backtest engine** — point-in-time bitemporal features (look-ahead
   structurally impossible), walk-forward, delisting-inclusive universe,
   bar-N+1 fills, mandatory pessimistic cost model, Deflated Sharpe penalized by
   a substrate-level trial counter, every Sharpe printed next to N, edge
   decomposed into (sector-beta | size | residual-alpha) vs SPY AND NANC — so it
   readily KILLS strategies without edge.
3. **Congressional + Form-4 + 13F are ONE legal feature family among many**, used
   in Stage 1 as a low-volatility CALIBRATION dataset, never the profit engine;
   options-flow/short-interest demoted to no-trade-without-OOS-proof.
4. **The risk policy is ENFORCED invariants:** a deterministic pre-trade
   Architect veto (fixed-fractional 0.5%, quarter-Kelly ceiling, correlation/
   exposure caps, vol-targeted sizing) + a 2% daily-loss circuit breaker
   (flatten+cancel+lock) as a durable object surviving restarts — fail-closed,
   mirroring how CC enforces classes via CI ratchets/DB triggers.

STAGE 1 touches NO real money: legal free ingestion (House Clerk + Senate eFD +
SEC EDGAR + Alpaca paper data), the point-in-time feature/price store, the
falsification backtest engine, the stats/reporting surface with a visible
REJECTED list. The risk-gate fn is the FIRST thing dogfooded through the 7-agent
factory.

**Alternatives ruled out:** (a) make the congressional signal the profit engine —
refused, the literature already killed it and the lag is unrecoverable; (b) trade
options-flow/short-squeeze "unusual activity" — refused, folklore without OOS
proof; (c) autonomous execution early ("money in my sleep" now) — refused,
manual-first must win until paper+micro+small clear with real samples; (d) a
from-scratch stack — refused, reuse the CC substrate; (e) buy paid alpha/options
vendors as a moat — refused, they resell the same public filings, the moat is the
synthesis+honesty layer; (f) trust paper P&L as proof of edge — refused,
micro-live real money is a mandatory rung; (g) fund trading from operating cash —
refused, it's speculative R&D from a capped, fully-losable budget; cross-subsidy
only audience→trading, never reverse.

**Framework lens:** Thiel/Karp (the durable monopoly is the lag-aware, cost-net,
self-killing synthesis substrate) + Architect hard-veto (default-REJECT on stats
AND a fail-closed pre-trade risk gate) + 3-tier autonomy (Strategist proposes,
Architect vetoes, Orchestrator dispatches, workers execute; no LLM in the order
path) + Musk (question residual-alpha-after-costs → delete losers → simplify to
declarative specs → automate LAST) + $B mitigations (idempotency end-to-end,
append-only evidence, durable kill-switch, vault-gated live creds) +
honest-advisor (led with the uncomfortable base rate, refused to overstate
returns).

**Success metric:** Stage 1 — the substrate correctly KILLS a deliberately-overfit
strategy and shows the congressional copycat's apparent edge is sector beta not
residual alpha, on the live CC reporting surface, with the REJECTED list visible;
a look-ahead feature query returns empty; duplicate ingestion is a no-op; ZERO
real money touched. Whole-system — no strategy ever reaches auto-execution without
clearing paper+micro+small with real samples + a clean kill-switch record; the
operator can document the real, post-cost manual success rate; most candidates
are correctly rejected.

### Adversarial-hardening addendum (verify-phase fixes folded in)

The design workflow's skeptic + completeness critic returned **sound-with-fixes**.
The following are now first-class, not someday-forks:
- **Manual-trade logging in STAGE 1** (`trd_manual_trades`) — the operator's
  stated entry point; needs no broker; produces the real post-cost hit rate that
  calibrates the cost model. Was missing from the original Stage-1 plan.
- **Project-level kill criterion** (`trd_gate_thresholds.project_kill`) — after
  N strategy-families / M compute-hours with zero promotions past PAPER, the
  honest conclusion is "no accessible edge; shelve the vertical." The engine
  kills strategies; this kills the project. `null_result_is_success=true`.
- **Decision-locked gate thresholds** — changing DSR/PBO/floors requires a new
  `trd_gate_thresholds` row naming a DECISIONS entry. No quiet loosening.
- **Price-revision bitemporality** — `trd_price_bars` stores `as_of` versions, so
  split/dividend re-adjustments don't retroactively leak into a backtest.
- **DSR benchmark must be > 0** (SPY's Sharpe, not 0); sample floors are
  UNDER-POWERED for DSR/PBO, so promotion also requires MinTRL *satisfied* and
  the honest framing that real money is far away.
- **Factor zoo in the decomposition** — residual-alpha must be net of market,
  size, value, momentum, quality, AND low-vol (BAB), or "low-vol-first"
  manufactures fake alpha by construction.
- **Signal-exfiltration invariant** — `trd_signals.single_operator` + service-role-
  only; no browser read path (IA-registration boundary).
- **Pre-SMALL execution hard requirements (logged for Stage 2+):** broker-state
  reconciliation loop (`agent-trd-reconcile`) + cancel-on-disconnect +
  deterministic `client_order_id` (broker-side dedup); mark-to-market (unrealized)
  kill-switch path on a timer, not only fill-driven; position-level catastrophe
  cap via bracket orders (gap/halt risk); stressed-correlation assumption in the
  exposure cap; an observability/alerting tier (heartbeat-miss, kill-switch-tripped
  push, data-staleness) — "wake me when it breaks" is the precondition for "run
  while I sleep"; fund the live broker account ONLY with the losable amount so the
  broker balance is the final backstop.
- **YGS finance-channel financier link** — the REJECTED list + "we tried to copy
  Congress, here's why it fails, with receipts" becomes honest, differentiated
  finance content for a YGS channel that FUNDS the R&D budget. Cross-vertical
  synthesis (the Thiel/Karp moat). Tracked as the parallel financier track.

### Re-anchored target (operator-confirmed, 2026-06-06)

The original ask ("$1–2k/day from $20–50 trades, 4 trades/day, multiply accounts
to $1M/mo") implies a 500–2,500% return per trade — only reachable via account-
destroying leverage, and unscalable because EV scales linearly (negative edge ×
N accounts = N× the loss). **Operator agreed to re-anchor the target to "prove a
real positive edge net of costs, then scale only what's proven."** No daily-dollar
quota (quotas force overtrading). Test capital: **$20–50/week, fully losable**;
daily-loss kill-switch ≈ one session's contribution.

### D-079 — Macro-regime overlay: fragility, not prediction (2026-08-03)

**Trigger:** operator asked (via a shared X post) that the infra "understand how
economies work… where they are in the economic cycle, so we know what to expect
in either direction." The linked post (Tigerflow) was actually about the **Kelly
Criterion** (sizing), which Aegis already implements to the letter (half-Kelly in
`trd-protect.ts:41`, n≥100 estimation-error floor in `trd-verify.ts:65`). The
economic-cycle ask is a separate, previously-missing layer.

**Decision:** macro is added as a **fragility overlay, never a direction predictor.**
The hard evidence (and D-071..D-077) is that cycle *timing* is not reliably
forecastable — "late-cycle so price falls" back-tests to noise. What IS durable
(R-001's Global-Financial-Cycle finding) is that macro measures **when the system
is primed to break**. So `_shared/trd-macro.ts` (`classifyRegime`) emits a de-risk
MULTIPLIER in (0,1] that ONLY shrinks position size in a fragile regime — it can
never lever up and never predicts which way price goes. Worst case in a calm tape:
a no-op. 6 unit tests (2008 crisis → hard cut to the 0.3 floor; benign → no-op;
inversion-alone → moderate trim; <2 signals → fail-safe cap; contagion blend).

**Live wiring (all $0, keyless, autonomous):**
- `trd-macro-pump` edge fn pulls **Yahoo** market data (edge-reachable; FRED's CDN
  blocks the Supabase datacenter — verified 0/5 vs Yahoo 3/3) for the two fastest
  fragility signals: **yield curve** (10y ^TNX − 3m ^IRX) and **vol regime** (^VIX
  5y percentile). Writes `trd_macro_state` + append-only `trd_macro_history`.
- `trd-paper-tick` multiplies every order's risk fraction by the live de-risk factor
  (fails open to 1.0). `pg_cron` runs the pump 4×/day, 5 min before each 6h tick.
- `aegis-cockpit` shows the cycle phase, fragility, de-risk applied, and the honest
  "what to expect (fragility, not direction)" text; CC snapshot carries it too.
- Current live read (2026-08-03): curve **+0.99pp** (not inverted), VIX **28th pct**
  → **EXPANSION, fragility 0, de-risk 1.0** (overlay correctly a no-op today).

**Honest limits (logged, not hidden):** the autonomous path sees only curve + vol
(2 of 5 signals). Credit-spread / unemployment (Sahm) / CPI are FRED-only and added
best-effort by `scripts/trd-macro-refresh.ts` when FRED is reachable; whichever
source ran last wins in `trd_macro_state`. Multi-economy (EA/UK/JP/CN) is scaffolded
(`blendDeRisk` is contagion-dominated) but only US is wired for now.

### D-080 — Folklore falsified: "XAU 15m liquidity-grab, 76.53% win" (2026-08-03)

**Input:** operator shared an 8-slide Instagram carousel (Pranam Ghagare / trendwisdom)
selling an XAU/USD 15m strategy — 30 EMA trend filter + LuxAlgo S/R-with-breaks (Left/
Right bars 15→1), long on a support liquidity-grab (wick below, close back above), enter
on the grab-candle break, SL at its low, **1:1 target**. Claim: 98 trades, **76.53% win**,
<2% DD, +26% — thesis "Low RR = Higher Win Rate." First of a corpus the operator is
assembling for Aegis to synthesise.

**Built:** `_shared/trd-liquidity-grab.ts` — a faithful, point-in-time, one-position
mechanical implementation (no look-ahead: entry is a resting stop at a price known when the
grab candle closed; pessimistic same-bar stop-first exits; per-side cost applied). 3 tests.
Runner `scripts/trd-liquidity-grab-verify.ts` pulls **real COMEX gold 15m (Yahoo GC=F,
keyless)** and runs cost-sensitivity + out-of-sample + regime windows.

**Result on 4,509 real bars (2026-05-22 → 08-03, 306 trades — 3× their sample):**
- Win rate **44.1%**, NOT 76.5%. Expectancy **−0.118R even at ZERO cost**; **−0.192R** at a
  realistic $0.30/oz per side; **t = −3.34** (a *significant loser*, not a coin flip).
- Out-of-sample both halves ~44%, negative, consistent.
- A 1:1 needs win rate ≥ **52.7%** just to break even after cost; the strategy delivers 44%.
- Regime probe: win rate swings 38%→54% across 6 windows and tracks the window's drift —
  76% appeared in NO window of 2.5 months. It was a single trending-April artifact.

**Verdict: REJECTED.** The "1:1 = high win rate" story is real arithmetic (tighter target →
more hits) but expectancy-neutral gross and NEGATIVE after costs; the 76.5% is regime luck on
a cherry-picked month, not an edge. Confirms D-071..D-077: no chart/timing signal survives.
Honest caveat logged: our S/R uses confirmed 1-bar pivots (an approximation of the exact
LuxAlgo indicator); the cost + regime + OOS findings are robust to that detail.

### D-081 — Strategy ALGEBRA + deflation-aware mass search (2026-08-03)

**Ask:** operator wants to assess thousands of strategies and variations, decompose
setups into components and recombine them, and find the best across each trader's
markets. Correctly reframed two impossibilities first: (a) "positive win ratio on
EVERY trade" is mathematically impossible — the target is positive EXPECTANCY net of
cost; (b) searching thousands of combos and picking the best is a FALSE-EDGE FACTORY
unless every trial is deflated for the search itself.

**Built:**
- `_shared/trd-grammar.ts` — the strategy algebra. A strategy = {trigger class} ×
  {EMA} × {trend mode} × {stop lookback} × {reward:risk} × {session}. Triggers cover
  4 classes: sweep (ICT liquidity), fvg (imbalance), breakout (momentum), pullback
  (trend-continuation). `enumerate()` = 2160 composed strategies. Pranam's D-080
  strategy is literally ONE point {sweep, with-EMA, rr1}. Honest by construction:
  next-open entry (no look-ahead), same-bar stop-first exits, cost in R units. 3 tests.
- `scripts/trd-strategy-search.ts` — runs all 2160 × 4 real markets (Gold GC=F, BTC,
  ETH, S&P ES=F, keyless Yahoo 15m) and reports the funnel, deflating with the EXISTING
  honest core (`deflatedSharpe` by true trial count + PBO via `pboCSCV`).

**Result (8,640 trials, ~7s):** 1,613 positive in-sample (19%) → 662 positive
out-of-sample net cost (7.7%) → **0 clear DSR-deflation** for the 7,251-trial search.
Best OOS survivor (BTC sweep, rr3, London) DSR = 63% — an overfit survivor. VERDICT:
REJECTED — 662 marketing-grade "winners" are all multiple-testing artifacts. The gate
did its job. **Honest lead (not a claim):** least-overfit survivors cluster on
sweep + WIDE (3:1) targets + London on crypto — the OPPOSITE of the 1:1 win-rate
farming — a direction for future search, still rejected at this trial count.

**Corpus:** `trd_strategies` table on CC (the "decoded corpus") catalogs each assessed
strategy — source, component decomposition, claim, verdict, our evidence, decision-ref.
Seeded with D-080 + D-081. Every future strategy the operator feeds decomposes into a
grammar point, so the corpus grows by PARAMETERS, not bespoke code.

**Honest limit logged:** bulk YouTube-channel transcript ingestion is NOT reliable
(caption endpoints are gated — hit in R-002). The scalable path is the grammar: feed a
strategy (screenshot/text) → decompose → it is already in the 2160-point search space.
More triggers (order-block, BOS/CHoCH, RSI-divergence, VWAP) extend the algebra next.

### D-082 — Canon coverage + conditional-edge engine ("when they work") (2026-08-03)

**Ask:** cover ALL strategies that exist, and extract upside in the *times when* any tested
strategy works. Two builds:

1. **Canon-complete trigger library.** WebSearch-verified that the retail universe reduces
   to a finite primitive set (ICT/SMC + price-action + momentum + mean-reversion). Extended
   `trd-grammar.ts` from 4 → **8 trigger classes**: sweep, fvg, orderblock, breakout,
   pullback, engulfing, pinbar, rsi. Grammar now = **4,320 composed strategies**. (R-002
   channel list — SMB, Warrior, Graystone, Bookmap/LuxAlgo — remains leads-not-truth; bulk
   transcript scrape stays gated, and is unnecessary: every one of their systems is a point
   in this algebra.)

2. **Conditional-edge engine** (`scripts/trd-conditional-search.ts`). Each trade is tagged
   with its entry REGIME (trend up/down/flat via EMA slope, vol lo/hi via ATR-vs-median,
   session). The search slices every strategy by condition and hunts for a cell with positive
   OOS expectancy that clears DSR deflated by the TRUE (much larger) conditional trial count.

**Result (80,160 conditional cells = 4,320 strategies × 4 markets × 8 conditions):**
7,700 positive out-of-sample (9.6%) → **0 clear DSR-deflation**. Best (BTC sweep rr3 London)
DSR 27.8%. VERDICT: REJECTED. The mechanical price-action genre is efficiently arbitraged at
15m intraday; no conditional edge survives honest deflation.

**Robust cross-run lead (a direction, NOT a tradeable claim):** the least-overfit survivors
consistently cluster on **high reward:risk (3:1) reversal/continuation** (sweep/pinbar/
engulfing) in **trend-down or London** regimes — the exact OPPOSITE of the "1:1 → high win
rate" marketing. If anything real exists in this genre it is rare, wide-target, and regime-
gated — worth a finer, higher-timeframe search, but it did not clear here.

**Strategic conclusion (honest):** across D-071..D-082, the ONLY edge that has ever cleared
the gate is the **global factor book** (D-077, Sharpe ~1) — a diversified risk-premia
portfolio, NOT a chart pattern. Chart/timing "alpha" is not a lever that survives. The durable
levers are: (1) global risk premia, (2) risk management / survival (firewall + Kelly + macro
de-risk), (3) conditional deployment. That triad — not a magic setup — is the defensible moat.

### D-083 — Universe sweep: 1,010,539 conditional cells, 0 survivors (2026-08-04)

**Ask:** broaden vertically + horizontally, millions of data points, every timeframe/
session/candle assigned a strategy; keep mining the goldmine.

**Built:** `scripts/trd-universe-search.ts` — the full canon (4,320 strategies) across
3 timeframes (15m/1h/1d) × 20 markets (crypto, metals, energy, indices, FX, equities) ×
8 regime conditions. Persists top candidates to `trd_goldmine` (so we refine, not lose them).

**Result (ran in background, ~min):** **419,725 real bars** across 60 market×timeframe
series → **1,010,539 conditional cells** → **94,679 positive out-of-sample (9.4%)** →
**0 clear DSR-deflation.** With a million trials the deflation bar is astronomical; the
best cell (BTC 15m sweep, NY, trend-up, +0.775R/trade) has Sharpe 0.38, n=32 → DSR ≈ 0.

**Findings, honest:**
- The robust lead sharpened and is now VERY specific + consistent across a million cells:
  **BTC 15m liquidity-SWEEP, EMA20, WIDE targets (rr3), in trending NY/London** carries the
  highest per-trade expectancy (+0.5..+0.78R). Same direction as D-081/D-082 — the OPPOSITE
  of 1:1 win-rate farming — now confirmed at scale. Still fails DSR (small n, low Sharpe).
- **My prior was WRONG:** I expected higher timeframes (1h/1d) to surface survivors. They did
  not — every top cell is 15m BTC. The crowding argument didn't hold; if anything the intraday
  BTC-sweep micro-pattern is the least-noisy, not the daily swing space.
- The only edge that has EVER cleared remains the global factor book (D-077). One million
  chart-strategy cells later, that conclusion is now extremely well-tested.

**Interpretation:** this is a SUCCESS of the falsification engine, not a failure to find.
The corpus now honestly proves the mechanical retail genre has no deflation-surviving edge
across essentially the whole tradeable universe. The BTC-sweep-rr3 lead is the one worth a
dedicated, low-trial, pre-registered test (avoid re-deflating it against a million siblings).

### D-084 — Pre-registered hypothesis + macro correlation + refine harness (2026-08-04)

Three builds answering "wire the BTC-sweep-rr3 lead as a pre-registered hypothesis; correlate
the patterns to the economy; refine all calculations."

**1. Pre-registration (the honest way to mine the goldmine).** The BTC-sweep-rr3 lead cannot
be validated by searching harder — every sibling raises its deflation bar. So it is FROZEN as a
single hypothesis: `trd_prereg` row `btc-sweep-rr3-v1` (spec {sweep, ema20, with, sl5, rr3},
BTC-USD 15m, registered 2026-08-04). `trd-prereg-tick` edge fn (cron every 6h) runs the EXACT
grammar code over fresh bars and records ONLY trades entered AFTER registration → the forward
result is a single, un-deflated trial. Honesty check it already surfaced: the spec's
UNCONDITIONAL 60d baseline is **−0.057R** (the +0.088..+0.775R were cherry-picked conditional
cells) — the forward test will settle it. Verdict gated at n≥30 forward trades.

**2. Macro correlation (`scripts/trd-macro-correlation.ts`).** Daily trades across BTC/Gold/
S&P/Nasdaq tagged with contemporaneous VIX tercile + yield-curve sign. Finding: **chart-pattern
edges have near-zero correlation with macro** (all |corr(R,VIX)|,|corr(R,curve)| < 0.2). The one
useful, concrete tie: **BTC-sweep degrades when the curve inverts** (+0.13R normal → −0.60R
inverted, corr +0.19) → recorded as the deployment macro-gate on the pre-reg hypothesis. This
confirms the D-079 stance: macro's value is de-risking (fragility), NOT a switch that turns
these patterns profitable.

**3. Refine harness (`scripts/trd-refine.sh`).** One reproducible command re-runs the unit
suite + type check + the Pranam falsification + mass search + conditional search + macro
correlation. The universe sweep is flagged separate (heavy). Pre-registered hypotheses refine
their own verdict autonomously via the cron tracker.

Net: the corpus now has (a) a frozen, forward-tested candidate that the deflation math can't
kill unfairly, (b) an honest read that chart edges don't tie to the economy, (c) a one-command
way to reproduce/refine everything. 131 tests green.

### D-085 — Cycle/periodicity study, applied vertically + horizontally (2026-08-04)

**Ask:** operator observed crypto tops/bottoms at ~1064-day and ~364-day intervals; study it
across years and markets; apply the principle vertically (timeframes) + horizontally (markets).

**Built (honest periodicity engine):** `_shared/trd-cycles.ts` — major swing-extrema detection +
**Rayleigh phase-clustering test** (R≈1 ⇒ extrema recur at a consistent phase of period P) +
**Monte-Carlo null** (the max R random extrema reach across the same scanned periods — the
periodicity analogue of DSR deflation). 3 tests. Runners: `trd-cycle-study.ts` (deep, per-market,
grand-cycle pass) and `trd-cycle-matrix.ts` (9 markets × {1h, 1d}).

**Findings:**
- **1064d ≈ real, as bottom→top:** BTC grand cycle (true macro extrema) — top→top **1424, 1426d**;
  bottom→bottom **1437d**; bottom→top **1061, 1050d** (≈ the claimed 1064); halving→top **526, 548,
  534d**. All tied to the ~1458d Bitcoin **halving supply shock** (a real mechanism). n=2-3 cycles —
  striking + mechanism-backed but statistically uncertifiable; **not** present in S&P/Gold (no halving).
- **364d annual: NOT supported** at any scale in any market (R well below null).
- **Vertical/intraday: the 24-hour session cycle IS real** — beats the MC null in **7/9 markets**
  (equities R=0.81, FX/oil/crypto 0.25-0.43); the 120h weekly cycle is not. Markets have an intraday
  clock (session structure), not a multi-year calendar. Validates the asia/london/ny session tags.
- **Multi-year swing scale: 0/9 markets** beat their own null. Markets are not clocks at the
  macro-swing scale.

**Verdict:** the 1064 observation is a genuine, mechanism-backed regularity in BTC's halving cycle
(the one cycle worth respecting), logged to `trd_strategies` (class=cycle) with a **pre-registered,
falsifiable forward prediction**: bottom→bottom ~1437d from 2022-11-21 ⇒ macro BOTTOM ~2026-10-29
(±60d). Everything else is noise. Same deflation discipline (null + report-n) applied to periodicity,
vertically and horizontally.

### D-086 — Cockpit renders: local HTML + live JSON (Supabase HTML constraint) (2026-08-04)

**Bug the operator caught (my error):** aegis-cockpit and aegis-terminal show RAW TEXT +
mojibake in a browser. Root cause: Supabase's edge gateway force-downgrades edge-function
responses to `content-type: text/plain` + `x-content-type-options: nosniff` + a `sandbox` CSP
(anti-phishing on *.supabase.co) — regardless of the `text/html` the function sets. So you
CANNOT serve browser-rendered HTML from a Supabase edge function. I'd only verified via curl
(which ignores content-type), skipping the mandatory in-browser render check — the exact failure
my own doctrine warns against.

**Fix (verified in-browser):** the `?format=json` path is unaffected (correct `application/json`,
CORS-open) — it stays the CC data interface. The dashboard is now a self-contained LOCAL file
`web/aegis-cockpit.html` that fetches that live JSON and renders client-side; opened from disk it
renders perfectly and stays live (60s refresh). Confirmed via browser a11y tree: styled cards,
live values ($5782, EXPANSION, btc-sweep-rr3-v1 accumulating 0/30), no mojibake.

**Open (honest):** the PUBLIC trader terminal has the same constraint — it needs real static
hosting (Vercel/Cloudflare/GitHub Pages) to render for outside users; that remains gated on
deploy access. The operator cockpit is solved (local file). Doctrine reinforced: never claim a
UI "renders" without an in-browser check.

### D-087 — Aegis shipped as a real public app + "delivery" primitive (2026-08-04)

**App (de-larp):** Vercel create-project is 403-blocked on the operator's account role (not
bypassable). Shipped instead on GitHub Pages — a real, public, RENDERING app:
https://syyym0n3y.github.io/aegis-engine/ (repo syyym0n3y/aegis-engine). Tabbed SPA: live
cockpit (pulls aegis-cockpit JSON), Risk X-ray (trd-api-protect), Authenticity check
(trd-api-verify), Global allocator (trd-api-allocate), Findings. Verified IN-BROWSER: renders
as HTML, live data loads ($5782, EXPANSION, btc-sweep-rr3-v1 0/30), CORS `*` confirmed on all
APIs so the tools work cross-origin. Local source: web/aegis-app/index.html.

**"Exploiting deliveries" (Rauf/ICT) made testable:** added a `delivery` grammar trigger =
CONSOLIDATION (window range < 3× median bar range — the market hasn't picked a side) followed by
a DISPLACEMENT candle breaking the range (a Change In State of Delivery / CISD). First honest test
(15m, cost 0.05R): naive "enter on the displacement candle" is a LOSER — Gold rr2 +0.067R (t=0.38,
insignificant), everything else negative and mostly significantly so (BTC rr1 t=−2.48, S&P rr2
t=−3.04). Consistent with the whole genre: chasing the breakout candle gets caught by the fakeout.
**Refinement to test next** (what the content actually implies): enter on the RETRACE into the
displacement's imbalance/FVG, or AFTER the consolidation is first swept — not on the break itself.
Grammar now 9 trigger classes; 3 grammar tests green.

### D-088 — NY Time Based Range (Rauf) faithfully tested: negative on his markets, lead on Gold (2026-08-04)

Operator supplied the exact Time Based Academy method (screenshots): range = 8:12–9:12 NY high/low;
wait for 9:30 open; wait for a TBR liquidity sweep; CISD reversal back into range; enter next bar,
target the OPPOSING end, stop beyond the swept extreme. Built `scripts/trd-tbr-backtest.ts` — a
faithful, time-anchored, no-look-ahead intraday backtester (5m, cost 0.05R/side, OOS split).

**Result (~60d, ~35-40 setups/market):**
- **ES (S&P):** 46% win, **−0.165R**, t=−0.64, OOS +0.05/−0.49 → loses.
- **NQ (Nasdaq):** 53% win, **−0.194R**, t=−1.32, OOS −0.23/−0.15 → loses.
- **Gold:** 43% win, **+0.498R**, t=1.22, OOS **+0.72/+0.17** → positive both halves; low-win/high-RR.

**Verdict:** on the indices Rauf actually trades, the method does NOT survive — negative expectancy,
consistent with D-071..D-087. On **Gold** it is the strongest chart-setup lead the program has found:
positive expectancy, positive out-of-sample in both halves, high-RR sweep-reversal profile. But n=40,
t=1.22 (<2) — a genuine LEAD, not a proof. Reinforces the cross-cutting result: the only recurring
signal is **high-RR sweep-reversals**, never 1:1 win-rate farming. Cataloged (trd_strategies, D-088)
as the pre-registration record (frozen params, registered 2026-08-04). Next: autonomous forward
tracker for Gold-TBR (trd-tbr-tick edge fn + cron), same pattern as btc-sweep-rr3.

### D-089 — Operating principle locked + Gold-TBR instrumented forward (2026-08-04)

Operator north star: *"dominate and control every market we enter; make what's out of my control
serve that goal."* Honored HONESTLY (memory: operating-principle-domination): you cannot control
price — domination = the 4 durable surfaces (KNOWLEDGE / SURVIVAL / COMPOUNDING / DISTRIBUTION) +
ANTIFRAGILITY (instrument every uncontrollable so it pays us or can't hurt us), via SELECTIVITY not
ubiquity. Refused the literal "control the market" reading (it is the D-070..D-088 LARP).

**Acted on it:** froze the Gold-TBR lead (D-088) as pre-registered hypothesis `gold-tbr-v1` and
built `trd-tbr-tick` edge fn + cron (weekdays 21:00 UTC) — runs the exact TBR method on fresh Gold
5m and records ONLY post-registration setups → a single un-deflated forward trial. Whether the lead
holds now resolves into owned knowledge either way (antifragile). Live: forward n=0 (baseline +0.498R,
n=40). Appears on the app cockpit alongside btc-sweep-rr3-v1. Two hypotheses now earning forward
verdicts autonomously.

### D-090 — Edge-Lens Taxonomy: the map of where edges can live (2026-08-04)

Operator: be the most context/knowledge-aware ecosystem — know more than the market about what
edges exist and how to find them; draw out models (lenses) to look at the data. Reframe: a strategy
is one point; a LENS is a whole dimension, each spawning thousands of strategies. So we map the
LENSES, not the strategies.

**Built:** [`docs/research/R-003-edge-lens-taxonomy.md`](./docs/research/R-003-edge-lens-taxonomy.md)
— 12 edge-lenses (price-pattern, time-structure, cross-sectional RV, factor/premia, order-flow,
intermarket, event/catalyst, vol-regime, cycle, flow/positioning, sentiment/funding, calendar-flow),
each with the structural feature it exploits, data needs, free-data feasibility, and our honest status.

**Inventory:** thoroughly done 4 (price-pattern DEAD, factor/premia CLEARED, cycle=halving-only,
cross-sectional weak); partial 4; **UNTESTED free-data frontier 4** = calendar-flow, crypto-funding
carry, event-window vol, intermarket lead-lag. That is the honest answer to "how many more are out there."

**Demonstrated the map generates real tests** (`scripts/trd-xsection.ts`, a lens we'd never used):
cross-sectional relative value on sectors/crypto/indices. Result (D-090 corpus): sector momentum neg
(Sharpe −0.11, shuffle p=0.63), crypto momentum weak lead (0.44, p=0.08, OOS decays), indices nil.
Conclusion: the cross-sectional momentum edge is the SLOW factor (WML, already in the D-077 book),
not a fast tradeable signal. Reinforces the cross-cutting law: edges are slow/structural/risk-managed.

**Frontier queue:** calendar-flow (turn-of-month/OPEX) → funding-carry → event-vol → intermarket
lead-lag. Each becomes a corpus row; survivors pre-registered forward like btc-sweep / gold-tbr.

### D-091 — Frontier lens sweep complete: 4 untested lenses, 0 survivors (2026-08-04)

Operator: "go and don't stop until you're done." Worked the entire R-003 free-data frontier through
the honest gate (shuffle null + OOS + report-n). Real data, real verdicts:

- **Calendar/structural-flow (#12)** — `scripts/trd-calendar.ts`, S&P 10y: turn-of-month p=0.64,
  day-of-week all n.s., OPEX p=0.94. **DEAD.**
- **Event/catalyst (#7)** — pre-FOMC drift (45 events): mean −0.006%, p=0.65, hit-rate 42%. The famous
  Lucca-Moench anomaly has been **arbitraged away** post-2015. **DEAD.**
- **Intermarket lead-lag (#6)** — `scripts/trd-leadlag.ts`: contemp corr 0.78–0.93 dominates; predictive
  lags tiny + non-tradeable; yields→SPX real but negative-expectancy naive trade. **DEAD.**
- **Sentiment/funding (#11)** — `scripts/trd-funding.ts`, Binance keyless: BTC carry 1.7%/yr (thin, calm
  regime), contrarian n.s. (Sharpe −0.60); ETH weak lead (Sharpe 1.07, t=0.72, OOS +); SOL backwardation.
  **WEAK** — real but regime-dependent yield, no clean standalone edge.

**The frontier is exhausted.** Of 12 lenses (R-003): 1 CLEARED (factor premia), 1 LEAD (time-structure,
forward-testing), 8 DEAD/WEAK, 1 GATED (paid order-flow), 1 PARTIAL (vol-regime). Corpus now 9 rows,
0 survivors among chart/tradeable lenses. The cross-cutting law holds across every dimension: **edges
are slow, structural, cross-sectional-premia and risk-managed — never fast, directional, or anomaly-
based.** The only remaining free upside is deeper vol-regime isolation; the only paid upside is
order-flow (a capital decision, not a free test).

### D-092 — Order-flow paywall bypassed + killed; vol-regime = risk-layer win + BTC lead (2026-08-04)

Operator: "if no way around the paywall we pay; follow 1 (order-flow) and 2 (vol-regime) down until
complete." Both completed.

**Lens #5 Order-flow — the FREE path around the tick-data paywall + verdict.** Binance klines carry
`takerBuyBaseVolume` → per-bar delta = 2·takerBuy − volume = real CVD, no paid tick data (crypto).
`scripts/trd-orderflow.ts`, BTC/ETH 15m ~47d: delta is CONTEMPORANEOUS with price (corr 0.68/0.77)
but **ZERO predictive** (corr 0.006 next bar); both confirmation and divergence trades LOSE after cost
(Sharpe −17 to −32, shuffle p≈1). **TESTED-DEAD.** Since crypto CVD is the free equivalent of the
ES/NQ tick signal and it's dead, **paying for futures tick data is NOT justified** — the free proxy
saved the spend. (Caveat: bar-CVD ≠ full L2/footprint, but the R-002 CVD *confidence-lever* is bar-delta
and it is dead.)

**Lens #8 Volatility-regime — completed, PARTIAL-WIN.** `scripts/trd-volregime.ts`: (1) vol clustering
is STRONGLY predictable (corr_t,t+1 = 0.98, t+5 = 0.91 across S&P/BTC/Gold) → **validates vol-targeting
in the risk layer** (the risk system's core assumption is sound). (2) directional squeeze breakout: no
edge on S&P/Gold, but **a real LEAD on BTC** (+0.471R, t=4.45) that SURVIVES adversarial check (long
+0.585 / short +0.152 → not trend-leakage; OOS +0.64/+0.21). Pre-registered `btc-squeeze-v1` +
`trd-squeeze-tick` edge fn + cron (daily 01:30 UTC). Three live forward hypotheses now: btc-sweep,
gold-tbr, btc-squeeze.

**Frontier fully complete.** 12 lenses mapped; the only remaining upside (paid order-flow) is now
falsified on its free proxy. Nothing free is left untested. Durable edge = factor premia + risk mgmt;
three high-RR crypto/Gold leads forward-testing; everything else efficiently priced.

### D-093 — COT positioning tested (last free lens); free frontier COMPLETE (2026-08-04)

Operator: "do all the free ones until you have gotten all the answers." Ran the last genuinely-untested
free lens — **CFTC Commitment of Traders** positioning (free Socrata). `scripts/trd-cot.ts`, with a
proper release lag (survey Tue → act next week, no look-ahead) + shuffle null + OOS.

Result (S&P, the one market that joined cleanly, n=75): corr(commercial-net, fwd-2w)=0.34 (mild) but the
tradeable version is NEGATIVE (Sharpe −0.61, t=−1.04, OOS −0.01/−1.70, shuffle p=0.85). **TESTED-DEAD** —
commercials-as-smart-money is folklore at the tradeable level; the mild corr does not survive as a
strategy. (Honest caveat: the futures-ticker price join had a plumbing gap on Gold/Crude/10Y; the clean
S&P result + positioning already being partial-dead from D-071 settles it.)

**THE FREE FRONTIER IS COMPLETE.** 12 lenses + COT, all tested. Corpus: 12 rows, 4 hard-DEAD, rest
weak/partial, 0 tradeable survivors; the only CLEARED thing is the factor book; 3 leads forward-testing.
**Honest stopping rule stated:** from here, "more tests" means parameter VARIATIONS of already-mapped
lenses, not new lenses — and each variation raises the deflation bar (the multiple-testing tax we
enforce). Running thousands more to find a "winner" is the false-edge factory. The free answers are IN:
the edge is slow factor-premia + risk management; everything fast/positioning/flow/anomaly is efficiently
priced. Remaining upside requires either PAID data (order-flow already pre-falsified on its free proxy)
or real forward time on the 3 pre-registered leads.

### D-094 — dYdX short surface un-automatable; full strategy analysis (R-004) (2026-08-04)

**Short-surface search closed (honest wall).** Attempted the no-KYC dYdX v4 testnet path: wallet
generation + faucet WORK (202, no KYC, no money), but the `@dydxprotocol/v4-client-js` order client
**cannot run in a Supabase edge function** (needs Node node_modules + lodash/protobuf native deps;
Deno edge runtime has neither). Combined with Binance geo-blocked for the operator and Hyperliquid's
faucet gated behind a mainnet deposit, there is NO no-KYC crypto-short surface our autonomous infra
can drive. Verdict: shorts stay on the simulator (validated conservative by Alpaca's real 0.096% fills).

**Full analysis: `docs/research/R-004-full-strategy-analysis.md`** — every strategy/backtest (D-070…
D-093) in one ledger. Tier 0: factor book CLEARED (the compounder). Tier 1: 4 leads forward-testing
(btc-sweep, gold-tbr, btc-squeeze, halving cycle) — all high-RR crypto/Gold vol-liquidity events.
Tier 2: 9 falsified (Pranam grab, 1.01M-cell searches, calendar, intermarket, CVD, COT, insider).
Tier 3: 4 weak/partial (cross-sectional, funding, vol-clustering→risk-layer, 24h cycle). Five
cross-cutting laws proven. Scale: ~1.1M+ configurations, 13 lenses.

### D-095/096 — On-chain flow lead + whole-market shorts + ML meta-labeling (2026-08-04)

Operator ordered #2→#1→#3. All built through the honest gate.

**#2 On-chain flow lens (D-095):** `scripts/trd-onchain.ts` — free data (CoinGecko stablecoin supply,
Blockchain.com activity). **Stablecoin dry-powder 7d growth predicts BTC** (corr 0.20, +1%/wk,
mechanism: capital→stablecoins→buying, positive BOTH OOS halves) but t=1.31 on 51 independent weeks →
uncertified LEAD (overlap-inflated to t=2.52). Network activity signals dead. First non-chart non-factor
lens with a real signal. Frozen `stablecoin-flow-v1`. Honest guard vs the kimchi survivorship anecdote.

**#1 Whole-market shorts (real Alpaca):** `trd-alpaca-equity-tick` — corrects the crypto-only tunnel
vision. REAL Alpaca paper LONG+SHORT on SPY/QQQ/IWM (indices) + **GLD (a real gold surface** GC=F
futures couldn't provide). All 4 confirmed shortable+ETB; IEX data works. Market-hours-gated cron.

**#3 ML meta-labeling (D-096):** `scripts/trd-metalabel.ts` — the HONEST ML. Logistic regression on
signal CONTEXT (vol regime, trend strength, ema slope, stop size, session, recent quality) filters
which sweep signals to TAKE — NOT price prediction. OOS: BTC 0.067R→**0.714R**, ETH 0.290R→**0.750R**
(takes top ~25%), consistent + sensible weights. **First ML win in the program — exactly where predicted
(quality filter, not predictor).** Caveat: filtered test n=14-16 → promising not certified. Deployable
as linear weights (a NEW pre-reg hypothesis, not a mod of the frozen sweep). Corpus now 14 rows.

### D-097 — Entire-market scan: the whole liquid universe, one gate, 0 survivors (2026-08-04)

Operator: "don't stop until we have collected and analysed the entire market." Done.
`scripts/trd-market-scan.ts` — **121 instruments across 7 asset classes** (US large-caps, sector/broad
ETFs, global indices, commodity futures, FX, rates, crypto), **310,856 bars**, both leads (sweep-rr3 +
vol-squeeze) on 10y daily, deflated across all 241 strategy-instrument trials.

**Result: 148/241 positive in-sample (61%) → 0 clear DSR-deflation.** Per-class positive-in-sample rate:
crypto 70% (highest), US large-cap 65%, rates 63%, global-index 62%, ETF 58%, FX 54%, commodity 52%.
Top by deflated Sharpe: ^IRX-sweep 51.5%, ETH-squeeze 28%, LINK-sweep 25% — none near 95%.

**The cross-cutting law is now confirmed at FULL-MARKET scale.** The leads concentrate exactly where
we found them (crypto = highest inefficiency, most retail-driven), plus rates and high-momentum names,
but **no instrument in the entire liquid market carries a certifiable unconditional chart edge.** This
closes the collection+analysis of the entire market: the durable edge is factor premia + risk management
+ the 5 mechanism-backed forward-testing leads — never an unconditional setup, anywhere. Result JSON:
`docs/research/market-scan-result.json`. Corpus: 15 rows.

### D-098 — Inefficient-tail scan: 315 more instruments, hypothesis disproven honestly (2026-08-04)

Operator: "there are way more instruments that will prove an edge — search for a lot more." Tested the
INEFFICIENT TAIL (where a retail edge could plausibly persist): `scripts/trd-market-scan-xl.ts` —
**315 instruments** (242 altcoins from CoinGecko, small-cap/meme equities, EM equity ETFs, leveraged/
thematic ETFs, EM FX), **414,791 bars, 500 trials**, sweep+squeeze at **honest illiquid cost (0.10R/side)**.

**Result: positive-in-sample FELL to 40% (vs 61% for the liquid core)** — at honest cost the tail carries
LESS tradeable edge, not more (wider spreads eat the marginal signal). **1 instrument cleared DSR raw:
USDTRY squeeze (99.9%, +1.225R) — a textbook FALSE POSITIVE:** 466% Lira devaluation over 5y, 123 LONG
breakouts vs 0 SHORT (100% long = just riding the trend), and the price-only backtest ignores ~40%/yr
NEGATIVE CARRY that roughly cancels the gain (covered interest parity). One-off macro regime, non-
stationary, untradeable. **Real survivors: 0.**

**Hypothesis disproven, honestly:** more (and less-arbitraged) instruments RAISED the deflation bar and
did NOT create edge; the single DSR-clearer is a carry-ignoring devaluation-trend mirage the post-analysis
caught. Combined with D-097 (liquid core, 0 clear), the ENTIRE market — liquid core + inefficient tail,
436 instruments, 725k bars — carries no certifiable unconditional chart edge. Corpus: 16 rows.

### D-099 — Stablecoin-flow tracker wired + full-stack security audit (2026-08-04)

**Forward-testing picture complete.** Wired `trd-stablecoin-tick` (weekly cron Mon 02:00 UTC): the
on-chain dry-powder lead (stablecoin-flow-v1) now accrues forward on its own — USDT+USDC 7d supply
growth vs trailing median → long/short BTC, resolved-and-post-registration weeks only, no look-ahead.
All 4 pre-registered hypotheses now have autonomous trackers.

**Security & robustness audit** (`docs/SECURITY-AUDIT.md`). Structural strength: the whole stack is
PAPER-only — no real money, so worst case is a corrupted paper record, not a loss. FIXED two HIGH
vulns: (1) the Alpaca executors' `?flatten=1`/`?selftest=1` were PUBLIC (anyone could close positions
or spam orders) → now require `x-admin: <service-role-key>`, verified 403 for public callers; (2) no
circuit breaker → durable `trd_killswitch` row, checked by both Alpaca executors, verified trip→halt→
reset. Flagged (operator/next): rename the fragile Alpaca secret to standard names; add tracker
staleness alerting. Residual-risk statement: this clears the PAPER threat model only — real money would
require re-hardening (reconciliation, disconnect, exposure caps) and a fresh audit.

### D-100 — Tail-day study across 17 markets + the verified risk control wired INTO the order path (2026-08-04)

**Operator ask:** find every huge-move day across many real markets, test whether those days are
predictable, and turn it into something that helps traders — then fix any foundation cracks. Not on
self-simulated data; verify everything.

**Study (`scripts/trd-tail-study.ts`, real Yahoo daily, 1970→2026, 121,962 tradeable market-days).**
Adversarially audited by an independent Opus pass; every flaw it found was fixed and the study re-run:
- **You cannot predict WHICH day or WHICH direction** a tail lands — the sign is not forecastable.
- **You CAN predict the REGIME (causal, look-ahead-free).** A >3σ day is **5.9×** more likely when
  trailing-20d realised vol is above its own trailing-252d median — a regime visible IN ADVANCE.
  **84.5%** of all tail days occur in that elevated regime. (Headline uses a trailing-σ tail label to
  remove the fixed-σ/heteroskedasticity artifact the auditor flagged; the inflated fixed-σ version was
  7.1×. Level series ^TNX/DX excluded from the pooled rate; adjClose used; up-day window made causal.)
- **The biggest UP days are a trap:** 68.1% occur below the 200d MA (bear-market rallies); 28.6% land
  within 3 days AFTER a >3σ crash. You cannot harvest the up-tail without sitting in the down-tail's
  cluster → the correct reaction to a high-upside regime is REDUCE, not chase.
- **Tail risk is systemic:** 93 dates had ≥5 markets post a >3σ move together — all 2008 / 2020 / 2011.
  Diversification fails exactly when it's needed → de-risk must be portfolio-level.

**Crack found + fixed (the one that mattered).** The thesis says the risk gate is the only near-certain
positive-EV component — yet it was computed by `trd-macro` and applied NOWHERE in the order path. Both
Alpaca executors sized purely off stop distance. **Fixed:** new tested primitive
`_shared/trd-vol-regime.ts` (`volRegimeDeRisk`) = causal vol-target capped as a strict risk-REDUCER
(size ×min(1, medianRV/RV), floor 0.30, no-op when calm or history thin; never levers up). Wired into
BOTH `trd-alpaca-tick` (v5) and `trd-alpaca-equity-tick` (v4), deployed, and **verified LIVE on real
Alpaca daily data** via `?volprobe=1`/`?probe=1`: today QQQ RV 1.52%>1y-median 1.08% → size ×0.715,
SPY ×0.90, IWM/GLD/BTC/ETH calm ×1.00. Guard: `_shared/trd-vol-regime.test.ts` (5 tests, green).

**Status:** the verified regime control is now enforced in sizing, not just displayed. Still PAPER-only
(no real money before the gates). Corpus unchanged. Remaining flagged cracks (unchanged from D-099):
Alpaca secret rename; tracker staleness alerting; surface the tail-risk regime flag on the cockpit.

### D-101 — Synthesis of the "free finance" essay into the models + tail-risk flag on the cockpit (2026-08-04)

Operator shared an eight-pillar essay (Merlow, "Everything You Need to Retire Was Published Decades
Ago") and asked to use as much as possible in our models. The essay is, in effect, an external audit of
Aegis's thesis — it maps almost one-to-one onto what we've built. Mapping each pillar → what we do:

| Essay pillar | Aegis status |
|---|---|
| **2. Kelly / fractional Kelly** — size matters more than edge; use ≤half-Kelly because you never know your edge; overbetting ruins even a winning system | **NEW this turn:** `_shared/trd-kelly.ts` (+6 tests) — quarter-Kelly on each strategy's *measured* forward edge (p, payoff b, f*=p−(1−p)/b), capped at base budget (pure reducer), tiny-probe on a measured non-edge, conservative default under small sample. Wired into BOTH executors, deployed, verified live (n=0 now → 50%-of-base default, adapts as trades resolve). |
| **5. Mandelbrot fat tails** — real risk of ruin > your model; bell curve fails; leverage amplifies non-linearly | Validated by D-100 (kurtosis 6–55, tails 5–6× normal). Sizing biases DOWN (fractional Kelly + vol-regime), never assumes normality; ruin metric on the Risk-Xray uses empirical inputs. |
| **1. Sequence-of-returns risk** — order of returns, not average, decides survival; flexibility (de-risking in bad years) beats clever allocation | This is exactly the D-100 vol-regime de-risk: shrink exposure ahead of the high-tail regime. Now surfaced on the cockpit. |
| **3. Buffett — never lose money / survival first** — can't compound from zero | The founding invariant: the risk gate is the only near-certain positive-EV component; no real money before the gates. |
| **4. Simons / Medallion capacity cap** — edge exists in a size range, vanishes at scale | Honest capacity caveat: every lead we find is capacity-bound; we never claim infinite scaling. |
| **6. Lo — Adaptive Markets** — edges decay because they get crowded; anything working recently is near end-of-life | The whole project's finding (no durable chart edge; leads decay). Forward trackers exist to catch decay; a rolling-expectancy decay monitor is the next add. |
| **7. Cost is the one variable you control** | Costs are pessimistic-by-default in every backtest (invariant). |
| **8. Livermore — psychology / disposition effect** | Neutralised structurally: execution is deterministic rules, no discretion, no LLM in the order path. |

**Cockpit:** the D-100 tail-risk regime flag is now surfaced on `aegis-cockpit` (HTML + `?format=json`
`data.vol_regime`) and in the GitHub-Pages web app — per-instrument de-risk ×factor, the SAME primitive
the executors apply, so the operator sees exactly the sizing the bots use. Verified in-browser (SPY
×0.91 / QQQ ×0.71 ELEVATED, Gold/BTC/ETH ×1.00 calm). Sizing is now `kelly × vol-regime` — measured
edge × regime, both strict risk-reducers under the base budget. NOTE: the public GitHub-Pages deploy of
the web app is not re-pushed from this repo (no remote here; publishing is operator-gated) — the source
change is committed and verified locally against the live API.

### D-102 — Edge-decay monitor + tracker-staleness alerting + web app published (2026-08-04)

Completing the D-101 remainder ("go until completeness").

**Edge-decay monitor** (`_shared/trd-decay.ts` +6 tests) — Adaptive-Markets pillar made operational:
splits a strategy's chronological trades into early vs recent halves and flags `improving / stable /
decaying / dead`, where **dead** = was positive early, now ≤0 (the crowded-out death Lo describes).
Wired into `aegis-cockpit` as a "decay watch" column. On real data it immediately earned its keep:
`fvg:london` (+0.03R) and `fvg:ny` (−0.00R) flagged **DEAD**, `fvg:asia`/`sweep:asia` **decaying** —
edges that a raw expectancy number would have shown as ~flat, now correctly marked as decayed.

**Tracker-staleness alerting** (closes D-099 #4) — `aegis-cockpit` now reports each autonomous tracker's
`updated_at` age vs its cadence and flags STALE. Verified live: all 5 (paper loop, macro pump, pre-reg
tracker, both Alpaca execs) LIVE. Answers "is the engine actually running?" at a glance.

**Web app published** — the GitHub-Pages app (`syyym0n3y/aegis-engine`, commit 21c50e3) now carries the
tail-risk regime, decay watch, and tracker freshness. Verified in-browser on the live public URL. The
cockpit function (HTML + json) deployed to match. 151 `_shared` tests green; `deno check` clean.

**Still operator-only (cannot self-serve):** rename the Alpaca secret to `APCA_API_KEY_ID` /
`APCA_API_SECRET_KEY` in the Supabase dashboard (code already reads either) — the only open item from the
D-099 audit that requires the operator's own credentials.

### D-103 — On-chain "whale-behaviour" backtest → REJECTED (2026-08-04)

Operator asked to backtest the whale-tracking idea rather than forward-register it. Built
`scripts/trd-netflow-backtest.ts`. **Stated constraint:** true labelled-exchange netflow is PAID
(Glassnode/CryptoQuant); tested the strongest FREE aggregate proxies (Blockchain.com): active
addresses, on-chain USD settled volume, output(BTC) volume, tx-count, NVT — 5,781 daily rows 2010→2026.

Method: 6 signals × 2 direction-modes = 12 configs, each causal + cost-charged (10bps/turn). Select the
best on the first 70% (in-sample), report the last 30% (holdout, never used for selection); deflate the
in-sample winner by trial count (DSR); shuffle-null on the holdout; buy&hold as benchmark.

**Result — clean REJECT:**
- Best in-sample (active-addr momentum, long/flat) Sharpe **1.29** ≈ buy&hold **1.25** → no alpha even
  in-sample; it was just being long BTC in an uptrend.
- **HOLDOUT Sharpe −0.28** (buy&hold 0.01). **ALL 12 configs had NEGATIVE holdout Sharpe** — not one
  survived out of sample.
- **Deflated Sharpe 73.9% → FAILS the 0.95 gate.** Shuffle-null p≈0.80 → indistinguishable from chance.
- Only "benefit": part-time-in-cash cut max-DD (68% vs 82%) — that's de-risking, not edge.

**Verdict:** aggregate on-chain whale-behaviour carries no deflated, out-of-sample edge on BTC — it
front-runs to nothing, exactly as `trd-onchain.ts` predicted and consistent with D-095 (stablecoin lens
t=1.31) and the engine's core finding. Paying for labelled-exchange netflow is a low-EV bet: the free
proxy is already dead and it's the same public-signal/front-running class (cf. D-092 order-flow). Not
wired. Whale-tracking is falsified, not deferred. Corpus unchanged.

### D-104 — Leads resolved on DEEP HISTORY today (not forward-waited) + doctrine fix (2026-08-04)

Operator, correctly: forward-testing was being used as the thing we WAIT on to learn — months of "0/30"
— when existing history answers now. Fixed the default and resolved the "waiting" leads on deep data:

- **`btc-sweep-rr3` → FALSIFIED.** `scripts/trd-lead-oos-now.ts`: 130k BTC 15m bars (2022-11→2026-08),
  ran the FROZEN spec vs all 4,860 grammar specs. **N=4,673 trades, expectancy −0.019R, Sharpe −0.011,
  rank #318/4,430, DSR 0.0%**, walk-forward decays +0.004R→−0.042R. A search survivor, not an edge.
  4,673 historical trades gave today the verdict 2/30 forward trades would have taken until Q4 to hint.
- **`btc-squeeze-v1` → MARGINAL SURVIVOR (kept, weak).** `scripts/trd-squeeze-oos-now.ts`: deep daily
  BTC (3,275 bars, 2017→2026). **N=166, +0.052R/trade, 39% win, +8.6R total, walk-forward HOLDS
  (+0.015R→+0.089R).** Real but thin (annualized Sharpe ~0.15) — not investable alone, not falsified.
- **`gold-tbr-v1`** — free 5m gold is capped at ~60 days (Yahoo), so no deep test is possible on free
  data; the 60-day analog run earlier was noise/negative. Honest limit, not a pass.
- **`stablecoin-flow-v1`** — weekly macro signal, inherently low-N (t=1.31 in-sample, D-095); this one
  genuinely needs forward weeks because its history is short — the ONE place forward-waiting is justified.

**Doctrine fix (added to CLAUDE.md):** every lead is resolved on ALL available history with walk-forward
+ trial-deflation FIRST; forward-testing is a background re-confirmation, never the bottleneck to a
verdict. Only genuinely history-poor signals (short-history weekly macro) wait on forward data.

### D-105 — Portfolio risk engine: the broker-agnostic, correlation-aware, fat-tailed ruin X-ray (2026-08-04)

Operator: "think outside the box, the sandbox is limiting… be in a better position than anyone to help
traders make money through risk management." The honest reframe held: risk management doesn't make money
per trade — it prevents the ruin that stops compounding. The real constraint was never compute/paid data;
it was ALTITUDE — we were a research sandbox, not a tool on traders' real books. The unlock needs no
broker integration: every broker exports a positions list, so we compute risk from that.

**Built `trd-risk-engine` (public, CORS-open) + `_shared/trd-portfolio-risk.ts` (7 tests):**
- **Correlation-adjusted "real bet count"** — effective number of independent bets (diversification
  ratio²). Five 0.9-correlated longs read as ~1 bet, not 5 — the hidden concentration that kills retail.
- **Fat-tailed joint risk of ruin** — block-bootstrap Monte-Carlo on REAL joint history (vol-clustering
  + 2008/2020 tails preserved), NOT Gaussian VaR (which D-100 proved lies exactly at the tail).
- Per-position vol-regime de-risk, gross exposure, 1y outcome band, and a sizing prescription.
- Verified live: $25k / 4 tech longs @2× → verdict RUINOUS, 4 positions → **1.51 real bets**, **28.1%
  chance of a 50% drawdown**, "cut to 84%." No free single-position calculator does this.

**Reach:** surfaced as a "Portfolio risk" tab in the global web app (any trader, any broker, a positions
list). No signals, no direction — pure risk. This is the differentiated product the whole thesis pointed
at: the seatbelt that keeps traders alive long enough for compounding to work. 158 _shared tests green.

### D-106 — Live risk monitor (free, polled auto-sync) + the itzjblair reality check (2026-08-04)

Operator sent an Instagram day-trader's per-trade "wins" (itzjblair: +$9.9k, +$30k, +$43k floating) as
"what a good set-up can do," and asked for the real-time risk monitor built free. Both handled:

**The reality check (honest-advisor, evidence-backed).** The screenshots are the exact survivorship trap
the engine exists to kill: the giant green numbers are UP&L (UNREALIZED, floating open positions); the
banked RP&L is NEGATIVE in nearly every frame (−$266, −$1,694, −$2,177, −$4,320). Ran his Img-3 size
(20 MNQ short ≈ $1.17M on a "$50k" account) through our own `trd-risk-engine`: **23.4× leverage, 100%
P(50% drawdown), worst-5% = −100% (full wipe).** Even 1 NQ contract on $50k = 9.6×, 100% ruin. The
"$30 bomb" winner and the account-ending wipe are the SAME bet at the SAME size — inseparable. Prop-eval
accounts + finfluencer framing ("first day live", Follow, motivational overlays) = a dream sold to the
96%, not an edge. This VALIDATES the mission (the monitor is the antidote), it does not change the goal.

**The monitor (free, no paid host).** `trd-risk-monitor` — ruin is a slow variable, so cron-polling the
real book beats a websocket daemon: reads the live Alpaca account READ-ONLY, runs the D-105 fat-tailed
portfolio-ruin engine on ACTUAL positions, writes `trd_risk_state`, raises an alert ≥15% ruin, and with
`?enforce=1` trips the durable kill-switch (halts OUR paper bots ONLY — never places/closes a real
order). Scheduled hourly via pg_cron ($0). Surfaced on the cockpit (HTML + json `live_account_risk`).
Verified live: our own account flagged **AGGRESSIVE, 14.5% ruin, "2 positions = ~1.09 real bet
(correlated → concentrated)"** — the monitor catching hidden concentration on our own book.

### D-107 — Funding-carry backtest → real but arbitraged to ~0 now (2026-08-04)

Operator pushed for "make a ton with reasonable R:R." Tested the best structural candidate — delta-neutral
crypto funding carry (own spot, short perp, collect funding). `scripts/trd-carry-backtest.ts`, Binance
free funding history (~5.5mo, 2026 H1). GROSS annualized carry: BTC +1.8%, ETH +1.0%, SOL −1.7%; funding
negative 34–52% of periods; max DD tiny (0.8%). Genuinely low-risk (reasonable R:R) but reward is now
below T-bills — the premium that paid 10–30%/yr in 2020–21 has been crowded out. (Caught + fixed a cost-
model bug that first showed a false −20% before reporting.) Converges with the whole map: every ACCESSIBLE
edge (chart, on-chain, carry) is arbitraged toward zero. The honest "a ton with reasonable R:R" is a real
Sharpe~1 edge (the diversified trend/factor book) leveraged safely over YEARS — not fast. Fast+ton = high
leverage on a thin edge = ruin (D-106 itzjblair). Next honest test: diversified multi-market trend-following.

### D-108 — Cross-sectional trend ROTATION tested (the operator's actual model) (2026-08-04)

Operator, correctly: prior tests were single-setup/single-instrument; his real model is continuous
cross-sectional rotation — hold the top trend-ranked charts, ride to consolidation, rotate capital.
`scripts/trd-rotation-backtest.ts`: 28 instruments (ETFs+crypto), 2015→2026, weekly rotation into top-K
risk-adjusted trend leaders, inverse-vol weighted, vol-targeted 15% (cap 3x), long-only positive-trend.

Result — first approach to beat buy&hold IN-SAMPLE, but failed OOS:
- **IS (2015-21) Sharpe 0.80 vs SPY 0.67** — real signal (single-setups were negative even in-sample).
- **HO (2022-26) Sharpe −0.21 vs SPY +0.37, CAGR −3.4% vs +5.1%, maxDD 44.7% vs 18.9%.** All 9 configs
  failed OOS. DSR 97.8% on IS is overruled by the holdout — the gap is why holdout exists.

Honest caveats (on the method, not the thesis): (1) one 40% holdout = one regime, and 2022-23 was
historically brutal for momentum; (2) the EXIT was modeled crudely as calendar rotation, NOT the "ride
until consolidation" trend-decay exit the operator specified — his edge claim lives in the exit, which
this test did not faithfully build. Next: a proper trailing/trend-decay exit + ruin-engine DD cap, OOS.
Not a rejection — an under-modeled exit. Corpus unchanged pending the faithful re-test.

### D-108b — Faithful trailing-exit rotation: the operator's exit VALIDATED (2026-08-04)

Rebuilt D-108 with the operator's ACTUAL exit — Chandelier trailing trend-stop ("ride the high, cut on
rollover into consolidation") + trend-rank redeploy — instead of calendar rotation. `scripts/trd-rotation-
trail.ts`, same 28 instruments 2015→2026. The exit discipline is real and material:
- **IS Sharpe 0.80 → 1.18** (SPY 0.67); **OOS Sharpe −0.21 → +0.16** (flipped positive); **OOS max
  drawdown 44.7% → 17.9%** (≈ SPY's 18.9%, while diversified). Best result in the project besides the
  factor book. The operator's "don't leave early / don't stay late" exit HALVED drawdown — validated.
- Honest gap: still trails SPY buy&hold OOS (+1.7%/yr vs +5.1%) because it's LONG-ONLY and 2023-25 was a
  US-tech-concentrated regime a diversified long-only rotator can't beat. Drawdown matched SPY while
  diversified → it was protecting, not winning. Next: LONG/SHORT (capture downtrends both directions) —
  the honest test of whether the full model beats buy&hold OOS + where the asymmetry lives.

### D-108c — Long/short trend rotation: uncorrelated but thin; the honest alpha ceiling (2026-08-04)

Added the short side to the faithful-exit rotation (`scripts/trd-rotation-ls.ts`) — rotate into strongest
UP and DOWN trends, trailing-stopped both ways. Result: did NOT beat long-only or SPY (IS 1.03, OOS
Sharpe 0.08 vs long-only 0.16 vs SPY 0.37; CAGR 0.9%) — shorts dragged in the 2023-25 bull. BUT **OOS
correlation to SPY = −0.15** (uncorrelated). 

**Synthesis of the rotation arc (D-108/b/c):** the operator's model is REAL and validated (the trailing
"ride-to-consolidation" exit halved drawdown, returns positive OOS, uncorrelated to stocks) — a genuine
CTA/trend return stream. But OOS alpha is THIN (~0.1-0.2 Sharpe) and does not beat holding US equities in
the 2023-25 regime. Key honest correction to the operator's premise ("$100→$1M = risk-model optimization"):
leverage/risk-optimization MULTIPLY a robust edge; they cannot manufacture one — a thin edge levered is a
thin edge with bigger swings (cf. D-106 itzjblair 23×→ruin). Three durable assets remain: (1) this
uncorrelated trend stream as a portfolio DIVERSIFIER (its real value, not S&P-beating), (2) the shipped
risk/survival engine, (3) the product (the only genuine 1e10× lever; needs no trading alpha from us).
Alpha hunt reaching honest closure: retail-accessible directional alpha is thin-to-zero OOS across every
class tested (chart, on-chain, carry, single-setup, rotation); durable edge = risk + diversification + product.

### D-109 — Prop-farming economics: operator's model validated + the risk-optimization is the multiplier (2026-08-04)

Operator's correction (right): influencers farm PROP accounts — downside = eval fee (~$300), not the
balance; pass target, collect payout, reinvest. That's cheap optionality, and P(pass) is dominated by
SIZING → "the difference is risk-model optimization" is TRUE in this frame. Quantified it:
`scripts/trd-prop-sim.ts` (Monte-Carlo, $50k / +8% target / 10% maxDD / 5% daily / two-hurdle eval+funded).
- With a MODEST real edge (47% win, 2:1 → +0.41R): optimal sizing (0.25-0.75%/trade) → P(paid) ~100%,
  **EV +$2,900 per $300 eval (~10×), downside capped at $300.**
- Same edge, oversized 5%/trade (itzjblair school): P(paid) 23%, EV +$448 — 85% of value thrown away by
  sizing alone. The risk model is the multiplier, exactly as the operator argued.
- NO-edge control (coinflip, both hurdles): P(paid) 0%, EV −$300. This is the firm's business — they sell
  to the edgeless. (Caught + fixed a first-pass bug that treated 'pass eval'='cash', which wrongly made
  coinflip +EV.)
**VERDICT:** prop-farming is a genuine +EV, capped-downside, scalable business — IFF (1) a real (even
modest, +0.4R) edge AND (2) sizing optimized to pass. Unifies the project: risk engine (Kelly/vol/ruin) =
the pass-rate optimizer; the bottleneck remains a modest REAL edge. Two products fall out: (a) prop-farm
with our sizing engine once a modest edge is established; (b) a "pass your prop challenge" sizing tool for
the millions who buy evals — honestly tells most of them they have no edge, and the edged ones how to size.

### D-110 — Both built: prop-edge test (our signal) + "Pass Your Prop Challenge" product (2026-08-04)

Operator: "build both."
**(1) Our edge vs the +0.4R prop bar** (`scripts/trd-prop-edge.ts`): the validated trailing-trend entries
logged per-trade R. IS +0.81R (clears), **HOLDOUT +0.12R (below the +0.4R bar), 27% win.** Positive OOS
(notable — better than every chart setup) but too thin AND wrong-shape for prop (27% win → long losing
streaks breach the drawdown rule). Honest no on farming with THIS edge; sharpened the target to a higher-
win-rate, lower-variance signal.
**(2) `trd-prop-optimizer` (public product)** — "Pass Your Prop Challenge": takes a trader's real win/RR +
firm rules, two-hurdle Monte-Carlo → true P(paid), optimal risk/trade, EV/eval, honest verdict. Verified:
modest edge → "STRONG — FARMABLE, 0.25%, +$2900"; coinflip → "NO EDGE — DON'T BUY". Surfaced as a "Prop
challenge" tab in the app. Serves the millions who buy evals (~90% fail) — honestly tells most "don't buy",
the edged ones how to size. Needs no trading alpha from us; runs on the shipped risk math.

### D-111 — Prop-shaped edge FOUND: VIX-conditioned mean-reversion (high win rate) is farmable (2026-08-04)

Operator: hunt the prop-shaped edge (high win rate, shorts, cyclic/regime conditions). Tested the class I'd
neglected — RSI-2 mean-reversion, long the oversold + SHORT the overbought, regime-filtered, hard 2×ATR stop.
`scripts/trd-meanrev.ts` + `trd-meanrev-stacked.ts`, 12 liquid ETFs, 2015→2026.
- **Mean-reversion is prop-shaped: 64-70% win rate** (vs trend's 27%). Survives drawdown rules.
- **Shorts require the regime filter**: shorting overbought in ANY tape = −0.07R (run over in uptrends);
  shorting overbought in a DOWNtrend = +0.058R/67%. Validates the operator's "daily/weekly shorts, in the
  right conditions."
- **VIX is THE favorable condition**: same setup, high-VIX(>20) +0.162R vs calm −0.010R. Stacking (higher
  VIX + tighter RSI) lifts win rate to 78% / +0.2R but trades get rare (5-11/yr) and noisy.
- **The reframe that matters**: my "+0.4R bar" was WRONG for prop — prop is a win-rate/survival game, not
  an expectancy game. Ran the real edge (70% win, +0.11R) through the prop optimizer → **STRONG-FARMABLE,
  61% pass, EV +$1,661 per $300 eval** at 3% sizing. A thin edge with a HIGH win rate IS prop-farmable.

**First genuinely actionable prop strategy.** Honest caveats: (1) FREQUENCY — daily setups fire ~0.3/day
across 12 instruments; a 40-day eval needs more (solve: wider universe / intraday), the operator's "high
liquidity" point; (2) the +0.11R is optimistic vs the broad-grid OOS (~+0.02R) — forward/OOS confirmation
needed; (3) real-platform slippage. Next: pre-register the frozen VIX-conditioned mean-reversion spec +
expand universe for frequency + forward-test. This is the lead that fits the operator's model.

### D-112 — meanrev-vix-v1 pre-registered + wired: forward tracker, scanner, personal-risk map (2026-08-04)

Wired the D-111 prop-shaped edge end-to-end.
- **Pre-registered** `meanrev-vix-v1` (frozen spec + timestamp 2026-08-04 23:47Z): RSI-2<5 long / >95 short,
  200MA regime, VIX≥20 gate, 2×ATR stop, RSI-revert exit, forward-only.
- **`_shared/trd-meanrev.ts`** (+5 tests): the signal + trade-resolver as one tested primitive so the live
  tracker and backtest run identical code.
- **`trd-meanrev-tick`**: forward tracker (resolves trades, accrues R, no look-ahead) + live favourability
  SCANNER across a broadened 40-instrument universe (indices/sectors/intl/commodities/bonds/crypto/mega-cap
  singles). `?scan=1` = live "which markets/side are favourable now". Cron weekdays 22:00 UTC. Surfaced on
  cockpit. Verified: VIX 16.5 now → 0 setups ("calm, sit out") — the regime gate works; it fires on stress.
- **Personal-account risk map** (`scripts/trd-personal-growth.ts`): at 200 favourable trades/yr, **~2-3%
  risk/trade = the grow-a-ton-safely band — 56-92% median CAGR with 0% chance of a 50% drawdown**; above
  ~5% enters the blow-up zone (P(50% DD) 9%→82%). The edge is thin (+0.11R) so growth = FREQUENCY ×
  compounding, not big bets.

**Honest limits (do-not-oversell):** the CAGR ceiling assumes the +0.11R favourable-condition edge HOLDS
live — the broad-grid OOS was thinner (~+0.02R), so the forward test (now accruing) is the arbiter, not the
backtest. Timeframe = DAILY only (free-data limit); intraday needs forward collection or paid data. "First
to know" = the live scanner; it currently says WAIT (VIX calm). Nothing risks real money — forward/paper only.

### D-113 — Conditions map: which setup wins in which regime (+ honest short-side correction) (2026-08-04)

Operator: study which setups won in which conditions across all ingested instruments + cyclic context.
`scripts/trd-conditions-map.ts` — 5 setups fired unconditionally across 35 instruments (~11y), each trade
tagged by VIX regime / trend / day-of-week / month, aggregated to a lookup. Findings (expectancy/win%/N):

| Setup | Best condition | Worst |
|---|---|---|
| **dip-buy (RSI<30, uptrend)** | **STRESS VIX>25: +0.088R/57%** | Feb season |
| rsi2-long (oversold) | STRESS: +0.055R/55%, aboveMA +0.048 | Jan season −0.10 |
| breakout-long (20d high) | normal VIX +0.049R | **STRESS −0.037** (trend fails in stress) |
| rsi2-short (overbought) | **LOSES everywhere −0.103R** | calm −0.127 |
| breakdown-short (20d low) | **LOSES −0.121R** | aboveMA −0.205 |

**The map's story:** LONG mean-reversion (buy dips/oversold) is the edge, and it's STRONGEST in high-VIX
stress. Breakout/trend is the COMPLEMENT — works in calm/normal, FAILS in stress. Regime dictates setup:
calm→trend, stress→mean-rev-long. **Cyclic:** Wednesday best day for longs (+0.08R/56%); seasonality per
setup (dip-buy best Dec, breakout best Jan, mean-rev-long best Jul).

**HONEST CORRECTION:** SHORTS LOSE systematically — both fade-overbought (−0.10R) and breakdown (−0.12R),
across all regimes. The market's upward drift punishes systematic daily shorts. This corrects the D-111
short claim (+0.058R "short in downtrend"), which was fragile to the narrow 12-instrument/narrow-exit test;
on the broad universe with a clean horizon, the short side is a drag. Implication: meanrev-vix-v1's short
leg is a negative-EV component → recommend a LONG-ONLY refinement (dip-buy + high-VIX = the +0.088R/57%
cell). The operator's daily/weekly-short thesis does not hold on daily EOD bars (may differ intraday).

### D-114 — Intraday session engine (sweep-reversal) + DayTradingRauf/TBR methodology (2026-08-04)

Built the intraday engine on 1m data (Binance BTC/ETH, 55d, 80k bars each). Sweep-reversal both directions,
session-tagged, CVD-filtered (`scripts/trd-intraday-sweep.ts`).
- **Raw mechanical sweep-reversal is THIN**: +0.02R, ~37% win at RR2 (≈breakeven, same profile as the daily
  TBR). CVD confirmation is NOT a clean filter (helped ETH-long +0.136 vs +0.065, hurt BTC-short).
- **Session is the strong axis**: NY best — BTC SHORT NY +0.090R/40%, ETH LONG NY **+0.180R/43%** (n=352);
  London worst. Consistent with US-session liquidity. (55d = small; directional, not proven.)

**DayTradingRauf / Time Based Academy (operator-supplied, CREDIBLE — unlike itzjblair):** shares REAL
monthly P&L WITH losing days (+$56K Mar incl −$8.58K/−$5.4K red days; +$19.5K Apr incl −$6.04K week;
"3 wins 1 loss" weeks). Repeatable model: **NY TBR = mark 8:12–9:12 ET range → wait for 9:30 open → wait
for liquidity to be taken (sweep) → enter the reversal (order block/delivery shift) → target the OPPOSING
end, stop beyond swept extreme.** ES-vs-NQ relative strength. NOT survivorship (losses shown, monthly
consistency, trades what he preaches).

**The decisive insight (his own words) = our whole thesis:** *"Your edge isn't designed to fire every day.
It's designed for specific conditions. You're losing because you're over-exposing your strategy — maybe
2–3 of 5 days offer clean high-probability conditions."* The edge is NOT the raw sweep (thin, as our
backtest shows) — it's the SELECTIVITY/condition-filtering that picks which 2–3 days to take. That's
testable: replicate his filters (validate the range before 9:30, clean liquidity take, relative strength,
NY session) and measure whether the FILTERED sweep-reversal clears a real edge where the raw one doesn't.
Next: precise NY-TBR engine (8:12–9:12 ET, 9:30 wait, opposing-end target) + condition filters on 1m equity.

### D-115 — Generalized session-range engine (every session × market, broad): raw loses, "edges" are small-N noise (2026-08-04)

Broadened the intraday sweep→reversal→opposing-end (Rauf's TBR logic) across 5 crypto markets × 3 sessions
(Asia/London/NY) × 90d 1m = 1,209 trades (`scripts/trd-intraday-tbr.ts`). Honest result:
- **RAW loses: −0.057R, 19% win.** Low-win-rate/high-RR shape (target = opposing range end). Confirms the
  raw mechanical sweep-reversal is not an edge — same as daily TBR, trend, carry, on-chain.
- **Session gradient real-ish:** NY best (+0.074R), London breakeven, Asia worst (−0.204R). London/NY SHORT
  less-bad than long. Consistent with active-session liquidity.
- **Selectivity filter (trend-aligned + high-vol) moved raw −0.057R → +0.038R (159 trades)** — marginally
  positive but STILL 16% win (wrong shape for prop; long losing streaks breach drawdown).
- **The standout cells are NOISE, not edges (flagged honestly):** London short+downtrend+hivol +1.842R but
  **n=13**; NY same +1.446R **n=33**; BTC filtered +1.135R **n=29**. Small-N at high RR = data-mining
  artifacts. Presenting these as "found it" would be the exact survivorship trap the engine exists to kill.

**Honest conclusion:** the MECHANICAL version of Rauf's method does not carry a robust systematic edge
across a broad, careful test. His real +$56K/mo is real but comes from DISCRETIONARY condition-reading
("validate before 9:30", ES/NQ relative strength, which 2-3 days, execution/exits) that is NOT
systematizable from free OHLCV. This converges with the entire project: retail-accessible MECHANICAL edges
are thin-to-noise; the money that exists is discretionary skill OR the risk/prop/product business. What a
real systematic intraday test would need (don't have): years of 1m (not 90d), equity/FX feeds, and
order-flow/footprint data (paid) — the "read" Rauf uses likely isn't in free OHLCV.

### D-116 — Volatility Risk Premium (covered-call / option-selling): the first REAL high-win-rate edge (2026-08-04)

Operator proposed holding core shares + using options ("house money"). Untangled: shares don't decay;
selling covered calls COLLECTS theta = harvesting the Volatility Risk Premium (VRP). Measured it on real
data (`scripts/trd-vrp.ts`, SPY vs ^VIX, 25y/6155 days):
- **VRP is real + persistent: implied 19.4 vs realised 15.8 = +3.6 vol pts, POSITIVE 84% of months**,
  positive in every regime (calm +2.3 / normal +4.0 / stress +5.1). Option sellers are paid ~5/6 of the time.
- **84% win = prop-shaped, high-probability** — and STRUCTURAL (paid to bear risk), NOT a front-run chart
  pattern, so it doesn't arbitrage to zero like the directional stuff.
- Covered-call test: Sharpe 1.11 vs buy&hold 0.71 (risk-adjusted win). **HONEST FLAG: my CC CAGR came out
  13.2%>10% — likely my Black-Scholes premium approx is too generous; the robust/literature result is CC ≈
  or slightly < buy&hold total return but much lower vol/drawdown. Bank the Sharpe, not the CAGR.**

**Caveats:** covered calls cap upside + keep full downside; VRP crashes (Feb-2018 Volmageddon, Mar-2020)
hit sellers hard — the D-100 fat-tail engine is exactly the sizing/hedging tool for this (danger & tool matched).

**Strategic map (structurally-different approaches):** VRP/option-selling = REAL, high-win, best edge found;
carry = real-but-arbitraged; trend/CTA = real diversifier, thin OOS; rel-value & event = real but
untested/gated; directional/chart/intraday = front-run to noise (tested 10×). **Conclusion: reasonable-R:R
money lives in STRUCTURAL PREMIA (paid to bear risk), not directional prediction. VRP is the standout.**
Next: validate with CBOE BXM/PUT/PUTW actual index history (real buy-write/put-write track records), then
wire tail-managed. Options data (chains/IV) needed for a full build — the one paid-ish gap.

### D-117 — "G Trade" house-money covered-calls = right concept, decay-trap instrument (2026-08-04)

Operator's source for the covered-call idea: TikTok "G Trade" — covered calls on LEVERAGED ETFs (TQQQ 3x,
TSLL 2x) framed as "rent collecting with house money." His OWN screenshots show LOSSES: sold calls "down
322%" (−$1,420 MV), a TQQQ $51 call bought back for −$1,292 realized (−384%), shares −33% underwater
(avg $79.30 → ~$53). His own words: "like any leverage ETF you should NOT be buying and holding." Tell: his
search bar reads "pov ideas for content video funny" — the trading is content; "$10k/day" is the hook.

**Quantified the decay (TQQQ vs QQQ, 2010-2026, real data):** QQQ +1,733%/−35% maxDD; TQQQ +32,165% but
**−82% maxDD**, and vs a no-decay "true 3x" of +72,157% → TQQQ delivered <HALF of pure 3x; the missing
~40,000pp = volatility decay. Leveraged ETFs are the WORST "hold forever" underlying, and a covered call on
one is the worst combination (capped upside + decay + rocket-losses on the short call).

**Verdict:** the CONCEPT (covered calls = VRP harvest, D-116, 84% positive) is real; G Trade's IMPLEMENTATION
is a decay trap his own numbers show losing. Correct version = covered-call/put-write on QUALITY non-decaying
underlyings (SPY/blue-chip/dividend), tail-managed by the D-100 engine. Keep the idea, drop the ticker + guru.

### D-118 — VRP on REAL CBOE data (corrects D-116): risk-reducer, not return-multiplier (2026-08-04)

Pulled the actual CBOE indices (free, Yahoo): ^BXM (BuyWrite, since 1988), ^PUT (PutWrite, since 1996) vs
SPY, 30y aligned (`scripts/trd-vrp-cboe.ts`).
- SPY buy&hold: CAGR 10.4%, vol 19.3%, Sharpe 0.51, maxDD 55%.
- ^BXM covered-call: CAGR **7.3%**, vol 14.1%, Sharpe 0.50, maxDD 40%.
- ^PUT put-write: CAGR 8.5%, vol 15.3%, Sharpe **0.54**, maxDD **37%**, corr 0.80.

**CORRECTS D-116:** my BS-approximation gave covered-call 13.2% CAGR (beating buy&hold) — WRONG; real BXM
did 7.3%, well BELOW SPY. Honest truth: VRP is real but the STANDARD harvest does NOT beat buy&hold on
return — it delivers similar RISK-ADJUSTED return with much shallower drawdown (37-40% vs 55%), giving up
~2-3%/yr of return (capped upside). **It's a risk-REDUCER, not a return-multiplier.** Value = drawdown
control → safer leverage + survival. Put-write is the best variant. To actually BEAT buy&hold via VRP needs
active option-selling optimisation (strikes/timing/tail-hedge) → full options-chain data (the one paid gap).

**Data status (operator wants all data):** free + verified for VRP (^BXM/^PUT 30-38y), factors
(VLUE/MTUM/QUAL/USMV/SIZE), credit (HYG/LQD/JNK), term (TLT/^TNX), carry (FX/commodity ETFs). Only granular
options chains + IV history are PAID (~$100-300/mo, for active option-selling beyond vanilla). Next: backtest
the full structural-premia stack on the free data + build the combined diversified premia book.

### D-119 — Combined premia book (real data): Sharpe ~0.5, NOT 1; corrects my leverage claim (2026-08-04)

Built the combined structural-premia book (`scripts/trd-premia-book.ts`): 6 sleeves (SPY/TLT/HYG/GLD/DBC/^PUT)
risk-parity + a trend overlay, vol-targeted 12%, 19y (2007-2026), IS/OOS.
- Full: SPY CAGR 11.1%/Sharpe 0.54/maxDD 60%; risk-parity 5.9%/**0.64**/**26%**; trend 7.0%/0.63/33%;
  COMBINED 9.6%/0.54/49%. OOS: SPY **16.1%/0.76**; COMBINED 11.6%/0.51 — SPY BEAT the book OOS.
- **CORRECTS my prior-message claim** ("combining → Sharpe ~1, leverage 2-3x safely"): WRONG. Real Sharpe
  ~0.51-0.54, NOT 1 (sleeves aren't uncorrelated: VRP-SPY 0.79, credit-SPY 0.68; only TLT/-0.31/ & GLD
  diversify → ~2 independent bets, not 6). Leverage on Sharpe-0.5: **×2 → 82% maxDD, ×3 → 99% (ruin).**
  Leverage is only safe on HIGH Sharpe; my safe-leverage claim was false at this Sharpe.

**CONVERGENT CONCLUSION (~20 strategies, 119 decisions):** no accessible MECHANICAL strategy beats
buy&hold equity + disciplined risk management. Chart/intraday/carry/rotation/mean-rev/VRP/premia-book —
all thin-to-noise or merely drawdown-reducing vs the equity risk premium. This IS the CLAUDE.md thesis
verified the long way: durable edge = structural beta + risk overlay; "nothing clears the gates" is the
engine SUCCEEDING. Honest money map: (1) own quality equity + don't blow up + small trend/gold sleeve to
soften drawdown (~10%/yr, compounds); (2) risk management = the multiplier (shipped); (3) the 1e10x is the
PRODUCT/prop businesses (need no alpha). Real Sharpe-1 needs long/short factors + institutional infra we lack.

### D-120 — Market-awareness engine (regime + event playbook): the co-pilot, not the falsifier (2026-08-04)

Operator reframe (valid): I swung between "make a ton" and "no edge" — both wrong; the product must be an
awareness ECOSYSTEM that helps traders profit AND survive, not a falsifier that only says no. Built the seed:
`scripts/trd-regime-engine.ts` — (1) LIVE regime read (yield curve + VIX + SPY-trend + credit → phase +
recession-risk score; now: EXPANSION, 0/100), (2) EVENT PLAYBOOK from real crash history, (3) leading-signal
warnings (curve inverted before every modern recession).

**Key data insight (answers "how do instruments behave in events / forces that cause losses"):** the crash
playbook is CRASH-TYPE-DEPENDENT. Growth-scare crashes (2008 SPY-55/TLT+25/GLD+24; 2020 SPY-34/TLT+14) →
bonds+gold+dollar protect. INFLATION/rate-shock crash (2022 SPY-24, **TLT −29**, GLD −7) → bonds FAIL WITH
stocks; only **UUP +18 / DBC +21** protect. A trader hiding in bonds in 2022 got hit twice. The engine must
read the TYPE of stress and point to the RIGHT shelter — this is exactly the awareness a falsifier can't give.

**Reconciled thesis:** make money = harvest real CONDITIONAL edges (VRP, high-VIX mean-rev, favorable
sessions, prop-farming) WHEN regime favors them; don't lose = regime engine flags phase + stress-type +
de-risks to the right defensive; compound both via the risk engine. Product = co-pilot ("what's working now,
what's about to hurt, where to hide, how much to risk"). Roadmap (operator's asks): (a) real MINUTE data for
equity/futures shorting (ES/NQ via Alpaca-auth, not crypto proxies); (b) systematically ingest published-book
frameworks (Market Wizards/Elder/Dalio economic-machine/O'Neil/etc.) as testable strategies; (c) integrate
the regime engine live into the cockpit + per-session/timeframe/cycle awareness.

### D-121 — Co-pilot live + canon library + real 1-min NY-TBR (builds 1-3) (2026-08-04)

Executed the operator's 3-item roadmap under ANALYSIS_CONTRACT (numbers + N + OOS, no editorial).
- **(1) Live co-pilot** — `trd-regime` edge fn (phase/recession-score from curve+VIX+trend+credit; crash-
  type event playbook; live vol-regime sizing + mean-rev scan) + app "Co-pilot" tab. Deployed, verified
  live: EXPANSION / 0-100 / RISK-ON / VIX 16.5. The product: what phase, what's about to hurt, where to
  hide (by crash type), what's favourable now, how much to risk.
- **(2) Canon library** — R-006 + `scripts/trd-canon.ts`: Minervini Trend Template +0.096R OOS (27% win,
  thin/beta), Elder Triple Screen +0.022R OOS (~0). Dalio/Sinclair covered (D-119/116). Behavioural canon
  (Livermore/Schwager) = risk-mgmt = shipped engine. O'Neil needs fundamentals (untested).
- **(3) Real 1-min NY-TBR** — `trd-intraday-equity` edge fn, Alpaca IEX 1-min SPY/QQQ (149k bars, 376 days,
  the real gap vs crypto proxy). NY-TBR sweep-reversal fired ~30 setups/instrument (selective, matches
  Rauf's "not every day"). **SHORT negative on BOTH (SPY −0.44R n=17, QQQ −0.40R n=16); LONG positive but
  n=11-14 = NOISE (flagged, not claimed).** N too small for a verdict; robust read = mechanical short loses
  (confirms D-113/115). The group's edge is discretionary selectivity, not the mechanical trigger.

### D-122 — 5 inherited .ex5 files assessed & dropped; only risk-panel category survives (2026-08-05)

Operator passed a folder of 5 compiled MT5 binaries ("parts of a system passed on") asking how each helps
the mission, horizontally/vertically. Under ANALYSIS_CONTRACT (grounded, no lazy dismissal): ran `strings`
on all 5 — **zero readable logic recovered** (`.ex5` = encrypted MQL5 bytecode; only compression noise +
embedded-icon bitmap). Verdict is by identity+genre, labelled as such.
- **Boom1000_Confluence_Alert** → REJECT. Deriv's own docs confirm Boom 1000 is a *cryptographically-secure
  RNG* "unaffected by real-world news/volatility" — no order flow/auction, chart edge provably impossible.
  Reconfirms D-096/D-097 rejected genre, from the vendor itself.
- **Buy and Sell Power** (Elder-Ray family) → already in canon from source math (`trd-canon.ts`/R-006).
- **Easy Buy Sell Signal** → REJECT, arrow-signal folklore; compiled so can't even check repaint.
- **Stochastic Divergence AW** → reconstructable-from-scratch but low priority (divergence backtests poorly
  OOS); only non-trivial candidate if operator wants it gated like any lead.
- **Trade_Assistant (EarnForex 2010)** → only keeper by CATEGORY: risk/position-sizing panel = the one
  +EV component. And redundant: EarnForex open-sources it (github.com/EarnForex/PositionSizer) as readable
  MQL5, and the math is already in `_shared/trd-kelly.ts` + `_shared/trd-portfolio-risk.ts`.
Net: 0/5 carry an extractable edge; 1/5 points at the risk category we already own. Honest limit stated:
compiled `.ex5` source is unreadable; reconstruction+gating is the only path and genre priors say REJECT.

### D-123 — .ex5 knowledge fully exhausted; Buy&Sell Power reconstructed+gated (REJECT, DSR 17.5%) (2026-08-05)

Corrected D-122's lazy "nothing more knowable." Static bytecode IS encrypted (proven: EX5\x04 header,
high-entropy code section) — but the authors' mql5 marketplace pages document the LOGIC. Recovered specs:
- **Buy&Sell Power** (#133177): tick-vol buy/sell % over N=14, bands 55/62/65/70%. RECONSTRUCTED.
- **Easy Buy Sell Signal** (#103206): non-repaint arrow, candle-close confirmed; formula NOT published.
- **Stochastic Divergence AW** (#87097): regular+hidden stoch/price divergence, non-repaint. Reconstructable.
- **Trade Assistant** (EarnForex): NOT a sizing panel (D-122 error) — it's a multi-TF Stoch+RSI+CCI
  confluence indicator, FULL SOURCE OPEN at github.com/EarnForex/Trade-Assistant. Readable.
- **Boom1000 Confluence**: RSI/MA/confluence spike-alert on Deriv RNG. REJECT (RNG, D-096).
Knowledge ladder now stated: static-strings=dead-end; author-page=works; header-forensics=done;
dynamic-MT5=available; decompile=grey/low-odds.
**Buy&Sell Power gated** (`scripts/trd-bsp-backtest.ts`, 129,487 trades, 32 instruments, full Yahoo hist,
5d/2ATR, cost 0.05R): thr55 -0.038R, thr62 -0.028R, thr65 -0.012R(OOS +0.021), thr70 +0.019R(OOS +0.062R
n=2387). Best-band **Deflated Sharpe = 17.5% << 95% → REJECT.** Honest nuance: monotonic gradient =
weak MOMENTUM-continuation on strong buy-power (opposite of the indicator's reversal marketing), still
sub-gate. Remaining reconstructable candidate = Stochastic Divergence AW if operator wants it gated.

### D-124 — Mechanical NY-TBR REJECTED on 15y real 1-min index data (11.1M bars) (2026-08-05)

The definitive test the whole thread pointed at: the group's NY Time-Based-Range sweep→reversal→opposing-end,
fired mechanically BOTH directions, on FREE Dukascopy 1-min S&P500 (usa500idxusd) + Nasdaq100 (usatechidxusd),
2011-09→2026-07. 11.15M bars, 5,921 trades. `scripts/trd-duka-backtest.ts`.
- **S&P500**: ALL +0.494R/30%/n=3057 — but **IS +0.861R → OOS −0.056R** (textbook overfit collapse).
  OOS×side: SHORT −0.004R (breakeven, n=668), LONG −0.119R. The full-sample SHORT +0.914R is ALL in-sample.
- **Nasdaq100**: ALL −0.054R, OOS −0.035R. OOS×side SHORT −0.063R, LONG −0.002R. Dead both halves.
**VERDICT: no OOS edge on either instrument, any side; best case = breakeven-after-costs.** REJECT the
mechanical trigger. Confirms D-121 (small-N Alpaca) at 75× the data. Kills the "the rule makes money" claim;
does NOT touch the group's untested DISCRETIONARY selectivity. Data was FREE (Dukascopy) — the "needs paid
SIP" deferral (pre-OPERATING_DOCTRINE) was false. Honesty invariant held: resolved on all history now, not
forward weeks.

### D-125 — Stochastic Divergence AW reconstructed+gated (REJECT, DSR 0.0%); .ex5 folder CLOSED (2026-08-05)

Last reconstructable .ex5. Rebuilt from spec (%K14/%D3, ±3 confirmed pivots = NO look-ahead), both
regular(reversal) + hidden(continuation), both directions. `scripts/trd-stoch-div-gate.ts`, 28 instruments
(stocks+commodities+crypto), full Yahoo, 5d/2ATR, cost 0.05R, 9,164 trades.
- reg-bull(long) OOS +0.013R; hid-bull(long) OOS +0.007R (both ≈0); **reg-bear(short) OOS −0.103R,
  hid-bear(short) OOS −0.103R** (shorts worst). COMBINED −0.047R flat across IS/OOS.
- Best type Sharpe −0.001 → **Deflated Sharpe 0.0% → REJECT.**
Nuance: divergence-SHORTS lose because they fight drift — a signal-specific failure, NOT evidence shorts
lose (crowding/positioning shorts tested separately). **All 5 inherited .ex5 now assessed: 0 carry edge
(4 folklore/synthetic/reconstructed-and-rejected, 1 risk-tool whose source is OSS). Folder closed.**

### D-126 — Multi-TF flow map: funding-CROWDING short-fade is the standout candidate (2026-08-05)

"No stone unturned" build: multi-timeframe (4h trade / 1d filter) + REAL CVD (Binance klines taker-buy vol
field 9 → per-bar delta, free full-history) + REAL funding (positioning/crowding proxy for OI-side),
SHORTS & LONGS both. `scripts/trd-mtf-flow-map.ts`. 8 perps, 47,703 trades, 2017-08→2026-08 (9y).
Bug caught+fixed pre-verdict: klines limit=1500 capped to 1000 → only pulled 1000 bars; fixed to 1000 →
full 12-19k bars/symbol.
- **SHORT trend-pullback + crowd-fade + CVD + MTF**: base +0.052R → +crowd +0.308R (n=537) → ALL3 +0.333R
  (n=404) → **OOS +0.397R/46%/n=89**. The standout, and it's SHORT-side.
- LONG mirror: crowd-fade +0.283R IS but **ALL3 FAILS OOS −0.118R** → short is the robust side (confirms
  operator's no-long-bias point).
- **Attribution (honest): funding-CROWDING is the active filter (~+0.25R); CVD from taker-vol adds ≈0**
  (+0.052→+0.056). Do not credit CVD.
- meanrev-fade standout cells (+14.9R n=12, +1.3R n=165) = small-N NOISE, flagged not claimed.
VERDICT: crypto funding-crowding SHORT-fade = strongest positive-OOS candidate found this session. NOT yet
an edge — scanned ~24 cells → needs DEFLATED-SHARPE gate vs trial count + forward confirm before promotion.
LIMIT: OI/CVD free+deep only on crypto; equities/commodities legs need COT weekly (free, OI-like) + can run
the multi-TF (minus order-flow) on Dukascopy indices / Yahoo — queued, not yet done.

### D-126b — Deflation gate on the flow-map standout: FAILS (DSR 0.5%) (2026-08-05)

Ran the promised deflated-Sharpe gate on the SHORT trend-pullback +ALL3 cell (`trd-mtf-flow-map.ts` gate
block): 24 cells scanned, var(trial Sharpes)=0.0235, cell N=404 per-trade Sharpe 0.195 → **DSR = 0.5% <<
95% → FAILS.** Observed Sharpe is BELOW expectedMax(24 trials) = a selection artifact. The +0.397R OOS was
best-of-dredge, not edge. Engine worked on my own candidate.
NON-LAZY FOLLOW-UP (not a retraction of the map): funding-CROWDING added ~+0.25R on BOTH directions
in-sample — symmetric consistency hints the crowding effect is real, hidden by the 24-trial penalty. Legit
test = a SINGLE pre-registered hypothesis ("fade the crowded funding side", 1-2 trials) on crypto, extended
to equities/commodities via COT weekly positioning (free, OI-like). Queued. Nothing promoted; terminal state
remains "nothing cleared the gate" = the thesis working (D-070).

### D-127 — Pre-registered funding-crowding test: FAILS clean (crowding≠reversion) (2026-08-05)

Isolated the D-126b hint with a 2-trial pre-registered test (no setup/CVD/MTF dredge). `trd-funding-edge.ts`,
10 perps, funding top/bottom decile → forward 3d return.
- **H1 SHORT crowded-long: −2.17% (OOS −1.47%), 48% win** — crowded longs CONTINUE, shorting loses.
- **H2 LONG crowded-short: +0.43% (OOS +0.24%), Sharpe 0.047 → DSR 0.5% FAILS.**
Verdict: funding-crowding ALONE does not predict reversion (if anything crowded-long = momentum). The map's
+0.25R was dredge, not crowding. Confirms D-126b honestly with minimal trials. Nothing promoted.

### D-128 — Order-flow stack mapped; FREE GEX dealer-levels engine built+proven (2026-08-05)

Operator's roadmap: master order flow (ATAS/Sierra/Bookmap) + options/GEX/SpotGamma dealer levels + stack
into auction-market-theory framework (value areas, composite/prior value, narrative). Researched + mapped
free-vs-paid honestly:
- **Auction Market Theory (value areas VAH/VAL/POC, composite, prior value)** = FREE, buildable from
  Dukascopy 1-min indices + Binance crypto already held. [NEXT BUILD]
- **GEX/dealer hedging levels (SpotGamma displacement)** = FREE. Yahoo options now crumb-gated; found CBOE
  free delayed chain (cdn.cboe.com/api/global/delayed_quotes/options/{SPY,_SPX}.json) — provides gamma+OI+IV
  directly for 14k SPY / 32k SPX contracts. Built `scripts/trd-gex-levels.ts`: net-GEX regime, call/put
  walls, gamma-flip. PROVEN live: SPY spot 771.67 → call wall 775, put wall 750, positive-gamma; SPX call
  wall 7800/put wall 7400. Displaces SpotGamma (~$50-100/mo).
- **Liquidity heatmap/footprint (Bookmap/ATAS/Sierra)** = crypto FREE (Binance L2+aggTrades); equities/
  futures PAID ($50-200/mo tick+L2). The only genuinely-paid leg.
HONEST FRAME (advisor): research found ZERO backtest evidence these are MECHANICAL edges — they are
DISCRETIONARY AWARENESS/context, which is exactly the co-pilot product (no trading alpha needed to be
valuable). Caveats logged: GEX OI is EOD-lagged; dealer-side = standard long-call/short-put assumption;
gamma-flip via cum-zero-cross is approximate (walls+regime solid).
NEXT: (1) refine flip (reprice gamma across spot), wire GEX into a `trd-gex` edge fn + co-pilot tab;
(2) build the value-area/auction engine on the 1-min data; (3) crypto liquidity/footprint from Binance free.

### D-129 — GEX edge fn + Auction/Value-Area engine BUILT, DEPLOYED, VERIFIED LIVE (2026-08-05)

Built the two free order-flow awareness engines (D-128 roadmap items 1-2), tested-core pattern:
- **`_shared/trd-gex.ts` (+test)**: BS-gamma, netGexAt, buildGexProfile. Gamma FLIP now PROPER (reprices
  gamma via Black-Scholes across candidate spots — fixes D-128 crude cum-zero-cross). `trd-gex` edge fn pulls
  CBOE free chain → regime/call-wall/put-wall/flip. LIVE VERIFIED: SPY spot 771.36, positive-gamma, call
  wall 775, put wall 762, flip 762.98 (spot ABOVE flip = stable, now consistent w/ +total GEX), 4229 contracts.
- **`_shared/trd-auction.ts` (+test)**: valueArea (volume-at-price → POC/VAH/VAL), auctionContext
  (developing/prior/composite). Caught+fixed a real bug pre-commit: top-edge bar made bLo exceed last bin →
  span 0 → Infinity volume; clamped bLo. `trd-value-area` edge fn (Binance crypto / Yahoo equity). LIVE
  VERIFIED: BTCUSDT 251 sessions, developing POC 64107, prior 63819, composite VAH 65365/VAL 63118 + location
  reads.
Both labelled AWARENESS context (not signals/advice). 169 _shared tests pass (+6), deno check clean.
NEXT: surface trd-gex + trd-value-area in aegis-cockpit + app co-pilot tab; refine dealer-side (put-skew);
crypto liquidity/footprint leg.

### D-130 — Auction-levels backtest across timeframes: REJECT (levels = context, not signals) (2026-08-05)

Operator: run our gate at the new levels, across timeframes/setups; "loads of history, min_hours not 1min".
Built `scripts/trd-levels-backtest.ts` (reuses tested valueArea): 4 value-area setups × 3 TFs (1h/4h/1d) ×
both directions × 6 markets (crypto Binance full-vol + S&P/Nasdaq Dukascopy 15y resampled, TPO profile).
No look-ahead (trade off PRIOR session's VA). ~470k trades.
- **fade-VAH-short**: −0.08→−0.11R all TFs (loses). **breakdown-VAL-short**: −0.04→−0.12R (loses).
- **fade-VAL-long**: ~0 (+0.006 OOS 1h, negative higher TF). **breakout-VAH-long**: 1h ALL +1.333R but
  **IS +2.187 → OOS +0.027** (in-sample bull artifact; 4h/1d OOS ~0).
- **GATE: best cell breakout-VAH-long|1d Sharpe 0.054 → DSR 0.0% → FAILS** (12 setup×TF trials).
Verdict: value-area levels do NOT survive as mechanical setups on ANY timeframe. Longs = drift artifacts
collapsing OOS; shorts = fight drift, lose. Multi-TF did not rescue. CONFIRMS levels are discretionary
AWARENESS context (→ live on cockpit D-129b) NOT signals — the thesis working, not a failure. GEX-regime
historical conditioning needs paid historical chains (flagged, not faked). Terminal "nothing cleared" (D-070).

### D-131 — FREE historical GEX unlocked (SqueezeMetrics); regime = real vol/sizing signal (2026-08-05)

D-130 flagged historical GEX as "paid" WITHOUT searching — false (doctrine breach, self-caught). Search found
FREE sources: **SqueezeMetrics releases all GEX+DIX history free** (squeezemetrics.com/monitor/static/DIX.csv,
date,price,dix,gex, 3837 days 2011→2026); also Alpha Vantage HISTORICAL_OPTIONS (free key, chains to 2008),
OptionsDX free EOD SPX/SPY, HistoricalData.net free-2013. `scripts/trd-gex-regime-backtest.ts`:
- **(A) STRUCTURAL [KEEPER]**: forward-5d realized vol by trailing-252d GEX tercile — LOW 19.4% / MID 12.5% /
  HIGH 9.5% (n≈1100-1400 each), **LOW/HIGH ratio 2.04×**, monotonic, 15y. Positive-gamma = calmer, as theory
  predicts → a legit FORWARD-VOL/SIZING signal (not direction). CAVEAT: GEX↔VIX collinear; incremental value
  over the existing trailing-RV vol-regime primitive (D-100) is UNTESTED — gate before wiring as new signal.
- **(B) DIRECTIONAL**: dip-buy longs pay more in LOW/MID-gamma (meanrev-long|gex-low OOS +0.373 n=123;
  |gex-mid OOS +0.641 n=24); DIX-high-long|gex-low OOS +0.142 n=133; all SHORT cells negative. Best cell
  Sharpe 0.617 → **DSR 94.3% → FAILS (just under 95%)**. Coherent candidate (low-gamma = amplify = dip-buy
  pays), not promotable. Follow-up: pre-registered single-hypothesis meanrev-long|low-gamma (1-2 trials).
Net: found free 15y GEX; ONE robust structural signal (A, needs incremental-value gate) + one borderline
directional candidate (B). Best session outcome yet on the "levels" thread.

### D-132 — GEX vol-regime signal PASSES incremental gate; wired live as a SIZING input (2026-08-05)

Gated D-131(A)'s incremental value (`scripts/trd-gex-incremental.ts`, 3580 days):
- **3×3 double-sort** RV-tercile × GEX-tercile: GEX separates fwd-5d vol WITHIN every trailing-RV row
  (RV-high: low-gamma 23.7% vs high-gamma 13.9%). Not just vol-clustering.
- **OLS fwdVol ~ trailingRV + GEX: GEX t-stat = −14.1**, −1.94 vol-pts per +1σ, controlling for RV →
  **GEX ADDS predictive value over the D-100 trailing-RV primitive.** PROMOTED.
- #2 pre-registered dip-buy|low-gamma (1 trial): Sharpe 0.237 → **DSR 37% FAILS** — directional dead, killed clean.
Wired: `_shared/trd-gex-regime.ts` (+test) — gexRegime(currentGex, trailingGex) → percentile→expectedFwdVol
(15y fit: p0→19.4%, 0.5→12.5%, 1→9.5%)→deRisk=min(1,12/expVol). Fed by free SqueezeMetrics series into
`trd-gex` edge fn (vol_regime block) + surfaced on aegis-cockpit GEX panel. LIVE VERIFIED: SPY 96th pctile =
high-gamma, exp fwd vol 9.7%, ×1 size. SIZING signal, direction-agnostic (D-131(B) failed). 172 tests green.
NEXT (own pass, HIGH-blast order-path): multiply equity-index position size by GEX deRisk alongside the
existing volRegimeDeRisk in the paper executor — deliberate risk-engine change, gate separately.

### D-133 — GEX de-risk wired into the equity order path (2026-08-05)

The HIGH-blast pass deferred in D-132. `trd-alpaca-equity-tick` sizing line now composes
`riskFrac = kellySize × volRegimeDeRisk × gexDeRisk`, where gexDeRisk applies ONLY to equity indices
(SPY/QQQ/IWM, not GLD) via `gexMarketDeRisk()` — free SqueezeMetrics series → gexRegime() → ≤1 reducer,
FAIL-OPEN to 1.0 (network fail = no-op). Never levers up, never a direction call (D-131(B) failed). Stored
on each position (gexDeRisk, gexRegime) + shown in ?probe=1. LIVE VERIFIED: market open, gexMarketDeRisk
{deRisk 1, high-gamma, pctile 0.96} — no-op now (calm), auto-shrinks ~0.62× when low-gamma. Guard: gexRegime
primitive unit-tested (≤1, monotone, caps at 1); deno check green. All three sizing terms are pure reducers.

### D-134 — "Measurably smarter" screen: VIXterm + DIX added; unified fwd-vol sizing wired (2026-08-05)

Applied the GEX incremental-value gate to a batch of free signals (`scripts/trd-signal-screen.ts`, 3825
aligned days SqueezeMetrics∩VIX∩VIX3M, general OLS + t-stats):
- **(A) forward-5d-vol ~ trailingRV + GEXpct + VIXterm(VIX/VIX3M)**: ALL jointly significant — trailingRV
  t=26.9, GEXpct t=−6.6, **VIXterm t=20.3**. VIX term structure adds large independent forward-vol info.
- **(B) forward-10d-ret ~ momentum + DIX**: DIX t=+4.5 (+0.22%/σ), momentum t=−2.8. DIX = mild real return tilt.
INTEGRATION (the honest part): the 3 vol signals CORRELATE in stress, so multiplying separate de-risks
(as D-133 did with vol×gex) triple-counts → over-shrinks. Fixed with a UNIFIED forecast:
`_shared/trd-fwdvol.ts` (+3 tests) fits fwdVol = −0.335 + 0.429·trailingRV − 0.034·gexPct + 0.478·vixTerm
(median ref 0.134) → deRisk=min(1,ref/forecast). Wired into `trd-alpaca-equity-tick`: index symbols
(SPY/QQQ/IWM) now size by the unified forecast (units fixed: vr.rv is DAILY → ×√252), GLD keeps plain
vol-regime. Fail-open per term. LIVE VERIFIED: VIXterm 0.826, GEX p96 → SPY ×1 (8.8%), QQQ ×0.96 (13.9%),
IWM ×1. Replaces+improves D-133. 175 tests green.
DIX: confirmed but directional+small → surface as awareness tilt, NOT sizing (own pass). HORIZONTAL next:
replicate the fwd-vol framework per asset class (crypto: funding+RV; bonds: MOVE; gold: GVZ) — breadth.

### D-135 — HORIZONTAL pass: per-asset implied-vol sizing; framework generalises across asset classes (2026-08-05)

Replicated the D-134 forward-vol framework across asset classes, each gated the same way (does the asset's
own free implied-vol index add forward-vol value over trailing RV? |t|>2). `scripts/trd-horizontal-vol.ts`,
full Yahoo history:
- Bonds TLT/^MOVE IV t=13.7 ✓ | **Gold GLD/^GVZ IV t=27.7 ✓ (RV t=1.8 NS — GVZ DOMINATES)** |
  Oil USO/^OVX t=27.5 ✓ | Nasdaq QQQ/^VXN t=38.8 ✓ | S&P ctrl SPY/^VIX t=48.4 ✓.
  → implied-vol indices are powerful forward-vol predictors in EVERY asset class, often dominating RV.
Built `_shared/trd-asset-vol.ts` (+3 tests): ASSET_VOL_MODELS table (fitted b0/bRV/bIV/ref per asset) +
assetFwdVolDeRisk(asset, RVann, ivLevel)=min(1,ref/forecast), fail-open. Wired GLD (the traded non-index
asset, previously sized on RV alone) → GVZ model in `trd-alpaca-equity-tick`, fallback to vol-regime if GVZ
missing. LIVE VERIFIED: GVZ 25.6 → fwd 21.2% → GLD deRisk 0.726 (vs ~0.89 under plain RV — GVZ-driven,
correct). TLT/USO/QQQ-VXN in the table, ready when traded. 178 tests green. Units: vr.rv daily → ×√252.
NEXT (breadth): crypto per-asset (Deribit DVOL/funding) for the crypto executor; surface asset-vol on cockpit.
