// trd-macro — the macro-regime engine. This is the layer the operator asked for: "understand
// how economies work, their history, where they are in the economic cycle, so we know what to
// expect." The HONEST framing (and the hard-won lesson of D-071..D-077): macro does NOT predict
// market DIRECTION — professional economists miss most recessions, and every "we're late-cycle
// so price falls" narrative back-tests to noise. What macro DOES measure, durably, is FRAGILITY:
// when the financial system is primed to break (this was the core of R-001's Global-Financial-
// Cycle finding). So this engine classifies WHERE an economy sits in its cycle from point-in-
// time data, and emits a de-risk MULTIPLIER (0..1) that only ever SHRINKS position size when the
// regime is fragile. It never predicts direction and never tells you to lever up. Worst case in a
// benign regime it is a no-op; in a fragile regime it protects capital. Asymmetric by design.
//
// Every indicator is the value as it was KNOWN at asOf (releases lag: unemployment ~1wk, GDP
// ~1mo, etc.). The caller is responsible for feeding point-in-time-correct values (the FRED pump
// stores by release/observation date). No look-ahead is possible if that contract is honored.

export type CyclePhase = "EXPANSION" | "LATE_CYCLE" | "CONTRACTION" | "RECOVERY" | "UNKNOWN";

/** Point-in-time macro indicators for ONE economy, as legally knowable at asOf. */
export interface MacroIndicators {
  economy: string; // "US" | "EA" | "UK" | "JP" | "CN" ...
  asOf: string; // ISO date the snapshot was knowable
  /** 10y minus 3m sovereign yield, in percentage points. Negative = inverted (leading stress). */
  yieldCurve10y3m?: number;
  /** Corporate credit spread (e.g. BAA-AAA or HY OAS) in pp. Higher / widening = coincident stress. */
  creditSpread?: number;
  /** Its own trailing-12m median, so we judge widening vs level. */
  creditSpreadMedian12m?: number;
  /** Unemployment rate (%). */
  unemploymentRate?: number;
  /** Trailing-12m MINIMUM unemployment (%) — for the Sahm recession rule. */
  unemploymentMin12m?: number;
  /** Purchasing-managers index (ISM-style). >50 expansion, <50 contraction. */
  pmi?: number;
  /** PMI 3 months ago — to see if it is crossing up (recovery) or down (rolling over). */
  pmiPrior3m?: number;
  /** Headline CPI year-over-year (%). */
  cpiYoY?: number;
  /** CPI YoY 3 months ago — inflation direction. */
  cpiYoYPrior3m?: number;
  /** Equity-vol regime as a 0..1 percentile (0 = calmest on record, 1 = crisis). */
  volPercentile?: number;
}

export interface MacroRegime {
  economy: string;
  asOf: string;
  phase: CyclePhase;
  /** 0 = robust, 1 = maximally primed to break. A blend of leading+coincident+recession signals. */
  fragility: number;
  /** Position-size multiplier in (0,1]. 1 = normal risk; <1 = shrink. NEVER >1. */
  deRiskFactor: number;
  /** The individual signals that fired, for transparency on the cockpit. */
  signals: string[];
  /** Honest, direction-free statement of what to EXPECT (about risk, not price). */
  expectation: string;
  /** How much of the indicator set was actually present (0..1). Low → treat phase as tentative. */
  coverage: number;
}

// ---- thresholds (documented; not tuned to any backtest — these are textbook regime lines) ----
const SAHM_TRIGGER = 0.5; // unemployment 12m-low +0.5pp ≈ recession underway (Sahm rule)
const CREDIT_STRESS_ABS = 2.0; // BAA-AAA above ~2pp is historically stressed
const CREDIT_WIDEN_RATIO = 1.5; // spread ≥1.5x its own 12m median = fast widening
const PMI_CONTRACT = 50;
const VOL_STRESS = 0.8; // top-quintile vol regime
const MAX_CUT = 0.7; // fragile regime can cut size to 30% of normal, never below (0.3 floor)

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

/**
 * Classify an economy's cycle position + fragility from point-in-time indicators.
 * Pure function. Missing indicators are simply not counted (coverage reflects that).
 */
export function classifyRegime(ind: MacroIndicators): MacroRegime {
  const signals: string[] = [];
  let present = 0, total = 0;
  const have = (v: number | undefined): v is number => { total++; if (v !== undefined && Number.isFinite(v)) { present++; return true; } return false; };

  // --- individual signals ---
  const curveInverted = have(ind.yieldCurve10y3m) && ind.yieldCurve10y3m! < 0;
  if (curveInverted) signals.push(`yield curve inverted (${ind.yieldCurve10y3m!.toFixed(2)}pp) — leading fragility`);

  const creditAbs = have(ind.creditSpread) && ind.creditSpread! >= CREDIT_STRESS_ABS;
  const creditWiden = ind.creditSpread !== undefined && ind.creditSpreadMedian12m !== undefined &&
    ind.creditSpreadMedian12m > 0 && ind.creditSpread >= CREDIT_WIDEN_RATIO * ind.creditSpreadMedian12m;
  const creditStress = creditAbs || creditWiden;
  if (creditStress) signals.push(`credit spreads stressed (${ind.creditSpread?.toFixed(2)}pp) — coincident risk-off`);

  const sahm = have(ind.unemploymentRate) && ind.unemploymentMin12m !== undefined &&
    ind.unemploymentRate! - ind.unemploymentMin12m >= SAHM_TRIGGER;
  if (sahm) signals.push(`Sahm rule triggered (unemployment +${(ind.unemploymentRate! - ind.unemploymentMin12m!).toFixed(1)}pp off lows) — recession underway`);

  const pmiContraction = have(ind.pmi) && ind.pmi! < PMI_CONTRACT;
  if (pmiContraction) signals.push(`PMI in contraction (${ind.pmi!.toFixed(1)})`);
  const pmiRolling = ind.pmi !== undefined && ind.pmiPrior3m !== undefined && ind.pmi < ind.pmiPrior3m && ind.pmi < 52;
  if (pmiRolling && !pmiContraction) signals.push(`PMI rolling over (${ind.pmiPrior3m?.toFixed(1)}→${ind.pmi?.toFixed(1)})`);
  const pmiRecovering = ind.pmi !== undefined && ind.pmiPrior3m !== undefined && ind.pmi > ind.pmiPrior3m && ind.pmiPrior3m < PMI_CONTRACT && ind.pmi >= PMI_CONTRACT - 1;

  const volStress = have(ind.volPercentile) && ind.volPercentile! >= VOL_STRESS;
  if (volStress) signals.push(`vol regime elevated (${(ind.volPercentile! * 100).toFixed(0)}th pct)`);

  have(ind.cpiYoY); // count toward coverage; inflation shapes expectation text, not fragility directly
  const inflationHot = ind.cpiYoY !== undefined && ind.cpiYoY > 4;
  const inflationRising = ind.cpiYoY !== undefined && ind.cpiYoYPrior3m !== undefined && ind.cpiYoY > ind.cpiYoYPrior3m;

  const coverage = total > 0 ? present / total : 0;

  // --- fragility: weighted blend. Leading (curve) warns early; coincident (credit/pmi/vol) is
  //     happening now; Sahm confirms recession. Weights sum to 1 when all present. ---
  const w = { curve: 0.20, credit: 0.25, sahm: 0.25, pmi: 0.15, vol: 0.15 };
  let frac = 0, wsum = 0;
  const add = (present: boolean, fired: boolean, weight: number) => { if (present) { wsum += weight; if (fired) frac += weight; } };
  add(ind.yieldCurve10y3m !== undefined, curveInverted, w.curve);
  add(ind.creditSpread !== undefined, creditStress, w.credit);
  add(ind.unemploymentRate !== undefined && ind.unemploymentMin12m !== undefined, sahm, w.sahm);
  add(ind.pmi !== undefined, pmiContraction || pmiRolling, w.pmi);
  add(ind.volPercentile !== undefined, volStress, w.vol);
  const fragility = wsum > 0 ? clamp01(frac / wsum) : 0;

  // --- phase (CLASSIFY the present, do not predict the future) ---
  let phase: CyclePhase;
  if (coverage === 0) phase = "UNKNOWN";
  else if (sahm || (pmiContraction && creditStress)) phase = "CONTRACTION";
  else if (pmiRecovering && !creditStress && !sahm) phase = "RECOVERY";
  else if (curveInverted || pmiContraction || creditStress || pmiRolling) phase = "LATE_CYCLE";
  else phase = "EXPANSION";

  // de-risk multiplier: shrink with fragility, never amplify. Floor at 1-MAX_CUT.
  const deRiskFactor = clamp01(1 - fragility * MAX_CUT);

  // honest expectation — about RISK, never direction
  let expectation: string;
  switch (phase) {
    case "CONTRACTION":
      expectation = "Recession signals active: expect elevated volatility, wider tails, and correlated drawdowns across risk assets. Size DOWN and widen stops — do not fade or predict a bottom.";
      break;
    case "LATE_CYCLE":
      expectation = "Late-cycle fragility building: the system is primed for larger moves in EITHER direction. Trend can persist, but tail risk is rising — carry smaller size than a benign regime warrants.";
      break;
    case "RECOVERY":
      expectation = "Early-recovery signs (activity crossing back up). Fragility easing, but confirmation is thin — restore risk gradually, not all at once.";
      break;
    case "EXPANSION":
      expectation = "Benign expansion: no acute fragility signal. Normal risk budget applies; the overlay is a near no-op here.";
      break;
    default:
      expectation = "Insufficient macro data to classify the regime — default to full caution (treat as if fragile until data arrives).";
  }
  if (inflationHot) expectation += inflationRising ? " Inflation is high and rising — policy is a tightening headwind." : " Inflation elevated but cooling.";

  // If we have fewer than TWO usable signals we can't really judge the regime → fail SAFE (assume
  // some fragility) rather than assume calm. Two independent signals (e.g. curve + vol) is a real
  // read and must NOT be down-capped — else a benign tape needlessly halves size.
  const safeDeRisk = present < 2 ? Math.min(deRiskFactor, 0.6) : deRiskFactor;

  return { economy: ind.economy, asOf: ind.asOf, phase, fragility, deRiskFactor: safeDeRisk, signals, expectation, coverage };
}

/**
 * Combine several economies (each affecting the markets traded in its session) into ONE de-risk
 * factor for a given traded symbol/session. Conservative: the blended factor is dominated by the
 * MOST fragile relevant economy (a crisis anywhere that touches the instrument should shrink size).
 * `weights` lets a symbol lean on its home economy while still respecting global contagion.
 */
export function blendDeRisk(regimes: MacroRegime[], weights?: Record<string, number>): { deRiskFactor: number; drivers: string[] } {
  if (regimes.length === 0) return { deRiskFactor: 1, drivers: [] };
  // weighted-average fragility, but floor the de-risk at the single most-fragile economy's factor
  let wsum = 0, fragW = 0, worst = 1; const drivers: string[] = [];
  for (const r of regimes) {
    const wt = weights?.[r.economy] ?? 1;
    wsum += wt; fragW += wt * r.fragility;
    if (r.deRiskFactor < worst) worst = r.deRiskFactor;
    if (r.fragility > 0.25) drivers.push(`${r.economy}:${r.phase}(${(r.fragility * 100).toFixed(0)}%)`);
  }
  const avgFrag = wsum > 0 ? fragW / wsum : 0;
  const blended = clamp01(1 - avgFrag * MAX_CUT);
  return { deRiskFactor: Math.min(blended, worst), drivers };
}
