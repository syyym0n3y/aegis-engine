# LIVE STATE — snapshot of the owned node

> Written by `state-export.ts` at **2026-09-24T00:50:21.941Z**. This is a SNAPSHOT, not a live view:
> a session reading it off git (cloud, another device) must treat every number as "as of" that timestamp.
> The node itself is never exposed — the repo is the only bridge.

## Kill switches

- `paper`: **armed**
- `micro`: **armed**

## Forward clocks (34)

| clock | started | last mark |
|---|---|---|
| fwd-book-p2-paper | 2026-08-24 | 2026-09-23 |
| fwd-canonical-premia-blend | 2026-09-15 | 2026-09-23 |
| fwd-cef-discount | 2026-09-01 | 2026-09-23 |
| fwd-crypto-lit5 | 2026-08-24 | 2026-09-23 |
| fwd-despac-underperf | 2026-08-31 | 2026-09-23 |
| fwd-despac-underperf-v2 | 2026-09-02 | 2026-09-23 |
| fwd-direction-4h-xrp-bnb-makerin-takerout | 2026-09-13 | 2026-09-23 |
| fwd-distress-blend-combined | 2026-09-16 | 2026-09-23 |
| fwd-distress-ivol-blend-5 | 2026-09-16 | 2026-09-23 |
| fwd-eq-belowPML-liquid-K5-day-clustered | 2026-09-04 | 2026-09-23 |
| fwd-etf-trend-timing | 2026-09-13 | 2026-09-23 |
| fwd-fourfactor-blend-gcshort | 2026-09-16 | 2026-09-23 |
| fwd-ftd-persistence-short | 2026-08-26 | 2026-09-23 |
| fwd-goingconcern-distress | 2026-09-15 | 2026-09-23 |
| fwd-gold-rangeext-cont-k24 | 2026-09-13 | 2026-09-23 |
| fwd-hedging-pressure-flip | 2026-08-26 | 2026-09-23 |
| fwd-isa-crypto-parity | 2026-09-13 | 2026-09-23 |
| fwd-latefiling-distress | 2026-09-16 | 2026-09-23 |
| fwd-nt-late-avoid | 2026-09-02 | 2026-09-23 |
| fwd-onchain-fee-momentum | 2026-09-15 | 2026-09-23 |
| fwd-payout-8 | 2026-08-22 | 2026-09-23 |
| fwd-persist-real-K24 | 2026-09-03 | 2026-09-23 |
| fwd-placeable-psl-fade-k24 | 2026-09-08 | 2026-09-23 |
| fwd-prop-ftmo100k-utc16-0p5x-v1 | 2026-09-06 | 2026-09-23 |
| fwd-psl-fade | 2026-09-03 | 2026-09-23 |
| fwd-residual-follow | 2026-08-24 | 2026-09-23 |
| fwd-spinoff-premium | 2026-08-31 | 2026-09-23 |
| fwd-three-factor-blend | 2026-09-15 | 2026-09-23 |
| fwd-trend-long-parity | 2026-09-13 | 2026-09-23 |
| fwd-tsmom-110 | 2026-09-13 | 2026-09-23 |
| fwd-utc01-sweepPDL-reclaim-long-K6-panel17 | 2026-09-04 | 2026-09-23 |
| fwd-utc09to10-belowPDL-long-K6-panel17 | 2026-09-04 | 2026-09-23 |
| fwd-utc16-abovePDH-long-K6-panel17 | 2026-09-04 | 2026-09-23 |
| fwd-xmr-asia-rangefade | 2026-09-15 | 2026-09-23 |

## Pre-registrations (most recent 40)

| id | outcome | registered |
|---|---|---|
| D-972-onchain-breadth-consumer | _open_ | 2026-09-23 |
| D-970-crowd-dc-adoption | ADOPTED | 2026-09-23 |
| D-970-gex-sizing-calibration | _open_ | 2026-09-23 |
| D-960-london-session-continuation | _open_ | 2026-09-22 |
| D-935-latefiling-distress-short | supported | 2026-09-16 |
| D-934-exit-rules-capital-velocity | supported | 2026-09-16 |
| D-933-explosive-upside-squeeze | null_confirmed | 2026-09-16 |
| D-932-fourfactor-blend-gcshort | supported | 2026-09-16 |
| D-931-goingconcern-borrow-cost | supported | 2026-09-15 |
| D-930-goingconcern-edgar | supported | 2026-09-15 |
| D-929-attention-predictors | untested | 2026-09-15 |
| D-928-onchain-predictors | null_confirmed | 2026-09-15 |
| D-927-crossinstrument-leadlag | null_confirmed | 2026-09-15 |
| D-925-orderbook-imbalance-predict | null_confirmed | 2026-09-15 |
| D-924-cryptomom-third-sleeve | supported | 2026-09-15 |
| D-923-positioning-predictors | null_confirmed | 2026-09-15 |
| D-922-canonical-premia-diversification | supported | 2026-09-15 |
| D-921-intraday-residual-structure | null_confirmed | 2026-09-15 |
| D-920-driver-variance-decomposition | null_confirmed | 2026-09-15 |
| D-919-confluence-liftpastcost | null_confirmed | 2026-09-15 |
| D-918-illiquid-altmr-portfolio | null_confirmed | 2026-09-15 |
| D-917-quality-surface-phase0 | supported | 2026-09-15 |
| D-916-stake-vs-edge-model | confirmed | 2026-09-14 |
| D-915-prop-real-firm-terms | partial | 2026-09-14 |
| D-914-prop-funded-trailing-dd | partial | 2026-09-14 |
| D-913-leverageable-excess-audit | confirmed | 2026-09-14 |
| D-912-winning-construction-on-futures | partial | 2026-09-14 |
| D-911-futures-trainselect-book | null | 2026-09-14 |
| D-910-futures-book-breadth-floor | null | 2026-09-14 |
| D-909-futures-implemented-book | untested | 2026-09-14 |
| D-908-futures-financing-route | partial | 2026-09-14 |
| D-907-prop-economics | untested | 2026-09-14 |
| D-906-unlevered-growth-frontier | partial | 2026-09-14 |
| D-905-unfinanced-leverage-in-the-ladder | confirmed | 2026-09-14 |
| D-904-timing-vs-long-basket | confirmed | 2026-09-14 |
| D-903-era-conditional-ladder | null | 2026-09-14 |
| D-902-rates-diversification-regime | confirmed | 2026-09-14 |
| D-901-isa-sleeve-universe | supported | 2026-09-14 |
| D-900-isa-sleeve-robustness | supported | 2026-09-14 |
| D-899-macro-state-sleeve | null | 2026-09-14 |

## Gap register

| gap | status | actionable by |
|---|---|---|
| trace-credit | blocked-credential | operator |
| intraday-equities | blocked-paid | operator |
| options-history | blocked-paid | operator |
| borrow-rates | blocked-paid | operator |
| yield-curve | filled | engine |
| edgar-fulltext | filled | engine |
| fred-macro | filled | operator |
| coingecko-blockchair | filled | engine |
| sp500-announcement-dates | filled | operator |
| binance-live-universe | retracted | engine |
| real-fills | structural | nobody |
| delisted-price-history | unfetched | operator |
| binance-vision-archive | unfetched | operator |

## Guard board (last local run)

`-- all 32 guards green`

> The 32-guard board reads the owned node directly and therefore CANNOT run off-machine. Any session
> without node access must not claim a green board — it can only quote this line and its timestamp.

