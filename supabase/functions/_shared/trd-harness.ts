// trd-harness.ts — the UNIFIED edge scorecard (D-263). Pure, tested. Does NOT re-implement anything: it COMPOSES
// the already-tested cores so every edge is judged by the SAME gauntlet, cost-net and comparable:
//   • cost      → trd-cost-model.ts / trd-cost.ts   (pessimistic prior OR Corwin-Schultz measured spread)
//   • skill     → trd-random-control.ts edgeVsRandom (D-146: setup must beat matched random entry)
//   • stats     → trd-backtest-core.ts evaluateStrategy (DSR, minTRL, sortino, maxDD) + gateVerdict
// The audit's finding was that these existed but were imported by nothing but trd-copilot. This wires them.
//
// UNIT NOTE. Edges are measured in R (stop-relative), currency-neutral. Cost is a PRICE fraction, so to put it
// in R we divide by each trade's stop fraction: costR = costFrac / stopFrac. The vs-random EDGE is cost-neutral
// (setup and control pay the SAME cost, it cancels in the difference) — so skill is tested on gross R, while the
// ABSOLUTE "does it actually profit" question is answered on net R. Both are reported; neither is hidden.
import { evaluateStrategy, gateVerdict, DEFAULT_GATE, type GateThresholds } from "./trd-backtest-core.ts";
import { edgeVsRandom } from "./trd-random-control.ts";
import { mean } from "./trd-stats.ts";

export interface HarnessTrade {
  r: number;          // realized R multiple (gross, pre-cost)
  stopFrac: number;   // stop distance / entry price — converts a price-fraction cost into R
  period?: string;    // e.g. "2024Q1" — used for split-half OOS
}
export interface ScoreOpts {
  costBps: number;            // round-trip cost of the instrument, in bps (from the cost model)
  nTrials: number;            // trial count for DSR deflation (from trd_trial_counter) — a Sharpe without N is a lie
  varTrialSharpes?: number;   // variance of trial Sharpes for DSR (conservative default 0.25)
  benchmarkSharpe?: number;   // DSR/minTRL benchmark, MUST be >0 (e.g. buy&hold) — default 0.5
  oosSplit?: (period: string) => "h1" | "h2"; // period → half; default lexicographic < "cut"
  oosCut?: string;            // default "2025" (H1 = periods lexically < cut)
  gate?: GateThresholds;      // default: DSR≥0.95 + net-cost>0 + minTRL; residual-alpha auto-off (no factor panel)
}
export interface EdgeScorecard {
  edge: string; n: number; nTrials: number;
  absR: number; costR: number; netR: number;                 // gross / cost / net mean R
  vsRandomEdge: number; vsRandomT: number; vsRandomPasses: boolean; vsRandomVerdict: string;
  deflatedSharpe: number; sharpe: number; maxDrawdown: number; minTRL: number;
  oosH1: number; oosH2: number; holdsBoth: boolean;
  gatePassed: boolean; gateFailing: string[];
  costBps: number;
}

/** Score one edge from its setup trades + a MATCHED random-control set (same instrument/regime/geometry). */
export function scoreEdge(edge: string, setup: HarnessTrade[], control: HarnessTrade[], opts: ScoreOpts): EdgeScorecard {
  const costFrac = opts.costBps / 1e4;
  const costRof = (t: HarnessTrade) => t.stopFrac > 0 ? costFrac / t.stopFrac : 0;
  const grossR = setup.map((t) => t.r);
  const costRs = setup.map(costRof);
  const netRs = setup.map((t, i) => t.r - costRs[i]);
  const ctrlGross = control.map((t) => t.r);

  // skill (cost-neutral — cost cancels between setup and its matched control)
  const vr = edgeVsRandom(grossR, ctrlGross);

  // stats on NET R (already net → pass costBps 0 so evaluateStrategy doesn't double-charge)
  const panel = evaluateStrategy({
    returns: netRs, costBps: 0, nTrials: opts.nTrials,
    varTrialSharpes: opts.varTrialSharpes ?? 0.25,
    benchmarkSharpe: opts.benchmarkSharpe ?? 0.5,
  });

  // split-half OOS on net R
  const cut = opts.oosCut ?? "2025";
  const half = opts.oosSplit ?? ((p: string) => (p < cut ? "h1" : "h2"));
  const h1: number[] = [], h2: number[] = [];
  setup.forEach((t, i) => { if (t.period) (half(t.period) === "h1" ? h1 : h2).push(netRs[i]); });
  const oosH1 = h1.length ? mean(h1) : NaN, oosH2 = h2.length ? mean(h2) : NaN;

  // gate: keep the locked DSR/net-cost/minTRL invariants; residual-alpha only applies with a factor panel
  const gate: GateThresholds = opts.gate ?? { ...DEFAULT_GATE, requireResidualAlpha: false };
  const gv = gateVerdict(panel, gate);

  return {
    edge, n: setup.length, nTrials: opts.nTrials,
    absR: +mean(grossR).toFixed(4), costR: +mean(costRs).toFixed(4), netR: +mean(netRs).toFixed(4),
    vsRandomEdge: vr.edge, vsRandomT: vr.tStat, vsRandomPasses: vr.passes, vsRandomVerdict: vr.verdict,
    deflatedSharpe: +panel.deflatedSharpe.toFixed(4), sharpe: +panel.sharpePerPeriod.toFixed(4),
    maxDrawdown: +panel.maxDrawdown.toFixed(4), minTRL: Number.isFinite(panel.minTRL) ? Math.ceil(panel.minTRL) : Infinity,
    oosH1: Number.isFinite(oosH1) ? +oosH1.toFixed(4) : NaN, oosH2: Number.isFinite(oosH2) ? +oosH2.toFixed(4) : NaN,
    holdsBoth: Number.isFinite(oosH1) && Number.isFinite(oosH2) && oosH1 > 0 && oosH2 > 0,
    gatePassed: gv.passed, gateFailing: gv.failing, costBps: opts.costBps,
  };
}
