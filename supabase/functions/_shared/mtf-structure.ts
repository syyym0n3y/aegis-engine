// mtf-structure.ts — DETERMINISTIC multi-timeframe price-action structure primitives.
//
// PURPOSE. SMC/ICT price-action ("liquidity", "break of structure", "fair value gaps", "sessions") is the most
// overfit domain in retail trading: the concepts are drawn on charts after the fact and always look predictive.
// This module refuses that. Every concept is a MECHANICAL rule computed from PAST/CLOSED bars only, so it can be
// measured out-of-sample with the programme's full falsification discipline. Nothing here decides whether a concept
// WORKS — mtf-liquidity-break.ts does the measuring. This file only guarantees the primitives are (a) deterministic
// and (b) free of look-ahead: a level, swing, gap or volume state at bar i uses ONLY bars with index <= i (and, where
// a pattern structurally needs the confirming bar, the primitive reports the index at which it becomes KNOWN).
//
// NO-LOOK-AHEAD CONTRACT, stated once and enforced by the hand-built test:
//   - A marked level (prior-day/week/session high-low) is visible only AFTER that prior period has fully closed.
//     Intraday of the current day, today's own high is NOT a level.
//   - A swing point uses a fractal of `w` bars each side; its right side is in the future, so it is CONFIRMED only at
//     index (pivot + w). `confirmedAt` carries that index; consumers must not use a swing before it.
//   - A break of structure is a CLOSE beyond the most recently CONFIRMED swing.
//   - An FVG is a 3-bar pattern known only at the third bar (index i+1 for a gap around middle bar i).
//   - Volume state uses a trailing window ending at the PREVIOUS bar (i-1 .. i-N), never including bar i's own future.
//
// This is a library: pure functions, no I/O, no Deno APIs. Testable offline with `deno test _shared/`.

export interface Bar {
  ts: number; // unix seconds, open time of the bar
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // base volume (crypto) or tick-count vol (FX/CFD — NOT real size; caller must state the proxy)
}

/** Decode a packed array bar [ts,o,h,l,c,v,...] (extra trailing fields ignored). */
export function decodeBar(a: number[]): Bar {
  return { ts: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// SESSIONS. UTC day, UTC week (Monday open), and the three approximate ICT/FX sessions. The session boundaries are
// APPROXIMATE and stated as such: Asia 00-08, London 07-16, NY 13-22 UTC (they overlap by design in ICT lore).
// ---------------------------------------------------------------------------------------------------------------

export type SessionName = "asia" | "london" | "ny" | "off";

/** UTC calendar day key "YYYY-MM-DD". */
export function utcDayKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** UTC ISO-week key "YYYY-Www" with the week STARTING Monday (ISO-8601). Used for prior-week levels. */
export function utcWeekKey(ts: number): string {
  const d = new Date(ts * 1000);
  // ISO week: Thursday-anchored.
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7; // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // move to Thursday of this week
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Which approximate ICT/FX session an hour falls in. Overlaps resolved to the "primary" owner in this fixed order. */
export function sessionOf(ts: number): SessionName {
  const hr = new Date(ts * 1000).getUTCHours();
  // primary ownership, chosen once and fixed (a research degree of freedom, declared): NY owns 13-22, London 07-13,
  // Asia 00-07; 22-24 is "off". This is one convention; a different split is a different trial.
  if (hr >= 13 && hr < 22) return "ny";
  if (hr >= 7 && hr < 13) return "london";
  if (hr >= 0 && hr < 7) return "asia";
  return "off";
}

/** A session key that is unique per (day, session), so a "prior session" is well-defined across days. */
export function sessionKey(ts: number): string {
  return `${utcDayKey(ts)}:${sessionOf(ts)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// MARKED LEVELS. For each bar, the {high, low} of the most recently COMPLETED prior period (day/week/session).
// No look-ahead: bar i sees only periods whose key differs from bar i's and which closed at or before i-1.
// ---------------------------------------------------------------------------------------------------------------

export interface Level {
  high: number;
  low: number;
  /** index of the last bar of the period this level came from (it is KNOWN from index+1 onward). */
  fromLastIndex: number;
}

/**
 * priorPeriodLevel[i] = high/low of the most recent FULLY-CLOSED period before bar i's period, or null until one exists.
 * Implementation walks forward, rolling the running period into `lastCompleted` at each key change BEFORE assigning it
 * to the current bar — so the current, still-open period never contributes to its own bars' level.
 */
export function priorPeriodLevels(bars: Bar[], keyFn: (ts: number) => string): (Level | null)[] {
  const out: (Level | null)[] = new Array(bars.length).fill(null);
  let curKey: string | null = null;
  let curHi = -Infinity, curLo = Infinity, curStart = 0;
  let lastCompleted: Level | null = null;
  for (let i = 0; i < bars.length; i++) {
    const k = keyFn(bars[i].ts);
    if (curKey === null) {
      curKey = k;
      curHi = bars[i].h; curLo = bars[i].l; curStart = i;
    } else if (k !== curKey) {
      // the period [curStart .. i-1] just closed -> it becomes the newest completed period
      lastCompleted = { high: curHi, low: curLo, fromLastIndex: i - 1 };
      curKey = k;
      curHi = bars[i].h; curLo = bars[i].l; curStart = i;
    } else {
      curHi = Math.max(curHi, bars[i].h);
      curLo = Math.min(curLo, bars[i].l);
    }
    // assign the level KNOWN at bar i = the last fully-closed period (never the open one)
    out[i] = lastCompleted;
  }
  return out;
}

export const priorDayLevels = (bars: Bar[]) => priorPeriodLevels(bars, utcDayKey);
export const priorWeekLevels = (bars: Bar[]) => priorPeriodLevels(bars, utcWeekKey);
export const priorSessionLevels = (bars: Bar[]) => priorPeriodLevels(bars, sessionKey);

// ---------------------------------------------------------------------------------------------------------------
// SWING POINTS + BREAK OF STRUCTURE. A swing high at pivot p (fractal width w) requires h[p] strictly greater than
// h of the w bars on each side. It is CONFIRMED only at index p+w (the right side is future). BOS = a close beyond
// the most recently confirmed swing.
// ---------------------------------------------------------------------------------------------------------------

export interface Swing {
  index: number; // pivot bar
  price: number;
  kind: "high" | "low";
  confirmedAt: number; // index p+w, first bar at which this swing may be USED
}

export function swings(bars: Bar[], w = 2): Swing[] {
  const out: Swing[] = [];
  for (let p = w; p < bars.length - w; p++) {
    let isHi = true, isLo = true;
    for (let k = 1; k <= w; k++) {
      if (!(bars[p].h > bars[p - k].h && bars[p].h > bars[p + k].h)) isHi = false;
      if (!(bars[p].l < bars[p - k].l && bars[p].l < bars[p + k].l)) isLo = false;
      if (!isHi && !isLo) break;
    }
    if (isHi) out.push({ index: p, price: bars[p].h, kind: "high", confirmedAt: p + w });
    if (isLo) out.push({ index: p, price: bars[p].l, kind: "low", confirmedAt: p + w });
  }
  return out;
}

export interface Bos {
  index: number; // bar whose CLOSE broke structure
  dir: "up" | "down";
  swingPrice: number;
  swingIndex: number;
}

/**
 * Break of structure: at each bar j, if close[j] > most-recent-confirmed swing HIGH -> up-BOS; if
 * close[j] < most-recent-confirmed swing LOW -> down-BOS. A given swing triggers at most one BOS (the first close
 * beyond it); the reference swing then advances. No look-ahead: only swings with confirmedAt <= j are eligible.
 */
export function breaksOfStructure(bars: Bar[], w = 2): Bos[] {
  const sw = swings(bars, w);
  const hi = sw.filter((s) => s.kind === "high").sort((a, b) => a.confirmedAt - b.confirmedAt);
  const lo = sw.filter((s) => s.kind === "low").sort((a, b) => a.confirmedAt - b.confirmedAt);
  const out: Bos[] = [];
  let hp = 0, lp = 0; // pointers into confirmed swings
  let curHi: Swing | null = null, curLo: Swing | null = null;
  for (let j = 0; j < bars.length; j++) {
    while (hp < hi.length && hi[hp].confirmedAt <= j) { curHi = hi[hp]; hp++; }
    while (lp < lo.length && lo[lp].confirmedAt <= j) { curLo = lo[lp]; lp++; }
    if (curHi && bars[j].c > curHi.price) {
      out.push({ index: j, dir: "up", swingPrice: curHi.price, swingIndex: curHi.index });
      curHi = null; // consumed; next confirmed high becomes the reference
    }
    if (curLo && bars[j].c < curLo.price) {
      out.push({ index: j, dir: "down", swingPrice: curLo.price, swingIndex: curLo.index });
      curLo = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// FAIR VALUE GAP (FVG) + INVERSE FVG (IFVG). 3-bar imbalance.
//   bullish FVG around middle bar i: bars[i-1].h < bars[i+1].l  -> gap zone [bars[i-1].h, bars[i+1].l]
//   bearish FVG around middle bar i: bars[i-1].l > bars[i+1].h  -> gap zone [bars[i+1].h, bars[i-1].l]
// Known only at bar i+1 (`knownAt`). "Filled" = price later trades back through the FAR edge of the gap.
// IFVG (standard ICT): a bullish FVG that price CLOSES below its bottom flips to a bearish/resistance level, and a
// bearish FVG that price CLOSES above its top flips to a bullish/support level. `invertedAt` = that close's index.
// ---------------------------------------------------------------------------------------------------------------

export interface Fvg {
  midIndex: number; // the middle bar of the 3-bar pattern
  knownAt: number; // midIndex+1, first bar at which the gap is known
  dir: "bull" | "bear";
  top: number; // upper edge of the gap zone
  bottom: number; // lower edge of the gap zone
  sizeBp: number; // gap height in basis points of the zone mid
  filledAt: number | null; // index where price first trades through the FAR edge (fully fills), else null
  invertedAt: number | null; // index where a CLOSE-through inverts the gap (IFVG), else null
}

export function fvgs(bars: Bar[]): Fvg[] {
  const out: Fvg[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1], next = bars[i + 1];
    let dir: "bull" | "bear" | null = null;
    let top = 0, bottom = 0;
    if (prev.h < next.l) { dir = "bull"; bottom = prev.h; top = next.l; }
    else if (prev.l > next.h) { dir = "bear"; bottom = next.h; top = prev.l; }
    if (!dir) continue;
    const mid = (top + bottom) / 2;
    const sizeBp = mid > 0 ? ((top - bottom) / mid) * 1e4 : 0;
    const knownAt = i + 1;
    // scan forward for fill (through the far edge) and inversion (a close through the near edge that started the gap).
    // bullish gap: far edge = bottom (price falling back down through it fills; a CLOSE below bottom inverts).
    // bearish gap: far edge = top (price rising back up through it fills; a CLOSE above top inverts).
    let filledAt: number | null = null, invertedAt: number | null = null;
    for (let j = knownAt + 1; j < bars.length; j++) {
      if (dir === "bull") {
        if (filledAt === null && bars[j].l <= bottom) filledAt = j;
        if (invertedAt === null && bars[j].c < bottom) { invertedAt = j; break; }
      } else {
        if (filledAt === null && bars[j].h >= top) filledAt = j;
        if (invertedAt === null && bars[j].c > top) { invertedAt = j; break; }
      }
    }
    out.push({ midIndex: i, knownAt, dir, top, bottom, sizeBp, filledAt, invertedAt });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// VOLUME STATE. Participation ratio = v[i] / trailing median of the previous N bars' volume (window ends at i-1, so
// no look-ahead). Directional-volume PROXY: CLV = ((c-l)-(h-c))/(h-l) in [-1,1] (a bar closing at its high on big
// volume = directional buying), times v; z-scored on the trailing N (window ending i-1). This is a PROXY for signed
// taker flow, NOT a real buy/sell split — no intraday taker delta is held. State that everywhere it is used.
// ---------------------------------------------------------------------------------------------------------------

/** Close-location value in [-1,1]; 0 when h==l (a flat/closed-session bar carries no direction). */
export function clv(b: Bar): number {
  const rng = b.h - b.l;
  if (!(rng > 0)) return 0;
  return ((b.c - b.l) - (b.h - b.c)) / rng;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface VolState {
  partRatio: number; // v[i] / trailing median volume (>=1 means above-typical participation); NaN until N history
  dirZ: number; // z-score of CLV*v against trailing N (NaN until N history); +ve = directional buying
}

/** Per-bar volume state using a trailing window of N bars ending at i-1 (strictly past). */
export function volumeStates(bars: Bar[], N = 24): VolState[] {
  const out: VolState[] = new Array(bars.length);
  const dv = bars.map((b) => clv(b) * b.v);
  for (let i = 0; i < bars.length; i++) {
    if (i < N) { out[i] = { partRatio: NaN, dirZ: NaN }; continue; }
    const volWin: number[] = [];
    let dvSum = 0;
    for (let k = i - N; k < i; k++) { volWin.push(bars[k].v); dvSum += dv[k]; }
    const med = median(volWin);
    const dvMean = dvSum / N;
    let s2 = 0;
    for (let k = i - N; k < i; k++) s2 += (dv[k] - dvMean) ** 2;
    const sd = Math.sqrt(s2 / (N - 1));
    out[i] = {
      partRatio: med > 0 ? bars[i].v / med : NaN,
      dirZ: sd > 0 ? (dv[i] - dvMean) / sd : NaN,
    };
  }
  return out;
}
