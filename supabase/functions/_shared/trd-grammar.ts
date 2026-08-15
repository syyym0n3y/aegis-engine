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
export type TriggerClass = "sweep" | "fvg" | "orderblock" | "breakout" | "pullback" | "engulfing" | "pinbar" | "rsi" | "delivery" | "inside" | "channel" | "nbar" | "ssweep" | "nr7" | "star" | "soldiers" | "choch" | "supertrend" | "squeeze" | "rsidiv" | "stoch" | "macd" | "harami" | "doubletop" | "tweezer" | "marubozu" | "aroon" | "psar" | "kumo" | "doji" | "hikkake";
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
  trigger: ["sweep", "fvg", "orderblock", "breakout", "pullback", "engulfing", "pinbar", "rsi", "delivery", "inside", "channel", "nbar", "ssweep", "nr7", "star", "soldiers", "choch", "supertrend", "squeeze", "rsidiv", "stoch", "macd", "harami", "doubletop", "tweezer", "marubozu", "aroon", "psar", "kumo", "doji", "hikkake"] as TriggerClass[],
  emaPeriod: [20, 30, 50],
  trendMode: ["with", "against", "none"] as TrendMode[],
  stopLookback: [3, 5, 10],
  rr: [0.5, 1, 1.5, 2, 3],
  session: ["all", "asia", "london", "ny"] as Session[],
  stopMode: ["swing", "atr2", "atr6", "atr12", "wide100"] as StopMode[],
};

/** Cartesian product of the grammar → every distinct strategy. |GRAMMAR| = 31·3·3·3·5·4·5 = 83,700. */
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
    case "psar": { // Parabolic SAR flip (ingest id=29, web:quantifiedstrategies+cmc) — the 28th primitive, and the
      // first whose condition depends on the ENTIRE PATH since the last regime change rather than on a window.
      // Every other trigger in the grammar is a function of a BOUNDED slice of bars: the candle families read 1–3
      // bars, `channel`/`aroon`/`squeeze`/`stoch`/`rsi` read a fixed N, and even the two recursive ones are
      // effectively windowed — `supertrend`'s bands are ATR(10) plus a ratchet that resets on every flip, and
      // `macd` is a fixed EMA blend. Parabolic SAR carries a state variable with no window at all: the
      // ACCELERATION FACTOR starts at 0.02 and steps up by 0.02 (capped 0.20) EVERY TIME the trend makes a new
      // extreme, so the trail closes on price at a rate set by HOW MANY new extremes the leg printed. Two legs
      // that arrive at the same place having made a different number of new highs put the SAR in different places
      // and therefore flip on different bars. That is a genuinely new kind of information for this grammar: not a
      // shape, not a level, not a ratio, not a recency — a COUNT OF PROGRESS accumulated over an unbounded span.
      // Negative control B in the test pins exactly this: the last 20 bars are byte-identical and only the older
      // path differs, so every windowed trigger sees the same data and only `psar` changes its mind.
      // The trade is the flip itself (this is the "stop and reverse" — the indicator's own semantics), and the
      // stop is the post-flip SAR, i.e. the previous leg's extreme point, which is the canonical SAR stop. It is
      // clamped to the far side of the signal bar so a flip that also printed a new extreme cannot emit a stop on
      // the wrong side of entry (fails closed into a wider, never a narrower, risk).
      // AF0/step/max are held FIXED at Wilder's 0.02/0.02/0.20 — as `supertrend`'s 10/3 and `aroon`'s 14/70/30 are
      // — so this class cannot inflate the trial count with parameters the sources state as constants.
      // Point-in-time: the recursion at bar k reads only bars k, k-1, k-2, so `flip[i]` is knowable at the close of
      // bar i and nothing at or after i+1 is read. Memoised identity-keyed (WeakMap), never by bars.length (D-310).
      const ps = psarSeries(bars);
      if (i <= ps.warm || ps.flip[i] === 0) return null;    // the seed direction is an assumption — quarantine it
      if (ps.flip[i] === 1) return { side: "long", stop: Math.min(ps.sar[i], b.low) };
      return { side: "short", stop: Math.max(ps.sar[i], b.high) };
    }
    case "kumo": { // Ichimoku Kumo breakout (ingest id=28, web:avatrade+oanda) — the 29th primitive, and the first whose
      // reference level is FORWARD-DISPLACED: the cloud standing at bar i was computed at bar i−26 and projected
      // ahead. Every other level in the grammar is derived from a window that ENDS at the signal bar or the one
      // before it — `channel` reads bars i−20…i−1, `breakout` i−lb…i−1, `squeeze`'s bands the last 20, `psar` the
      // live leg. Here bars i−25…i−1 contribute NOTHING to the level being broken: it is stale by construction, a
      // barrier the last 25 bars of price action were structurally unable to move. That is the whole point of the
      // class — a break of a level that recent trading cannot have manufactured, which is a different question from
      // "did price clear where it has just been" and the one negative control A isolates.
      // The second structural difference is what is averaged. Every moving average in the grammar averages CLOSES
      // (`pullback`'s EMA, `macd`'s two EMAs, `squeeze`'s SMA basis, `stoch`'s %D). Tenkan(9), Kijun(26) and Senkou
      // B(52) are MIDPOINTS OF HIGH–LOW RANGES — (HH+LL)/2 — so they are functions of the two extremes only and are
      // completely indifferent to where the other bars closed. `channel` is the only other extremes-only construct
      // and it takes the extreme itself rather than the midpoint of the pair.
      //   Senkou A = (Tenkan + Kijun)/2, Senkou B = (HH52 + LL52)/2, both displaced +26. Cloud top/bottom = max/min.
      // The trade is the CROSSING event: a close above the cloud top when the prior close was not above it (mirror
      // for the short), so it fires once per regime change and not on every bar spent above the cloud. A close
      // INSIDE the cloud is explicitly not a breakout — that is the "no man's land" the sources describe, and
      // control B pins it.
      // Stop at the OPPOSITE edge of the cloud — the canonical Ichimoku invalidation level, and the same mechanic as
      // `squeeze`'s opposite-Keltner stop: 1R is the cloud's own thickness plus the distance travelled, so the risk
      // is scaled by the structure rather than by a 3-bar swing (the D-303 riskFrac argument). It cannot land on the
      // wrong side of entry: a long requires close > top >= bot, so the stop is strictly below the signal close.
      // 9/26/52/26 are held FIXED at their textbook values — as `supertrend`'s 10/3, `macd`'s 12/26/9 and `aroon`'s
      // 14/70/30 are — so this class cannot inflate the trial count with parameters the sources state as constants.
      // Point-in-time: the cloud at index t is written from bar t−26 only, so reading it at i uses data that was
      // knowable 26 bars ago; nothing at or after i+1 is read. `NaN` inside warm-up fails closed (both comparisons
      // are false). Memoised identity-keyed (WeakMap), never by bars.length (D-310).
      const kc = kumoCloud(bars);
      if (i < KUMO_WARM + 1) return null;                  // need the cloud at i AND at i-1 for the crossing test
      const top = kc.top[i], bot = kc.bot[i], topPrev = kc.top[i - 1], botPrev = kc.bot[i - 1];
      const pc = bars[i - 1].close;
      if (b.close > top && pc <= topPrev) return { side: "long", stop: bot };
      if (b.close < bot && pc >= botPrev) return { side: "short", stop: top };
      return null;
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
    case "harami": { // Harami (ingest id=13, web:ig) — the 23rd primitive, and the first whose condition is
      // CONTRACTION OF THE BODY AGAINST THE PRIOR BAR. The grammar already contains both of its near neighbours,
      // and it is the pair of them that shows this is a genuinely different bar:
      //   · `engulfing` is the SAME containment relation with the two bars SWAPPED — there the CURRENT body
      //     swallows the prior one (expansion, and the signal bar is the large one). Here the PRIOR body swallows
      //     the current one (contraction, and the signal bar is the small one). A bar cannot be both.
      //   · `inside` contains the HIGH–LOW RANGE and then requires a CLOSE BEYOND the mother bar — it fires on the
      //     expansion break, one or more bars later, and is blind to candle colour. Harami contains only the
      //     OPEN–CLOSE BODY and fires on the contraction bar itself. The two disagree in both directions: a bar
      //     whose body sits inside the prior body while its wicks spill outside the prior range is a harami and
      //     NOT an inside bar, and a same-colour inside bar (a pause in a trend) is an inside bar and NOT a harami.
      // The read is that a large directional bar was immediately answered by a small OPPOSITE-colour bar that
      // could not extend it — supply/demand met at the extreme rather than the trend simply resting. Direction is
      // the reversal (against the prior bar's colour); stop at the far side of the two-bar pattern, which is the
      // prior bar's own extreme, so 1R scales with the size of the bar being faded.
      // The one free constant is the "small relative to large" ratio, held FIXED at 2× — the same choice made for
      // `pinbar`'s wick and `orderblock`'s impulse — rather than exposed as a grammar axis, so it cannot multiply
      // the trial count and deflate every other candidate's DSR.
      // Point-in-time: reads bars i-1 and i only, both closed. No series, no cache, nothing after i.
      const p = bars[i - 1];
      const body = Math.abs(b.close - b.open), pbody = Math.abs(p.close - p.open);
      if (!(pbody > 0 && pbody >= 2 * body)) return null;         // the prior bar must dominate this one
      const pTop = Math.max(p.open, p.close), pBot = Math.min(p.open, p.close);
      const inside = Math.max(b.open, b.close) <= pTop && Math.min(b.open, b.close) >= pBot;
      if (!inside) return null;                                   // BODY containment, not range containment
      if (p.close < p.open && b.close > b.open) return { side: "long", stop: Math.min(p.low, b.low) };
      if (p.close > p.open && b.close < b.open) return { side: "short", stop: Math.max(p.high, b.high) };
      return null;                                                // same colour, or a flat body → fails closed
    }
    case "doubletop": { // Double top / double bottom (ingest id=22, web:tradingsim) — the 24th primitive, and the
      // first whose SIGNAL LEVEL is neither the current bar's own geometry, an indicator, nor the extreme that
      // DEFINES the pattern. Every other structural trigger enters at the level it just cleared: `breakout` and
      // `channel` break the window extreme, `sweep`/`ssweep` fade the extreme they just wicked, `choch` breaks the
      // most recent swing pivot. Here the two defining extremes (the twin peaks) are never traded at all — the
      // entry is a close through the NECKLINE, the swing low BETWEEN them, which sits below both peaks and earlier
      // in time than one of them. The read is a level that rejected price TWICE, followed by the failure of the
      // support that held between the attempts: the second rejection is what makes the neckline break mean
      // something, and nothing in the grammar can express "twice" — a rejection count is not a shape, a level, a
      // window, a ratio, or a derivative.
      // Why it is not `choch`. Their preconditions are opposite reads of the SAME two swing highs: `choch` requires
      // the highs to be UNEQUAL (a lower high after a higher one = an established down structure) and fires LONG on
      // a close ABOVE the most recent one. This requires the two highs to be EQUAL within a tolerance, and fires
      // SHORT on a close BELOW the low between them. They cannot produce the same trade on the same bar.
      // Why it is not `breakout`. A break of the neckline is a range break, so `breakout` fires on the identical
      // bar with NO precondition at all — the test pins exactly that (negative control A is silent here and
      // produces a trade under `breakout`), so what this trigger contributes is the twice-rejected precondition.
      // The tolerance is the one free constant: the peaks must differ by less than EQ_TOL of the pattern's own
      // HEIGHT (peak − neckline), so the test is scale-free and needs no absolute price unit. It is held FIXED at
      // 0.10 — as `pinbar`'s 2× wick, `orderblock`'s 1.4× impulse and `harami`'s 2× body ratio are — rather than
      // exposed as a grammar axis, so it cannot multiply the trial count and deflate every other candidate's DSR.
      // Choice-free by construction: the pattern is ALWAYS the two most recent confirmed pivots of that kind (no
      // scanning back for the best-fitting pair — that would be a per-bar optimisation the trial counter cannot
      // see), and the neckline is the LOWEST low pivot between them, which is the textbook definition rather than a
      // pick. Only the pivots within KPIV/MAXBACK are considered, so a pattern whose neckline is older than that is
      // simply not detected — it fails closed, never guesses.
      // Point-in-time by construction: a fractal pivot at bar k needs L bars on EITHER side, so it is not knowable
      // until k+L; the scan starts at i−L, so nothing after the current closed bar is read. The break test uses
      // bars[i-1].close, also closed, which makes the entry a CROSSING event — the trigger fires on the bar that
      // takes out the neckline, not on every bar of the decline that follows.
      const L = 2, MAXBACK = 300, KPIV = 3, EQ_TOL = 0.10;
      const hiIdx: number[] = [], loIdx: number[] = [];
      for (let k = i - L; k >= L && k >= i - MAXBACK && (hiIdx.length < KPIV || loIdx.length < KPIV); k--) {
        let isHi = true, isLo = true;
        for (let j = 1; j <= L; j++) {
          if (!(bars[k].high > bars[k - j].high && bars[k].high > bars[k + j].high)) isHi = false;
          if (!(bars[k].low < bars[k - j].low && bars[k].low < bars[k + j].low)) isLo = false;
        }
        if (isHi && hiIdx.length < KPIV) hiIdx.push(k);
        if (isLo && loIdx.length < KPIV) loIdx.push(k);
      }
      if (hiIdx.length >= 2) {                                  // DOUBLE TOP → short the neckline break
        const a = hiIdx[1], z = hiIdx[0];                       // the two most recent swing highs, a earlier than z
        let neck = Infinity;
        for (const k of loIdx) if (k > a && k < z && bars[k].low < neck) neck = bars[k].low; // lowest trough between
        const h0 = bars[z].high, h1 = bars[a].high, peak = Math.max(h0, h1), amp = peak - neck;
        if (Number.isFinite(neck) && amp > 0 && Math.abs(h0 - h1) <= EQ_TOL * amp && bars[i - 1].close >= neck && b.close < neck)
          return { side: "short", stop: peak };
      }
      if (loIdx.length >= 2) {                                  // DOUBLE BOTTOM → the exact mirror
        const a = loIdx[1], z = loIdx[0];
        let neck = -Infinity;
        for (const k of hiIdx) if (k > a && k < z && bars[k].high > neck) neck = bars[k].high; // highest peak between
        const l0 = bars[z].low, l1 = bars[a].low, trough = Math.min(l0, l1), amp = neck - trough;
        if (Number.isFinite(neck) && amp > 0 && Math.abs(l0 - l1) <= EQ_TOL * amp && bars[i - 1].close <= neck && b.close > neck)
          return { side: "long", stop: trough };
      }
      return null;
    }
    case "tweezer": { // Tweezer top/bottom (ingest id=14, web:ig) — the 25th primitive, and the first whose condition is
      // EQUALITY OF AN EXTREME BETWEEN TWO ADJACENT BARS. The grammar already contains one twice-touched condition and
      // several single-bar rejection conditions, and it is the gap between them that this occupies:
      //   · `doubletop` is the other "the level held twice" read, but its two touches are separate swing PIVOTS with a
      //     trough and several bars between them, and — decisively — it does not trade the level at all: the entry is a
      //     close through the NECKLINE, below both peaks and AWAY from the twice-touched high. Here the two touches are
      //     CONSECUTIVE bars with nothing in between, and the entry is at the level itself, on the second touch. The two
      //     cannot fire on the same bar: `doubletop` needs L=2 bars on each side of each pivot, so its second peak is at
      //     least two bars old when it signals, while this requires the second touch to BE the signal bar.
      //   · `pinbar` and `sweep` are the single-bar rejections of a level. Both are satisfied by ONE bar's own geometry
      //     (a long wick; a wick beyond the range that closes back inside) and are blind to whether anything tested the
      //     same price before it. Here neither bar need have a wick at all, and neither need violate the range — what is
      //     required is that the SAME price stopped both of them.
      //   · `engulfing` and `harami` are the two-bar BODY relations (expansion and contraction of the open–close range);
      //     they say nothing about where the highs and lows sit. This is the converse: a constraint on the EXTREMES with
      //     no body-containment requirement in either direction, so a tweezer whose bodies overlap freely is neither.
      // The read is that a single price rejected two consecutive attempts by OPPOSITE sides — a bull bar reached it and
      // the next bar, reaching the same price, closed down — so the level is being defended rather than merely paused at.
      // Direction is the fade (short at a twin high, long at a twin low); the stop is the shared extreme itself, so 1R is
      // the distance to the level that is being defended and the trade dies the moment it stops being defended.
      // Two free constants, both held FIXED — as `pinbar`'s 2× wick, `orderblock`'s 1.4× impulse, `harami`'s 2× body and
      // `doubletop`'s 0.10 tolerance are — so they cannot multiply the trial count and deflate every other candidate's DSR:
      //   EQ_TOL = 0.10 of the two-bar range, which makes "near-equal" scale-free and needs no absolute price unit;
      //   and the pair must be the extreme of the stopLookback window, which is the textbook "at a swing extreme"
      //   qualifier expressed with a window the grammar already varies rather than a new axis.
      // Point-in-time: reads bars i-1 and i plus the already-computed hi/lo of bars[i-lb..i-1], all closed. Nothing after i.
      const EQ_TOL = 0.10;
      const p = bars[i - 1];
      const span = Math.max(p.high, b.high) - Math.min(p.low, b.low);
      if (!(span > 0)) return null;                                    // a two-bar flat spot → fails closed
      const tol = EQ_TOL * span;
      const topLvl = Math.max(p.high, b.high), botLvl = Math.min(p.low, b.low);
      // TWEEZER TOP: near-equal highs, at the top of the window, bull bar answered by a bear bar → fade it short.
      if (Math.abs(b.high - p.high) <= tol && topLvl >= hi && p.close > p.open && b.close < b.open)
        return { side: "short", stop: topLvl };
      // TWEEZER BOTTOM: the exact mirror.
      if (Math.abs(b.low - p.low) <= tol && botLvl <= lo && p.close < p.open && b.close > b.open)
        return { side: "long", stop: botLvl };
      return null;                                                     // same colour, unequal extreme, or mid-range
    }
    case "marubozu": { // Marubozu (ingest id=15, web:strike.money) — the 26th primitive, and the first whose condition is
      // the BODY'S SHARE OF ITS OWN BAR'S RANGE. Every existing single-bar and multi-bar condition sits somewhere else:
      //   · `pinbar` is the exact CONVERSE and the only other trigger reading one bar's internal geometry: it requires a
      //     wick to DOMINATE the body (wick > 2× body) on one side, and reads that as rejection → fade. This requires the
      //     body to dominate and both wicks to vanish, and reads it as acceptance → continue. The two are mutually
      //     exclusive by construction: at body ≥ 0.90 × range the wicks sum to ≤ 0.11 × body, so neither can exceed 2×.
      //   · `soldiers` does carry a body-share term, but at 0.5 and only as an anti-doji qualifier on each of THREE bars
      //     that must also advance monotonically and open inside the prior body. A single strong bar cannot fire it, and
      //     a 0.5-share bar is not a marubozu — the pattern here is the one-bar case its 0.5 floor deliberately admits.
      //   · `engulfing` and `harami` compare one body to the PRIOR body; `nbar` and `soldiers` compare closes across bars.
      //     All are blind to how much of a bar's own range its body occupies. This reads that ratio and nothing else.
      //   · `breakout` conditions the close against a prior RANGE — a location condition. This is a location-free shape
      //     condition: a marubozu mid-range signals exactly as one clearing a high does.
      // The read is that a bar which opened at one extreme and closed at the other never traded against its direction for
      // the whole period — one side had uncontested control of the bar — so the next period is more likely to continue
      // than to reverse. Direction is therefore the bar's OWN direction (bull → long), not a fade. The stop is the bar's
      // opposite extreme, so 1R ≈ the marubozu's own body: the trade dies exactly when the bar that defined control is
      // fully given back, which is the event that falsifies the read.
      // ONE free constant, held FIXED — as `pinbar`'s 2× wick, `orderblock`'s 1.4× impulse, `harami`'s 2× body,
      // `doubletop`'s and `tweezer`'s 0.10 tolerance are — so it cannot multiply the trial count and deflate every other
      // candidate's DSR: BODY_FRAC = 0.90 of the bar's range, scale-free and needing no absolute price unit.
      // Point-in-time: reads bar i's own OHLC only, all of it known at its close. Nothing at or after i+1.
      const BODY_FRAC = 0.90;
      const rng = b.high - b.low;
      if (!(rng > 0)) return null;                                     // a zero-range bar → fails closed
      if (Math.abs(b.close - b.open) < BODY_FRAC * rng) return null;   // wicks too large → not a marubozu
      if (b.close > b.open) return { side: "long", stop: b.low };      // bull marubozu → continue up, stop at its low
      if (b.close < b.open) return { side: "short", stop: b.high };    // bear marubozu → continue down, stop at its high
      return null;                                                     // a doji (body 0) can never clear BODY_FRAC>0 anyway
    }
    case "doji": { // Doji-at-extreme break (ingest id=16, web:ig) — the 30th primitive, and the first CONDITIONAL
      // trigger in the grammar: the signal bar carries NO condition of its own except that it break a level defined
      // by a bar that had ALREADY given up its direction. Everything it is adjacent to sits somewhere else:
      //   · `marubozu` is the exact converse of the shape test and is mutually exclusive with it by construction
      //     (body ≥ 0.90 of range vs body ≤ 0.10). It is also a ONE-bar trigger that fires on the strong bar itself
      //     with no break requirement; here the shape bar is i-1 and it never signals — only a later break does.
      //   · `nr7` is the closest MECHANIC (a prior bar's range, broken by this one) but its condition on that bar is
      //     a RANGE-WIDTH RANKING against 7 neighbours, blind to where the body sits inside it. The two are logically
      //     independent: a doji with long wicks on both sides can be the WIDEST bar of the last 7 (firing here,
      //     silent there), and a full-bodied bar can be the narrowest of 7 (firing there, silent here). `nr7` also
      //     carries no location requirement at all, while this one demands the shape bar BE the window's extreme.
      //   · `inside` is 2-bar range CONTAINMENT — blind to body and to location alike.
      //   · `star` also contains a small-body bar, but measures its smallness against ANOTHER BAR'S BODY (< 0.5× the
      //     impulse's) rather than against its own range, and confirms with a close past that impulse's midpoint —
      //     never a break of the small bar's own range. A small body inside a huge bar's range fires `star` and is
      //     silent here whenever its own wicks are short.
      //   · `pinbar` is the one honest overlap: it too admits a near-zero body. But it requires ONE wick to DOMINATE
      //     (>2× body and larger than the other side), fires on that bar itself, and FADES it — the opposite read.
      //     A symmetric doji (equal wicks) can never fire `pinbar`, and where both shapes coexist the two still
      //     disagree, because this trigger takes whichever side the NEXT bar breaks, which may be the fade's side.
      // The read is the textbook one: indecision printed AT the edge of the range means neither side could extend
      // there, so the range's edge is being decided rather than trended through — and the bar that resolves the
      // indecision by closing beyond the doji's own range picks the winner. Direction is therefore the BREAK's, and
      // the stop is the doji's opposite extreme: 1R is exactly the width of the indecision, and the trade dies the
      // moment the bar that was supposed to have resolved it is fully retraced.
      // ONE free constant, held FIXED — as `pinbar`'s 2× wick, `marubozu`'s 0.90 body-share and `tweezer`'s 0.10
      // tolerance are — so it cannot multiply the trial count and deflate every other candidate's DSR:
      //   DOJI_BODY = 0.10 of the bar's own range, scale-free and needing no absolute price unit. The "at a swing
      //   extreme" qualifier is expressed with the stopLookback window the grammar ALREADY varies, not a new axis.
      // Point-in-time: reads bar i-1's OHLC, bar i's close, and the hi/lo of bars[i-lb..i-1] — all closed at i.
      const DOJI_BODY = 0.10;
      const d = bars[i - 1];
      const drng = d.high - d.low;
      if (!(drng > 0)) return null;                                    // a zero-range bar → fails closed
      if (Math.abs(d.close - d.open) > DOJI_BODY * drng) return null;  // a real body → indecision was not printed
      // `hi`/`lo` span bars[i-lb..i-1] and therefore INCLUDE the doji, so these tests read "the doji IS the window's
      // extreme" — the location qualifier — and are exact rather than tolerance-based.
      if (b.close > d.high && d.high >= hi) return { side: "long", stop: d.low };
      if (b.close < d.low && d.low <= lo) return { side: "short", stop: d.high };
      return null;                                                     // unresolved, or resolved away from the edge
    }
    case "hikkake": { // Hikkake (ingest id=31, Chesler 2003; web:financestrategists+tradingsetupsreview+earnforex) — the
      // 31st primitive, and the first whose condition is ANOTHER PATTERN'S SIGNAL FAILING INSIDE A DEADLINE. Every one
      // of the 30 triggers already in the grammar conditions on something OCCURRING: a shape printing, a level being
      // cleared, a ratio crossing, an extreme being recent, a state flipping. This one conditions on the `inside`
      // trigger's own break being WRONG, and it must be proven wrong within a bounded number of bars or the setup is
      // discarded. Two things about that are new here:
      //   · It is a NEGATION. The signal requires that a specific, fully-formed entry signal of another class did not
      //     work — the trade is taken against the direction `inside` would have taken. `inside` and this trigger can
      //     never agree on a bar, and on the same series they take opposite sides of the same range.
      //   · It carries a DEADLINE. Every other trigger is a predicate evaluated on bar i alone (over whatever window it
      //     reads); if the condition is not met, nothing is pending. Here a break arms a setup that stays live for at
      //     most HIK_WIN bars and then EXPIRES unfilled. A confirmation that arrives one bar late produces no trade at
      //     all — the deadline is the whole idea, and the test pins the d=3 fires / d=4 silent boundary exactly.
      // Why it is not the nearest neighbours:
      //   · `inside` is the direct converse and is mutually exclusive by construction (it trades the break; this trades
      //     the break that dies).
      //   · `sweep`/`ssweep` are the other "the move failed" reads, but their failure is INTRA-BAR — one candle wicks
      //     past a level and closes back inside, so the rejection is contained in a single bar's geometry. Here the
      //     failed move is a CLOSED bar's break that then needs a later bar to close beyond the range's OTHER side; a
      //     sweep bar cannot express "and then, two bars later, the opposite extreme gave way".
      //   · `choch` also reverses a structure, but its precondition is a sequence of swing pivots, not a specific
      //     entry signal firing and failing, and it has no expiry.
      // ONE free constant, held FIXED — as `pinbar`'s 2× wick and `doji`'s 0.10 body share are — so this class cannot
      // multiply the trial count and deflate every other candidate's DSR: HIK_WIN = 3, Chesler's own stated deadline.
      // Choice-free by construction: `d` is scanned from the MOST RECENT break bar outward and the first match wins, so
      // there is no per-bar search for the best-fitting pattern. The `already` guard requires bar i to be the FIRST bar
      // to close beyond the opposite extreme, so one armed setup emits at most one signal rather than one per bar it
      // stays beyond. An outside break bar (one that took out BOTH sides of A) is ambiguous about which side failed and
      // is rejected — fails closed.
      // Stop at the extreme of the failed excursion (the lowest low of the whole break-and-reversal for a long) — the
      // canonical hikkake stop, and the level whose violation says the "failure" was itself the failure. It is strictly
      // beyond A's broken side and therefore on the correct side of a close that is past A's opposite extreme.
      // Point-in-time: reads bars[i-4 … i] only, all closed at i; nothing at or after i+1 is read.
      const HIK_WIN = 3;
      for (let d = 1; d <= HIK_WIN; d++) {
        const bk = i - d, a = bk - 1;
        if (a < 1) break;                                              // no bar before A → the inside test is undefined
        if (!(bars[a].high < bars[a - 1].high && bars[a].low > bars[a - 1].low)) continue;  // A is not an inside bar
        const aHi = bars[a].high, aLo = bars[a].low;
        const dn = bars[bk].low < aLo, up = bars[bk].high > aHi;
        if (dn === up) continue;                                       // no break at all, or BOTH sides → ambiguous
        const beyond = (k: number) => (dn ? bars[k].close > aHi : bars[k].close < aLo);
        if (!beyond(i)) continue;                                      // the break has not (yet) been falsified
        let already = false;
        for (let k = bk + 1; k < i; k++) if (beyond(k)) { already = true; break; }
        if (already) continue;                                         // an earlier bar owned this reversal, not i
        let ext = dn ? bars[bk].low : bars[bk].high;
        for (let k = bk + 1; k <= i; k++) ext = dn ? Math.min(ext, bars[k].low) : Math.max(ext, bars[k].high);
        return { side: dn ? "long" : "short", stop: ext };
      }
      return null;
    }
    case "aroon": { // Aroon Up/Down cross (ingest id=27, web:fidelity+litefinance) — the 27th primitive, and the first
      // whose condition is a PURELY TEMPORAL/ORDINAL quantity: HOW MANY BARS AGO the window's extreme occurred. Every
      // other trigger in the grammar reads a price MAGNITUDE (a close against a level, a body against a range, one
      // extreme against another). This one reads no magnitude at all — only the RECENCY of the high versus the low:
      //   Aroon Up = ((N − barsSinceHighestHigh)/N)·100, Aroon Down the mirror on the lowest low, N = 14.
      //   · `channel` and `breakout` are the nearest neighbours and are magnitude conditions: they need the CLOSE to
      //     clear the prior extreme. This needs no break whatsoever — Up ≥ 70 admits a high up to 4 bars OLD, so the
      //     signal bar may close well inside the range and still fire. Conversely a bar can break the 20-bar high
      //     (firing `channel`) and be silent here whenever the LOW is also recent, because a fresh low keeps Down high.
      //     The distinguishing requirement is the one no magnitude trigger can express: the opposite extreme must be
      //     STALE (Down ≤ 30 ⇒ the low is ≥ 10 bars old).
      //   · `nbar` and `soldiers` count bars, but they count CONSECUTIVE closes — an unbroken run. Bars-since-extreme
      //     is indifferent to the path: 4 bars of chop since the high scores identically to 4 bars of hard selling.
      //   · `supertrend`, `macd`, `stoch`, `rsi` are all continuous functions of price levels; none has a term whose
      //     units are BARS. That absence is the gap this fills, and it is why the class is worth a trial budget: if
      //     the grammar's 26 magnitude triggers are all reading the same crowded information, an ordinal reading of
      //     the same bars is the cheapest available source of genuinely different information.
      // The read is that when the highest high is recent and the lowest low is old, buyers have been setting the pace
      // for the whole window — a trend-strength statement, not a level statement — so the entry is WITH the cross
      // (Up crossing above Down → long). The cross must actually HAPPEN on bar i (it was not true at i−1), so the
      // trigger fires once per regime change rather than continuously while the condition holds.
      // Three free constants, all held FIXED at their textbook values — as `pinbar`'s 2× wick, `orderblock`'s 1.4×
      // impulse and `marubozu`'s 0.90 body-share are — so they cannot multiply the trial count and deflate every
      // other candidate's DSR: N = 14, and the strong-trend qualifiers 70 / 30.
      // Stop: the stopLookback swing (the source's "recent swing low/high"), which is also the axis the grammar
      // already varies — no new stop mechanic is introduced.
      // Point-in-time: `aroonAt(k)` scans bars[k−14..k] only, and is evaluated at k = i and k = i−1, both closed.
      // Nothing at or after i+1 is read.
      const AR_N = 14, AR_HI = 70, AR_LO = 30;
      if (i < AR_N + 1) return null;                                   // need bar i-1's window too → i ≥ 15
      const aroonAt = (k: number) => {
        let hIdx = k - AR_N, lIdx = k - AR_N;
        // ">=" / "<=" ⇒ the MOST RECENT occurrence wins a tie, which is the standard reading and the one that keeps a
        // flat market at Up = Down = 100 (no cross, no signal) instead of manufacturing one.
        for (let j = k - AR_N; j <= k; j++) { if (bars[j].high >= bars[hIdx].high) hIdx = j; if (bars[j].low <= bars[lIdx].low) lIdx = j; }
        return { up: ((AR_N - (k - hIdx)) / AR_N) * 100, dn: ((AR_N - (k - lIdx)) / AR_N) * 100 };
      };
      const cur = aroonAt(i), prv = aroonAt(i - 1);
      // BULLISH CROSS: Up takes the lead on this bar having not held it on the last, with the strong-trend qualifier.
      if (cur.up > cur.dn && prv.up <= prv.dn && cur.up >= AR_HI && cur.dn <= AR_LO) return { side: "long", stop: lo };
      // BEARISH CROSS: the exact mirror.
      if (cur.dn > cur.up && prv.dn <= prv.up && cur.dn >= AR_HI && cur.up <= AR_LO) return { side: "short", stop: hi };
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

// Parabolic SAR state (D-324). Wilder's constants, held FIXED (see the `psar` case for why).
const PS_AF0 = 0.02, PS_STEP = 0.02, PS_AF_MAX = 0.20;
interface PSSeries { flip: Int8Array; sar: Float64Array; warm: number }
let _psCache = new WeakMap<Bar[], PSSeries>();
/** Causal Parabolic SAR: bar k reads only bars k, k-1 and k-2, so `flip[k]` is knowable at the close of bar k.
 * `flip[k]` is +1 when the trail was breached from below (state turns long), -1 for the mirror, 0 otherwise;
 * `sar[k]` is the trail AFTER bar k's update, so on a flip bar it is the previous leg's extreme point — the
 * canonical stop-and-reverse level.
 * `warm` is the index of the FIRST flip, and callers must ignore everything at or before it. The seed (direction
 * from close[1] vs close[0], EP/SAR from the first two bars' extremes) is an assumption, not a measurement — but a
 * flip overwrites every state variable with measured quantities (SAR := EP, EP := this bar's extreme, AF := 0.02),
 * so from the bar after the first flip onward NO part of the seed survives. That is an exact quarantine rather than
 * a guessed bar count. */
function psarSeries(bars: Bar[]): PSSeries {
  const hit = _psCache.get(bars); if (hit) return hit;
  const n = bars.length;
  const flip = new Int8Array(n), sar = new Float64Array(n);
  let warm = n;                                          // n → no seed-free state at all unless a flip happens below
  if (n >= 2) {
    let up = bars[1].close >= bars[0].close;
    let ep = up ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
    let s = up ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);
    let af = PS_AF0;
    sar[1] = s;
    for (let k = 2; k < n; k++) {
      let next = s + af * (ep - s);                       // the trail closes on the extreme point at rate AF
      // Wilder's clamp: the trail may never sit inside the last two bars' range, so it cannot be hit by a move
      // that already happened.
      if (up) next = Math.min(next, bars[k - 1].low, bars[k - 2].low);
      else next = Math.max(next, bars[k - 1].high, bars[k - 2].high);
      if (up && bars[k].low < next) { up = false; s = ep; ep = bars[k].low; af = PS_AF0; flip[k] = -1; }
      else if (!up && bars[k].high > next) { up = true; s = ep; ep = bars[k].high; af = PS_AF0; flip[k] = 1; }
      else {
        s = next;
        // AF steps up ONLY on a new extreme — this is the accumulating, unbounded-span state that makes the class
        // path-dependent rather than windowed.
        if (up && bars[k].high > ep) { ep = bars[k].high; af = Math.min(af + PS_STEP, PS_AF_MAX); }
        else if (!up && bars[k].low < ep) { ep = bars[k].low; af = Math.min(af + PS_STEP, PS_AF_MAX); }
      }
      sar[k] = s;
      if (flip[k] !== 0 && warm === n) warm = k;
    }
  }
  const out: PSSeries = { flip, sar, warm };
  _psCache.set(bars, out); return out;
}

// Ichimoku Kumo (D-325). Canonical 9/26/52 with the standard +26 forward displacement, held FIXED for the same
// reason as Supertrend's 10/3 and MACD's 12/26/9: the grammar already varies five axes, and freeing the periods
// would multiply the trial count and deflate every other candidate's DSR for constants the sources state.
const KU_TENKAN = 9, KU_KIJUN = 26, KU_SENKOU_B = 52, KU_DISP = 26;
/** First index at which the DISPLACED cloud exists: the earliest bar whose 52-bar window is full is
 * KU_SENKOU_B-1, and its spans are plotted KU_DISP bars later. Before this the cloud is NaN and every
 * comparison against it is false, so the trigger fails closed. */
const KUMO_WARM = KU_SENKOU_B - 1 + KU_DISP;
interface KumoSeries { top: Float64Array; bot: Float64Array }
let _kumoCache = new WeakMap<Bar[], KumoSeries>();
/** The cloud standing at index t is written ONLY from bar t-26, so it is causal with 26 bars to spare — the
 * forward displacement moves a PAST computation forward, it never reads the future. Identity-keyed (D-310). */
function kumoCloud(bars: Bar[]): KumoSeries {
  const hit = _kumoCache.get(bars); if (hit) return hit;
  const n = bars.length;
  const top = new Float64Array(n).fill(NaN), bot = new Float64Array(n).fill(NaN);
  // Midpoint of the high–low range over the `len` bars ending at k — the extremes only, blind to the closes.
  const mid = (k: number, len: number): number => {
    let h = -Infinity, l = Infinity;
    for (let j = k - len + 1; j <= k; j++) { if (bars[j].high > h) h = bars[j].high; if (bars[j].low < l) l = bars[j].low; }
    return (h + l) / 2;
  };
  for (let k = KU_SENKOU_B - 1; k < n; k++) {
    const t = k + KU_DISP; if (t >= n) break;
    const spanA = (mid(k, KU_TENKAN) + mid(k, KU_KIJUN)) / 2;
    const spanB = mid(k, KU_SENKOU_B);
    top[t] = Math.max(spanA, spanB); bot[t] = Math.min(spanA, spanB);
  }
  const out: KumoSeries = { top, bot };
  _kumoCache.set(bars, out); return out;
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
export function clearEmaCache() { _emaCache = new WeakMap(); _rsiCache = new WeakMap(); _stCache = new WeakMap(); _sqCache = new WeakMap(); _stoCache = new WeakMap(); _macdCache = new WeakMap(); _psCache = new WeakMap(); _kumoCache = new WeakMap(); }
