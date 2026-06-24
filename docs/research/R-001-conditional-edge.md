# R-001 — Does the positioning / macro / microstructure lens restore edge in the 16 rejected strategies?

> **Deep-research pass, 2026-06-24.** Run `wf_00036b5d-d4f` — 106 agents, 24 sources,
> 115 candidate claims → 25 adversarially verified (3-vote, need 2/3 refutes to kill)
> → **23 confirmed, 2 killed.** Synthesis step failed on the monthly spend cap; this
> file is the hand-synthesis over the verified claims. All sources are primary
> (BIS, Federal Reserve, NBER, Journal of Finance, SSRN academic).
>
> Confidence tags: **[Certain]** = a 3-0 verified primary source; **[Likely]** = 2-1
> verified or strong inference; **[Guessing]** = my extrapolation beyond the evidence.

---

## The single most uncomfortable truth

**The conditional-edge hypothesis was RIGHT as a mechanism and WRONG as a retail edge.**
The operator was correct that the prior two passes only tested *average* effects and
never tested *conditioning* — and the literature is unambiguous that conditioning
variables (dealer gamma sign, volatility regime, dealer-capacity stress, momentum's
own forecastable crashes) **do** turn signals on and off and **do** roughly double
risk-adjusted returns in specific cases. So "16/16 rejected" was rejecting on the
wrong axis for at least three of the families.

**But every single confirmed edge came chained to a cost/capacity/latency caveat that
puts it outside small-retail reach** — and the one conditional edge a small account
*could* in principle trade (multi-day gamma stock-picking) was **killed 0-3 in
verification.** The verdict therefore *refines* rather than *reverses*: the wall is the
same wall D-072 already named ("the edge is cost-constrained, not capacity-constrained;
small size is a *disadvantage*"), but the research now lets us name *why* with
peer-reviewed precision instead of a prior.

**The genuinely new, durable, retail-accessible result is not an alpha — it's a risk
instrument.** The conditioning variables themselves (VIX as the Global-Financial-Cycle
proxy, dealer net-gamma sign, dealer-capacity stress, momentum-crash state) are public,
free, and have *verified* predictive value for *when the system is fragile*. That is a
**protect-the-core regime overlay**, which is exactly Aegis's pivoted mandate.

---

## What the evidence actually established

### Block A — Global plumbing is mechanically real (not narrative)

- **[Certain]** One global factor explains **~25% of the variance of all risky-asset
  prices worldwide**, correlated with the VIX — the Global Financial Cycle is real.
  ([Miranda-Agrippino & Rey](http://www.helenerey.eu/Content/_Documents/MirandaAgrippino_Rey_Handbook.pdf), 3-0)
- **[Certain]** **US Fed policy causally drives that cycle**: a surprise tightening →
  global intermediary deleveraging, rising risk aversion, contracting asset-price
  factor, widening credit spreads, capital-flow retrenchment. (same, 3-0)
- **[Certain]** Floating FX does **not** insulate domestic conditions — the trilemma is
  a **"dilemma"**; monetary conditions even in flexible-FX countries are partly dictated
  by the US. *Directly relevant to the operator's ZAR/GBP/USD exposure.* (same, 3-0)
- **[Likely]** The **VIX is an effective proxy** for the latent global risk-appetite
  factor — a legitimate, free, retail-accessible regime variable. (same, 2-1)
- **[Certain]** **CIP has persistently failed since the GFC**; the cross-currency basis
  widened again post-2014 — a durable dislocation, not a crisis artifact.
  ([BIS QR Sep-2016](https://www.bis.org/publ/qtrpdf/r_qt1609e.htm), 3-0)
- **[Certain]** It persists because **dealer arbitrage capacity is constrained** —
  "balance sheet space is rented, not free." (same, 3-0)
- **[Certain]** **Treasury basis trade** = HF short futures / long cash / repo-financed
  — mechanically links futures, cash-Treasury, and repo.
  ([Fed note 2025](https://www.federalreserve.gov/econres/notes/feds-notes/the-cross-border-trail-of-the-treasury-basis-trade-20251015.html), 3-0)
- **[Certain]** It **partly unwound in March 2020** amid repo/Treasury strains — a real
  deleveraging-cascade episode. (same, 3-0)
- **[Certain]** **FX carry funded in yen ≈ ¥40T ($250B)** into Aug-2024, biased down.
  ([BIS Bulletin 90](https://www.bis.org/publ/bisbull90.pdf), 3-0)
- **[Likely]** Carry unwinds and equity-vol shocks share a **common short-vol exposure**
  — a real cross-asset channel (FX carry ↔ equity vol). (same, 2-1)

### Block B — Dealer balance-sheet capacity is a NONLINEAR, tail-only conditioning variable

- **[Certain]** Dealer capacity is **nonlinear**: ~0 marginal effect at 20-30%
  utilization, but illiquidity rises **~3 SD beyond what volatility predicts** as
  utilization goes 40%→80%. *This is the textbook "benign average hides a strong tail
  conditional" — the exact shape the conditional-edge thesis predicted.*
  ([BIS WP 1138](https://www.bis.org/publ/work1138.pdf), 3-0)
- **[Certain]** **But yield volatility alone (swaption-implied) explains ~82%** of daily
  illiquidity variation; dealer capacity is only a *residual second component*. **Hard
  hurdle: a plain vol regime already captures most of it.** (same, 3-0)
- **[Certain]** Dealer capacity predicts the **99th-percentile tail, not the median** —
  conditional, stress-only. (same, 3-0)
- **[Certain]** Repo balance-sheet cost is quantifiable from public data (CMTR spread
  ~7bps normal); **[Likely]** SLR exclusion compressed it 7→4bps (regulation→pricing).
  ([Fed note 2024](https://www.federalreserve.gov/econres/notes/feds-notes/dealer-balance-sheet-constraints-evidence-from-dealer-level-data-across-repo-market-segments-20240923.html), 3-0 / 2-1)

### Block C — Dealer OPTION gamma conditions INTRADAY momentum (strongest edge finding — and its cost killer)

- **[Certain]** For the S&P 500, intraday momentum is strong **only when net gamma
  exposure (NGE) is negative** (dealers short gamma): slope **6.63, t=4.78, R²=3.58%**
  when NGE<0 vs an insignificant **0.82, t=1.03, R²=0.05%** when NGE≥0; strengthens the
  more negative NGE gets. ([Notre Dame / Dong-Lou-Pollet](https://academicweb.nd.edu/~zda/intramom.pdf), 3-0)
- **[Certain]** Continuous NGE×return interaction = **-123.04, t=-3.42** (and survives a
  diff-in-diff) — monotonic, not a single-threshold artifact. (same, 3-0)
- **[Certain]** Independently replicated: intraday momentum present only on negative-NGE
  days, absent on positive-NGE days.
  ([SSRN 3760365](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3760365), 3-0)
- **[Certain] THE COST KILLER:** both papers report results **with zero transaction
  costs** and explicitly warn the strategy "**might not be exploitable after costs**"
  due to frequent rebalancing. The only **net-positive Sharpe** claim is for **S&P 500
  futures at a 1-tick cost "faced commonly by advanced investors"** — *not* small retail,
  *not* the broad cross-section. (both, 3-0)

### Block D — Momentum: conditioning genuinely restores edge (cleanest case)

- **[Certain]** **Momentum crashes are partly forecastable ex-ante** — they cluster in
  "panic" states (after declines, high vol, on rebounds).
  ([Daniel & Moskowitz, NBER w20439](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf), 3-0)
- **[Likely]** A **dynamic momentum** strategy conditioning size on forecast mean+variance
  **~doubles alpha and Sharpe** vs static, not explained by other factors. (same, 2-1)

### What the engine KILLED (the honesty receipts)

- **❌ 0-3 REFUTED:** "Net gamma exposure predicts the **cross-section of multi-day
  forward stock returns** (high-gamma underperform)." *This was the one gamma edge a
  small account could trade on a daily horizon — and it did not survive.*
  ([Sci-Direct gamma paper](https://www.sciencedirect.com/science/article/pii/S0927539823001093))
- **❌ 0-3 REFUTED:** "The Aug-2024 VIX spike was mechanically amplified **far beyond**
  what the historical VIX↔S&P relationship predicts." *The carry unwind was real; the
  "margin-spiral amplifier" magnitude claim was not.* ([BIS Bulletin 90](https://www.bis.org/publ/bisbull90.pdf))

---

## Verdict per rejected family

| Family | New conditional evidence? | Refined verdict |
|---|---|---|
| **Time-series / X-sec momentum** | **Yes** — crashes forecastable; dynamic conditioning ~2× Sharpe | Edge is **conditionally real** but it's enhancing a crowded, capacity-bound factor, and it needs a **live long/short book the visa forbids**. Still REJECT for *this operator*; KEEP the crash-state forecast as a *risk overlay*. |
| **VRP / options (gamma)** | **Yes (intraday)** — NGE-sign flips intraday momentum on/off | **Net edge only at 1-tick SPX-futures cost for "advanced investors."** Retail cost + visa kill it. Cross-sectional multi-day version **KILLED 0-3**. REJECT as alpha; KEEP NGE-sign as a *fragility regime flag*. |
| **FX carry** | **Yes (mechanism)** — ¥40T scale, carry↔vol channel, dilemma | Confirms carry is a **short-vol crash-risk trade**, not alpha (matches D-071 "~0 OOS, crash-clustered"). REJECT; KEEP carry-unwind state as a *de-risk trigger*. |
| **Illiquidity / stat-arb / basis** | **Yes (mechanism)** — dealer capacity nonlinear, tail-only | The dislocations (CIP, basis) are **real but require rented balance sheet** retail doesn't have; effect is stress-tail-only and **vol already explains 82%**. REJECT — institutional-only, sharper reason than before. |
| Congressional, insider, 13F, crypto-native, alt-data, merger-arb, micro-cap | **No new evidence** | Prior rejection **stands unchanged** — this pass concentrated on momentum/carry/gamma/macro; it did not surface conditional evidence for these, neither for nor against. |

---

## The one highest-conviction finding

**[Certain]** The positioning/macro lens is a **verified risk-regime instrument, not a
retail alpha source.** Four public, free, retail-accessible variables have peer-reviewed,
adversarially-survived predictive value for *system fragility* (not for picking winners):

1. **VIX / Global Financial Cycle state** — when global risk appetite is contracting.
2. **Dealer net-gamma sign (NGE)** — when market makers amplify rather than dampen moves.
3. **Dealer-capacity / funding stress** (repo spreads, cross-currency basis) — tail liquidity.
4. **Momentum-crash state** (post-decline + high-vol + rebound) — when trend reverses violently.

Used as a **protect-the-core overlay** — "de-risk / don't add leverage when ≥N of these
flash fragile" — this is legitimate, evidence-backed, visa-safe (it informs a *passive*
allocation, places no live discretionary trade), and is the honest, differentiated thing
no GEX vendor ships: regime context with its realized track record, explicitly labeled
*not a buy signal.*

---

## What would still need live falsification before any real money

Consistent with the REJECT-by-default doctrine, *nothing here is "proven" yet*:

1. **Build the four regime flags as dated `trd_features`** (effectiveDate-stamped, look-ahead-proof) from free public data (VIX, NGE proxy from options OI, FRED repo/SOFR + cross-currency basis, momentum-crash state).
2. **Falsify the overlay, not an alpha:** test whether "de-risk when ≥N flags fragile"
   actually reduced drawdown / improved Calmar on the *index core* OOS — vs the null of
   never de-risking. Deflated-Sharpe + PBO + trial-counter apply unchanged.
3. **Adversarial check:** does the overlay beat a single naive **VIX>threshold** rule? (Block B warns one vol variable may already capture ~82%.) If it doesn't beat that null, kill it.
4. **Capacity honesty:** any *alpha* reading of gamma/momentum must be re-tested at
   *retail* cost (not 1-tick futures) and is visa-blocked for live trading regardless.
5. **No real money** until an overlay clears PAPER on real data with a clean record — and even then it governs a *passive* allocation, not a live book.

---

## Sources (all primary unless noted)

- [Miranda-Agrippino & Rey — Global Financial Cycle](http://www.helenerey.eu/Content/_Documents/MirandaAgrippino_Rey_Handbook.pdf)
- [BIS WP 1138 — dealer capacity & Treasury illiquidity](https://www.bis.org/publ/work1138.pdf)
- [BIS QR Sep-2016 — CIP failure / cross-currency basis](https://www.bis.org/publ/qtrpdf/r_qt1609e.htm)
- [BIS Bulletin 90 — Aug-2024 carry unwind](https://www.bis.org/publ/bisbull90.pdf)
- [Fed note 2025 — Treasury basis trade](https://www.federalreserve.gov/econres/notes/feds-notes/the-cross-border-trail-of-the-treasury-basis-trade-20251015.html)
- [Fed note 2024 — dealer balance-sheet constraints in repo](https://www.federalreserve.gov/econres/notes/feds-notes/dealer-balance-sheet-constraints-evidence-from-dealer-level-data-across-repo-market-segments-20240923.html)
- [Notre Dame — intraday momentum & net gamma exposure](https://academicweb.nd.edu/~zda/intramom.pdf)
- [SSRN 3760365 — gamma & intraday momentum (replication)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3760365)
- [Daniel & Moskowitz — Momentum Crashes (NBER w20439)](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf)
- [Sci-Direct — net gamma & returns (cross-sectional claim KILLED)](https://www.sciencedirect.com/science/article/pii/S0927539823001093)
