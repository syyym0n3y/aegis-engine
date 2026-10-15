# THE LONG-TERM BASKET — instruments held only because we can measure what moves them (D-987)

> Regenerated every daily coverage-runner cycle by `scripts/basket-register.ts`; generated 2026-10-15T02:27:36.880Z. Machine-readable: `research/basket.json`. **Not advice** — single-operator research; every vehicle is a candidate to verify with the broker (ISA/SIPP eligibility, KID, TER, currency line).

**understood = measured material drivers ÷ material drivers.** A driver is MEASURED only if its feed is held AND fresh within a budget matched to how often its source publishes (daily 6d · weekly 14d · monthly 85d, monthly series dated at period start). Held-but-stale is not measured (CONTINUITY LAW). Materiality was fixed per instrument from the operator's category list before any probe ran; non-material drivers are shown but never scored. Floor for membership: **0.8**.

**10 of 17 candidates qualify.** What this basket is and is not: it EXTENDS the deployed 5-sleeve blend (D-930..D-971) rather than duplicating it — the blend's trend/long sleeves already trade the price of every instrument marked "in trend universe" (read from `tsmom-book.ts` LONGONLY_RE at run time); its distress and IVOL sleeves are single-name SHORTS that no ISA can hold and are therefore not basket members. Understanding a driver is not an edge in it: most rows below carry the record's verdict that the driver is real and NOT forward-tradable — which is exactly why the basket is held through its drivers rather than timed on them (WEALTH_PATH: every timing overlay tested cost terminal wealth; the trend switch is the one admitted exception, measured as a drawdown result).

## Scoreboard

| instrument | candidate vehicle | research proxy | in trend universe | understood | basket | what blocks it |
|---|---|---|---|---|---|---|
| US Treasury bills 0-1y | IB01 (UCITS, USD) — candidate | SHY / 3m bill yield | yes | **1.00** (4/4) | **YES** | — |
| GBP overnight money market | CSH2 / XSTR (UCITS, GBP) — candidate | SONIA (BoE IADB) — a rate, not a fund price | no | **1.00** (3/3) | **YES** | — |
| Physical gold | SGLN / IGLN (physical ETC, GBP/USD lines) — candidate | GLD / GC=F | yes | **0.92** (11/12) | **YES** | central-bank buying |
| US TIPS | ITPS / IDTP (UCITS) — candidate | TIP | no | **0.88** (7/8) | **YES** | TIPS auction supply |
| US Treasuries 20y+ | IDTL / DTLA (UCITS; GBP-hedged line exists) — candidate | TLT | yes | **0.86** (12/14) | **YES** | Treasury auction supply and results; term premium (ACM) |
| UK gilts (conventional) | IGLT / VGOV (UCITS) — candidate | BoE nominal zero-coupon curve — yields, not a fund price | no | **0.86** (6/7) | **YES** | DMO issuance / auction results |
| UK index-linked gilts | INXG (UCITS) — candidate | BoE real zero-coupon curve — yields, not a fund price | no | **0.86** (6/7) | **YES** | DMO linker issuance |
| FTSE 100 | ISF / VUKE (UCITS, GBP) — candidate | ^FTSE (EWU) | yes | **0.83** (10/12) | **YES** | FTSE constituent earnings / revisions; UK fund flows / positioning |
| S&P 500 | CSPX / VUAG (UCITS, USD/GBP lines) — candidate | SPY / ^GSPC | yes | **0.82** (14/17) | **YES** | US activity surveys (ISM / PMI); fund / ETF flows (creations, redemptions); corporate buybacks / blackout windows |
| Nasdaq-100 | EQQQ / CNX1 (UCITS) — candidate | QQQ | yes | **0.82** (14/17) | **YES** | US activity surveys (ISM / PMI); fund / ETF flows (creations, redemptions); corporate buybacks / blackout windows |
| Bitcoin | physically-backed BTC ETP/ETN (UK retail since 2025-10; ISA eligibility — verify) — candidate | BTC-USD / BTCUSDT | no | **0.75** (9/12) | no | spot-ETF flows; stablecoin supply (crypto liquidity); regulatory / exchange events |
| US high-yield credit | IHYG / SHYG (UCITS) — candidate | HYG | yes | **0.75** (6/8) | no | default rates / distress; fund / ETF flows (creations, redemptions) |
| US investment-grade credit | LQDE (UCITS) — candidate | LQD | yes | **0.75** (6/8) | no | IG issuance supply; fund / ETF flows (creations, redemptions) |
| All-World / Developed World | VWRP / SWDA (UCITS) — candidate | VT / ACWI (EFA for ex-US) | yes | **0.67** (10/15) | no | own price / trend / volatility (VT); NON-US constituent earnings and revisions (~40% weight); ECB / BoJ policy paths; non-US activity / inflation releases; fund / ETF flows (creations, redemptions) |
| Broad commodities | CMOD (UCITS) — candidate | DBC | no | **0.67** (6/9) | no | live futures curves / roll yield; China demand / PMI; agricultural supply (USDA WASDE / weather) |
| WTI crude oil | CRUD (ETC) — candidate | CL=F | no | **0.67** (6/9) | no | live futures curve / roll yield; OPEC+ decisions; demand (EIA product supplied, refinery runs) |
| Emerging-market equity | EIMI / VFEM (UCITS) — candidate | EEM | yes | **0.60** (6/10) | no | China activity / credit impulse; EM policy rates (CNY/KRW/INR/BRL); EM constituent earnings / revisions; EM fund flows |

## Driver maps

### S&P 500 — understood 0.82 (14/17) — IN THE BASKET

Vehicle: CSPX / VUAG (UCITS, USD/GBP lines) — candidate. Proxy: SPY / ^GSPC. Role: core growth asset. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (SPY) | yes | MEASURED | `trd_bars_deep SPY` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| macro releases | US weekly initial jobless claims | yes | MEASURED | `trd_macro_series claims_initial_sa` (2026-10-03) | statistical claims surprise UNTESTED — failed its day-0 positive control (D-987-claims-surprise-spx) |
| macro releases | US nonfarm payrolls (level; latest vintage) | yes | MEASURED | `trd_macro_series payrolls_total` (2026-09-01) | held from D-987; first-print vintages NOT held (ALFRED) so payroll SURPRISE is untestable point-in-time |
| macro releases | US activity surveys (ISM / PMI) | yes | GAP | ISM/S&P Global PMIs are proprietary; no free keyless history held | named barrier — not a market finding |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| earnings / revisions | constituent earnings (reported vs consensus) | yes | MEASURED | `trd_earnings` (2026-10-13) | PEAD decayed post-2012 (D-225); holdout registered D-987-pead-holdout |
| earnings / revisions | consensus estimate revisions (~1,000 liquid names) | yes | MEASURED | `trd_macro_series est_rev90_0q:AAPL` (2026-10-14) | forward-only since 2026-09-07; D-987-revision-surprise accruing |
| flows / positioning | CFTC TFF positioning (E-mini S&P) | yes | MEASURED | `trd_cot_tff 13874A` (2026-10-06) | — |
| flows / positioning | fund / ETF flows (creations, redemptions) | yes | GAP | no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected) | named barrier — not a market finding |
| flows / positioning | corporate buybacks / blackout windows | yes | GAP | no buyback-execution series held; only 8-K text (trd_raw_filings), not a flow measure | named barrier — not a market finding |
| options / gamma | implied volatility (VIX) | yes | MEASURED | `trd_bars_deep ^VIX` (2026-10-14) | fear-reversion near-miss (D-276); same-bar phantoms killed (D-498) |
| options / gamma | SPX dealer gamma (SqueezeMetrics GEX) | yes | MEASURED | `trd_macro_series sqm_gex` (2026-10-13) | vol-damping validated 3 regimes, pooled t -17.3; sizing only, never direction (D-967/968) |
| liquidity / credit | credit spread (BAA-10y) | yes | MEASURED | `trd_macro_series credit_baa_10y` (2026-10-13) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| liquidity / credit | financial conditions (NFCI, weekly) | no | MEASURED | `trd_macro_series fin_conditions` (2026-10-02) | — |
| liquidity / credit | equity breadth (% > 200dma, survivorship-biased level) | no | MEASURED | `trd_macro_series breadth_pct_gt_200dma_surv` (2026-10-12) | — |
| seasonality | calendar seasonality (derived from the price series) | no | MEASURED | `trd_bars_deep SPY` (2026-10-14) | turn-of-month = drift wearing a calendar, killed by its benchmark (D-962) |
| macro releases | geopolitical risk index (monthly) | no | MEASURED | `trd_macro_series gpr` (2026-09-30) | — |
| commodity links | crude oil (CL=F) | no | MEASURED | `trd_bars_deep CL=F` (2026-10-14) | — |
| options / gamma | CBOE SKEW / put-call | no | MEASURED | `trd_macro_series cboe_skew` (2026-10-13) | options-regime conditioning null OOS (D-739) |

### Nasdaq-100 — understood 0.82 (14/17) — IN THE BASKET

Vehicle: EQQQ / CNX1 (UCITS) — candidate. Proxy: QQQ. Role: growth tilt (megacap concentration). Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (QQQ) | yes | MEASURED | `trd_bars_deep QQQ` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| macro releases | US weekly initial jobless claims | yes | MEASURED | `trd_macro_series claims_initial_sa` (2026-10-03) | statistical claims surprise UNTESTED — failed its day-0 positive control (D-987-claims-surprise-spx) |
| macro releases | US nonfarm payrolls (level; latest vintage) | yes | MEASURED | `trd_macro_series payrolls_total` (2026-09-01) | held from D-987; first-print vintages NOT held (ALFRED) so payroll SURPRISE is untestable point-in-time |
| macro releases | US activity surveys (ISM / PMI) | yes | GAP | ISM/S&P Global PMIs are proprietary; no free keyless history held | named barrier — not a market finding |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| earnings / revisions | constituent earnings (reported vs consensus) | yes | MEASURED | `trd_earnings` (2026-10-13) | PEAD decayed post-2012 (D-225); holdout registered D-987-pead-holdout |
| earnings / revisions | consensus estimate revisions (~1,000 liquid names) | yes | MEASURED | `trd_macro_series est_rev90_0q:AAPL` (2026-10-14) | forward-only since 2026-09-07; D-987-revision-surprise accruing |
| flows / positioning | CFTC TFF positioning (E-mini Nasdaq) | yes | MEASURED | `trd_cot_tff 209742` (2026-10-06) | — |
| flows / positioning | fund / ETF flows (creations, redemptions) | yes | GAP | no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected) | named barrier — not a market finding |
| flows / positioning | corporate buybacks / blackout windows | yes | GAP | no buyback-execution series held; only 8-K text (trd_raw_filings), not a flow measure | named barrier — not a market finding |
| options / gamma | QQQ implied vol (CBOE ATM IV) | yes | MEASURED | `trd_perp_oi QQQ` (2026-10-14) | — |
| options / gamma | QQQ dealer gamma (naive GEX, forward-only) | yes | MEASURED | `trd_perp_oi QQQ` (2026-10-14) | — |
| liquidity / credit | credit spread (BAA-10y) | yes | MEASURED | `trd_macro_series credit_baa_10y` (2026-10-13) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| seasonality | calendar seasonality (derived from the price series) | no | MEASURED | `trd_bars_deep QQQ` (2026-10-14) | turn-of-month = drift wearing a calendar, killed by its benchmark (D-962) |
| liquidity / credit | financial conditions (NFCI, weekly) | no | MEASURED | `trd_macro_series fin_conditions` (2026-10-02) | — |

### All-World / Developed World — understood 0.67 (10/15) — BLOCKED

Vehicle: VWRP / SWDA (UCITS) — candidate. Proxy: VT / ACWI (EFA for ex-US). Role: one-fund equity core. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (VT) | yes | STALE | `trd_bars_deep VT` (2026-08-28) | — |
| price itself | own price / trend / volatility (EFA) | yes | MEASURED | `trd_bars_deep EFA` (2026-10-14) | — |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| macro releases | US weekly initial jobless claims | yes | MEASURED | `trd_macro_series claims_initial_sa` (2026-10-03) | statistical claims surprise UNTESTED — failed its day-0 positive control (D-987-claims-surprise-spx) |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| earnings / revisions | constituent earnings (reported vs consensus) | yes | MEASURED | `trd_earnings` (2026-10-13) | PEAD decayed post-2012 (D-225); holdout registered D-987-pead-holdout |
| earnings / revisions | NON-US constituent earnings and revisions (~40% weight) | yes | GAP | earnings + revision feeds are US-listed names only | named barrier — not a market finding |
| rates | ECB / BoJ policy paths | yes | STALE | `trd_macro_series rate_3m_eur` (2026-01-01) | OECD monthly 3m interbank only |
| macro releases | non-US activity / inflation releases | yes | GAP | no euro-area / Japan release calendar or values held | named barrier — not a market finding |
| FX | EURUSD / USDJPY | yes | MEASURED | `trd_bars_deep EURUSD=X` (2026-10-14) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| options / gamma | implied volatility (VIX) | yes | MEASURED | `trd_bars_deep ^VIX` (2026-10-14) | fear-reversion near-miss (D-276); same-bar phantoms killed (D-498) |
| liquidity / credit | credit spread (BAA-10y) | yes | MEASURED | `trd_macro_series credit_baa_10y` (2026-10-13) | — |
| flows / positioning | fund / ETF flows (creations, redemptions) | yes | GAP | no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected) | named barrier — not a market finding |

### FTSE 100 — understood 0.83 (10/12) — IN THE BASKET

Vehicle: ISF / VUKE (UCITS, GBP) — candidate. Proxy: ^FTSE (EWU). Role: home-currency equity. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (^FTSE) | yes | MEASURED | `trd_bars_deep ^FTSE` (2026-10-14) | — |
| macro releases | UK CPI / CPIH + ONS first-release dates | yes | MEASURED | `trd_macro_series ons_cpi_yoy` (2026-08-01) | ONS D7G7/L55O/D7BT; 130 first-release dates 2015+ (ons_release:cpi). UK CPI surprise: see D-989 / docs/SURPRISE_EFFECTS.md |
| macro releases | UK labour market (unemployment, employment, AWE pay growth) | yes | MEASURED | `trd_macro_series ons_unemp_rate` (2026-06-01) | ONS MGSX/LF24/KAC3 — LATEST VINTAGE (revised; no first-release dates recoverable), so a labour SURPRISE is not testable point-in-time |
| rates | Bank Rate (BoE policy rate) | yes | MEASURED | `trd_macro_series boe_bank_rate` (2026-10-13) | BoE IADB IUDBEDR, daily from 1975 (D-989); the OECD 3m monthly series it replaces was 287 days stale |
| rates | expected BoE path — PROXY: 5y nominal zero-coupon gilt yield (BoE IUDSNZC) — the short-dated curve is the market-implied path; SONIA OIS not held | yes | MEASURED | `trd_macro_series gilt_nom_zc_5y` (2026-10-12) | — |
| rates | gilt curve (nominal zero-coupon 5/10/20y) | yes | MEASURED | `trd_macro_series gilt_nom_zc_10y` (2026-10-12) | BoE IADB fitted curve, ~1 business day publication lag (D-989) |
| earnings / revisions | FTSE constituent earnings / revisions | yes | GAP | earnings + revisions feeds cover US-listed names only | named barrier — not a market finding |
| FX | GBPUSD (FTSE 100 earns ~75% of revenue abroad — inverse GBP exposure) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| commodity links | crude oil (energy weight) | yes | MEASURED | `trd_bars_deep CL=F` (2026-10-14) | — |
| commodity links | copper / miners | yes | MEASURED | `trd_bars_deep HG=F` (2026-10-14) | — |
| flows / positioning | UK fund flows / positioning | yes | GAP | no FTSE futures COT equivalent or UK fund-flow series held | named barrier — not a market finding |
| options / gamma | implied volatility (VIX) | yes | MEASURED | `trd_bars_deep ^VIX` (2026-10-14) | fear-reversion near-miss (D-276); same-bar phantoms killed (D-498) |
| seasonality | calendar seasonality (derived from the price series) | no | MEASURED | `trd_bars_deep ^FTSE` (2026-10-14) | turn-of-month = drift wearing a calendar, killed by its benchmark (D-962) |

### Emerging-market equity — understood 0.60 (6/10) — BLOCKED

Vehicle: EIMI / VFEM (UCITS) — candidate. Proxy: EEM. Role: EM growth. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (EEM) | yes | MEASURED | `trd_bars_deep EEM` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| FX | US dollar (UUP) | yes | MEASURED | `trd_bars_deep UUP` (2026-10-14) | — |
| macro releases | China activity / credit impulse | yes | GAP | no China activity, PMI or credit series held | named barrier — not a market finding |
| rates | EM policy rates (CNY/KRW/INR/BRL) | yes | STALE | `trd_macro_series rate_3m_cny` (2026-07-01) | OECD/IMF monthly series; EM carry = research-space risk premium (D-741) |
| earnings / revisions | EM constituent earnings / revisions | yes | GAP | earnings feeds cover US-listed names only | named barrier — not a market finding |
| commodity links | broad commodities (DBC) | yes | MEASURED | `trd_bars_deep DBC` (2026-10-12) | — |
| options / gamma | EEM dealer gamma / IV (CBOE, forward-only) | yes | MEASURED | `trd_perp_oi EEM` (2026-10-14) | — |
| flows / positioning | EM fund flows | yes | GAP | no EM fund-flow series held | named barrier — not a market finding |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |

### US Treasuries 20y+ — understood 0.86 (12/14) — IN THE BASKET

Vehicle: IDTL / DTLA (UCITS; GBP-hedged line exists) — candidate. Proxy: TLT. Role: duration / deflation hedge. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (TLT) | yes | MEASURED | `trd_bars_deep TLT` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| rates | 10y breakeven inflation | yes | MEASURED | `trd_macro_series breakeven_10y` (2026-10-14) | — |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| macro releases | US weekly initial jobless claims | yes | MEASURED | `trd_macro_series claims_initial_sa` (2026-10-03) | statistical claims surprise UNTESTED — failed its day-0 positive control (D-987-claims-surprise-spx) |
| macro releases | US nonfarm payrolls (level; latest vintage) | yes | MEASURED | `trd_macro_series payrolls_total` (2026-09-01) | held from D-987; first-print vintages NOT held (ALFRED) so payroll SURPRISE is untestable point-in-time |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| flows / positioning | Treasury auction supply and results | yes | GAP | api.fiscaldata.treasury.gov auction results are free and keyless and the host IS allowlisted (D-989 corrects D-987, which said it was not) — not yet ingested | named barrier — not a market finding |
| rates | term premium (ACM) | yes | GAP | NY Fed ACM term-premium file is free but newyorkfed.org is NOT allowlisted | named barrier — not a market finding |
| rates | Fed balance sheet (QT/QE supply) | yes | MEASURED | `trd_macro_series fed_balance_sheet` (2026-10-07) | held from D-987 (FRED WALCL, existing keyless feed) |
| flows / positioning | CFTC TFF positioning (UST bond futures) | yes | MEASURED | `trd_cot_tff 020601` (2026-10-06) | — |
| options / gamma | TLT dealer gamma (CBOE, forward-only) | yes | MEASURED | `trd_perp_oi TLT` (2026-10-14) | — |
| FX | GBPUSD (USD line unhedged; the GBP-hedged line removes it) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| options / gamma | rates volatility (MOVE) | no | GAP | MOVE index not held (ICE, not free history) | named barrier — not a market finding |

### US TIPS — understood 0.88 (7/8) — IN THE BASKET

Vehicle: ITPS / IDTP (UCITS) — candidate. Proxy: TIP. Role: inflation-protected duration. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (TIP) | yes | MEASURED | `trd_bars_deep TIP` (2026-10-14) | — |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| rates | 10y breakeven inflation | yes | MEASURED | `trd_macro_series breakeven_10y` (2026-10-14) | — |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| flows / positioning | TIPS auction supply | yes | GAP | fiscaldata.treasury.gov not allowlisted (same barrier as nominal auctions) | named barrier — not a market finding |

### US Treasury bills 0-1y — understood 1.00 (4/4) — IN THE BASKET

Vehicle: IB01 (UCITS, USD) — candidate. Proxy: SHY / 3m bill yield. Role: USD cash ballast (rates bucket, D-901). Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| rates | 3m T-bill yield | yes | MEASURED | `trd_macro_series ust_3m` (2026-10-13) | — |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| price itself | own price / trend / volatility (SHY) | yes | MEASURED | `trd_bars_deep SHY` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |

### GBP overnight money market — understood 1.00 (3/3) — IN THE BASKET

Vehicle: CSH2 / XSTR (UCITS, GBP) — candidate. Proxy: SONIA (BoE IADB) — a rate, not a fund price. Role: GBP cash ballast. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| rates | Bank Rate (BoE policy rate) | yes | MEASURED | `trd_macro_series boe_bank_rate` (2026-10-13) | BoE IADB IUDBEDR, daily from 1975 (D-989); the OECD 3m monthly series it replaces was 287 days stale |
| rates | SONIA fixing (what the fund earns) | yes | MEASURED | `trd_macro_series boe_sonia` (2026-10-12) | — |
| rates | expected BoE path — PROXY: 5y nominal zero-coupon gilt yield (BoE IUDSNZC) — the short-dated curve is the market-implied path; SONIA OIS not held | yes | MEASURED | `trd_macro_series gilt_nom_zc_5y` (2026-10-12) | — |

### UK gilts (conventional) — understood 0.86 (6/7) — IN THE BASKET

Vehicle: IGLT / VGOV (UCITS) — candidate. Proxy: BoE nominal zero-coupon curve — yields, not a fund price. Role: GBP duration. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| rates | gilt curve (nominal zero-coupon 5/10/20y) | yes | MEASURED | `trd_macro_series gilt_nom_zc_10y` (2026-10-12) | BoE IADB fitted curve, ~1 business day publication lag (D-989) |
| macro releases | UK CPI / CPIH + ONS first-release dates | yes | MEASURED | `trd_macro_series ons_cpi_yoy` (2026-08-01) | ONS D7G7/L55O/D7BT; 130 first-release dates 2015+ (ons_release:cpi). UK CPI surprise: see D-989 / docs/SURPRISE_EFFECTS.md |
| macro releases | UK labour market (unemployment, employment, AWE pay growth) | yes | MEASURED | `trd_macro_series ons_unemp_rate` (2026-06-01) | ONS MGSX/LF24/KAC3 — LATEST VINTAGE (revised; no first-release dates recoverable), so a labour SURPRISE is not testable point-in-time |
| rates | Bank Rate (BoE policy rate) | yes | MEASURED | `trd_macro_series boe_bank_rate` (2026-10-13) | BoE IADB IUDBEDR, daily from 1975 (D-989); the OECD 3m monthly series it replaces was 287 days stale |
| rates | expected BoE path — PROXY: 5y nominal zero-coupon gilt yield (BoE IUDSNZC) — the short-dated curve is the market-implied path; SONIA OIS not held | yes | MEASURED | `trd_macro_series gilt_nom_zc_5y` (2026-10-12) | — |
| flows / positioning | DMO issuance / auction results | yes | GAP | dmo.gov.uk not ingested or allowlisted | named barrier — not a market finding |
| rates | global duration (US 10y) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |

### UK index-linked gilts — understood 0.86 (6/7) — IN THE BASKET

Vehicle: INXG (UCITS) — candidate. Proxy: BoE real zero-coupon curve — yields, not a fund price. Role: GBP inflation protection. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| rates | UK real yields (10y real zero-coupon) | yes | MEASURED | `trd_macro_series gilt_real_zc_10y` (2026-10-12) | — |
| macro releases | UK CPI / CPIH + ONS first-release dates | yes | MEASURED | `trd_macro_series ons_cpi_yoy` (2026-08-01) | ONS D7G7/L55O/D7BT; 130 first-release dates 2015+ (ons_release:cpi). UK CPI surprise: see D-989 / docs/SURPRISE_EFFECTS.md |
| rates | Bank Rate (BoE policy rate) | yes | MEASURED | `trd_macro_series boe_bank_rate` (2026-10-13) | BoE IADB IUDBEDR, daily from 1975 (D-989); the OECD 3m monthly series it replaces was 287 days stale |
| rates | expected BoE path — PROXY: 5y nominal zero-coupon gilt yield (BoE IUDSNZC) — the short-dated curve is the market-implied path; SONIA OIS not held | yes | MEASURED | `trd_macro_series gilt_nom_zc_5y` (2026-10-12) | — |
| rates | UK breakeven inflation (10y implied, BoE) | yes | MEASURED | `trd_macro_series gilt_infl_zc_10y` (2026-10-12) | BoE implied inflation is RPI-based (linkers pay RPI; RPI is not ingested — the CPI/CPIH gap to RPI is a stated wedge) |
| flows / positioning | DMO linker issuance | yes | GAP | dmo.gov.uk not ingested or allowlisted | named barrier — not a market finding |
| rates | global real yields (US 10y TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | — |

### Physical gold — understood 0.92 (11/12) — IN THE BASKET

Vehicle: SGLN / IGLN (physical ETC, GBP/USD lines) — candidate. Proxy: GLD / GC=F. Role: crisis / real-rate hedge. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (GLD) | yes | MEASURED | `trd_bars_deep GLD` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | gold's stated #1 driver; contemporaneous confirmed, forward null (D-730) |
| FX | US dollar (UUP) | yes | MEASURED | `trd_bars_deep UUP` (2026-10-14) | — |
| rates | 10y breakeven inflation | yes | MEASURED | `trd_macro_series breakeven_10y` (2026-10-14) | — |
| macro releases | US CPI level + release calendar | yes | MEASURED | `trd_macro_series cpi` (2026-09-01) | statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward) |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| flows / positioning | CFTC disaggregated positioning (gold) | yes | MEASURED | `trd_cot_disagg 088691` (2026-10-06) | — |
| flows / positioning | ETF holdings (GLD tonnes) | yes | MEASURED | `trd_macro_series gld_tonnes` (2026-10-13) | 'flows drive gold' REFUTED — flow follows price (D-745) |
| macro releases | geopolitical risk (GPR) | yes | MEASURED | `trd_macro_series gpr` (2026-09-30) | — |
| flows / positioning | central-bank buying | yes | GAP | IMF COFER / WGC reserve data is quarterly and lagged — EXPLAIN-only, cannot condition a position (D-716) | named barrier — not a market finding |
| options / gamma | GLD implied vol / dealer gamma (CBOE, forward-only) | yes | MEASURED | `trd_perp_oi GLD` (2026-10-14) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| seasonality | calendar seasonality (derived from the price series) | no | MEASURED | `trd_bars_deep GLD` (2026-10-14) | turn-of-month = drift wearing a calendar, killed by its benchmark (D-962) |
| commodity links | gold/silver ratio | no | MEASURED | `trd_bars_deep SI=F` (2026-10-14) | — |

### Broad commodities — understood 0.67 (6/9) — BLOCKED

Vehicle: CMOD (UCITS) — candidate. Proxy: DBC. Role: inflation / supply-shock hedge. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (DBC) | yes | MEASURED | `trd_bars_deep DBC` (2026-10-12) | — |
| commodity links | live futures curves / roll yield | yes | STALE | `trd_macro_series eia_cl_c2` (2024-04-05) | EIA curve mirror froze 2024-04; GC/ZC/ZW/ZS/HG/SI curves have no free source; roll yield null OOS (D-742) |
| commodity links | inventories (EIA crude/gas weekly) | yes | MEASURED | `trd_macro_series eia_crude_stocks_w` (2026-10-02) | change-conditioning null (D-743) |
| flows / positioning | CFTC disaggregated positioning (crude as bellwether) | yes | MEASURED | `trd_cot_disagg 067651` (2026-10-06) | — |
| FX | US dollar (UUP) | yes | MEASURED | `trd_bars_deep UUP` (2026-10-14) | — |
| macro releases | China demand / PMI | yes | GAP | no China activity series held | named barrier — not a market finding |
| commodity links | agricultural supply (USDA WASDE / weather) | yes | GAP | USDA reports not ingested | named barrier — not a market finding |
| rates | 10y breakeven inflation | yes | MEASURED | `trd_macro_series breakeven_10y` (2026-10-14) | — |
| macro releases | geopolitical risk index (monthly) | no | MEASURED | `trd_macro_series gpr` (2026-09-30) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |

### WTI crude oil — understood 0.67 (6/9) — BLOCKED

Vehicle: CRUD (ETC) — candidate. Proxy: CL=F. Role: energy shock hedge. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (CL=F) | yes | MEASURED | `trd_bars_deep CL=F` (2026-10-14) | — |
| commodity links | inventories (EIA weekly) | yes | MEASURED | `trd_macro_series eia_crude_stocks_w` (2026-10-02) | change-conditioning null (D-743) |
| commodity links | live futures curve / roll yield | yes | STALE | `trd_macro_series eia_cl_c2` (2024-04-05) | frozen 2024-04 (research history only, D-742) |
| flows / positioning | CFTC disaggregated positioning (crude) | yes | MEASURED | `trd_cot_disagg 067651` (2026-10-06) | — |
| macro releases | OPEC+ decisions | yes | GAP | no OPEC decision calendar / quota series held | named barrier — not a market finding |
| commodity links | demand (EIA product supplied, refinery runs) | yes | GAP | EIA weekly demand tables not ingested (the inventory ingest uses the same keyless host) | named barrier — not a market finding |
| FX | US dollar (UUP) | yes | MEASURED | `trd_bars_deep UUP` (2026-10-14) | — |
| macro releases | geopolitical risk (GPR) | yes | MEASURED | `trd_macro_series gpr` (2026-09-30) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |

### Bitcoin — understood 0.75 (9/12) — BLOCKED

Vehicle: physically-backed BTC ETP/ETN (UK retail since 2025-10; ISA eligibility — verify) — candidate. Proxy: BTC-USD / BTCUSDT. Role: convex growth (the deployed blend holds crypto via the cryptomom sleeve). Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (BTC-USD) | yes | MEASURED | `trd_bars_deep BTC-USD` (2026-10-14) | spot-crypto trend switch Sharpe 0.69, -6% DD 2018-26 (D-871); ISA+crypto pair 1.29 OOS, 0.90 ex-2020-21 (D-873) |
| flows / positioning | perp funding | yes | MEASURED | `trd_perp_oi BTCUSDT` (2026-10-14) | pooling artefact retracted (D-415); profitable direction an unregistered flip (D-553/554) |
| flows / positioning | top-trader long/short positioning | yes | MEASURED | `trd_perp_oi BTCUSDT` (2026-10-14) | — |
| options / gamma | implied vol (Deribit DVOL) | yes | MEASURED | `trd_macro_series deribit_btc_dvol` (2026-10-14) | BTC VRP measured NW t 4.39; return effect below bar (D-817) |
| flows / positioning | on-chain activity / fees | yes | MEASURED | `trd_macro_series onchain_btc_transaction_fees_usd` (2026-10-13) | fee-momentum clock (D-928); breadth consumer registered (D-972) |
| flows / positioning | CFTC TFF positioning (CME bitcoin) | yes | MEASURED | `trd_cot_tff 133741` (2026-10-06) | — |
| flows / positioning | spot-ETF flows | yes | GAP | no free daily spot-ETF flow history held | named barrier — not a market finding |
| liquidity / credit | stablecoin supply (crypto liquidity) | yes | GAP | no stablecoin supply series held (CoinGecko snapshot is one-off, D-964) | named barrier — not a market finding |
| rates | 10y real yield (global liquidity) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| price itself | equity beta (SPY) | yes | MEASURED | `trd_bars_deep SPY` (2026-10-14) | — |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |
| macro releases | regulatory / exchange events | yes | GAP | no structured event feed; not measurable from free data | named barrier — not a market finding |

### US high-yield credit — understood 0.75 (6/8) — BLOCKED

Vehicle: IHYG / SHYG (UCITS) — candidate. Proxy: HYG. Role: credit carry. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (HYG) | yes | MEASURED | `trd_bars_deep HYG` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| liquidity / credit | credit spread (BAA-10y; HY OAS not ingested) | yes | MEASURED | `trd_macro_series credit_baa_10y` (2026-10-13) | — |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| options / gamma | implied volatility (VIX) | yes | MEASURED | `trd_bars_deep ^VIX` (2026-10-14) | fear-reversion near-miss (D-276); same-bar phantoms killed (D-498) |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| liquidity / credit | default rates / distress | yes | GAP | no default-rate series held (the distress SHORT sleeve uses going-concern filings, not a default rate) | named barrier — not a market finding |
| flows / positioning | fund / ETF flows (creations, redemptions) | yes | GAP | no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected) | named barrier — not a market finding |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |

### US investment-grade credit — understood 0.75 (6/8) — BLOCKED

Vehicle: LQDE (UCITS) — candidate. Proxy: LQD. Role: duration + credit carry. Vehicle conversion: UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW).

| category | driver | material | state | feed (latest) | what the record says |
|---|---|---|---|---|---|
| price itself | own price / trend / volatility (LQD) | yes | MEASURED | `trd_bars_deep LQD` (2026-10-14) | the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901) |
| liquidity / credit | credit spread (BAA-10y) | yes | MEASURED | `trd_macro_series credit_baa_10y` (2026-10-13) | — |
| rates | Treasury curve (discount rate, term spread) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | orphaned 50 days then wired daily (D-982) |
| rates | 10y real yield (TIPS) | yes | MEASURED | `trd_macro_series real_yield_10y` (2026-10-13) | D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13) |
| rates | expected Fed policy path — PROXY: 2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid) | yes | MEASURED | `trd_yield_curve` (2026-10-14) | — |
| flows / positioning | IG issuance supply | yes | GAP | no issuance calendar held | named barrier — not a market finding |
| flows / positioning | fund / ETF flows (creations, redemptions) | yes | GAP | no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected) | named barrier — not a market finding |
| FX | GBPUSD (currency of account for a UK holder, unhedged line) | yes | MEASURED | `trd_bars_deep GBPUSD=X` (2026-10-14) | currency-of-account worth ~1.3pp/yr to a GBP investor (D-731) |

## The gaps that would move instruments into the basket (free unless stated)

- **no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected)** — blocks: All-World / Developed World, US high-yield credit, US investment-grade credit
- **own price / trend / volatility (VT) (STALE, latest 2026-08-28)** — blocks: All-World / Developed World
- **earnings + revision feeds are US-listed names only** — blocks: All-World / Developed World
- **ECB / BoJ policy paths (STALE, latest 2026-01-01)** — blocks: All-World / Developed World
- **no euro-area / Japan release calendar or values held** — blocks: All-World / Developed World
- **no China activity, PMI or credit series held** — blocks: Emerging-market equity
- **EM policy rates (CNY/KRW/INR/BRL) (STALE, latest 2026-07-01)** — blocks: Emerging-market equity
- **earnings feeds cover US-listed names only** — blocks: Emerging-market equity
- **no EM fund-flow series held** — blocks: Emerging-market equity
- **live futures curves / roll yield (STALE, latest 2024-04-05)** — blocks: Broad commodities
- **no China activity series held** — blocks: Broad commodities
- **USDA reports not ingested** — blocks: Broad commodities
- **live futures curve / roll yield (STALE, latest 2024-04-05)** — blocks: WTI crude oil
- **no OPEC decision calendar / quota series held** — blocks: WTI crude oil
- **EIA weekly demand tables not ingested (the inventory ingest uses the same keyless host)** — blocks: WTI crude oil
- **no free daily spot-ETF flow history held** — blocks: Bitcoin
- **no stablecoin supply series held (CoinGecko snapshot is one-off, D-964)** — blocks: Bitcoin
- **no structured event feed; not measurable from free data** — blocks: Bitcoin
- **no default-rate series held (the distress SHORT sleeve uses going-concern filings, not a default rate)** — blocks: US high-yield credit
- **no issuance calendar held** — blocks: US investment-grade credit
