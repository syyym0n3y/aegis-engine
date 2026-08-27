# GAP REGISTER

> Week 2 rule: every gap is either **FILLED** or **RECORDED WITH THE VERDICT IT BLOCKS**.
> Machine-readable in `trd_gap_register`; checked each cycle by `scripts/gap-register-guard.ts`.
> A gap marked filled whose data has gone stale is worse than an unfilled gap — it silently licenses conclusions the
> data no longer supports.

## Filled

| gap | what it previously blocked | proxy it replaced |
|---|---|---|
| **US Treasury yield curve** (9,170 days, 1990–2026, 14 tenors) | any statement about curve *shape* — inversion, steepening, twist — and all rates-conditioned regime tests | TLT, one long-duration ETF; a parallel shift and a twist are indistinguishable to it |

## Blocked on credentials — operator action, ingest already built

| gap | blocker | what it blocks | proxy contaminating results today |
|---|---|---|---|
| **FRED macro** | free key, fredaccount.stlouisfed.org | every credit-conditioned verdict (`BAMLH0A0HYM2` is the real HY spread); every liquidity-conditioned crypto verdict (`WALCL`); all macro regime conditioning, which no verdict here has ever applied | **HYG** — an equity-listed ETF whose price reflects fund flows and duration as much as credit |
| **FINRA TRACE** | free account, developer.finra.org | the only non-institutional source of real credit-market transactions; no credit signal has ever been tested and the family does not exist on the board | **HYG again** — one ETF standing in for an entire asset class |

## Blocked on paid data — operator's call

| gap | what it blocks |
|---|---|
| **Options history / IV surface** | the entire volatility-surface family. D-435 rests on **66 non-overlapping windows**; equity VRP cannot be tested at all |
| **Intraday equities** | all equity microstructure and intraday timing. The grammar work (D-588–595) ran on crypto and FX *because* equities were unavailable at that frequency |
| **Borrow rates and availability** | the cost side of every short-leg claim. D-627 showed the fails signal requires shorting the hardest-to-borrow names at a borrow cost the backtest models as **zero** — the largest unmodelled cost on this board |

## Structural — nobody can close

| gap | why |
|---|---|
| **Real execution fills** | requires live trading at size. D-592 measured fill-conditional returns from OHLC bars, which is a reconstruction, not a fill. Queue position, partial fills and true slippage stay unmeasurable |

## Unfetched, engine-actionable — free, allowlisted, scheduled

| gap | what it blocks |
|---|---|
| **EDGAR full-text** (`efts.sec.gov`) | any text-derived event signal — going-concern language, litigation disclosure, auditor changes beyond the structured event tables. `trd_raw_filings` holds **zero** rows |
| **CoinGecko / Blockchair** | cross-venue crypto reference and on-chain flow beyond the blockchain.info series held. Low priority: D-439 already found on-chain fundamentals null |

## Why this register exists

Three times in two days a free, already-accessible dataset was found missing *after* conclusions had been drawn on
its absence: EDGAR concepts (the COVERAGE LAW's origin), spot coverage at 33 of 484 (which defined "placeable" in
D-603), and the Treasury curve (which left TLT standing in for all of rates). The pattern is not that the data was
hard to get — it is that **nothing was watching for its absence**.
