// trd-cycles — rigorous test of the "tops/bottoms recur at fixed day-intervals" claim (e.g. the
// 1064-day and 364-day intervals). The trap: with only a handful of major cycles of history, ANY
// interval can be fit to 2-3 extrema — the periodicity version of a 76%-win-from-one-month. So we
// don't eyeball. We: (1) detect MAJOR swing highs/lows, (2) for a candidate period P compute the
// Rayleigh phase-clustering R of the extrema (R≈1 ⇒ they recur at a consistent phase of P; R≈0 ⇒
// no periodicity), and (3) deflate with a Monte-Carlo null — the max R random extrema reach across
// the SAME scanned periods — so "significant" means beating chance under multiple-comparison.
// Every result is reported next to n (the extrema count). A cycle from n=4 is a story, not a signal.

export interface Bar { ts: string; open: number; high: number; low: number; close: number; }
export interface Extreme { day: number; price: number; kind: "high" | "low"; ts: string; }

/** Calendar day offset of each bar from bar 0 (so intervals are real days, not trading days). */
export function dayOffsets(bars: Bar[]): number[] {
  const t0 = Date.parse(bars[0].ts);
  return bars.map((b) => Math.round((Date.parse(b.ts) - t0) / 86400000));
}

/** Major swing extrema: a high strictly greater than all bars within ±halfWindow (mirror for low). */
export function findExtrema(bars: Bar[], halfWindow: number): Extreme[] {
  const days = dayOffsets(bars); const out: Extreme[] = [];
  for (let i = halfWindow; i < bars.length - halfWindow; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) { if (j === i) continue; if (bars[j].high >= bars[i].high) isHigh = false; if (bars[j].low <= bars[i].low) isLow = false; }
    if (isHigh) out.push({ day: days[i], price: bars[i].high, kind: "high", ts: bars[i].ts });
    if (isLow) out.push({ day: days[i], price: bars[i].low, kind: "low", ts: bars[i].ts });
  }
  return out;
}

/** Rayleigh resultant length R∈[0,1] of extrema phases at period P, and its approximate p-value.
 * R near 1 ⇒ extrema cluster at one phase of the cycle (strong periodicity at P). */
export function rayleigh(daysArr: number[], period: number): { R: number; p: number } {
  const n = daysArr.length; if (n < 2 || period <= 0) return { R: 0, p: 1 };
  let sx = 0, sy = 0;
  for (const t of daysArr) { const ph = 2 * Math.PI * ((t % period) / period); sx += Math.cos(ph); sy += Math.sin(ph); }
  const R = Math.hypot(sx, sy) / n;
  return { R, p: Math.exp(-n * R * R) }; // Rayleigh test approximation
}

export interface PeakScan { period: number; R: number; }
/** Scan candidate periods → R(P). Peaks are candidate cycles. */
export function scanPeriods(daysArr: number[], minP: number, maxP: number, step: number): PeakScan[] {
  const out: PeakScan[] = [];
  for (let P = minP; P <= maxP; P += step) out.push({ period: P, R: rayleigh(daysArr, P).R });
  return out;
}

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Monte-Carlo null: scatter n random extrema over the same span, take the MAX R across the same
 * period grid, repeat iters times. Returns the 95th & 99th percentiles — the bar a real cycle must
 * clear to beat chance AFTER scanning many periods (the periodicity analogue of DSR deflation). */
export function monteCarloThreshold(n: number, spanDays: number, minP: number, maxP: number, step: number, iters: number, seed = 12345): { p95: number; p99: number } {
  const rnd = mulberry32(seed); const maxes: number[] = [];
  for (let it = 0; it < iters; it++) {
    const days: number[] = []; for (let k = 0; k < n; k++) days.push(Math.floor(rnd() * spanDays));
    let mx = 0; for (let P = minP; P <= maxP; P += step) { const r = rayleigh(days, P).R; if (r > mx) mx = r; }
    maxes.push(mx);
  }
  maxes.sort((a, b) => a - b);
  return { p95: maxes[Math.floor(iters * 0.95)], p99: maxes[Math.floor(iters * 0.99)] };
}

/** Intervals (in days) between consecutive same-kind extrema — the raw "how far apart are tops". */
export function consecutiveIntervals(ex: Extreme[], kind: "high" | "low"): number[] {
  const d = ex.filter((e) => e.kind === kind).map((e) => e.day).sort((a, b) => a - b);
  const out: number[] = []; for (let i = 1; i < d.length; i++) out.push(d[i] - d[i - 1]);
  return out;
}
