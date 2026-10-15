// surprise-registry.ts (D-987) — THE SURPRISE-EFFECT PROGRAMME'S PRE-REGISTRATIONS, as data.
//
// Operator directive 2026-10-15: "test for surprise effects that we can exploit". Under the D-823 freeze a new question
// is admissible ONLY if its hypothesis, data, test and promote/kill floors are written BEFORE the outcome is seen. These
// rows are inserted into `trd_prereg` (append-only, immutability trigger, migration 0092/0097) by
// `surprise-program.ts SP_MODE=register`, which REFUSES to proceed if a row already exists with different text — the text
// below can never be quietly edited after the numbers arrive. Every row names the STATISTIC LEVEL (D-612: event vs
// portfolio t differ 4x), the SIGN (SIGN LAW), the INSTRUMENT (INSTRUMENT LAW), the cost and the floors.
//
// Families already measured on this record are NOT re-registered (re-testing PEAD on the D-489 sample, the SI/fails
// surprise books, GLD flows, the VRP/fear family, index inclusion would be re-mining under D-823). Where a family is
// re-entered here it is on data that DID NOT EXIST when it was last tested (a true holdout), and that is stated.
//
// "Gates" used below, defined once:
//   CEILING  = sqrt(2 ln (trials counted under the id + all trd_prereg rows)) at scoring time (D-823 split ceiling,
//              `preregCeiling`); ~3.2 at registration.
//   DSR      = deflatedSharpe(net per-period SR, n, skew, kurt, nTrials = CEILING's N, var = 1/(n-1)) >= 0.95.
//   MinTRL   = minTRL(net SR, 0, skew, kurt, 0.95) <= n.
//   PBO      = pboCSCV over the pre-declared variants, 8 blocks, < 0.5.
//   EFFECT   = |slope| in bp per 1sd of the surprise >= 1.0x the stated round trip (EFFECT-SIZE LAW).

export interface SurprisePrereg {
  id: string; claim: string; competing: string; rule: string; kill_condition: string;
  /** not stored in trd_prereg — programme metadata for the ledger */
  meta: { variable: string; instruments: string; data: string; status_when_registered: "runnable-now" | "accruing"; trials: number; cost_bp: number; sign?: "POSITIVE" | "NEGATIVE" };
}

export const SURPRISE_PREREGS: SurprisePrereg[] = [
  {
    id: "D-987-claims-surprise-spx",
    claim: "A STATISTICAL surprise in US weekly initial jobless claims (FRED ICSA, SA, week ending Saturday W, released Thursday W+5 08:30 ET) is incompletely priced on release day: z = (ICSA_W - mean(ICSA of the 4 prior weeks)) / sd of that same deviation over the 52 strictly-prior releases, winsorised at +/-4, predicts the S&P 500 (^GSPC, research proxy for CSPX/SPY) return over the 5 sessions from the CLOSE of the first trading day >= W+5 (entry >= 6.5h after publication; no close-derived input, lag-safe) with a NEGATIVE sign (more claims than expected -> lower subsequent drift).",
    competing: "Weekly claims are fully priced within minutes of 08:30 (EMH); any slope is the 2020 COVID outlier or an era artefact; the statistical surprise is not the surprise the market trades (consensus is not held), so the measure may carry no priced information at all.",
    rule: "PRIMARY STATISTIC: OLS slope b of r(+1..+5 sessions) on z, one observation per release (approximately non-overlapping; Newey-West(1) t and plain t both reported, the SMALLER |t| decides), full sample 1970-01..latest. POSITIVE CONTROL first: day-0 return (prior close -> entry close) on z must have |t| >= 2.0 in either sign, else the verdict is UNTESTED (proxy carries no priced information). PROMOTE to a forward clock (never capital) only if ALL: b < 0 (SIGN MATCHED) on the full sample AND in both the first-2/3 and last-1/3 halves; |t| >= CEILING; EFFECT |b| >= 1.0x a 6bp round trip; the trading expression p = -clip(z,-2,2)/2 held 5 sessions, 6bp x |p| per release, has DSR >= 0.95, MinTRL <= n, PBO < 0.5 across the 3 pre-declared baseline variants (4/8/13 prior weeks; 4 is primary). Instrument conversion stated: weekly ^GSPC vs SPY return beta/corr on the 1993+ overlap. Trials: 4 (3 variants + control).",
    kill_condition: "REJECTED if b >= 0 on the full sample (SIGN MISSED; a positive slope is a post-hoc flip and not claimable), OR |t| < 2.0, OR EFFECT < 1.0x cost, OR the two halves disagree in sign. 2.0 <= |t| < CEILING with every sign clause matched = BELOW-BAR (recorded, no clock).",
    meta: { variable: "macro release surprise (labour, weekly)", instruments: "S&P 500 (CSPX/SPY via ^GSPC)", data: "FRED ICSA (keyless fredgraph, existing feed) + trd_bars_deep ^GSPC/SPY", status_when_registered: "runnable-now", trials: 4, cost_bp: 6 },
  },
  {
    id: "D-987-cpi-surprise-spx",
    claim: "A STATISTICAL CPI surprise is incompletely priced on release day: for each BLS CPI release date R (bls:consumer-price-index, 2016+, 08:30 ET) the headline MoM of the reference month (FRED CPIAUCSL) minus the mean MoM of the 3 prior months, divided by the sd of MoM over the 24 prior months, predicts ^GSPC (proxy for CSPX/SPY) over the 5 sessions from R's CLOSE with a NEGATIVE sign (hotter than recent trend -> lower subsequent drift).",
    competing: "CPI is priced within the release minute; n ~120 is too small to detect a plausible effect (UNDERPOWERED is the likely honest verdict); the trailing-3m prior is a poor stand-in for consensus, so the measure may carry no priced information; CPIAUCSL is the latest vintage (seasonal-factor revisions are small but non-zero).",
    rule: "PRIMARY STATISTIC: OLS slope b of r(+1..+5) on z, one observation per release (non-overlapping), plain t. POSITIVE CONTROL: day-0 (R-1 close -> R close) slope |t| >= 2.0 in either sign, else UNTESTED. PROMOTE to a forward clock only if ALL: b < 0 (SIGN MATCHED) full sample and both halves (first 2/3, last 1/3); |t| >= CEILING; EFFECT >= 1.0x 6bp; trading expression p = -clip(z,-2,2)/2 has DSR >= 0.95, MinTRL <= n, PBO < 0.5 across 2 pre-declared variants (3m / 6m prior mean; 3m primary). If |t| < 2.0 AND n is below the n required for the observed effect to reach |t| 2.0, the verdict is UNDERPOWERED with that n stated, not REJECTED. Trials: 3.",
    kill_condition: "REJECTED if b >= 0 (SIGN MISSED), or |t| < 2.0 at adequate power, or EFFECT < 1.0x cost, or halves disagree in sign. BELOW-BAR if 2.0 <= |t| < CEILING with every sign clause matched.",
    meta: { variable: "macro release surprise (inflation, monthly)", instruments: "S&P 500 (CSPX/SPY via ^GSPC)", data: "trd_macro_series cpi (FRED CPIAUCSL) + bls:consumer-price-index release dates (D-877) + ^GSPC", status_when_registered: "runnable-now", trials: 3, cost_bp: 6 },
  },
  {
    id: "D-987-pead-holdout",
    claim: "Post-earnings drift exists in events that did not exist when PEAD was last tested (D-489/D-612 used 142,695 events through 2026-08-23): among trd_earnings events with report_date >= 2026-08-24 and a reported surprise_pct, liquid names (21d median $ volume >= $5M at entry), the TOP surprise quintile's 20-session return from the close of the first session AFTER report_date, in EXCESS of the same-month liquid-event mean (BENCHMARK LAW), is POSITIVE.",
    competing: "D-225 measured PEAD decayed post-2012 (H2 t 0.24) and D-393 saw the sign flip train->test; any positive read in a few months is earnings-season beta or one sector.",
    rule: "SCORED ONLY when >= 6 entry months each hold >= 50 liquid events with complete 20-session windows (expected ~2027-04). STATISTIC LEVEL: PORTFOLIO — one excess per entry month, plain t across months (event-level t is reported but never decides, D-612). PROMOTE to a forward clock if: sign POSITIVE, t >= CEILING, mean excess >= 1.0x a 25bp single-name round trip, and the top-minus-bottom-quintile spread is positive. Until the floor is met the status is ACCRUING, not inconclusive. Trials: 1.",
    kill_condition: "REJECTED at the floor if the top-quintile monthly excess is <= 0 (SIGN MISSED) or t < 1.0; BELOW-BAR if 1.0 <= t < CEILING with sign matched.",
    meta: { variable: "earnings surprise / post-earnings drift (holdout)", instruments: "US liquid single names (not ISA-basket; informs the S&P/Nasdaq driver map)", data: "trd_earnings (Nasdaq calendar, daily ingest) + trd_bars_deep", status_when_registered: "accruing", trials: 1, cost_bp: 25 },
  },
  {
    id: "D-987-revision-surprise",
    claim: "Analyst estimate-revision surprise predicts returns: at the first snapshot of each calendar month, the top quintile of est_rev90_0q (Yahoo earningsTrend, current-quarter consensus EPS now vs 90 days ago, ~1,000 liquid names daily since 2026-09-07) earns POSITIVE excess over the same-snapshot universe mean across the next 21 sessions.",
    competing: "Revision momentum is a documented but crowded factor; a short forward sample is dominated by sector rotation; the liquid decile is the most efficiently covered part of the market (LIQUIDITY LAW).",
    rule: "SCORED ONLY when >= 12 non-overlapping monthly cross-sections exist, each with >= 200 names (BREADTH LAW), expected ~2027-09. STATISTIC LEVEL: PORTFOLIO (one top-quintile excess per month, plain t across months); universe mean and excess both reported (BENCHMARK LAW); turnover stated (TURNOVER LAW). PROMOTE to a forward clock if sign POSITIVE, t >= CEILING, and mean monthly excess net of 2 x one-way turnover x 25bp is > 0. Trials: 1.",
    kill_condition: "REJECTED at the floor if mean excess <= 0 (SIGN MISSED) or t < 1.0, or if net of turnover cost the excess is <= 0 (SUB-FEE); BELOW-BAR if 1.0 <= t < CEILING.",
    meta: { variable: "estimate-revision surprise", instruments: "US liquid single names (feeds the S&P/Nasdaq 'earnings revisions' driver)", data: "trd_macro_series est_rev90_0q:* (D-817, daily since 2026-09-07) + trd_bars_deep", status_when_registered: "accruing", trials: 1, cost_bp: 25 },
  },
  {
    id: "D-987-implied-move-surprise",
    claim: "Options-implied vs realised earnings-move surprise: for earnings events whose name has a CBOE atm_iv_near snapshot on the session BEFORE the report (D-817 WIDE collector, liquid decile), S = |day-0 return| / (atm_iv_near x sqrt(1/252)). Events in the TOP tercile of S (the move exceeded what options priced) continue in the direction of the day-0 move over sessions +1..+20: the mean of sign(r0) x excess(+1..+20 vs SPY) is POSITIVE and larger than in the BOTTOM tercile.",
    competing: "Large surprises are fully priced on day 0 (no drift); the near-expiry IV understates the event move, so S mostly ranks IV level; continuation is momentum/beta in a rising market.",
    rule: "SCORED ONLY when >= 300 events with a valid prior-session IV and complete 20-session windows exist, spanning >= 2 earnings seasons (expected ~2027-03). STATISTIC LEVEL: PORTFOLIO by entry month (top-tercile signed excess minus bottom-tercile signed excess, plain t across months); event-level t reported, never decides. PROMOTE to a forward clock if the top-minus-bottom difference is POSITIVE, t >= CEILING, and top-tercile signed excess >= 1.0x a 25bp round trip. Trials: 1.",
    kill_condition: "REJECTED at the floor if the difference is <= 0 (SIGN MISSED) or t < 1.0; BELOW-BAR if 1.0 <= t < CEILING.",
    meta: { variable: "options-implied vs realised move surprise (earnings)", instruments: "US liquid single names with listed options", data: "trd_perp_oi venue=cboe interval=atm_iv_near (daily, forward-only since ~2026-08-22) + trd_earnings + trd_bars_deep", status_when_registered: "accruing", trials: 1, cost_bp: 25 },
  },
  {
    id: "D-987-release-reversal-forward",
    claim: "The one release-hour regularity D-877b found above cost, scored ONLY on releases after it was found: on US macro release days (bls: CPI, Employment Situation, PPI, JOLTS) the S&P 500 and Nasdaq-100 hourly panels (USA500IDXUSD, USATECHIDXUSD) REVERSE the release-hour move over the next 4 hours — slope of r(next 4h) on z(release-hour return) is NEGATIVE. D-877b registered the opposite sign, so this is the fresh registration it said a claim requires.",
    competing: "D-877b's reversal is a post-hoc sign found in-sample (SIGN LAW) and will regress to zero forward; release-hour moves are mostly noise at hourly granularity.",
    rule: "SCORED ONLY on release dates strictly after 2026-09-13 with complete hourly bars, when >= 40 such releases exist (expected ~2027-06). STATISTIC: per-instrument OLS slope of r(+1..+4h) on z(r0), z scaled by the sd of release-hour returns over the 2016-2026-09-13 training releases (frozen). PROMOTE to a forward clock (no capital) if BOTH instruments have slope < 0, pooled t <= -CEILING, and |slope| >= 1.0x a 6bp round trip per 1sd. Trials: 2.",
    kill_condition: "REJECTED at the floor if either instrument's slope >= 0 (SIGN MISSED) or pooled |t| < 1.5; BELOW-BAR if 1.5 <= |t| < CEILING with both signs negative.",
    meta: { variable: "macro release-hour surprise reaction (reversal), forward", instruments: "S&P 500 / Nasdaq-100 (CSPX, EQQQ)", data: "trd_fx_hourly USA500IDXUSD/USATECHIDXUSD (Dukascopy, hourly refresh) + bls:* calendar", status_when_registered: "accruing", trials: 2, cost_bp: 6 },
  },
  {
    id: "D-989-uk-cpi-surprise-gilts",
    claim: "A STATISTICAL UK CPI surprise is incompletely priced on release day: on each ONS first-release date R (ons_release:cpi, 07:00 London, 2015+), s = annual CPI rate of the reference month minus that of the previous month (ONS D7G7; the naive no-change forecast of the annual rate; CPI is never revised, so both are point-in-time), z = s / sd of the same monthly change over the 24 prior months, winsorised at +/-4. Registered sign POSITIVE: a hotter print predicts a further RISE in the BoE 5y nominal zero-coupon gilt yield (IUDSNZC) from R's close to the 5th business day after R (gilts under-react).",
    competing: "UK CPI is priced within minutes of 07:00; the naive no-change forecast is not the consensus the market trades, so z may not be a surprise at all; n ~125 monthly releases may be too few to see a plausible drift (UNDERPOWERED is a likely honest verdict).",
    rule: "POSITIVE CONTROL first: the day-0 change in the 5y yield (previous business day -> R) regressed on z must have |t| >= 2.0 in either sign, else UNTESTED. PRIMARY STATISTIC: OLS slope b (bp of yield per 1sd of z) of the R -> R+5 business-day yield change on z, one observation per release, plain t. PROMOTE to a forward clock (never capital) only if ALL: b > 0 (SIGN MATCHED) on the full sample and in both the first-2/3 and last-1/3 halves; |t| >= CEILING; EFFECT = b x 4.5 (approx. modified duration of a 5y zero) >= 1.0x a 10bp gilt-fund round trip; the expression p = clip(z,-2,2)/2 short duration for 5 days (return = -p x 4.5 x dy - 10bp x |p|) has DSR >= 0.95, MinTRL <= n, PBO < 0.5 across 2 pre-declared variants (24 / 36-month sd window; 24 primary). UNDERPOWERED (not REJECTED) if sign matched, |t| < 2.0, effect >= 1.0x and n is below the n that the observed effect needs for |t| 2.0. Trials: 3.",
    kill_condition: "REJECTED if b <= 0 (SIGN MISSED), or |t| < 2.0 at adequate power, or EFFECT < 1.0x cost, or the halves disagree in sign. BELOW-BAR if 2.0 <= |t| < CEILING with every sign clause matched.",
    meta: { variable: "UK macro release surprise (CPI, monthly)", instruments: "UK gilts (IGLT/short-dated gilt funds; research series BoE 5y zero-coupon yield)", data: "ONS D7G7 + ons_release:cpi first-release dates + BoE IUDSNZC (D-989 ingest)", status_when_registered: "runnable-now", trials: 3, cost_bp: 10, sign: "POSITIVE" },
  },
];
