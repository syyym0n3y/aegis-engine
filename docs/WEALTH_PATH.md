# WEALTH_PATH — where we are, and the path to extracting wealth from markets (2026-09-01)

> Governed by ANALYSIS_CONTRACT.md: the measurement, not the feeling. Every number below is from a live run on
> 2026-09-01 (forward-score-specs, ladder-harvester, guard-status, trd_lineage). This is the engine's finding, not
> personal financial advice — the programme is single-operator research and nobody here is a licensed adviser.

## 1. The uncomfortable truth, first

**"Extract as much wealth as possible from the markets every day" is the one thing 1,373,403 trials say a low-budget
participant cannot do.** Not "we haven't found it yet" — the shape of every failure is the same:

| what "daily extraction" needs | what the engine measured |
|---|---|
| a repeatable daily edge | 0 promoted of 224 leads; 0 of ~1.37M trials cleared the gates |
| the edge to survive trading costs | every daily/hourly effect found was SUB-FEE (0.02–0.14x fee, D-426) or died at taker cost |
| the edge to survive turnover | TURNOVER LAW: the best equity candidate ever found (+4.2%/yr, t 3.98) was −0.6%/yr after its own rebalancing (D-654) |
| to be placeable at our size | every real cross-sectional effect lives in illiquid names or needs borrow (INSTRUMENT LAW, 4 of 4) |
| timing — "start when odds are good, stop when against" | every timing rule tested COSTS wealth: vol-timing sign-flipped under 1 day of lag (D-498); macro-regime washed out (D-730); trend de-risk gives up 30–37% of terminal wealth (D-735) |

And the single best wealth engine the programme has measured is the one with **zero switches**: buy-and-hold SPY at
$150/mo → **$547,847 on $60,600 deposited (9.04x, 6.8% CAGR, 34y)**. Every "know when to stop" overlay finished
$164k–$205k poorer.

The daily thing the engine should do is **monitor**, not trade: ingest, guard board, retest harness, score the clocks.

## 2. Scoreboard — exactly where we are

- **Edge found:** none. 0/224 promoted. Deflation ceiling 5.46 at N≈2.9M; nothing near it honestly.
- **Live candidates:** 9 forward clocks (fwd-cef-discount added 2026-09-02), **0 of 9 currently produce a number** (all not-yet-computable — spin-off
  needs ≥20 liquid spincos with 500d data, ~3–4y; de-SPAC may stay inconclusive; paper book's first markable month
  hasn't occurred). Pre-registered, immutable, scored daily. This is the ONLY path to a claim, and it is slow by
  construction.
- **Structural finding (the real asset):** compound + deposit + don't-panic-sell, measured at 9x/34y. Confidence HIGH
  (D-680/735) — it is the one thing here that has cleared every attack, because it isn't a forecast.
- **Data (2026-09-02):** driver register **45 HELD / 0 research debt / 6 blocked with a named barrier**. Unlocked free
  this session: FRED foreign rates (14 ccy), CBOE options regime, Wikipedia S&P membership, EIA curve (CL/NG) +
  weekly inventories, GLD holdings. Truly gated after a real search: per-strike options surface, borrow fee bps,
  analyst revisions, L2, curves for GC/ZC/ZW/ZS/HG/SI, central-bank reserves (quarterly), S&P announcement dates. Borrow FEE bps later found free (iBorrowDesk, D-752) — ingest in build.
- **Integrity:** 25 guards (market-cap added 2026-09-02, self-tested RED on three old constructions), all green, each verified to fail. The engine is more reliable than any strategy it holds.

## 3. What "wealth from markets" actually decomposes into (the arithmetic that sets the path)

At a low budget, terminal wealth ≈ **deposits × compounding multiplier × (1 − leakage)**, plus alpha, which is zero.

| lever | measured worth | who controls it |
|---|---|---|
| **deposit size** | doubling $150→$300/mo doubles terminal wealth (linear) — worth **~$548k** over the run | income, i.e. Revitalise, not markets |
| **compounding multiplier** | 9.04x over 34y at market β; the multiplier is on TIME — a 10-year delay costs more than any drawdown | start date; not selling |
| **leakage** (cost, tax wrapper, currency-of-account) | ~1–2pp/yr; currency-of-account alone ~1.3pp/yr for a GBP investor (D-731) — compounds to tens of % | structural, one-time decisions |
| **alpha** | 0 found; best forward candidate is years from a verdict | the falsification engine |

**Consequence:** for this budget, a 3%/yr alpha (which nobody has) is worth less than raising deposits by $100/mo.
Wealth is an INCOME problem being routed through a market VESSEL. The market compounds what the business earns.

## 4. Start / stop — the honest answer, not the wished-for one

- **START:** now. The measured cost of waiting for "better odds" IS the de-risk cost: 30–37% of terminal wealth.
  No tested signal identified a better entry than "the month you have the money."
- **STOP (sell the market):** no tested rule improved on never. The only legitimate stops are (i) a real liquidity
  need, (ii) the pre-registered kill rule on a *strategy* clock, (iii) the durable kill-switch on any *live book*.
- **What "knowing when" legitimately means here:** the regime snapshot / odds map tell you the **risk you are
  holding** (−52% depth, 3.4y duration, what drivers are extreme) so you can size it to what you'll actually hold
  through. Risk shown ≠ exit signal. Sizing to holdability is the lever; timing is not.
- **Start/stop on STRATEGIES (the part that IS automatable):** a clock's promote/kill rule fires → paper → micro →
  small, each rung gated (LADDER.md). Auto-execution stays off below SMALL. Nothing is at that rung.

## 5. The path (ordered by measured worth, all $0 to run)

**P0 — Structural engine, fully automated (worth the most, needs no edge).**
Automate the deposit; hold the broad, cheapest vehicle; fix currency-of-account and the tax wrapper once; size to
the −52%/3.4y that buy-and-hold has historically demanded so panic-selling is never triggered. The ladder harvester
runs daily and reports its "current signals" as CONTEXT for risk, never as an order.
**The sizing table is now measured (D-744, `scripts/holdability-sizer.ts`, daily):** a 30% drawdown ceiling forces
50% equity and costs **59% of terminal wealth**; 80% equity costs 29% for a −43% worst case. Safety bought through
the mix is the most expensive item on this map — the cheap lever is deciding in advance to hold through −52%/3.4y.

**P1 — Keep the falsification engine running daily (the only thing that can ever find an edge).**
Daily runner: ingest → guards → retest harness → forward scorer. Spin-off (the sole long-only candidate that fits
small size) resolves in ~3–4y; nothing to do but not touch it.

**P2 — Close the FREE research frontier (cheap, and the odds map names it).** RUN 2026-09-01, same day:
| item | result |
|---|---|
| 1. options-regime conditioning (CBOE SKEW/VVIX/VIX3M) | **NULL** OOS, |t| 0.28–0.88; the naive t −5 was a 21d-overlap artifact (D-739) |
| 2. S&P-500 index inclusion (Wikipedia, free) | **NULL** post-effective, prior MATCHED; the pre-effective pop UNTESTED for want of announcement dates (D-740) |
| 3. commodity roll yield (EIA keyless curve, CL+NG) | CL **NULL out-of-sample** (full t 2.72 carried by 1985–2004, post-2005 t 1.18, −82% DD); NG **RUINED** (D-742) |
| 4. EIA inventories (keyless, LIVE weekly) | HELD; post-release change conditioning **NULL** (CL t −0.62, NG 0.16), naive weekly books RUINED; two construction defects caught before recording (D-743) |
| 5. EM carry (14 currencies, FRED keyless) | **a risk premium, not an edge**: EM t 2.79 is the rate differential collected against a −3%/yr spot leg, under the 5.46 ceiling, breadth 14, research-space not NDF (D-741) |
Outcome as expected: verified nulls, each a market statement with coverage stated. Their value is confidence, per
the COVERAGE LAW — an unfetched free dataset is a research failure, not a market finding. Five more approaches are
now off the "untested" list and on the "measured absent" list, which is the only direction this map moves honestly.

**P3 — Promotion ladder, dormant until a clock clears.** Paper → micro → small with real samples, kill-switch record,
DSR>0.95 / PBO<0.5 locked. Broker creds NOT provisioned before then.

## 6a. At what budget does it start working? (D-746, `scripts/budget-threshold-map.ts`, daily)
| channel | threshold, from the ledger |
|---|---|
| deposits vs alpha | below **~$60k capital** (at $1,800/yr deposits, 3% alpha) the next deposit beats any plausible edge; at 1% alpha, $180k |
| cost break-even | EM momentum needs **< 52bp round-trip** (institutional, not retail); the best intraday window needs **< 3.9bp** (below VIP taker); perp flow is negative before cost |
| instrument access | factor long-shorts ~$110k (portfolio margin) to $1M+ (prime); EM carry needs NDFs — the vehicle unlocks, and every unlocked vehicle measured was dead or unmeasured |
| capacity | de-SPAC / factor tails exist only in illiquid names — **more budget makes them worse** |
| daily, structurally | US PDT rule $25k; UK stamp duty 0.5% one-way kills turnover outright; crypto VIP tiers ~$250M/30d |
**Daily extraction starts working at no budget on anything measured. Structural compounding started at the first deposit.**

## 6b. The frontier beyond predict-the-return (2026-09-02, docs/FRONTIER.md) — every row now measured
| mechanism | measured answer |
|---|---|
| closed-end fund discounts | **the one candidate**: liquid-tercile excess ~4%/yr at t 3.3–3.8 in the survivorship-clean 2019+ window (upper bound; 52% of the 2010 universe is missing); forward clock registered, 24 months, no honest way to shorten it (D-750/750b/750c) |
| odd-lot tender priority | real, retail-only, **~$2k/yr on ~$15k**; ceiling absolute at 99 shares (D-751) |
| securities lending | ~0 on a broad ETF (the fund keeps it); 0.2–4.9%/yr on liquid single names on assumed rates; a rounding line on a small account (D-752) |
| VIX-futures roll | ruined at margin on 8 days, ruined UNLEVERED on 2018-02-05; SPY dominates (D-749) |
| Russell reconstitution | proxy-null, underpowered on years (D-748) |
| prediction markets | null where testable, untested where the archive is closed, unplaceable from the UK (D-753) |
| IPO / primary market | the pop is real and entirely in the allocated leg (US +20%, UK +12.9%); the buyable leg is −27.5%/yr (US) or flat (UK) — a fee paid to allocation, not capital (D-754) |
Net of the whole frontier: **one candidate on a clock, one negligible retail-only mechanism, zero new edges** — and
three share-base defects under the valuation family found and fixed along the way (D-747b/f/g). The deposit
arithmetic in §6a still binds every row.

## 6. What would change this answer

- A forward clock clears its pre-registered rule → P3 activates for that spec only.
- Budget large enough for a prime broker → borrow-gated short legs become placeable (the de-SPAC −40% becomes
  reachable); at small size, spin-off long-only is the only event effect that fits.
- A free source for per-strike options or borrow fee → the two biggest UNTESTED spaces open.
Nothing on the list is "find a daily edge." The engine's verdict on that stands until the data overturns it.
