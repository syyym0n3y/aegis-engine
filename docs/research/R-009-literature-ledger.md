# R-009 — The literature ledger: 859 catalogued claims, and how we separate gold from fluff

**Operator ask:** get 100,000 sources; compare what every author says; test against every concept ever
written; separate the fluff from the gold mine.

## The reframe that makes this tractable
Scraping 100k individual papers is the wrong shape — **the field has already catalogued itself**, and the
meta-studies are both authoritative and machine-readable. Four of them cover essentially the entire published
cross-sectional literature:

| Meta-study | Scope | Headline verdict |
|---|---|---|
| **Hou, Xue & Zhang (2020, RFS)** *Replicating Anomalies* | **452 anomalies** | **65% fail \|t\|>1.96; 82% fail at 2.78; 85% (380/447) fail at t>3.** 96% of "trading frictions" fail. |
| **Harvey, Liu & Zhu (2016, RFS)** | 316 factors | "most claimed research findings in financial economics are likely false"; demands t>3 |
| **McLean & Pontiff (2016, JF)** | 97 predictors | returns decay **26–58% post-publication** |
| **Chen & Zimmermann (2022, CFR)** *Open Source Asset Pricing* | **212 predictors, code + data public** | reproduces ~98% of clearly-significant originals |

## What we built
`data/literature/claims-ledger.{csv,json}` — **859 unique published claims** parsed from the
Harvey-Liu-Zhu catalogue and the cross-meta-study comparison tables in the OpenSourceAP repo, each with
author, journal, year, the **formation/definition**, our category, and **whether we can test it with free data**.

| Category | Claims | | Testability | Claims |
|---|---|---|---|---|
| other | 227 | | **yes (have the data)** | **256** |
| fundamental | 189 | | partial | 187 |
| price | 176 | | no-data (needs paid fundamentals) | 189 |
| risk/vol | 80 | | unknown | 227 |
| positioning/flow | 72 | | | |
| macro | 60 | | | |
| microstructure | 40 | | | |
| options | 15 | | | |

Plus `trd_claims` (Postgres, surfaced on the cockpit): the **adjudicated** subset — every claim we actually
tested, with the verdict and the evidence.

## Gold vs fluff — decided by gates, not reputation
A claim is gold only if it survives: **random-entry control** (D-146) → **both-halves sign stability**
(D-155) → **incremental-to-price** (D-156) → **subgroup decomposition** (D-157).

**CONFIRMED (9):** short-term mean reversion (dip-buy, our only tradable survivor); dealer-gamma governs vol
regime; implied-vol indices beat trailing RV in every asset class; correlations rise in stress (45
instruments = 2.6 bets); asymmetric R:R required (TP 3×SL measured, not folklore); and all four meta-findings
above — **which our own corpus independently reproduced** (1 of 14 families survived = 7%, versus their 15–18%).

**FAILED (7):** Boehmer short-volume (inverts, then fails decomposition); trend-following; breakouts;
liquidity sweeps; iFVG (statistically real at t=6.15 yet still loses money); candlestick patterns;
VIX-term-structure direction (fails incremental).

## Honest limits
- 189 of 859 claims are fundamental-based and **untestable without a paid fundamentals feed at depth** — the
  single largest data gap, and the highest-value future acquisition if ROI is ever justified.
- The ledger is a **catalogue of claims, not of every paper ever written**. It covers the meta-studied
  cross-section; practitioner literature (ICT, Wyckoff, candlesticks) is represented only where we tested it.
- Chen-Zimmermann's 212-predictor *portfolio return* dataset is downloadable and remains the highest-leverage
  next ingestion: it would let us re-test ~200 published predictors against our own gates directly.
