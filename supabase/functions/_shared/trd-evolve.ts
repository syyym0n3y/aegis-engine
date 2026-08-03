// trd-evolve.ts — a TRIAL-HONEST evolutionary search over Wyckoff strategy specs.
// PURE (evaluation is injected). Deterministic (seeded PRNG) so re-runs are no-ops
// on the same inputs — the idempotency invariant.
//
// WHY THIS EXISTS AND WHY IT IS SAFE:
// "Evolve different algorithms until we are the exception" is, mechanically, an
// overfitting machine: a large enough search ALWAYS finds an in-sample winner, and
// it is noise ~97% of the time. This module is built so that CANNOT lie:
//   1. nTrials = EVERY unique candidate ever evaluated across all generations. The
//      Deflated Sharpe is deflated by that true N (López de Prado), so a winner
//      found by searching 5,000 variants is judged against the expected best-of-5,000
//      under the null — not against zero.
//   2. PBO via CSCV over the candidate return matrix: if the selection procedure's
//      in-sample winner lands below the out-of-sample median more than half the time,
//      the whole search is declared OVERFIT and its "edge" is thrown out.
//   3. The module never promotes anything. It returns the winning spec + the honest
//      TrialContext (nTrials, varTrialSharpes) so the caller runs the SAME
//      default-REJECT gate (residual-alpha vs the factor zoo) as every hand-written
//      strategy. Evolution buys no exemption from the gate.
// The most likely — and CORRECT — outcome is that nothing clears. Per D-070 that is
// a success of the engine, not a failure of the search.

import { Signal, StrategySpec } from "./trd-strategy.ts";
import { kurtosis, pboCSCV, sharpe, skewness } from "./trd-stats.ts";
import { deflatedSharpe } from "./trd-stats.ts";

// ---------- genome ----------

export type WyckoffEvent = "wy_spring" | "wy_sos" | "wy_upthrust" | "wy_sow";

/** A candidate parameterization. Side is pinned to event polarity so genes stay
 * economically sane (bullish events → long, bearish → short); the search varies the
 * confidence-lever gates + thresholds + concurrency. */
export interface WyckoffGene {
  event: WyckoffEvent;
  useEvrGate: boolean; // require an efficient (non-absorbed) move
  evrMin: number; // wy_evr >= evrMin
  useCvdGate: boolean; // require proxy-CVD slope confluence
  cvdSlopeSide: ">" | "<";
  cvdSlopeThresh: number;
  maxPositions: number;
}

const BULLISH: WyckoffEvent[] = ["wy_spring", "wy_sos"];

export function sideOf(event: WyckoffEvent): "long" | "short" {
  return BULLISH.includes(event) ? "long" : "short";
}

/** Content-addressed key so duplicate genes are counted ONCE (an honest nTrials
 * counts distinct hypotheses, and PBO columns must not be duplicated). */
export function geneKey(g: WyckoffGene): string {
  return [
    g.event,
    g.useEvrGate ? `evr>=${g.evrMin.toFixed(3)}` : "evr-",
    g.useCvdGate ? `cvd${g.cvdSlopeSide}${g.cvdSlopeThresh.toFixed(1)}` : "cvd-",
    `mp${g.maxPositions}`,
  ].join("|");
}

/** Compile a gene into the declarative StrategySpec the backtest interpreter runs. */
export function geneToSpec(g: WyckoffGene, universe: string[], costBps: number): StrategySpec {
  const side = sideOf(g.event);
  const rules: Signal[] = [{ kind: "feature_threshold", feature: g.event, op: ">=", value: 1, side }];
  if (g.useEvrGate) {
    rules.push({ kind: "feature_threshold", feature: "wy_evr", op: ">=", value: g.evrMin, side });
  }
  if (g.useCvdGate) {
    rules.push({
      kind: "feature_threshold",
      feature: "wy_cvd_proxy_slope",
      op: g.cvdSlopeSide,
      value: g.cvdSlopeThresh,
      side,
    });
  }
  const signal: Signal = rules.length === 1 ? rules[0] : { kind: "and", rules, side };
  return {
    family: "wyckoff-evolved",
    name: geneKey(g),
    version: 1,
    universe,
    signal,
    sizing: { kind: "equal_weight", maxPositions: g.maxPositions },
    costBps,
  };
}

// ---------- deterministic PRNG (mulberry32) ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENTS: WyckoffEvent[] = ["wy_spring", "wy_sos", "wy_upthrust", "wy_sow"];

function randomGene(rnd: () => number): WyckoffGene {
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  return {
    event: pick(EVENTS),
    useEvrGate: rnd() < 0.5,
    evrMin: Math.round(rnd() * 100) / 100, // 0.00..1.00
    useCvdGate: rnd() < 0.5,
    cvdSlopeSide: rnd() < 0.5 ? ">" : "<",
    cvdSlopeThresh: Math.round((rnd() - 0.5) * 2000), // -1000..1000 (proxy units)
    maxPositions: 1 + Math.floor(rnd() * 5),
  };
}

function mutate(g: WyckoffGene, rnd: () => number): WyckoffGene {
  const n = { ...g };
  const r = rnd();
  if (r < 0.2) n.event = EVENTS[Math.floor(rnd() * EVENTS.length)];
  else if (r < 0.4) n.useEvrGate = !n.useEvrGate;
  else if (r < 0.6) n.evrMin = Math.min(1, Math.max(0, n.evrMin + (rnd() - 0.5) * 0.4));
  else if (r < 0.75) n.useCvdGate = !n.useCvdGate;
  else if (r < 0.9) n.cvdSlopeThresh = Math.round(n.cvdSlopeThresh + (rnd() - 0.5) * 400);
  else n.maxPositions = 1 + Math.floor(rnd() * 5);
  return n;
}

function crossover(a: WyckoffGene, b: WyckoffGene, rnd: () => number): WyckoffGene {
  return {
    event: rnd() < 0.5 ? a.event : b.event,
    useEvrGate: rnd() < 0.5 ? a.useEvrGate : b.useEvrGate,
    evrMin: rnd() < 0.5 ? a.evrMin : b.evrMin,
    useCvdGate: rnd() < 0.5 ? a.useCvdGate : b.useCvdGate,
    cvdSlopeSide: rnd() < 0.5 ? a.cvdSlopeSide : b.cvdSlopeSide,
    cvdSlopeThresh: rnd() < 0.5 ? a.cvdSlopeThresh : b.cvdSlopeThresh,
    maxPositions: rnd() < 0.5 ? a.maxPositions : b.maxPositions,
  };
}

// ---------- search ----------

/** Injected evaluator: given a spec, return its NET (post-cost) decision-bar return
 * series. Kept as a dependency so this module is pure/offline-testable and the panel
 * / point-in-time wiring lives in the orchestrator. */
export type RunSpec = (spec: StrategySpec) => number[];

export interface EvolveConfig {
  universe: string[];
  costBps: number;
  populationSize: number;
  generations: number;
  seed: number;
  eliteFrac?: number; // top fraction carried + bred (default 0.3)
}

export interface Candidate {
  gene: WyckoffGene;
  spec: StrategySpec;
  netReturns: number[];
  sharpe: number;
}

export interface EvolveResult {
  /** every DISTINCT candidate evaluated across all generations — the honest N */
  nTrials: number;
  varTrialSharpes: number;
  best: Candidate | null;
  /** honest DSR of the winner, deflated by nTrials */
  deflatedSharpeBest: number;
  pbo: number;
  /** true if the search is statistically overfit (PBO >= 0.5) — winner is noise */
  overfit: boolean;
  /** convenience booleans for the caller; the FULL default-REJECT gate (residual
   * alpha vs the factor zoo) still runs downstream via backtest() with this ctx */
  clearsDsr: boolean;
  trialContext: { nTrials: number; varTrialSharpes: number };
  note: string;
}

function sampleVar(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

/**
 * Run the evolutionary search. Returns the honest verdict. Note it NEVER returns
 * "passed" — it returns the winner + the true trial context so the caller applies
 * the same gate as everything else. DSR threshold shown here (0.95) mirrors the
 * decision-locked gate; the caller re-checks it against trd_gate_thresholds.
 */
export function evolve(cfg: EvolveConfig, run: RunSpec): EvolveResult {
  const rnd = mulberry32(cfg.seed);
  const elite = Math.max(1, Math.floor(cfg.populationSize * (cfg.eliteFrac ?? 0.3)));
  const evaluated = new Map<string, Candidate>(); // dedup by geneKey → distinct trials

  const evalGene = (g: WyckoffGene): Candidate => {
    const k = geneKey(g);
    const hit = evaluated.get(k);
    if (hit) return hit;
    const spec = geneToSpec(g, cfg.universe, cfg.costBps);
    const netReturns = run(spec);
    const s = netReturns.length >= 2 ? sharpe(netReturns) : -Infinity;
    const c: Candidate = { gene: g, spec, netReturns, sharpe: Number.isFinite(s) ? s : -Infinity };
    evaluated.set(k, c);
    return c;
  };

  // gen 0
  let population: Candidate[] = [];
  for (let i = 0; i < cfg.populationSize; i++) population.push(evalGene(randomGene(rnd)));

  for (let gen = 1; gen < cfg.generations; gen++) {
    population.sort((a, b) => b.sharpe - a.sharpe);
    const parents = population.slice(0, elite);
    const next: Candidate[] = [...parents];
    while (next.length < cfg.populationSize) {
      const a = parents[Math.floor(rnd() * parents.length)].gene;
      const b = parents[Math.floor(rnd() * parents.length)].gene;
      const child = mutate(crossover(a, b, rnd), rnd);
      next.push(evalGene(child));
    }
    population = next;
  }

  const all = [...evaluated.values()].filter((c) => Number.isFinite(c.sharpe));
  const nTrials = all.length;
  if (nTrials === 0) {
    return {
      nTrials: 0, varTrialSharpes: 0, best: null, deflatedSharpeBest: 0, pbo: 1,
      overfit: true, clearsDsr: false, trialContext: { nTrials: 0, varTrialSharpes: 0 },
      note: "no evaluable candidates",
    };
  }

  const varTrialSharpes = sampleVar(all.map((c) => c.sharpe));
  const best = all.reduce((x, y) => (y.sharpe > x.sharpe ? y : x));

  // PBO across the candidate return matrix (rows = obs, cols = distinct candidates).
  // Truncate to the shared min length so columns align.
  const usable = all.filter((c) => c.netReturns.length >= 2);
  const minLen = usable.reduce((m, c) => Math.min(m, c.netReturns.length), Infinity);
  let pbo = 1;
  if (Number.isFinite(minLen) && minLen >= 8 && usable.length >= 2) {
    const M: number[][] = [];
    for (let t = 0; t < minLen; t++) M.push(usable.map((c) => c.netReturns[t]));
    const sBlocks = Math.min(8, minLen - (minLen % 2)); // even, <= minLen
    pbo = pboCSCV(M, Math.max(2, sBlocks - (sBlocks % 2))).pbo;
  }

  const bs = best.netReturns;
  const dsr = bs.length >= 2
    ? deflatedSharpe(best.sharpe, bs.length, skewness(bs), kurtosis(bs), nTrials, varTrialSharpes)
    : 0;
  const overfit = pbo >= 0.5;
  const clearsDsr = dsr >= 0.95 && !overfit;

  return {
    nTrials,
    varTrialSharpes,
    best,
    deflatedSharpeBest: dsr,
    pbo,
    overfit,
    clearsDsr,
    trialContext: { nTrials, varTrialSharpes },
    note: overfit
      ? `OVERFIT: PBO=${pbo.toFixed(2)} >= 0.5 over ${nTrials} trials — winner is selection noise, REJECT the search`
      : clearsDsr
      ? `winner DSR=${dsr.toFixed(3)} over ${nTrials} trials; PBO=${pbo.toFixed(2)}. Now run the FULL factor-decomposition gate before believing it.`
      : `no edge survived deflation: best DSR=${dsr.toFixed(3)} over ${nTrials} trials (need >=0.95). Expected outcome per D-070.`,
  };
}
