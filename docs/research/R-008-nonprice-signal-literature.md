# R-008 — Non-price signals: literature survey + free data map

**Why:** every signal tested through D-155 was price-derived (RSI, MAs, sweeps, gaps, TP/SL structure). The
operator's directive: exhaust non-price signals — options flow, positioning — with real literature behind them.

## What the literature actually says (before we test anything)

| Finding | Source | Implication for us |
|---|---|---|
| Anomalies decay **26–58% post-publication**; many were data snooping | McLean & Pontiff (2016), *Does Academic Research Destroy Stock Return Predictability?* | Any published edge we test is the DECAYED version. Independent confirmation of this project's whole method. |
| **15 macro predictors** (D/P, term spread, credit spread, T-bill, inflation, book/market…) "predicted poorly both in-sample and out-of-sample for 30 years" and "would not have helped an investor" | Goyal & Welch (2008) | The macro family is a **documented dead end**. Test cheaply, expect failure, don't build on it. |
| **Heavily shorted stocks underperform by 1.16% over 20 days (15.6% ann.)**; short volume ratio is a significant NEGATIVE predictor; institutional shorts most informative | Boehmer, Jones & Zhang, *Which Shorts Are Informed?* | The **best non-price candidate** — and it is a SHORT signal, the direction that has failed every price-based test here. |
| Shorts are informed via news/information processing, not just momentum | Engelberg, Reed & Ringgenberg | Short-flow is information, not noise — worth a daily-frequency test. |

## Free data map (verified reachable from this environment)

| Source | What | Status |
|---|---|---|
| **FINRA RegSHO daily** `cdn.finra.org/equity/regsho/daily/CNMSshvol<YYYYMMDD>.txt` | **per-symbol DAILY short-sale volume + total volume**, ~10k symbols/day, back to ~2018 | ✅ **200 OK — the key find** |
| **CFTC COT** `cftc.gov/files/dea/history/fut_fin_txt_<YYYY>.zip` | weekly futures positioning (commercial vs speculative) | ✅ 200 OK |
| Yahoo `^SKEW` | CBOE options-implied **tail/crash pricing** | ✅ |
| Yahoo `^VVIX` | vol-of-vol (options on VIX) | ✅ |
| Yahoo `^VIX9D` / `^VIX` / `^VIX3M` | full short-end term structure | ✅ |
| Yahoo `^TNX` / `^IRX` | curve slope | ✅ |
| Computed breadth (% of book > own 200MA) | cross-sectional participation | ✅ (derived) |
| FRED CSV | credit spreads, NFCI, EPU | ❌ network-blocked here → proxy with HYG/LQD, TNX−IRX |
| CBOE put/call JSON, `^PCALL`, `^CPC` | put/call ratios | ❌ 403 / empty |

## Test protocol (unchanged, D-146/D-155 gates)
Every signal: percentile vs trailing 252d → forward return at extremes → **must be |t|>2 in BOTH halves with
the SAME sign** (the disambiguation that caught the calm-VIX artifact), plus matched random control where a
trade-level test applies. Caveat carried into the short-volume test: our FINRA data starts 2018, entirely
post-publication of Boehmer et al., and FINRA short volume includes market-maker hedging (noisier than the
institutional data in the paper). We are testing the tradable remainder, not the paper's headline.
