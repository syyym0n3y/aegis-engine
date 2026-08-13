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
  regime?: Record<string, string>; // observable-AT-ENTRY tags, e.g. {vol:"high", trend:"up", dir:"long"} — for C7
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

export interface RegimeCell {
  dimension: string; bucket: string; n: number;
  absR: number; netR: number; vsRandomEdge: number; vsRandomT: number; passes: boolean;
  h1Edge: number; h2Edge: number; holdsBoth: boolean; // OOS: does the bucket's vs-random edge hold in BOTH halves?
}
/** C7 regime matrix: for each regime dimension, bucket setup+control by the AT-ENTRY tag and measure the
 * vs-random edge PER BUCKET. Answers "WHEN does this edge fire best?" — the favourable-condition gate.
 * Control trades must carry the SAME regime tag at their random entry so buckets are matched (drift cancels
 * within a bucket). Thin buckets fail closed (minN). */
export function scoreByRegime(setup: HarnessTrade[], control: HarnessTrade[], costBps: number, dims: string[], minN = 20, oosCut = "2025"): RegimeCell[] {
  const costFrac = costBps / 1e4;
  const netOf = (t: HarnessTrade) => t.r - (t.stopFrac > 0 ? costFrac / t.stopFrac : 0);
  const halfEdge = (s: HarnessTrade[], c: HarnessTrade[]) => (s.length && c.length) ? mean(s.map((t) => t.r)) - mean(c.map((t) => t.r)) : NaN;
  const out: RegimeCell[] = [];
  for (const dim of dims) {
    const buckets = new Set<string>();
    for (const t of setup) { const b = t.regime?.[dim]; if (b) buckets.add(b); }
    for (const b of [...buckets].sort()) {
      const s = setup.filter((t) => t.regime?.[dim] === b);
      const c = control.filter((t) => t.regime?.[dim] === b);
      const vr = edgeVsRandom(s.map((t) => t.r), c.map((t) => t.r), 2, minN);
      // OOS: the bucket's vs-random edge must survive in BOTH time halves (guards against in-sample regime mining)
      const inH1 = (t: HarnessTrade) => !!t.period && t.period < oosCut;
      const e1 = halfEdge(s.filter(inH1), c.filter(inH1)), e2 = halfEdge(s.filter((t) => !inH1(t)), c.filter((t) => !inH1(t)));
      const h1n = s.filter(inH1).length, h2n = s.length - h1n;
      out.push({
        dimension: dim, bucket: b, n: s.length,
        absR: +mean(s.map((t) => t.r)).toFixed(4), netR: +mean(s.map(netOf)).toFixed(4),
        vsRandomEdge: vr.edge, vsRandomT: vr.tStat, passes: vr.passes,
        h1Edge: Number.isFinite(e1) ? +e1.toFixed(4) : NaN, h2Edge: Number.isFinite(e2) ? +e2.toFixed(4) : NaN,
        holdsBoth: h1n >= 10 && h2n >= 10 && e1 > 0 && e2 > 0,
      });
    }
  }
  return out;
}

export interface DollarView {
  edge: string; n: number; riskUsd: number;
  // FRAMEWORK A — flat: every trade risks the same $ (net-R × riskUsd)
  flatUsd: number; flatPerTrade: number;
  // FRAMEWORK B — conviction: each trade scaled by MEASURED setup quality (D-295 tight/up → larger)
  convUsd: number; convPerTrade: number; avgConv: number;
  // FRAMEWORK C — regime-gated: only trade the favourable regime (skip the rest)
  gatedUsd: number; gatedN: number; gatedPerTrade: number;
  // honest anchor: dollars from DRIFT (control) vs dollars from SKILL (edge over control)
  driftUsd: number; skillUsd: number;
}
/** DOLLAR framework (D-296): translate an edge's net-R trades into money under three chart-analysis lenses —
 * flat, conviction-sized (D-295), and regime-gated — AND split the flat dollars into drift (what a random
 * control earned) vs skill (edge over control). The anchor the operator must keep: dollar profit that is all
 * `driftUsd` and ~0 `skillUsd` is NOT an edge, however green the flatUsd looks. riskUsd = $ risked per 1R at
 * base size (e.g. 0.5% of a $100k book = $500). convOf/favOf read the AT-ENTRY regime tags; defaults are inert
 * (conv=1, all favourable) so an edge with no tags still gets an honest flat-dollar number. */
export function scoreDollar(
  edge: string, setup: HarnessTrade[], control: HarnessTrade[], costBps: number, riskUsd: number,
  convOf: (r: Record<string, string> | undefined) => number = () => 1,
  favOf: (r: Record<string, string> | undefined) => boolean = () => true,
): DollarView {
  const costFrac = costBps / 1e4;
  const netOf = (t: HarnessTrade) => t.r - (t.stopFrac > 0 ? costFrac / t.stopFrac : 0);
  const net = setup.map(netOf);
  const ctrlNet = control.map(netOf);
  const flatUsd = net.reduce((s, r) => s + r, 0) * riskUsd;
  const driftUsd = (ctrlNet.length ? mean(ctrlNet) : 0) * setup.length * riskUsd;
  const convs = setup.map((t) => convOf(t.regime));
  const convUsd = net.reduce((s, r, i) => s + r * convs[i], 0) * riskUsd;
  const gatedIdx = setup.map((t, i) => favOf(t.regime) ? i : -1).filter((i) => i >= 0);
  const gatedUsd = gatedIdx.reduce((s, i) => s + net[i], 0) * riskUsd;
  return {
    edge, n: setup.length, riskUsd,
    flatUsd: +flatUsd.toFixed(0), flatPerTrade: +(flatUsd / Math.max(1, setup.length)).toFixed(2),
    convUsd: +convUsd.toFixed(0), convPerTrade: +(convUsd / Math.max(1, setup.length)).toFixed(2),
    avgConv: +(convs.reduce((s, c) => s + c, 0) / Math.max(1, convs.length)).toFixed(3),
    gatedUsd: +gatedUsd.toFixed(0), gatedN: gatedIdx.length,
    gatedPerTrade: +(gatedUsd / Math.max(1, gatedIdx.length)).toFixed(2),
    driftUsd: +driftUsd.toFixed(0), skillUsd: +(flatUsd - driftUsd).toFixed(0),
  };
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
