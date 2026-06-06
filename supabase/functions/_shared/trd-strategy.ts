// trd-strategy.ts — declarative strategy specs + the backtest orchestrator.
//
// A strategy is DATA, not code: a JSON spec (universe + signal rule + sizing) that
// the interpreter runs over a panel of bars + point-in-time features. The decision
// at bar t may only read features knowable as-of dates[t] (asOf is called INSIDE
// the loop — look-ahead is impossible at the decision boundary, not just at panel
// build). The position decided at t earns the t→t+1 forward return ("bar N+1 fill").
//
// The orchestrator wires this into trd-backtest-core: run → net of turnover cost →
// stats panel + factor decomposition + default-REJECT gate. Pure, offline, testable.

import { asOf, PitRecord } from "./trd-point-in-time.ts";
import {
  evaluateStrategy, GateThresholds, gateVerdict, GateVerdict, StatsPanel,
} from "./trd-backtest-core.ts";

// ---------- spec model ----------

export type Signal =
  | { kind: "always"; side: "long" | "short" }
  | { kind: "feature_threshold"; feature: string; op: ">" | ">=" | "<" | "<="; value: number; side: "long" | "short" }
  | { kind: "and"; rules: Signal[]; side: "long" | "short" }
  | { kind: "or"; rules: Signal[]; side: "long" | "short" };

export interface SizingRule {
  kind: "equal_weight";
  maxPositions: number; // cap concurrent names (correlation/exposure discipline)
}

export interface StrategySpec {
  family: string;
  name: string;
  version: number;
  universe: string[];
  signal: Signal;
  sizing: SizingRule;
  /** per-unit-turnover cost in bps (a full weight-1 position change costs this) */
  costBps: number;
}

// ---------- panel ----------

export interface SymbolData {
  symbol: string;
  /** ascending ISO bar timestamps, shared grid across the panel */
  dates: string[];
  /** returns[t] = return over (dates[t-1], dates[t]]; returns[0] = 0 */
  returns: number[];
  /** raw point-in-time feature records per key (each carries effectiveDate) */
  features: Record<string, PitRecord[]>;
}

export interface Panel {
  dates: string[];
  symbols: SymbolData[];
}

// ---------- signal evaluation (point-in-time) ----------

/** The feature's value knowable AS-OF `date` (latest effectiveDate <= date), or
 * null if nothing is yet disclosed. asOf() enforces the look-ahead guard. */
function featureAsOf(records: PitRecord[] | undefined, date: string): number | null {
  if (!records || records.length === 0) return null;
  const visible = asOf(records, date);
  if (visible.length === 0) return null;
  let latest = visible[0];
  for (const r of visible) if (Date.parse(r.effectiveDate) >= Date.parse(latest.effectiveDate)) latest = r;
  const v = (latest as { value?: unknown }).value;
  return typeof v === "number" ? v : null;
}

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default: return false;
  }
}

/** Returns the desired position for one symbol at one bar: +1 long, -1 short, 0
 * flat. A rule that can't be evaluated (no data yet) is FALSE (flat) — fail to
 * cash, never guess. */
export function evalSignal(sig: Signal, feats: Record<string, PitRecord[]>, date: string): number {
  const sign = (side: "long" | "short") => (side === "long" ? 1 : -1);
  switch (sig.kind) {
    case "always":
      return sign(sig.side);
    case "feature_threshold": {
      const v = featureAsOf(feats[sig.feature], date);
      if (v === null) return 0;
      return cmp(sig.op, v, sig.value) ? sign(sig.side) : 0;
    }
    case "and": {
      const all = sig.rules.every((r) => evalSignal(r, feats, date) !== 0);
      return all ? sign(sig.side) : 0;
    }
    case "or": {
      const any = sig.rules.some((r) => evalSignal(r, feats, date) !== 0);
      return any ? sign(sig.side) : 0;
    }
  }
}

// ---------- backtest run ----------

export interface RunResult {
  dates: string[];
  grossReturns: number[];
  netReturns: number[];
  turnover: number[];
  /** weights[t] = symbol→weight chosen at decision bar t */
  weights: Record<string, number>[];
}

/** Run the interpreter over the panel. Equal-weight, gross exposure normalized to
 * 1, capped at sizing.maxPositions. Cost = turnover × costBps. Returns the
 * decision-bar return streams (length = #dates − 1, since bar t earns t→t+1). */
export function runBacktest(spec: StrategySpec, panel: Panel): RunResult {
  const T = panel.dates.length;
  const symData = new Map(panel.symbols.map((s) => [s.symbol, s]));
  const grossReturns: number[] = [];
  const netReturns: number[] = [];
  const turnover: number[] = [];
  const weightsHist: Record<string, number>[] = [];
  let prevW: Record<string, number> = {};

  for (let t = 0; t < T - 1; t++) {
    const date = panel.dates[t];
    // 1) desired positions
    const desired: { sym: string; pos: number }[] = [];
    for (const sym of spec.universe) {
      const sd = symData.get(sym);
      if (!sd) continue;
      const pos = evalSignal(spec.signal, sd.features, date);
      if (pos !== 0) desired.push({ sym, pos });
    }
    // 2) cap + equal-weight, gross exposure = 1
    const capped = desired.slice(0, spec.sizing.maxPositions);
    const w: Record<string, number> = {};
    if (capped.length > 0) {
      const each = 1 / capped.length;
      for (const d of capped) w[d.sym] = d.pos * each;
    }
    // 3) portfolio forward return (decision at t earns t→t+1)
    let gross = 0;
    for (const sym of Object.keys(w)) {
      const sd = symData.get(sym)!;
      gross += w[sym] * (sd.returns[t + 1] ?? 0);
    }
    // 4) turnover cost
    const syms = new Set([...Object.keys(w), ...Object.keys(prevW)]);
    let tov = 0;
    for (const s of syms) tov += Math.abs((w[s] ?? 0) - (prevW[s] ?? 0));
    const cost = tov * (spec.costBps / 1e4);

    grossReturns.push(gross);
    netReturns.push(gross - cost);
    turnover.push(tov);
    weightsHist.push(w);
    prevW = w;
  }
  return { dates: panel.dates.slice(0, T - 1), grossReturns, netReturns, turnover, weights: weightsHist };
}

// ---------- orchestrator ----------

export interface TrialContext {
  /** total strategy variants tried in this family (for DSR deflation) */
  nTrials: number;
  varTrialSharpes: number;
  /** benchmark Sharpe the DSR tests against — MUST be > 0 (e.g. SPY's) */
  benchmarkSharpe: number;
  /** factor returns aligned to the decision-bar grid (length = #dates − 1) */
  factors: Record<string, number[]>;
}

export interface BacktestResult {
  runKey: string;
  stats: StatsPanel;
  verdict: GateVerdict;
}

/** Stable, content-addressed run key so re-running the same spec is idempotent
 * (the edge fn uses it as the trial-counter / backtest-run dedup key). djb2. */
export function runKeyFor(spec: StrategySpec): string {
  const s = JSON.stringify({ f: spec.family, n: spec.name, v: spec.version, u: spec.universe, sig: spec.signal, sz: spec.sizing, c: spec.costBps });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${spec.family}:${spec.name}:v${spec.version}:${h.toString(16)}`;
}

/** Full backtest: interpret → net returns → honest stats + factor decomposition →
 * default-REJECT gate. Cost is already in netReturns, so evaluate adds no extra
 * drag (costBps: 0). */
export function backtest(spec: StrategySpec, panel: Panel, ctx: TrialContext, thresholds?: GateThresholds): BacktestResult {
  const run = runBacktest(spec, panel);
  const stats = evaluateStrategy({
    returns: run.netReturns,
    costBps: 0,
    nTrials: ctx.nTrials,
    varTrialSharpes: ctx.varTrialSharpes,
    benchmarkSharpe: ctx.benchmarkSharpe,
    factors: ctx.factors,
  });
  return { runKey: runKeyFor(spec), stats, verdict: gateVerdict(stats, thresholds) };
}
