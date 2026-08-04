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
