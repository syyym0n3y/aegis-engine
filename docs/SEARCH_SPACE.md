# SEARCH SPACE — who pays a return and why, mapped against what this programme has actually asked (D-850)

> Regenerated daily by `scripts/search-space.ts`. D-848 measured the search as 64.1% self-referential; this map is drawn from OUTSIDE the ledger — by counterparty, not by asset class or signal — and then matched to it. The taxonomy is the author's enumeration, not a citation, and is kept open. **A cell reading UNTESTED is a question this programme has never asked, not a market that has been shown efficient.**

**21 cells: 21 have at least one matching row, 0 have none.** Cells: A1 tested 2 (2 live) · A2 tested 2 (2 live) · A3 tested 3 (3 live) · A4 tested 11 (8 live) · A5 tested 3 (1 live) · B1 tested 3 (1 live) · B2 tested 5 (1 live) · B3 tested 8 (1 live) · B4 tested 17 (4 live) · C1 tested 21 (8 live) · C2 tested 11 (7 live) · C3 tested 3 (3 live) · D1 tested 26 (11 live) · D2 tested 17 (5 live) · D4 tested 6 (1 live) · D3 tested 15 (5 live) · E1 tested 1 (1 live) · E2 tested 1 (1 live) · E3 tested 14 (10 live) · F1 tested 5 (1 live) · F2 tested 4 (1 live)

## A1 — index funds: must trade at rebalance regardless of price
examples: index inclusion/deletion, close auction imbalance, month-end

| row | family | status |
|---|---|---|
| D734-index-inclusion | index inclusion / deletion | watched |
| D-740-index-inclusion | event (equity) | measured |

## A2 — levered holders: margin, liquidation, funding forces the sale
examples: perp liquidation cascades, funding extremes, forced selling

| row | family | status |
|---|---|---|
| D-756-forced-selling | event (equity) | measured |
| D-758-uk-rights-issues | event (UK) | measured |

## A3 — ETF / ETN / structured wrappers: mechanical roll, leverage reset, creation/redemption
examples: VIX roll, levered ETF decay, commodity roll, CEF discount

| row | family | status |
|---|---|---|
| D-742-commodity-roll | carry (commodity) | measured |
| D-750-cef-discount | wrapper mispricing (CEF) | monitoring |
| D-755-cef-tender | wrapper mispricing (CEF) | measured |

## A4 — corporate actions: terms fixed by document, not by market  *(capacity-inverted: pays per head, not per pound)*
examples: odd-lot tender, reverse-split round-up, SPAC trust, rights, spin-offs

| row | family | status |
|---|---|---|
| etf-crosssection | book | killed |
| D732-merger-arb | merger arbitrage | measured |
| D733-spinoff | spin-offs / corporate separations | monitoring |
| D-751-odd-lot-tender | event (retail structural) | measured |
| D-755-cef-tender | wrapper mispricing (CEF) | measured |
| D-758-uk-rights-issues | event (UK) | measured |
| D-760-spac-trust | event (SPAC) | measured |
| D734-despac | SPAC / de-SPAC | measured |
| D-837-reverse-split-roundup | structural | killed |
| D-849-g7-merger-oddlot | structural | untested |
| D-856-g7-merger-roundup-population | structural | measured |

## A5 — regulated / mandated flows: rule requires the trade
examples: settlement fails, buy-ins, tax-loss selling, window dressing, dividend capture by constrained funds

| row | family | status |
|---|---|---|
| ftd-persistence | shortside | killed |
| D-643 | shortside | killed |
| D-756-forced-selling | event (equity) | measured |

## B1 — insiders / politicians: they know first; disclosure lags
examples: Form 4, congressional, 13D activists

| row | family | status |
|---|---|---|
| form345-sells | form345 | killed |
| D-762-activist-13d | event (equity) | measured |
| D-805-insider-sells | insider | rejected |

## B2 — institutional footprint: size leaves a print
examples: 13F, N-PORT, dark-pool share, ATS, short interest

| row | family | status |
|---|---|---|
| nport-ownership | nport | killed |
| own13f-signals | own13f | killed |
| darkpool-share | darkpool | killed |
| retail-internalisation | darkpool | monitoring |
| D-817-spx-gex-dix | vol | rejected |

## B3 — the order book: aggressor imbalance precedes the move (or does not)
examples: taker imbalance, OI, basis, book depth

| row | family | status |
|---|---|---|
| D-426 | crypto-microstructure | killed |
| D-431 | crypto-derivatives | watched |
| D-808-book-depth-imbalance | timing | rejected |
| D-808-flow-metrics | timing | rejected |
| D-816-equity-depth-flow | timing | rejected |
| D-820-spx-oi-levels | timing | rejected |
| D-904-timing-vs-long-basket | portfolio | reference |
| D-925 | attribution | descriptive |

## B4 — analysts / issuers: estimates and guidance move before price finishes
examples: revisions, earnings drift, going-concern, late filings, non-reliance

| row | family | status |
|---|---|---|
| pead-real-surprises | xsec_eq | killed |
| annprem | annprem | killed |
| restructuring-events | nonreliance | killed |
| D-632 | event | killed |
| D-647 | event | killed |
| D732-merger-arb | merger arbitrage | measured |
| grammar-vs-buyhold | ml | monitoring |
| pead-analyst-coverage | pead | killed |
| exec-resignations | nonreliance | killed |
| accounting-red-flags | nonreliance | killed |
| delisting-notices | nonreliance | killed |
| D-762-activist-13d | event (equity) | measured |
| … | 5 more | |

## C1 — hedgers: pay a premium to shed variance
examples: variance risk premium, skew, term structure, hedging pressure (COT/TFF)

| row | family | status |
|---|---|---|
| D-454 | equity-volatility | confirmed-corrected |
| D-461 | equity-volatility | measured |
| cot-positioning | cot | killed |
| cot-disagg | cotdisagg | killed |
| tff-cohorts | tff | killed |
| D-663 | tff | killed |
| D-435 | crypto-derivatives | watched |
| vrp-implementability | vol | monitoring |
| cot-crosssectional | cot | killed |
| tff-sign-replication | tff | killed |
| vrp-straddle-model | vol | killed |
| crypto-vrp | vol | monitoring |
| … | 9 more | |

## C2 — carry payers: pay to hold the wrong side of a rate gap
examples: FX carry, funding carry, basis carry, dividend carry

| row | family | status |
|---|---|---|
| D-433 | crypto-derivatives | watched |
| D731b-bond-carry | carry (bond) | measured |
| funding-live-crosssection | crypto-derivatives | killed |
| crypto-funding-carry | ml | monitoring |
| D-431 | crypto-derivatives | watched |
| D-664 | infra | fixed |
| D-738-fx-carry | carry (fx) | measured |
| D-741-fx-carry-em | carry (fx) | measured |
| D-742-commodity-roll | carry (commodity) | measured |
| D-849-g7-merger-oddlot | structural | untested |
| D-865-multistrategy-blend | book | killed |

## C3 — tail buyers: overpay for convexity
examples: lottery / longshot, low-vol, IPO allocation, prediction markets

| row | family | status |
|---|---|---|
| D733-lockup | IPO / lockup expiry | measured |
| D-753-prediction-markets | prediction markets | measured |
| D-754-ipo-pop | event (primary market) | measured |

## D1 — trend followers' counterparties: underreact to persistent information
examples: time-series momentum, cross-sectional momentum, breakouts, MTF structure

| row | family | status |
|---|---|---|
| factor-momentum | factmom | killed |
| D-443 | crypto-factor | killed |
| weekly-crosssection | weekly | killed |
| szbivar-liquidity-law | szbivar | monitoring |
| intl-momentum-geography | intl | monitoring |
| D-652 | intl | killed |
| D-653 | intl | killed |
| D-655 | xsec_eq | killed |
| industry-momentum-not-identified | equity-factor | killed |
| D-765-mtf-fvg | price-action structure | measured |
| D-763-mtf-liquidity-break | price-action structure | measured |
| D-766-mtf-setup-battery | D-766-mtf-setup-battery | MEASURED |
| … | 14 more | |

## D2 — mean-reverters' counterparties: overreact and pay to get out
examples: reversal, range exhaustion, fades, overnight/intraday

| row | family | status |
|---|---|---|
| overnight-decomposition | overnight | killed |
| weekly-crosssection | weekly | killed |
| residual-fade-p3 | book | killed |
| szbivar-liquidity-law | szbivar | monitoring |
| crypto-subset-exhaustive | ml | monitoring |
| crypto-hourly-reversal | ml | killed |
| overnight-premium-breakeven | equity-pattern | killed |
| D-750-cef-discount | wrapper mispricing (CEF) | monitoring |
| D-767-mtf-volume-conditions | D-767-mtf-volume-conditions | MEASURED |
| D-764-psl-fade | price-action structure | monitoring |
| D-809-poc-pressure-delta | timing | rejected |
| D-866-trend-placeable-retail | book | killed |
| … | 5 more | |

## D4 — cross-instrument laggards: one instrument moves first and the other catches up
examples: lead-lag, spillover, leader/follower at hourly resolution

| row | family | status |
|---|---|---|
| D-417 | cross-asset | killed |
| xasset-leadlag | xasset | killed |
| xasset-hourly-leadlag | ml | killed |
| D-763-mtf-liquidity-break | price-action structure | measured |
| D-862-hourly-leadlag | timing | killed |
| D-927 | attribution | descriptive |

## D3 — seasonal / calendar: predictable timing of flows
examples: turn-of-month, day-of-week, settlement stamps, session windows

| row | family | status |
|---|---|---|
| D-445 | crypto-microstructure | killed |
| heston-sadka | hestonsadka | killed |
| seasonality | seasonal | killed |
| index-sessions | sessions | killed |
| D-641 | method | fixed |
| D-671 | infra | fixed |
| D-743-inventory-surprise | event (commodity) | measured |
| D-763-mtf-liquidity-break | price-action structure | measured |
| D-764-psl-fade | price-action structure | monitoring |
| D-808-value-area-levels | timing | rejected |
| D-816-equity-depth-flow | timing | rejected |
| D-846b-adjusted-levels-eighths | reliability | measured |
| … | 3 more | |

## E1 — venues / brokers / issuers: subsidise acquisition per HEAD, not per pound  *(capacity-inverted: pays per head, not per pound)*
examples: sign-up bonuses, fee rebates, maker rebates, prop-firm payout structure

| row | family | status |
|---|---|---|
| D-851-venue-signup-bonus | structural income | measured |

## E2 — claims administrators: fixed payment per claimant, most never claim  *(capacity-inverted: pays per head, not per pound)*
examples: class-action settlements, unclaimed elections, abandoned property

| row | family | status |
|---|---|---|
| D-852-class-action-claims | structural income | measured |

## E3 — the tax and wrapper system: certain, linear, capped per person  *(capacity-inverted: pays per head, not per pound)*
examples: ISA/SIPP wrapper, employer match, deposit compounding

| row | family | status |
|---|---|---|
| wrapper-vs-factor | book | monitoring |
| ladder-crossover-invariant | structural | fixed |
| D680-tax-drag | ladder-mechanics | measured |
| D-744-holdability-sizer | structural | measured |
| D-750-cef-discount | wrapper mispricing (CEF) | monitoring |
| D-755-cef-tender | wrapper mispricing (CEF) | measured |
| D-758-uk-retail-structural | structural income | measured |
| D-868-etf-longonly-trend-timing | book | monitoring |
| D-873-isa-plus-crypto-parity | book | monitoring |
| D-870-timed-risk-parity-classes | book | monitoring |
| D-872-vol-regime-overlay | book | monitoring |
| D-894-placeable-vol-premium-sleeve | portfolio | killed |
| … | 2 more | |

## F1 — nobody — the process: range/vol is forecastable even when direction is not
examples: HAR-RV, range persistence, GARCH

| row | family | status |
|---|---|---|
| D-814-har-rv | vol | MEASURED |
| D-817-dvol-vrp | vol | rejected |
| D-821-harrv-sizing | timing | rejected |
| D-822-vrp-conditional-harrv | vol | rejected |
| D-830-forecast-vs-implied-equity | vol | killed |

## F2 — nobody — the microstructure: tick, spread, and discreteness
examples: tick lattice, bid-ask bounce, round numbers, decimalisation

| row | family | status |
|---|---|---|
| D-643 | shortside | killed |
| D-811-fx-footprint | timing | rejected |
| D-843-era-cost | reliability | killed |
| D-846-adjusted-levels | reliability | measured |

## What this map cannot do
It matches by keyword, so a cell with rows may still be badly covered and a cell without rows may have been touched under other words. It is a prompt for the next question, not a certificate. The cells marked capacity-inverted are the only ones where an account near zero holds an advantage (D-834); everything else pays a rate on capital the account does not have.
