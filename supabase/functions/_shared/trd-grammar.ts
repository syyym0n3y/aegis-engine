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

// The canon of retail trigger primitives (WebSearch-verified coverage of ICT/SMC + price-action +
// momentum + mean-reversion families). Every forum/YouTube "system" is a recombination of these.
//   sweep=liquidity grab · fvg=imbalance · orderblock=OB return · breakout=momentum ·
//   pullback=trend-continuation · engulfing=PA reversal · pinbar=rejection · rsi=mean-reversion.
// "delivery" = the ICT/Rauf concept made testable: a CONSOLIDATION (balance — the market hasn't
// picked a side) followed by a DISPLACEMENT candle that breaks the range = a Change In State of
// Delivery (CISD). Enter in the break direction, stop at the far side of the consolidation. It is
// the volatility-clustering idea (range contraction → expansion) as a mechanical setup.
export type TriggerClass = "sweep" | "fvg" | "orderblock" | "breakout" | "pullback" | "engulfing" | "pinbar" | "rsi" | "delivery";
export type TrendMode = "with" | "against" | "none";
export type Session = "all" | "asia" | "london" | "ny";
export type TrendState = "up" | "down" | "flat";
export type VolState = "lo" | "hi";

export interface ComponentSpec {
  trigger: TriggerClass; // the setup class (ICT-liquidity / imbalance / momentum / trend-continuation)
  emaPeriod: number; // trend-filter EMA length
  trendMode: TrendMode; // trade WITH the EMA (trend-follow), AGAINST (mean-revert), or ignore it
  stopLookback: number; // bars used to place the protective stop (swing extreme)
  rr: number; // target = rr × risk
  session: Session; // entry-session filter (UTC buckets)
}

export const GRAMMAR = {
  trigger: ["sweep", "fvg", "orderblock", "breakout", "pullback", "engulfing", "pinbar", "rsi", "delivery"] as TriggerClass[],
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
    case "orderblock": { // ICT order block: an impulse that engulfs the prior opposite candle
      const p = bars[i - 1]; const body = Math.abs(b.close - b.open), pbody = Math.abs(p.close - p.open);
      const impulse = body > 1.4 * (pbody || 1e-9);
      if (impulse && p.close < p.open && b.close > b.open && b.close > p.high) return { side: "long", stop: Math.min(b.low, p.low) };
      if (impulse && p.close > p.open && b.close < b.open && b.close < p.low) return { side: "short", stop: Math.max(b.high, p.high) };
      return null;
    }
    case "engulfing": { // 2-candle engulfing reversal
      const p = bars[i - 1];
      if (b.close > b.open && b.open <= p.close && b.close >= p.open && p.close < p.open) return { side: "long", stop: b.low };
      if (b.close < b.open && b.open >= p.close && b.close <= p.open && p.close > p.open) return { side: "short", stop: b.high };
      return null;
    }
    case "pinbar": { // rejection wick (mean-reversion at an extreme)
      const body = Math.abs(b.close - b.open), up = b.high - Math.max(b.open, b.close), dn = Math.min(b.open, b.close) - b.low;
      if (dn > 2 * body && dn > up && b.close > b.open) return { side: "long", stop: b.low };
      if (up > 2 * body && up > dn && b.close < b.open) return { side: "short", stop: b.high };
      return null;
    }
    case "rsi": { // classic mean-reversion: RSI crosses back up through 30 (long) / down through 70 (short)
      const r = triggerSignal_rsi(bars, i, 14); const rPrev = triggerSignal_rsi(bars, i - 1, 14);
      if (r === null || rPrev === null) return null;
      if (rPrev < 30 && r >= 30) return { side: "long", stop: lo };
      if (rPrev > 70 && r <= 70) return { side: "short", stop: hi };
      return null;
    }
    case "delivery": { // consolidation (balance) → displacement break = Change In State of Delivery
      const W = Math.max(4, s.stopLookback * 2); if (i < W + 1) return null;
      let ch = -Infinity, cl = Infinity; const rng: number[] = [];
      for (let j = i - W; j < i; j++) { if (bars[j].high > ch) ch = bars[j].high; if (bars[j].low < cl) cl = bars[j].low; rng.push(bars[j].high - bars[j].low); }
      const med = [...rng].sort((a, z) => a - z)[rng.length >> 1] || 1e-9;
      const consolidated = (ch - cl) < 3 * med;          // the window is a tight balance (no side winning)
      const displaced = (b.high - b.low) > 1.5 * med;     // this bar expands hard = delivery
      if (consolidated && displaced) {
        if (b.close > ch) return { side: "long", stop: cl };
        if (b.close < cl) return { side: "short", stop: ch };
      }
      return null;
    }
  }
}

const _rsiCache = new Map<string, number[]>();
function triggerSignal_rsi(bars: Bar[], i: number, period: number): number | null {
  if (i < period) return null;
  const key = `${bars.length}:rsi${period}`; let arr = _rsiCache.get(key);
  if (!arr) {
    arr = new Array(bars.length).fill(NaN); let gain = 0, loss = 0;
    for (let k = 1; k <= period; k++) { const d = bars[k].close - bars[k - 1].close; if (d >= 0) gain += d; else loss -= d; }
    let ag = gain / period, al = loss / period; arr[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let k = period + 1; k < bars.length; k++) { const d = bars[k].close - bars[k - 1].close; const g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (period - 1) + g) / period; al = (al * (period - 1) + l) / period; arr[k] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    _rsiCache.set(key, arr);
  }
  const v = arr[i]; return Number.isFinite(v) ? v : null;
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
export interface CTrade { r: number; exitIdx: number; entryTs: string; exitTs: string; side: "long" | "short"; trend: TrendState; vol: VolState; session: Session; }

// True-range → ATR series (Wilder), for the volatility-regime tag.
function atrSeries(bars: Bar[], period = 14): number[] {
  const tr: number[] = [0];
  for (let i = 1; i < bars.length; i++) { const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close; tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
  const out = new Array(bars.length).fill(0); let a = 0;
  for (let i = 1; i < bars.length; i++) { a = i <= period ? (a * (i - 1) + tr[i]) / i : (a * (period - 1) + tr[i]) / period; out[i] = a; }
  return out;
}
function median(xs: number[]): number { const s = [...xs].filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; }

/** Core: run one composed strategy → trades with R, exit index, and the entry REGIME (trend/vol/
 * session) so callers can find WHEN the strategy works. Pure, no look-ahead. */
export function runComponentTrades(bars: Bar[], s: ComponentSpec, cfg: GrammarCfg): CTrade[] {
  const n = bars.length; if (n < s.emaPeriod + 10) return [];
  const e = ema(bars.map((b) => b.close), s.emaPeriod);
  const atr = atrSeries(bars, 14); const atrMed = median(atr);
  const out: CTrade[] = [];
  let open: { side: "long" | "short"; entry: number; stop: number; target: number; entryTs: string; trend: TrendState; vol: VolState; session: Session } | null = null;
  let queued: Sig | null = null; // signal fired on prior bar → enter at this bar's open
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    if (open) { // resolve open (stop-first, pessimistic)
      let exit: number | null = null;
      if (open.side === "long") { if (bar.low <= open.stop) exit = open.stop; else if (bar.high >= open.target) exit = open.target; }
      else { if (bar.high >= open.stop) exit = open.stop; else if (bar.low <= open.target) exit = open.target; }
      if (exit !== null) { const dir = open.side === "long" ? 1 : -1; const risk = Math.abs(open.entry - open.stop); const grossR = risk > 0 ? (exit - open.entry) * dir / risk : 0; out.push({ r: grossR - 2 * cfg.costRPerSide, exitIdx: i, entryTs: open.entryTs, exitTs: bar.ts, side: open.side, trend: open.trend, vol: open.vol, session: open.session }); open = null; }
    }
    if (!open && queued) { // fill queued entry at this bar's open
      const entry = bar.open, dir = queued.side === "long" ? 1 : -1, risk = Math.abs(entry - queued.stop);
      if (risk > 0 && ((queued.side === "long" && queued.stop < entry) || (queued.side === "short" && queued.stop > entry))) {
        const slope = i > 10 ? (e[i] - e[i - 10]) / (e[i - 10] || 1) : 0;
        const trend: TrendState = slope > 0.001 ? "up" : slope < -0.001 ? "down" : "flat";
        const vol: VolState = atr[i] >= atrMed ? "hi" : "lo";
        open = { side: queued.side, entry, stop: queued.stop, target: entry + dir * s.rr * risk, entryTs: bar.ts, trend, vol, session: sessionOf(new Date(bar.ts).getUTCHours()) };
      }
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

export function clearEmaCache() { _emaCache.clear(); _rsiCache.clear(); }
