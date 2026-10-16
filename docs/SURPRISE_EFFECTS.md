# SURPRISE EFFECTS — what the market demonstrably rewards for being surprised, tested only as pre-registered (D-987)

> Regenerated every daily coverage-runner cycle by `scripts/surprise-program.ts`. Generated 2026-10-16T03:35:18.414Z. Every test below was written into the append-only `trd_prereg` table (rows `D-987-*`, text in `scripts/surprise-registry.ts`, verified identical on every run) BEFORE its outcome was computed. Machine-readable: `research/surprise-ledger.json`.

**7 pre-registered · 3 tested · 0 survived · 4 accruing.** Accruing floors are re-checked every night as an UPPER BOUND on progress; the night one may be met the run exits RED ("FLOOR MET — SCORER REQUIRED") until the registered statistic is computed and its outcome written once — maturity cannot pass silently. A survivor becomes a `trd_forward_rules` clock — never capital.

Gates for every row: the D-823 pre-registered ceiling sqrt(2 ln(trials under the id + all registrations)); SIGN stated before the data; a POSITIVE CONTROL that must show the surprise measure moves price on release day before any forward null is believed; effect in bp per 1sd vs the round-trip cost; DSR >= 0.95, MinTRL <= n and PBO < 0.5 on the net trading expression.

## The registered tests

| id | surprise variable | instrument | status | outcome recorded | result |
|---|---|---|---|---|---|
| `D-987-claims-surprise-spx` | macro release surprise (labour, weekly) | S&P 500 (CSPX/SPY via ^GSPC) | **UNTESTED** | untested | POSITIVE CONTROL FAILED: day-0 slope -1.55bp/sd t -0.83 — the statistical surprise carries no priced information on release day, so a forward null would be about the PROXY, not the market. |
| `D-987-cpi-surprise-spx` | macro release surprise (inflation, monthly) | S&P 500 (CSPX/SPY via ^GSPC) | **REJECTED** | rejected | SIGN MISSED: fwd-5 slope 20.29bp/sd (t 1.15) is not negative; a positive slope is an unregistered flip and not claimable. |
| `D-987-pead-holdout` | earnings surprise / post-earnings drift (holdout) | US liquid single names (not ISA-basket; informs the S&P/Nasdaq driver map) | **ACCRUING** | — | 297 holdout events with a reported surprise across 3 month(s); 1/6 months have >= 50 raw events and a complete 20-session window (upper bound before the liquidity filter). |
| `D-987-revision-surprise` | estimate-revision surprise | US liquid single names (feeds the S&P/Nasdaq 'earnings revisions' driver) | **ACCRUING** | — | revision snapshots since 2026-09-07; 0/12 monthly cross-sections have a complete 21-session forward window. |
| `D-987-implied-move-surprise` | options-implied vs realised move surprise (earnings) | US liquid single names with listed options | **ACCRUING** | — | 20/300 events with a valid pre-report IV (<= 5 days old) and a matured 20-session window, across 1/2 earnings quarter(s); 387 reported events in the window before the IV filter. Count only — no statistic computed below the floor. |
| `D-987-release-reversal-forward` | macro release-hour surprise reaction (reversal), forward | S&P 500 / Nasdaq-100 (CSPX, EQQQ) | **ACCRUING** | — | 4/40 qualifying calendar releases since 2026-09-13 (upper bound before the hourly-bar completeness check). |
| `D-989-uk-cpi-surprise-gilts` | UK macro release surprise (CPI, monthly) | UK gilts (IGLT/short-dated gilt funds; research series BoE 5y zero-coupon yield) | **UNTESTED** | untested | POSITIVE CONTROL FAILED: day-0 5y gilt yield move 0.58bp/sd t 1.20 — the naive UK CPI surprise is not what gilts price on release day. |

### D-987-claims-surprise-spx — UNTESTED

| measure | value |
|---|---|
| events | 2962 (1970-01-08..2026-10-08) |
| POSITIVE CONTROL: day-0 slope | -1.55bp per 1sd, t -0.83 (NW1 -0.74) — needs abs(t) >= 2 |
| PRIMARY: next-5-session slope | -3.03bp per 1sd, t -0.74 (NW1 -0.62); deciding t -0.62; registered sign NEGATIVE |
| halves (first 2/3, last 1/3) | -5.23bp t -1.12 (n 1974) / 1.7bp t 0.21 (n 988) |
| effect vs 6bp round trip | 0.5x |
| trading expression (p = -clip(z,-2,2)/2) | gross 2.54bp, net 0.42bp per release; DSR 0.006; MinTRL 219089; PBO 0.271 over 4wk/8wk/13wk |
| pre-registered ceiling | 3.19 |
| eras (descriptive) | 1970s -19.6bp t -2.16 · 1980s 8.4bp t 0.88 · 1990s 3.24bp t 0.38 · 2000s -12.94bp t -1.15 · 2010s 3.22bp t 0.37 · 2020s 12.72bp t 0.92 |
| INSTRUMENT conversion (SPY on ^GSPC, weekly) | beta 0.997, corr 0.9961 over 1696 weeks |

### D-987-cpi-surprise-spx — REJECTED

| measure | value |
|---|---|
| events | 123 (2016-02-19..2026-09-11) |
| POSITIVE CONTROL: day-0 slope | 25.59bp per 1sd, t 2.65 (NW1 2.12) — needs abs(t) >= 2 |
| PRIMARY: next-5-session slope | 20.29bp per 1sd, t 1.15 (NW1 1.23); deciding t 1.15; registered sign NEGATIVE |
| halves (first 2/3, last 1/3) | 30.87bp t 1.46 (n 82) / -28.52bp t -0.9 (n 41) |
| effect vs 6bp round trip | 3.38x |
| trading expression (p = -clip(z,-2,2)/2) | gross -13.57bp, net -15.86bp per release; DSR 0; MinTRL Infinity; PBO 0.829 over 3m/6m |
| pre-registered ceiling | 3.188 |
| eras (descriptive) | 2010s 17.19bp t 0.9 · 2020s 21.87bp t 0.87 |

### D-989-uk-cpi-surprise-gilts — UNTESTED

| measure | value |
|---|---|
| events | 130 (2015-10-13..2026-09-16) |
| POSITIVE CONTROL: day-0 slope | 0.58bp per 1sd, t 1.2 (NW1 1.46) — needs abs(t) >= 2 |
| PRIMARY: next-5-session slope | 0.71bp per 1sd, t 0.9 (NW1 1.22); deciding t 0.9; registered sign POSITIVE |
| units | slopes in bp of 5y gilt YIELD per 1sd; effect = slope x 4.5 duration in bp of price |
| halves (first 2/3, last 1/3) | 0.68bp t 0.72 (n 86) / 0.5bp t 0.3 (n 44) |
| effect vs 10bp round trip | 0.32x |
| trading expression (p = -clip(z,-2,2)/2) | gross -2.11bp, net -6bp per release; DSR 0; MinTRL Infinity; PBO 0.771 over 24m/36m |
| pre-registered ceiling | 3.188 |

## Surprise families already measured on this record (not re-registered — D-823 forbids re-mining)

| family | decisions | verdict on record |
|---|---|---|
| earnings surprise / PEAD | D-225, D-393, D-489, D-612 | real 1996-2012 (t 3.89), decayed post-2012 (t 0.24); best real-surprise spec t 2.83 below ceiling; analyst-coverage cut not supported, event-level t inflated 4x vs portfolio. Re-entered ONLY as the post-2026-08-24 holdout D-987-pead-holdout. |
| short-interest surprise | D-805 (prereg D-805-si-surprise-K12) | rejected. |
| settlement-fails / short-volume surprise | D-621..D-626 | independent of each other, both significant — in the UNREGISTERED direction; the registered direction lost (SIGN LAW: not claimable). |
| EIA inventory change (vs 5-yr seasonal) | D-743 | null (CL t -0.62 sign missed, NG t 0.16); the analyst-consensus inventory surprise is not held. |
| macro release-hour reaction | D-877, D-877b | continuation null (1 of 7); index REVERSAL above cost but sign registered the other way -> re-registered forward-only as D-987-release-reversal-forward. |
| index inclusion / deletion | D-740, D-963, D-965 | footprint real (adds +1.54% t 3.65 into effective date) but consumed at the announcement; lag-1 entrant funds the pop (-142bp/event). |
| spin-offs | D-733 (clock fwd-spinoff-premium) | forward clock running; latest mark liq median excess vs IWM +45.5pp at n 54 — not a promote until its own floor. |
| dealer gamma (options flow) | D-961, D-967, D-968, D-970 | vol-damping validated in 3 regimes (pooled t -17.3); direction dead; sizing gain +6.7% OOS awaiting free-feed calibration (D-970-gex-sizing-calibration). |
| implied vs realised (VIX / VRP / fear) | D-276, D-498, D-830, D-817 | fear-reversion near-miss; the first 'survivors' were same-bar phantoms (sign-flipped at lag 1); implied is a priced insurance premium, not a forecast; BTC VRP measured, null by rule. |
| ETF flow surprise (gold) | D-745 | refuted — flow follows price. |
| crypto funding / positioning / order-flow surprise | D-415, D-426, D-553/554, D-808/809 | pooling artefact retracted; order-flow surprise 0.02-0.18x the fee; the profitable funding direction is an unregistered flip. |
| crypto on-chain surprise | D-928 clock, D-972 prereg | single-chain fee-momentum clock running; cross-chain breadth consumer registered with a feed-removal kill. |
| real-yield change | D-730 | null forward (t 0.16/-0.27/-0.13). |

## Surprise variables the market rewards that we cannot yet measure (named barrier, not a market finding)

| variable | barrier |
|---|---|
| macro surprise vs CONSENSUS (CPI, payrolls, claims, ISM) | no free keyless consensus HISTORY is held; the statistical surprises tested here are a proxy (and the claims proxy failed its positive control). Candidate forward-accrual source: the ForexFactory weekly calendar JSON (forecast + previous) — not on the endpoint allowlist, NOT probed; one operator allowlist line would start a consensus feed whose first test could be registered at birth. |
| FOMC / policy-rate surprise | fed-funds futures and OIS are not held (CME data is paid); a daily 2y-yield proxy exists in trd_yield_curve but no FOMC timestamp series is ingested. |
| Treasury auction surprise (tail vs when-issued) | auction results are free and keyless at api.fiscaldata.treasury.gov and the host IS allowlisted (D-989 corrects D-987) — not yet ingested; when-issued yields are not free. |
| UK release surprise vs CONSENSUS (CPI, labour, BoE decisions) | D-989 holds ONS CPI first-release dates (130, 2015+) and the BoE curves: the NAIVE UK CPI surprise failed its day-0 control on gilts (D-989-uk-cpi-surprise-gilts UNTESTED). UK consensus is not held; ONS labour series are latest-vintage only (no first-release values), so a labour surprise is not testable point-in-time; no MPC decision-date series is ingested. |
| crypto spot-ETF flow surprise | no free daily flow history is held. |
| intraday earnings / announcement-timestamp reaction | intraday single-name equity history is a PAID gap (D-965); the daily expression is what D-987-pead-holdout and D-987-implied-move-surprise test. |

## How to read this page

- **UNTESTED** = the input was present but failed its positive control, or the input is absent: a statement about our data, never about the market.
- **REJECTED** = the registered kill condition fired. It cannot be re-opened by a variant; only a fresh registration on data that did not exist when this one was scored.
- **ACCRUING** = the data is arriving through an existing nightly feed and the floor is re-checked every night; reaching it turns the nightly run RED until the statistic is computed, so nobody has to remember — but for three of the four a session must still build that scorer. D-987-implied-move-surprise already carries its scorer: it only COUNTS below its floor and scores itself, once, the night the floor is met.
- A pre-registered UNTESTED/REJECTED is the engine working: the operator's money is protected by exactly these rows.
