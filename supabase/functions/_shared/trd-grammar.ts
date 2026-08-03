// trd-grammar — the strategy ALGEBRA. Every retail "setup" decomposes into a handful of reusable
// components; a strategy is a point in the product space of those components. This lets Aegis take
// setups apart and recombine them into thousands of candidates, then run them ALL through the same
// honest gate (see scripts/trd-strategy-search.ts — DSR deflated by trial count + PBO + OOS).
//
// A strategy = { trigger CLASS } × { trend filter } × { stop rule } × { reward:risk } × { session }.
// Pranam Ghagare's "XAU liquidity-grab" is simply {trigger: sweep, trend: with, rr: 1} — one point.
//
// Honest by construction: entries are taken at the NEXT bar's open after a signal bar CLOSES (no
// look-ahead), exits are same-bar stop-first (pessimistic), and a per-side cost is charged.

import { Bar, ema } from "./trd-liquidity-grab.ts";
export type { Bar };

export type TriggerClass = "sweep" | "fvg" | "breakout" | "pullback";
export type TrendMode = "with" | "against" | "none";
export type Session = "all" | "asia" | "london" | "ny";

export interface ComponentSpec {
  trigger: TriggerClass; // the setup class (ICT-liquidity / imbalance / momentum / trend-continuation)
  emaPeriod: number; // trend-filter EMA length
  trendMode: TrendMode; // trade WITH the EMA (trend-follow), AGAINST (mean-revert), or ignore it
  stopLookback: number; // bars used to place the protective stop (swing extreme)
  rr: number; // target = rr × risk
  session: Session; // entry-session filter (UTC buckets)
}

export const GRAMMAR = {
  trigger: ["sweep", "fvg", "breakout", "pullback"] as TriggerClass[],
  emaPeriod: [20, 30, 50],
  trendMode: ["with", "against", "none"] as TrendMode[],
  stopLookback: [3, 5, 10],
  rr: [0.5, 1, 1.5, 2, 3],
  session: ["all", "asia", "london", "ny"] as Session[],
};

/** Cartesian product of the grammar → every distinct strategy. |GRAMMAR| ≈ 4·3·3·3·5·4 = 2160. */
export function enumerate(g = GRAMMAR): ComponentSpec[] {
  const out: ComponentSpec[] = [];
  for (const trigger of g.trigger) for (const emaPeriod of g.emaPeriod) for (const trendMode of g.trendMode) for (const stopLookback of g.stopLookback) for (const rr of g.rr) for (const session of g.session) out.push({ trigger, emaPeriod, trendMode, stopLookback, rr, session });
  return out;
}
export function specKey(s: ComponentSpec): string { return `${s.trigger}|ema${s.emaPeriod}|${s.trendMode}|sl${s.stopLookback}|rr${s.rr}|${s.session}`; }

function sessionOf(hUtc: number): Session { return hUtc < 7 ? "asia" : hUtc < 13 ? "london" : hUtc < 21 ? "ny" : "asia"; }

// A trigger inspects data known by the CLOSE of bar i and returns a raw signal or null.
interface Sig { side: "long" | "short"; stop: number; }
function triggerSignal(bars: Bar[], i: number, s: ComponentSpec): Sig | null {
  const lb = s.stopLookback; if (i < Math.max(lb, 3)) return null;
  const b = bars[i];
  let hi = -Infinity, lo = Infinity; for (let j = i - lb; j < i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
  switch (s.trigger) {
    case "breakout": // momentum: close clears the recent range
      if (b.close > hi) return { side: "long", stop: lo };
      if (b.close < lo) return { side: "short", stop: hi };
      return null;
    case "sweep": { // ICT liquidity grab: wick beyond the range but close back inside
      const priorHi = hi, priorLo = lo;
      if (b.high > priorHi && b.close < priorHi) return { side: "short", stop: b.high };
      if (b.low < priorLo && b.close > priorLo) return { side: "long", stop: b.low };
      return null;
    }
    case "fvg": { // imbalance: 3-bar fair-value gap
      if (i < 2) return null;
      if (b.low > bars[i - 2].high) return { side: "long", stop: Math.min(lo, bars[i - 2].low) };
      if (b.high < bars[i - 2].low) return { side: "short", stop: Math.max(hi, bars[i - 2].high) };
      return null;
    }
    case "pullback": { // trend-continuation: tag an MA then close back through it
      const e = triggerSignal_ema(bars, i, s.emaPeriod);
      if (e === null) return null;
      if (b.low <= e && b.close > e) return { side: "long", stop: lo };
      if (b.high >= e && b.close < e) return { side: "short", stop: hi };
      return null;
    }
  }
}
// tiny memoized-ish EMA-at-i helper (recompute cheap for the grammar's small period set)
const _emaCache = new Map<string, number[]>();
function triggerSignal_ema(bars: Bar[], i: number, period: number): number {
  const key = `${bars.length}:${period}`; let arr = _emaCache.get(key);
  if (!arr) { arr = ema(bars.map((x) => x.close), period); _emaCache.set(key, arr); }
  return arr[i];
}

function passesTrend(side: "long" | "short", close: number, emaVal: number, mode: TrendMode): boolean {
  if (mode === "none") return true;
  const up = close > emaVal;
  if (mode === "with") return side === "long" ? up : !up;
  return side === "long" ? !up : up; // against
}

// Cost is charged in R units (a fraction of each trade's risk/stop-distance) so it is comparable
// across instruments. Gold's ~$0.30/side over an ~$11 stop ≈ 0.05R; 0.05 is a realistic default.
export interface GrammarCfg { costRPerSide: number; }
export interface CTrade { r: number; exitIdx: number; }
/** Core: run one composed strategy → trades with their R and exit bar index. Pure, no look-ahead. */
export function runComponentTrades(bars: Bar[], s: ComponentSpec, cfg: GrammarCfg): CTrade[] {
  const n = bars.length; if (n < s.emaPeriod + 10) return [];
  const e = ema(bars.map((b) => b.close), s.emaPeriod);
  const out: CTrade[] = [];
  let open: { side: "long" | "short"; entry: number; stop: number; target: number } | null = null;
  let queued: Sig | null = null; // signal fired on prior bar → enter at this bar's open
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    if (open) { // resolve open (stop-first, pessimistic)
      let exit: number | null = null;
      if (open.side === "long") { if (bar.low <= open.stop) exit = open.stop; else if (bar.high >= open.target) exit = open.target; }
      else { if (bar.high >= open.stop) exit = open.stop; else if (bar.low <= open.target) exit = open.target; }
      if (exit !== null) { const dir = open.side === "long" ? 1 : -1; const risk = Math.abs(open.entry - open.stop); const grossR = risk > 0 ? (exit - open.entry) * dir / risk : 0; out.push({ r: grossR - 2 * cfg.costRPerSide, exitIdx: i }); open = null; }
    }
    if (!open && queued) { // fill queued entry at this bar's open
      const entry = bar.open, dir = queued.side === "long" ? 1 : -1, risk = Math.abs(entry - queued.stop);
      if (risk > 0 && ((queued.side === "long" && queued.stop < entry) || (queued.side === "short" && queued.stop > entry))) open = { side: queued.side, entry, stop: queued.stop, target: entry + dir * s.rr * risk };
      queued = null;
    }
    if (!open && !queued) { // new signal on this closed bar
      if (s.session !== "all" && sessionOf(new Date(bar.ts).getUTCHours()) !== s.session) continue;
      const sig = triggerSignal(bars, i, s);
      if (sig && passesTrend(sig.side, bar.close, e[i], s.trendMode)) queued = sig;
    }
  }
  return out;
}
/** Convenience: per-trade R multiples (net of cost). */
export function runComponent(bars: Bar[], s: ComponentSpec, cfg: GrammarCfg): number[] {
  return runComponentTrades(bars, s, cfg).map((t) => t.r);
}

export function clearEmaCache() { _emaCache.clear(); }
