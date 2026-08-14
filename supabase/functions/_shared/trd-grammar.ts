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
export type TriggerClass = "sweep" | "fvg" | "orderblock" | "breakout" | "pullback" | "engulfing" | "pinbar" | "rsi" | "delivery" | "inside" | "channel" | "nbar" | "ssweep" | "nr7" | "star" | "soldiers" | "choch";
export type TrendMode = "with" | "against" | "none";
export type Session = "all" | "asia" | "london" | "ny";
export type TrendState = "up" | "down" | "flat";
export type VolState = "lo" | "hi";

// STOP GEOMETRY (D-305) — the axis D-303 identified as the binding constraint. Cost in R is
// (feeBps/1e4)/riskFrac, so how far the stop sits from entry, as a FRACTION OF NOTIONAL, decides whether a
// setup can pay its fees at all. MEASURED on 1,000 live 15m bars (BTC/ETH/SOL/DOGE): median ATR(14)/price
// = 0.16–0.25%, and the swing stops the triggers emit sit at 0.25–0.79% of notional. At a 10bp/side fee that
// is a 0.7R round trip — larger than any measured gross expectancy. These modes widen the stop into the
// 1–2% band where a 20–40bp round trip costs 0.1–0.3R instead:
//   swing   = the trigger's OWN stop (today's behaviour; the DEFAULT, so every pre-existing spec is unchanged)
//   atr2    = 2×ATR(14)   ≈ 0.4% of notional — the CONTROL rung: still too tight, predicted to die like today's
//   atr6    = 6×ATR(14)   ≈ 1.3% — marginal
//   atr12   = 12×ATR(14)  ≈ 2.6% — comfortably payable
//   wide100 = the 100-bar swing extreme ≈ 1.8–2.6% — the same widening via a NON-ATR mechanic, so we can tell
//             whether what matters is the WIDTH or the volatility-normalisation.
// The stop is widened AFTER the trigger fires; the trigger's own detection logic is untouched, so a mode
// change never alters WHICH bars signal — only where the protective stop sits. That keeps the axis clean.
export type StopMode = "swing" | "atr2" | "atr6" | "atr12" | "wide100";
/** ATR(14) multiple per mode; null = not an ATR mode. */
export const STOP_MODE_ATR: Record<StopMode, number | null> = { swing: null, atr2: 2, atr6: 6, atr12: 12, wide100: null };
const WIDE_LOOKBACK = 100;

// FALSIFIED OPTIMISATION, kept as a warning. It looks like stopLookback should be a no-op outside swing mode
// for the 12 triggers that don't use it in their SIGNAL (only breakout/sweep/delivery do) — the stop is
// overridden, so sl3/sl5/sl10 ought to yield identical trades, and pinning it would have cut the seed by 2.4×.
// It is WRONG: `triggerSignal` bails on `i < max(stopLookback, 3)`, so a larger lookback suppresses signals in
// the first few bars, and because a new signal is blocked while a trade is open, ONE suppressed early entry
// re-phases every subsequent trade. A test asserts the divergence so nobody re-introduces the shortcut.
// Aligning the guard would fix it but would change swing-mode results and invalidate 121k already-scored
// spec_keys — not worth it. stopLookback is therefore varied in FULL across every stop mode.

export interface ComponentSpec {
  trigger: TriggerClass; // the setup class (ICT-liquidity / imbalance / momentum / trend-continuation)
  emaPeriod: number; // trend-filter EMA length
  trendMode: TrendMode; // trade WITH the EMA (trend-follow), AGAINST (mean-revert), or ignore it
  stopLookback: number; // bars used to place the protective stop (swing extreme)
  rr: number; // target = rr × risk
  session: Session; // entry-session filter (UTC buckets)
  stopMode?: StopMode; // stop GEOMETRY; absent = "swing" = the trigger's own stop (backwards-compatible)
}

export const GRAMMAR = {
  trigger: ["sweep", "fvg", "orderblock", "breakout", "pullback", "engulfing", "pinbar", "rsi", "delivery", "inside", "channel", "nbar", "ssweep", "nr7", "star", "soldiers", "choch"] as TriggerClass[],
  emaPeriod: [20, 30, 50],
  trendMode: ["with", "against", "none"] as TrendMode[],
  stopLookback: [3, 5, 10],
  rr: [0.5, 1, 1.5, 2, 3],
  session: ["all", "asia", "london", "ny"] as Session[],
  stopMode: ["swing", "atr2", "atr6", "atr12", "wide100"] as StopMode[],
};

/** Cartesian product of the grammar → every distinct strategy. |GRAMMAR| = 17·3·3·3·5·4·5 = 45,900. */
export function enumerate(g = GRAMMAR): ComponentSpec[] {
  const out: ComponentSpec[] = [];
  const modes = g.stopMode ?? (["swing"] as StopMode[]);
  for (const trigger of g.trigger) for (const stopMode of modes) for (const emaPeriod of g.emaPeriod) for (const trendMode of g.trendMode) for (const stopLookback of g.stopLookback) for (const rr of g.rr) for (const session of g.session) out.push({ trigger, emaPeriod, trendMode, stopLookback, rr, session, stopMode });
  return out;
}
/** Stable identity of a spec. A swing-mode (or stopMode-absent) spec keys EXACTLY as it did before D-305, so
 * every already-scored spec_key in trd_edge_queue stays valid. */
export function specKey(s: ComponentSpec): string {
  const base = `${s.trigger}|ema${s.emaPeriod}|${s.trendMode}|sl${s.stopLookback}|rr${s.rr}|${s.session}`;
  return !s.stopMode || s.stopMode === "swing" ? base : `${base}|${s.stopMode}`;
}

function sessionOf(hUtc: number): Session { return hUtc < 7 ? "asia" : hUtc < 13 ? "london" : hUtc < 21 ? "ny" : "asia"; }

// The high/low of the immediately-PRIOR session block before bar i (skip bar i's own session, then aggregate the
// contiguous run of the previous session). Point-in-time: reads only bars strictly before i. Null if too thin.
function priorSessionRange(bars: Bar[], i: number): { hi: number; lo: number } | null {
  const sOf = (k: number) => sessionOf(new Date(bars[k].ts).getUTCHours());
  const cur = sOf(i); let j = i - 1;
  while (j >= 0 && sOf(j) === cur) j--;            // skip bar i's own (still-forming) session
  if (j < 0) return null;
  const prev = sOf(j); let hi = -Infinity, lo = Infinity, cnt = 0;
  while (j >= 0 && sOf(j) === prev) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; cnt++; j--; }
  return cnt >= 2 ? { hi, lo } : null;
}

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
    case "nr7": { // NR7 volatility compression: the PRIOR bar's range is the narrowest of the last 7 bars, then THIS
      // bar breaks that bar's range → compression-to-expansion. Stop at the NR7 bar's opposite extreme.
      if (i < 8) return null;
      const nb = bars[i - 1], nr = nb.high - nb.low;
      let isNR7 = true;
      for (let j = i - 7; j < i - 1; j++) { if ((bars[j].high - bars[j].low) < nr) { isNR7 = false; break; } }
      if (!isNR7) return null;
      if (b.close > nb.high) return { side: "long", stop: nb.low };
      if (b.close < nb.low) return { side: "short", stop: nb.high };
      return null;
    }
    case "star": { // morning/evening star — the canonical 3-candle reversal (ingest id=11, web:strike.money).
      // Morning star (LONG): bar i-2 is a large DOWN body, bar i-1 is a SMALL body (indecision — the "star"),
      // bar i is an UP candle that closes back above the MIDPOINT of bar i-2's body (the reversal is confirmed
      // by the close, not by a wick). Evening star is the exact mirror. Point-in-time: only closed bars ≤ i.
      // Stop at the far extreme of the 3-candle formation. Degenerate (zero-body i-2) can never fire because
      // body1 >= 0 is never < 0.5*0.
      const b2 = bars[i - 2], b1 = bars[i - 1];
      const body2 = Math.abs(b2.close - b2.open), body1 = Math.abs(b1.close - b1.open);
      if (!(body1 < 0.5 * body2)) return null;            // the middle bar must be small vs the impulse
      const mid2 = (b2.open + b2.close) / 2;
      if (b2.close < b2.open && b.close > b.open && b.close > mid2) return { side: "long", stop: Math.min(b2.low, b1.low, b.low) };
      if (b2.close > b2.open && b.close < b.open && b.close < mid2) return { side: "short", stop: Math.max(b2.high, b1.high, b.high) };
      return null;
    }
    case "soldiers": { // three white soldiers / three black crows (ingest id=12, web:strike.money) — the canonical
      // 3-candle CONTINUATION pattern, and the direct counterpart to `nbar` (3 same-direction closes then a
      // REVERSAL). Canonical requirements, all evaluated on CLOSED bars ≤ i:
      //   1. bars i-2, i-1, i are all the same colour (three up bodies / three down bodies),
      //   2. closes advance monotonically in that direction (each close beyond the prior close),
      //   3. each body is at least half its own bar's range — "strong" closes, so a doji/long-wick candle
      //      cannot count as a soldier (this is what separates the pattern from any three drifting bars),
      //   4. each candle OPENS inside the prior candle's real body — the classic "staircase" constraint that
      //      excludes gapped runs. Enter in the run's direction, stop at the far extreme of the formation.
      // A zero-range bar cannot pass (3) since body >= 0.5*range is `0 >= 0` — guarded explicitly instead.
      const c2 = bars[i - 2], c1 = bars[i - 1];
      const strong = (x: Bar) => { const rng = x.high - x.low; return rng > 0 && Math.abs(x.close - x.open) >= 0.5 * rng; };
      if (!strong(c2) || !strong(c1) || !strong(b)) return null;
      const up = (x: Bar) => x.close > x.open, dn = (x: Bar) => x.close < x.open;
      const inBody = (x: Bar, p: Bar) => x.open > Math.min(p.open, p.close) && x.open < Math.max(p.open, p.close);
      if (up(c2) && up(c1) && up(b) && c1.close > c2.close && b.close > c1.close && inBody(c1, c2) && inBody(b, c1))
        return { side: "long", stop: Math.min(c2.low, c1.low, b.low) };
      if (dn(c2) && dn(c1) && dn(b) && c1.close < c2.close && b.close < c1.close && inBody(c1, c2) && inBody(b, c1))
        return { side: "short", stop: Math.max(c2.high, c1.high, b.high) };
      return null;
    }
    case "choch": { // Change of Character (ingest id=18, web:ict) — the SMC trend-flip, and the first member of a
      // family the grammar had NO representative of: every other trigger reads CANDLES (star/soldiers/engulfing/
      // pinbar) or a ROLLING WINDOW (breakout/channel/delivery/nr7). This one reads MARKET STRUCTURE — the
      // sequence of confirmed swing pivots.
      // Point-in-time by construction: a fractal pivot at bar k needs L bars on EITHER side, so it is not KNOWN
      // until bar k+L. We only accept pivots with k+L <= i, so nothing after the current closed bar is used.
      //   structure DOWN = the last two swing highs are falling AND the last two swing lows are falling
      //   (lower-high + lower-low). A close ABOVE the most recent swing high is then the FIRST counter-trend
      //   break — the character of the market has changed. Enter long, stop at the most recent swing low.
      // What separates this from `breakout`/`channel` (and from raw BOS, which is why BOS is NOT worth its own
      // trigger) is the PRECONDITION: those fire on any range break in any context; this fires ONLY when the
      // break reverses an established structure. The negative controls in the test pin exactly that difference.
      const L = 2, MAXBACK = 300;
      const hiP: number[] = [], loP: number[] = [];
      for (let k = i - L; k >= L && k >= i - MAXBACK && (hiP.length < 2 || loP.length < 2); k--) {
        let isHi = true, isLo = true;
        for (let j = 1; j <= L; j++) {
          if (!(bars[k].high > bars[k - j].high && bars[k].high > bars[k + j].high)) isHi = false;
          if (!(bars[k].low < bars[k - j].low && bars[k].low < bars[k + j].low)) isLo = false;
        }
        if (isHi && hiP.length < 2) hiP.push(bars[k].high);
        if (isLo && loP.length < 2) loP.push(bars[k].low);
      }
      if (hiP.length < 2 || loP.length < 2) return null; // structure undefined → no trade (fail closed)
      const structUp = hiP[0] > hiP[1] && loP[0] > loP[1];
      const structDown = hiP[0] < hiP[1] && loP[0] < loP[1];
      if (structDown && b.close > hiP[0]) return { side: "long", stop: loP[0] };
      if (structUp && b.close < loP[0]) return { side: "short", stop: hiP[0] };
      return null;
    }
    case "ssweep": { // session-range sweep: price wicks BEYOND the prior session's high/low (running the stops resting
      // there) then closes back inside → fade the sweep. The Asia-range-swept-in-London / London-swept-in-NY pattern.
      const pr = priorSessionRange(bars, i); if (!pr) return null;
      if (b.high > pr.hi && b.close < pr.hi) return { side: "short", stop: b.high };
      if (b.low < pr.lo && b.close > pr.lo) return { side: "long", stop: b.low };
      return null;
    }
    case "nbar": { // N-consecutive-close reversal: 3 down-closes then an up-close = exhaustion reversal LONG (and
      // mirror for short). "down" = close below the prior close. Stop at the stopLookback swing. A mean-reversion primitive.
      const N = 3; if (i < N + 1) return null;
      let downs = 0, ups = 0;
      for (let k = i - N; k < i; k++) { if (bars[k].close < bars[k - 1].close) downs++; else if (bars[k].close > bars[k - 1].close) ups++; }
      const curUp = b.close > bars[i - 1].close, curDown = b.close < bars[i - 1].close;
      if (downs === N && curUp) return { side: "long", stop: lo };
      if (ups === N && curDown) return { side: "short", stop: hi };
      return null;
    }
    case "channel": { // Donchian/Turtle: break of the prior 20-bar high/low channel (a longer, FIXED lookback than
      // the generic breakout's stopLookback range), stop at the stopLookback swing. The classic trend-capture entry.
      const CH = 20; if (i < CH) return null;
      let ch = -Infinity, cl = Infinity;
      for (let j = i - CH; j < i; j++) { if (bars[j].high > ch) ch = bars[j].high; if (bars[j].low < cl) cl = bars[j].low; }
      if (b.close > ch) return { side: "long", stop: lo };
      if (b.close < cl) return { side: "short", stop: hi };
      return null;
    }
    case "inside": { // inside-bar breakout: bar i-1 fully inside the "mother" bar i-2 (a volatility contraction),
      // then bar i CLOSES beyond the mother's range → trade the expansion, stop at the mother's far side.
      if (i < 2) return null;
      const mother = bars[i - 2], insideBar = bars[i - 1];
      const isInside = insideBar.high <= mother.high && insideBar.low >= mother.low;
      if (!isInside) return null;
      if (b.close > mother.high) return { side: "long", stop: mother.low };
      if (b.close < mother.low) return { side: "short", stop: mother.high };
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

// D-310: these caches are keyed on the bars ARRAY ITSELF (WeakMap identity), never on a string derived from
// bars.length. The old key was `${bars.length}:${period}`, and every market in trd_bars_cache holds EXACTLY
// 35,040 bars (a fixed 1-year 15m window, not "whatever history exists"), so all 16 markets collided on one
// key. Edge-function isolates are reused across requests and each request scores a DIFFERENT market, so the
// first market to warm the isolate donated its EMA/RSI series to every market after it. Measured, both
// directions: a market whose own RSI yields 0 trades produced 10 fabricated ones, and a `pullback` market
// whose own EMA yields 36 trades produced 0. WeakMap identity is exact (the factory reuses one array object
// per market, so the hit-rate is unchanged) and cannot collide. A length-keyed cache must never come back.
let _rsiCache = new WeakMap<Bar[], Map<number, number[]>>();
function triggerSignal_rsi(bars: Bar[], i: number, period: number): number | null {
  if (i < period) return null;
  let per = _rsiCache.get(bars); if (!per) { per = new Map(); _rsiCache.set(bars, per); }
  let arr = per.get(period);
  if (!arr) {
    arr = new Array(bars.length).fill(NaN); let gain = 0, loss = 0;
    for (let k = 1; k <= period; k++) { const d = bars[k].close - bars[k - 1].close; if (d >= 0) gain += d; else loss -= d; }
    let ag = gain / period, al = loss / period; arr[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let k = period + 1; k < bars.length; k++) { const d = bars[k].close - bars[k - 1].close; const g = d > 0 ? d : 0, l = d < 0 ? -d : 0; ag = (ag * (period - 1) + g) / period; al = (al * (period - 1) + l) / period; arr[k] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    per.set(period, arr);
  }
  const v = arr[i]; return Number.isFinite(v) ? v : null;
}
// EMA-at-i helper. Identity-keyed for the same reason as the RSI cache above (D-310).
let _emaCache = new WeakMap<Bar[], Map<number, number[]>>();
function triggerSignal_ema(bars: Bar[], i: number, period: number): number {
  let per = _emaCache.get(bars); if (!per) { per = new Map(); _emaCache.set(bars, per); }
  let arr = per.get(period);
  if (!arr) { arr = ema(bars.map((x) => x.close), period); per.set(period, arr); }
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
// `riskFrac` = |entry − stop| / entry, i.e. how big 1R is as a FRACTION of notional. It is what converts a
// broker fee quoted in bps-of-notional into R units: costR_per_side = (feeBps/1e4) / riskFrac. A tight stop
// (small riskFrac) makes the SAME fee cost far more R. The grammar's flat `costRPerSide` cannot express that,
// so stage-2 validation re-costs trades honestly from this field (D-303).
export interface CTrade { r: number; riskFrac: number; exitIdx: number; entryTs: string; exitTs: string; side: "long" | "short"; trend: TrendState; vol: VolState; session: Session; }

// True-range → ATR series (Wilder), for the volatility-regime tag.
function atrSeries(bars: Bar[], period = 14): number[] {
  const tr: number[] = [0];
  for (let i = 1; i < bars.length; i++) { const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close; tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
  const out = new Array(bars.length).fill(0); let a = 0;
  for (let i = 1; i < bars.length; i++) { a = i <= period ? (a * (i - 1) + tr[i]) / i : (a * (period - 1) + tr[i]) / period; out[i] = a; }
  return out;
}
function median(xs: number[]): number { const s = [...xs].filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; }
export function atr14(bars: Bar[]): number[] { return atrSeries(bars, 14); }

// Tradeability floor on 1R as a fraction of notional (D-305). A degenerate swing range can put the stop a
// rounding error from entry; costR = (feeBps/1e4)/riskFrac then explodes to HUNDREDS of R, and a single such
// trade drags a mean to −1,228R (observed in trd_edge_queue). Such a "trade" is not real — a 2bp stop is
// inside the spread on 15m crypto. Scorers drop trades below this floor from the setup AND control legs
// symmetrically, so the filter cannot bias one side. It lives here (not in runComponentTrades) so the trade
// GENERATOR stays byte-identical for the 62k already-scored swing specs.
export const MIN_RISK_FRAC = 2e-4;

/** The protective stop for a chosen geometry. Point-in-time: ATR(14) at the SIGNAL bar, or the swing extreme
 * strictly BEFORE it, applied to the next bar's fill price. Returns null when the mode's history requirement
 * isn't met → the caller drops the signal rather than silently narrowing it.
 * SHARED by the setup leg and the matched-random control so their stop mechanics can never diverge — an
 * unmatched control is precisely the D-146 false-positive engine that ANALYSIS_CONTRACT Rule 7 exists to stop. */
export function stopForMode(bars: Bar[], sigIdx: number, side: "long" | "short", entry: number, triggerStop: number, mode: StopMode, atr: number[]): number | null {
  if (mode === "swing") return triggerStop;
  const dir = side === "long" ? 1 : -1;
  const mult = STOP_MODE_ATR[mode];
  if (mult !== null) { const a = atr[sigIdx]; return a > 0 ? entry - dir * mult * a : null; }
  if (sigIdx < WIDE_LOOKBACK) return null;
  let wHi = -Infinity, wLo = Infinity;
  for (let j = sigIdx - WIDE_LOOKBACK; j < sigIdx; j++) { if (bars[j].high > wHi) wHi = bars[j].high; if (bars[j].low < wLo) wLo = bars[j].low; }
  return side === "long" ? Math.min(wLo, triggerStop) : Math.max(wHi, triggerStop);
}

/** Core: run one composed strategy → trades with R, exit index, and the entry REGIME (trend/vol/
 * session) so callers can find WHEN the strategy works. Pure, no look-ahead. */
export function runComponentTrades(bars: Bar[], s: ComponentSpec, cfg: GrammarCfg): CTrade[] {
  const n = bars.length; if (n < s.emaPeriod + 10) return [];
  const e = ema(bars.map((b) => b.close), s.emaPeriod);
  const atr = atrSeries(bars, 14); const atrMed = median(atr);
  const out: CTrade[] = [];
  let open: { side: "long" | "short"; entry: number; stop: number; target: number; riskFrac: number; entryTs: string; trend: TrendState; vol: VolState; session: Session } | null = null;
  let queued: (Sig & { sigIdx: number }) | null = null; // signal fired on prior bar → enter at this bar's open
  const resolveStop = (q: { side: "long" | "short"; stop: number; sigIdx: number }, entry: number): number | null =>
    stopForMode(bars, q.sigIdx, q.side, entry, q.stop, s.stopMode ?? "swing", atr);
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    if (open) { // resolve open (stop-first, pessimistic)
      let exit: number | null = null;
      if (open.side === "long") { if (bar.low <= open.stop) exit = open.stop; else if (bar.high >= open.target) exit = open.target; }
      else { if (bar.high >= open.stop) exit = open.stop; else if (bar.low <= open.target) exit = open.target; }
      if (exit !== null) { const dir = open.side === "long" ? 1 : -1; const risk = Math.abs(open.entry - open.stop); const grossR = risk > 0 ? (exit - open.entry) * dir / risk : 0; out.push({ r: grossR - 2 * cfg.costRPerSide, riskFrac: open.riskFrac, exitIdx: i, entryTs: open.entryTs, exitTs: bar.ts, side: open.side, trend: open.trend, vol: open.vol, session: open.session }); open = null; }
    }
    if (!open && queued) { // fill queued entry at this bar's open
      const entry = bar.open, dir = queued.side === "long" ? 1 : -1;
      const stopPx = resolveStop(queued, entry);
      const risk = stopPx === null ? 0 : Math.abs(entry - stopPx);
      if (stopPx !== null && risk > 0 && ((queued.side === "long" && stopPx < entry) || (queued.side === "short" && stopPx > entry))) {
        const slope = i > 10 ? (e[i] - e[i - 10]) / (e[i - 10] || 1) : 0;
        const trend: TrendState = slope > 0.001 ? "up" : slope < -0.001 ? "down" : "flat";
        const vol: VolState = atr[i] >= atrMed ? "hi" : "lo";
        open = { side: queued.side, entry, stop: stopPx, target: entry + dir * s.rr * risk, riskFrac: entry > 0 ? risk / entry : 0, entryTs: bar.ts, trend, vol, session: sessionOf(new Date(bar.ts).getUTCHours()) };
      }
      queued = null;
    }
    if (!open && !queued) { // new signal on this closed bar
      if (s.session !== "all" && sessionOf(new Date(bar.ts).getUTCHours()) !== s.session) continue;
      const sig = triggerSignal(bars, i, s);
      if (sig && passesTrend(sig.side, bar.close, e[i], s.trendMode)) queued = { ...sig, sigIdx: i };
    }
  }
  return out;
}
/** Convenience: per-trade R multiples (net of cost). */
export function runComponent(bars: Bar[], s: ComponentSpec, cfg: GrammarCfg): number[] {
  return runComponentTrades(bars, s, cfg).map((t) => t.r);
}

/** Drops every memoized indicator series. With identity keying (D-310) this is no longer required for
 * CORRECTNESS — it exists so a test can force a cold recompute. Nothing in the live path calls it, and
 * nothing needs to: two different markets are two different array objects. */
export function clearEmaCache() { _emaCache = new WeakMap(); _rsiCache = new WeakMap(); }
