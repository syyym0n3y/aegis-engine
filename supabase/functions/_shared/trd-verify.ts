// trd-verify.ts — LAYER 1 (VERIFY): falsification-as-a-service. Takes any track
// record or backtest return series and answers the one question no honest retail tool
// answers: "is this a REAL edge, or overfit / lucky noise?" Reuses the honest-stats
// core (DSR deflation, PSR, MinTRL) — the exact engine that killed 15,000 backtests.
// PURE, deterministic, offline. This is the wedge product (prop firms + serious traders).

import { annualizedSharpe, deflatedSharpe, kurtosis, mean, minTRL, probabilisticSharpe, sharpe, skewness } from "./trd-stats.ts";

export interface VerifyInput {
  /** per-period (e.g. daily or per-trade) returns of the strategy / track record */
  returns: number[];
  periodsPerYear: number; // 252 daily, ~monthly 12, or trades/yr for a trade log
  /** how many strategies/variations were tried to FIND this one (the multiple-testing
   * surface). If unknown, we assume a pessimistic default — searching is the norm. */
  claimedTrials?: number;
  /** benchmark annualized Sharpe to beat (e.g. buy-and-hold ~0.5). Default 0. */
  benchmarkAnnualSharpe?: number;
}

export interface VerifyReport {
  n: number;
  annualSharpe: number;
  /** probability the true Sharpe > 0 given the data (PSR) */
  psr: number;
  /** DSR: probability the edge survives the multiple-testing deflation */
  deflatedSharpe: number;
  /** observations needed for the Sharpe to be trustworthy; > n means not-yet-proven */
  minTrackRecord: number;
  authenticityScore: number; // 0-100, blunt product-facing score
  verdict: "LIKELY REAL" | "UNPROVEN" | "LIKELY OVERFIT / LUCK";
  flags: string[];
  plainEnglish: string;
}

const PESSIMISTIC_TRIALS = 50; // if they don't tell us, assume real-world search happened

export function verifyTrackRecord(inp: VerifyInput): VerifyReport {
  const r = inp.returns;
  const n = r.length;
  const perSharpe = sharpe(r); // per-period
  const annual = annualizedSharpe(r, inp.periodsPerYear);
  const sk = skewness(r), ku = kurtosis(r);
  const benchPer = (inp.benchmarkAnnualSharpe ?? 0) / Math.sqrt(inp.periodsPerYear);
  const nTrials = Math.max(2, inp.claimedTrials ?? PESSIMISTIC_TRIALS);
  // variance of trial Sharpes: use the sample's own dispersion as a stand-in when
  // unknown (López de Prado's practical default is ~ (per-period sharpe)-scale).
  const varTrial = 1 / Math.max(1, n); // conservative: more data → less inflation room
  const psr = probabilisticSharpe(perSharpe, benchPer, n, sk, ku);
  const dsr = deflatedSharpe(perSharpe, n, sk, ku, nTrials, Math.max(varTrial, 1e-4));
  const mtrl = minTRL(perSharpe, benchPer, sk, ku, 0.95);

  const flags: string[] = [];
  if (annual > 3) flags.push(`annual Sharpe ${annual.toFixed(1)} is implausibly high — look-ahead, survivorship, or unrealistic costs are the usual causes`);
  if (n < 100) flags.push(`only ${n} observations — far too few to distinguish skill from luck`);
  if (Number.isFinite(mtrl) && mtrl > n) flags.push(`needs ~${Math.ceil(mtrl)} observations to be trustworthy; has ${n}`);
  if (!Number.isFinite(mtrl)) flags.push(`Sharpe does not exceed the benchmark — no track record length can prove an edge`);
  if (mean(r) <= 0) flags.push(`mean return is not positive`);
  if ((inp.claimedTrials ?? 0) === 0) flags.push(`trial count unknown — deflation assumes a pessimistic ${PESSIMISTIC_TRIALS}-strategy search (the honest default)`);

  // authenticity = blend of DSR (survives deflation) and MinTRL satisfaction
  const trlOk = Number.isFinite(mtrl) && mtrl <= n ? 1 : 0;
  const score = Math.round(100 * Math.max(0, Math.min(1, 0.7 * dsr + 0.3 * trlOk)));
  // HARD sample floor: a high in-sample Sharpe makes MinTRL deceptively small, so a
  // short record can never be "proven" no matter how good it looks — the classic trap.
  const enoughData = n >= 100;
  const verdict: VerifyReport["verdict"] = enoughData && score >= 70 && dsr >= 0.9 ? "LIKELY REAL" : score >= 35 && mean(r) > 0 ? "UNPROVEN" : "LIKELY OVERFIT / LUCK";

  const plainEnglish = verdict === "LIKELY REAL"
    ? `This track record clears the multiple-testing deflation (DSR ${dsr.toFixed(2)}) with enough history to be trustworthy. It is statistically distinguishable from luck — rare. Still verify costs and live-forward before sizing up.`
    : verdict === "UNPROVEN"
    ? `Not disproven, but not proven either (DSR ${dsr.toFixed(2)}, needs ~${Number.isFinite(mtrl) ? Math.ceil(mtrl) : "∞"} obs vs ${n}). Treat as a lead, not an edge. More live data or fewer prior attempts would settle it.`
    : `This does not survive honest scrutiny (DSR ${dsr.toFixed(2)}). Once deflated for the strategies likely tried to find it, the apparent edge is indistinguishable from luck. Do not risk capital on it.`;

  return { n, annualSharpe: annual, psr, deflatedSharpe: dsr, minTrackRecord: mtrl, authenticityScore: score, verdict, flags, plainEnglish };
}

/** Batch verify a matrix of candidate strategies (cols) and return PBO — the
 * probability the SELECTION procedure is overfit (for evaluating a trader who
 * "picked their best system"). Thin wrapper so the product surface is one import. */
export { pboCSCV as selectionOverfitProbability } from "./trd-stats.ts";
