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
export type TriggerClass = "sweep" | "fvg" | "orderblock" | "breakout" | "pullback" | "engulfing" | "pinbar" | "rsi" | "delivery" | "inside" | "channel" | "nbar" | "ssweep" | "nr7" | "star" | "soldiers" | "choch" | "supertrend" | "squeeze" | "rsidiv" | "stoch" | "macd";
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
  trigger: ["sweep", "fvg", "orderblock", "breakout", "pullback", "engulfing", "pinbar", "rsi", "delivery", "inside", "channel", "nbar", "ssweep", "nr7", "star", "soldiers", "choch", "supertrend", "squeeze", "rsidiv", "stoch", "macd"] as TriggerClass[],
  emaPeriod: [20, 30, 50],
  trendMode: ["with", "against", "none"] as TrendMode[],
  stopLookback: [3, 5, 10],
  rr: [0.5, 1, 1.5, 2, 3],
  session: ["all", "asia", "london", "ny"] as Session[],
  stopMode: ["swing", "atr2", "atr6", "atr12", "wide100"] as StopMode[],
};

/** Cartesian product of the grammar → every distinct strategy. |GRAMMAR| = 22·3·3·3·5·4·5 = 59,400. */
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
    case "supertrend": { // Supertrend flip (ingest id=20, web:supertrend) — the 18th primitive, and the first whose
      // SIGNAL is volatility-normalised. Every other trigger reads raw price geometry (candles, windows, pivots) or
      // a bounded oscillator; ATR appears in the grammar only as STOP geometry (D-305), never as a condition for
      // entry. Supertrend is an ATR-band trailing-trend state machine: bands sit ±(ST_MULT × ATR) around the bar
      // midpoint, ratchet only in the trend's favour, and the state FLIPS when a close breaches the far band. The
      // trade is the flip itself. Because the breach must clear 3×ATR, the setup fires only on moves that are large
      // RELATIVE TO CURRENT VOLATILITY — which is precisely the axis D-303 named as binding (a trigger whose stop
      // is ATR-scaled by construction carries a riskFrac that can pay its fees, unlike a 3-bar swing stop).
      // Point-in-time: the recursion at bar k reads only bars k and k-1, so the series is causal and reading it at
      // i uses nothing after i. Memoised identity-keyed (WeakMap) for the D-310 reason — never by bars.length.
      const st = supertrendSeries(bars);
      if (i <= st.warm) return null;                       // seed bar + warmup: the initial state is arbitrary
      const d = st.dir[i], dPrev = st.dir[i - 1];
      if (d === 0 || dPrev === 0 || d === dPrev) return null;
      // Stop at the ACTIVE band on the flip bar — the canonical Supertrend trailing stop, on the far side of entry.
      if (d === 1) return { side: "long", stop: st.lo[i] };
      return { side: "short", stop: st.up[i] };
    }
    case "squeeze": { // Bollinger-in-Keltner squeeze RELEASE (ingest id=21, web:chartink) — the 19th primitive, and
      // the first whose condition is a RATIO of two volatility measures rather than a level, a shape, or a range.
      // BB half-width = 2·stdev(close, 20) measures CLOSE-TO-CLOSE dispersion (where price actually settled);
      // KC half-width = 1.5·ATR(20) measures INTRABAR true range (how far it travelled to get there). "Squeeze on"
      // = the Bollinger band sits entirely INSIDE the Keltner channel, i.e. closes are agreeing while the bars are
      // still travelling — the market is churning, not going anywhere. The trade is the RELEASE bar: the first bar
      // on which the band escapes the channel. Direction from the close vs the 20-bar basis; stop at the OPPOSITE
      // Keltner band, so 1R is ATR-scaled by construction (the D-303 riskFrac argument that also motivated
      // `supertrend`).
      // Why this is not a duplicate of `nr7`/`inside`/`delivery`: all three of those measure ABSOLUTE range
      // compression over 2–20 bars. This measures a RATIO, so it is blind to scale and can disagree with them in
      // both directions — a prelude of tiny bars with steadily marching closes is maximally "compressed" to them
      // and NOT squeezed here (negative control A pins exactly that), while wide-ranging bars that keep closing at
      // the same price are squeezed here and unremarkable to them.
      // Point-in-time: the series at bar k reads only the 20 closes/ranges ending at k, so reading it at i uses
      // nothing after i. Memoised identity-keyed (WeakMap), never by bars.length (D-310).
      const sq = squeezeSeries(bars);
      if (i < SQ_WARM + 1) return null;                  // need on[i-1] to be defined too
      if (!(sq.on[i - 1] === 1 && sq.on[i] === 0)) return null; // the RELEASE bar, not the squeezed state
      if (b.close > sq.mid[i]) return { side: "long", stop: sq.kcLo[i] };
      if (b.close < sq.mid[i]) return { side: "short", stop: sq.kcUp[i] };
      return null;                                        // close exactly on the basis → no direction (fails closed)
    }
    case "rsidiv": { // RSI divergence (ingest id=25, web:tradersagency) — the 20th primitive, and the first whose
      // condition is a DISAGREEMENT BETWEEN TWO SERIES rather than a property of one. Every existing trigger reads
      // price geometry (candles, rolling windows, pivots) or an indicator taken ALONE: `rsi` fires on a LEVEL
      // cross, `supertrend` on a STATE flip, `squeeze` on a RATIO of two volatility measures of the same bars.
      // None compares the SHAPE of price against the SHAPE of momentum. Bullish divergence = price prints a LOWER
      // swing low while RSI prints a HIGHER low at that swing — the market reached a new extreme with less force
      // behind it. Bearish is the exact mirror. It is emphatically NOT a re-skin of `rsi`: RSI can be at any level
      // here (no 30/70 threshold is read at all), and `rsi` fires on absolute momentum regardless of what price
      // structure is doing.
      // Point-in-time by construction, and this is also what fixes the entry timing with NO free parameter: a
      // fractal pivot at bar k is not KNOWABLE until bar k+L, so the trigger may fire on exactly one bar — the
      // confirmation bar of the most recent pivot (k0 = i-L), which is the first instant at which the divergence
      // exists as information. Nothing repaints and there is no "wait for a confirmation candle" knob to tune.
      // Compared against the NEAREST prior pivot of the same kind ONLY. Scanning back for the best-matching pivot
      // would be a per-bar optimisation the trial counter cannot see — cherry-picking hidden inside the detector.
      const L = 2, MAXBACK = 300, RP = 14;
      const k0 = i - L; if (k0 < L + 1) return null;
      const pivLo = (k: number) => { for (let j = 1; j <= L; j++) if (!(bars[k].low < bars[k - j].low && bars[k].low < bars[k + j].low)) return false; return true; };
      const pivHi = (k: number) => { for (let j = 1; j <= L; j++) if (!(bars[k].high > bars[k - j].high && bars[k].high > bars[k + j].high)) return false; return true; };
      const isLo = pivLo(k0), isHi = pivHi(k0);
      if (!isLo && !isHi) return null;                      // this bar confirms no pivot → nothing is knowable yet
      const r0 = triggerSignal_rsi(bars, k0, RP); if (r0 === null) return null; // RSI not warm → fail closed
      for (let k = k0 - 1; k >= L && k >= k0 - MAXBACK; k--) {
        if (isLo && pivLo(k)) {
          const r1 = triggerSignal_rsi(bars, k, RP); if (r1 === null) return null;
          return bars[k0].low < bars[k].low && r0 > r1 ? { side: "long", stop: bars[k0].low } : null;
        }
        if (isHi && pivHi(k)) {
          const r1 = triggerSignal_rsi(bars, k, RP); if (r1 === null) return null;
          return bars[k0].high > bars[k].high && r0 < r1 ? { side: "short", stop: bars[k0].high } : null;
        }
      }
      return null;                                          // no prior pivot to diverge FROM → fail closed
    }
    case "stoch": { // Stochastic %K/%D cross out of oversold/overbought (ingest id=24, web:tradersagency) — the 21st
      // primitive, and the first whose condition is a POSITION-WITHIN-RANGE normalisation: %K asks "where in the
      // last 14 bars' HIGH–LOW band did this bar close", a quantity no existing trigger computes. The distinction
      // from `rsi` is not cosmetic and is exactly what the negative controls pin: RSI normalises the SIZE of
      // close-to-close moves (up magnitude vs down magnitude) and is blind to where the bar sits in its range,
      // while %K normalises POSITION and is blind to how the price got there. A market that grinds lower in small
      // steps but keeps closing at the top of a collapsing range is deeply oversold on RSI and near 100 on %K.
      // The trade is the momentum HANDOVER: %K crossing its own 3-bar average (%D) while still leaving the
      // oversold zone (long) / overbought zone (short). Stop at the stopLookback swing, as `rsi` does.
      // Canonical 14/3/3 held FIXED for the same reason as Supertrend's 10/3 and the squeeze's 20/2/1.5 — the
      // grammar already varies five axes, and freeing the periods would multiply the trial count (deflating every
      // other candidate's DSR) for constants the source states as fixed.
      // Point-in-time: %K at bar k reads only the 14 bars ending at k, %D only the 3 %K values ending at k, so
      // reading either at i uses nothing after i. Memoised identity-keyed (WeakMap), never by bars.length (D-310).
      const so = stochSeries(bars);
      if (i < STO_WARM + 1) return null;                    // need K[i-1]/D[i-1] defined as well as K[i]/D[i]
      const k0 = so.k[i], d0 = so.d[i], k1 = so.k[i - 1], d1 = so.d[i - 1];
      if (!(Number.isFinite(k0) && Number.isFinite(d0) && Number.isFinite(k1) && Number.isFinite(d1))) return null;
      if (k1 <= d1 && k0 > d0 && k1 < STO_OS) return { side: "long", stop: lo };   // cross UP, out of oversold
      if (k1 >= d1 && k0 < d0 && k1 > STO_OB) return { side: "short", stop: hi };  // cross DOWN, out of overbought
      return null;
    }
    case "macd": { // MACD signal-line cross (ingest id=23, web:tradersagency) — the 22nd primitive, and the first
      // whose condition is a SECOND-ORDER quantity. Every other trigger reads a FIRST-ORDER property of the
      // series: price geometry (candles, windows, pivots), an indicator's LEVEL (`rsi`), its STATE (`supertrend`),
      // its POSITION in a range (`stoch`), a RATIO of two volatility measures of the same bars (`squeeze`), or a
      // disagreement between price shape and momentum shape (`rsidiv`). The MACD line is none of those: it is the
      // SPREAD BETWEEN TWO TREND ESTIMATES OF DIFFERENT SPEEDS (EMA12 − EMA26), i.e. how fast trend is separating
      // from itself, and the trade is that spread crossing its OWN 9-bar average — the spread turning, not the
      // price turning.
      // The distinction from `pullback` (the only other EMA-reading trigger) is exactly what the negative control
      // pins, and it is not cosmetic: `pullback` reads a LEVEL RELATION between price and ONE EMA, so it can only
      // fire when price is AT that EMA. `macd` can fire a SHORT while price is above every moving average on the
      // chart — a still-rising but DECELERATING advance, where fast and slow EMAs are converging even though
      // neither has been touched. No price-geometry trigger and no single-MA relation can express that bar.
      // Canonical 12/26/9 on closes, held FIXED for the same reason as Supertrend's 10/3, the squeeze's 20/2/1.5
      // and the stochastic's 14/3/3: the grammar already varies five axes, and freeing the periods would multiply
      // the trial count (deflating every other candidate's DSR) for constants the source states as fixed.
      // Point-in-time: an EMA at bar k reads only bars ≤ k, and the signal EMA only MACD values ≤ k, so reading
      // either at i uses nothing after i. Memoised identity-keyed (WeakMap), never by bars.length (D-310).
      const m = macdSeries(bars);
      if (i < MACD_WARM + 1) return null;                   // need line/sig at i-1 as well as at i
      const m0 = m.line[i], s0 = m.sig[i], m1 = m.line[i - 1], s1 = m.sig[i - 1];
      if (!(Number.isFinite(m0) && Number.isFinite(s0) && Number.isFinite(m1) && Number.isFinite(s1))) return null;
      if (m1 <= s1 && m0 > s0) return { side: "long", stop: lo };   // spread turns UP through its own average
      if (m1 >= s1 && m0 < s0) return { side: "short", stop: hi };  // spread turns DOWN through its own average
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
// Supertrend state machine (D-312). Fixed canonical parameters — the grammar already varies five other axes, and
// making the ATR period/multiplier free would multiply the trial count (and deflate every other candidate's DSR)
// for a parameter the source describes as fixed at 10/3.
const ST_PERIOD = 10, ST_MULT = 3;
interface STSeries { dir: Int8Array; up: Float64Array; lo: Float64Array; warm: number }
let _stCache = new WeakMap<Bar[], STSeries>();
/** Causal Supertrend: bar k reads only bars k and k-1, so `dir[i]` is knowable at the close of bar i.
 * `warm` is the last index whose state must be ignored — the direction has to be SEEDED at the first bar with a
 * valid ATR, and that seed is an assumption, not a measurement. Suppressing ST_PERIOD bars past the seed means the
 * first reported flip is always produced by the recursion itself, never by the arbitrary initial value. */
function supertrendSeries(bars: Bar[]): STSeries {
  const hit = _stCache.get(bars); if (hit) return hit;
  const n = bars.length, atr = atrSeries(bars, ST_PERIOD);
  const up = new Float64Array(n), lo = new Float64Array(n), dir = new Int8Array(n);
  let fu = NaN, fl = NaN, d: 0 | 1 | -1 = 0, warm = n; // warm = n → no valid state at all unless seeded below
  for (let i = 1; i < n; i++) {
    const a = atr[i];
    if (i <= ST_PERIOD || !(a > 0)) continue;             // dir stays 0 = "state undefined" (fails closed)
    const mid = (bars[i].high + bars[i].low) / 2, pc = bars[i - 1].close;
    const bu = mid + ST_MULT * a, bl = mid - ST_MULT * a;
    fu = !Number.isFinite(fu) || bu < fu || pc > fu ? bu : fu; // upper ratchets DOWN while price stays below it
    fl = !Number.isFinite(fl) || bl > fl || pc < fl ? bl : fl; // lower ratchets UP while price stays above it
    const c = bars[i].close;
    if (d === 0) { d = c >= mid ? 1 : -1; warm = i + ST_PERIOD; } // the seed (assumption), then quarantine it
    else if (d === 1 && c < fl) d = -1;
    else if (d === -1 && c > fu) d = 1;
    up[i] = fu; lo[i] = fl; dir[i] = d;
  }
  const s: STSeries = { dir, up, lo, warm };
  _stCache.set(bars, s); return s;
}

// Bollinger-in-Keltner squeeze state (D-313). Canonical TTM-squeeze parameters, held FIXED for the same reason
// as Supertrend's 10/3: the grammar already varies five axes, and freeing the band parameters would multiply the
// trial count (deflating every other candidate's DSR) for constants the sources state as fixed.
const SQ_PERIOD = 20, SQ_BB_MULT = 2, SQ_KC_MULT = 1.5;
// First index whose state is a MEASUREMENT rather than a warmup artefact: the close window must be full
// (SQ_PERIOD bars) AND the Wilder ATR must have run a full period past its simple-average ramp-in.
const SQ_WARM = 2 * SQ_PERIOD - 1;
interface SQSeries { on: Int8Array; mid: Float64Array; kcUp: Float64Array; kcLo: Float64Array }
let _sqCache = new WeakMap<Bar[], SQSeries>();
/** Causal squeeze state: `on[i]` reads only the 20 closes and true ranges ending at bar i. `on[i] = -1` means
 * "undefined" (inside warmup) and can never satisfy the release test, so the trigger fails closed. */
function squeezeSeries(bars: Bar[]): SQSeries {
  const hit = _sqCache.get(bars); if (hit) return hit;
  const n = bars.length, atr = atrSeries(bars, SQ_PERIOD);
  const on = new Int8Array(n).fill(-1), mid = new Float64Array(n), kcUp = new Float64Array(n), kcLo = new Float64Array(n);
  for (let i = SQ_WARM; i < n; i++) {
    let sum = 0; for (let k = i - SQ_PERIOD + 1; k <= i; k++) sum += bars[k].close;
    const m = sum / SQ_PERIOD;
    let ss = 0; for (let k = i - SQ_PERIOD + 1; k <= i; k++) { const d = bars[k].close - m; ss += d * d; }
    const sd = Math.sqrt(ss / SQ_PERIOD);                 // population stdev — the canonical Bollinger definition
    const a = atr[i]; if (!(a > 0)) continue;             // no volatility measure → state stays undefined
    const bbHalf = SQ_BB_MULT * sd, kcHalf = SQ_KC_MULT * a;
    mid[i] = m; kcUp[i] = m + kcHalf; kcLo[i] = m - kcHalf;
    on[i] = bbHalf <= kcHalf ? 1 : 0;                     // BB fully inside KC (bands share the basis `m`)
  }
  const s: SQSeries = { on, mid, kcUp, kcLo };
  _sqCache.set(bars, s); return s;
}

// Slow-stochastic series (D-316). Canonical 14/3/3 with the 20/80 zones, held FIXED — see the `stoch` case.
const STO_N = 14, STO_K = 3, STO_D = 3, STO_OS = 20, STO_OB = 80;
// First index whose %D is a MEASUREMENT rather than a warmup artefact: raw %K needs STO_N bars, the smoothed %K
// needs STO_K of those, and %D needs STO_D of those.
const STO_WARM = (STO_N - 1) + (STO_K - 1) + (STO_D - 1); // = 17
interface STOSeries { k: Float64Array; d: Float64Array }
let _stoCache = new WeakMap<Bar[], STOSeries>();
/** Causal slow stochastic. A FLAT window (highest high === lowest low) leaves raw %K undefined rather than
 * inventing a 0/0 value, and that NaN propagates through both averages, so the trigger fails closed on a
 * market with no range instead of firing on a division artefact. */
function stochSeries(bars: Bar[]): STOSeries {
  const hit = _stoCache.get(bars); if (hit) return hit;
  const n = bars.length;
  const raw = new Float64Array(n).fill(NaN), k = new Float64Array(n).fill(NaN), d = new Float64Array(n).fill(NaN);
  for (let i = STO_N - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - STO_N + 1; j <= i; j++) { if (bars[j].high > hh) hh = bars[j].high; if (bars[j].low < ll) ll = bars[j].low; }
    if (hh > ll) raw[i] = 100 * (bars[i].close - ll) / (hh - ll);
  }
  const sma = (src: Float64Array, i: number, w: number): number => {
    let s = 0; for (let j = i - w + 1; j <= i; j++) { if (!Number.isFinite(src[j])) return NaN; s += src[j]; }
    return s / w;
  };
  for (let i = STO_N - 1 + (STO_K - 1); i < n; i++) k[i] = sma(raw, i, STO_K);
  for (let i = STO_WARM; i < n; i++) d[i] = sma(k, i, STO_D);
  const s: STOSeries = { k, d };
  _stoCache.set(bars, s); return s;
}

// MACD line + signal (D-317). Canonical 12/26/9 on closes, held FIXED — see the `macd` case.
const MACD_FAST = 12, MACD_SLOW = 26, MACD_SIG = 9;
// `ema()` SEEDS at vals[0], so the earliest values carry the seed rather than the data. The seed's weight decays
// as (1−k)^i with k = 2/(SLOW+1); after 3·SLOW bars it is (24/27)^78 ≈ 0.24%, i.e. below any price resolution we
// measure. Quarantining 3·SLOW + SIG bars means the first reported cross is produced by the data, never by the
// arbitrary starting value — the same discipline as Supertrend's `warm` (D-312).
const MACD_WARM = 3 * MACD_SLOW + MACD_SIG; // = 87
interface MACDSeries { line: Float64Array; sig: Float64Array }
let _macdCache = new WeakMap<Bar[], MACDSeries>();
/** Causal MACD: both EMAs at bar k read only closes ≤ k, and the signal EMA only MACD values ≤ k. */
function macdSeries(bars: Bar[]): MACDSeries {
  const hit = _macdCache.get(bars); if (hit) return hit;
  const n = bars.length, closes = bars.map((b) => b.close);
  const fast = ema(closes, MACD_FAST), slow = ema(closes, MACD_SLOW);
  const raw: number[] = new Array(n);
  for (let i = 0; i < n; i++) raw[i] = fast[i] - slow[i];
  const sig = ema(raw, MACD_SIG);
  const s: MACDSeries = { line: Float64Array.from(raw), sig: Float64Array.from(sig) };
  _macdCache.set(bars, s); return s;
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
export function clearEmaCache() { _emaCache = new WeakMap(); _rsiCache = new WeakMap(); _stCache = new WeakMap(); _sqCache = new WeakMap(); _stoCache = new WeakMap(); _macdCache = new WeakMap(); }
