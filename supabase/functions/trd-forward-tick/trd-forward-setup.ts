// trd-forward-setup — the EXACT RSI mean-reversion setup that survived the D-170 full sweep, factored out so
// the live forward tracker runs byte-identical logic to the backtest (repo == tested == deployed). No look-ahead:
// a signal on bar i is entered at bar i+1's open and resolved on bars strictly after entry, stop checked first
// (pessimistic). Everything is pure and offline-testable; the edge fn only supplies bars + params.

export interface Bar { ts: string; o: number; h: number; l: number; c: number }

export interface SetupParams {
  rsiLen: number;      // 14
  rsiThresh: number;   // 70 (short: fade when RSI>thresh; long: buy when RSI<100-thresh handled by dir)
  maLen: number;       // 200
  atrLen: number;      // 14
  stopAtr: number;     // 2
  tpMult: number;      // 3  (target = tpMult × stop distance)
  maxBars: number;     // 144 for 5m ≈ 12h hold
  dir: 1 | -1;         // 1 long (RSI<lowThresh & c>MA), -1 short (RSI>rsiThresh & c<MA)
  lowThresh?: number;  // 30 for longs; defaults to 100-rsiThresh
  borrowAnnual?: number; // e.g. 0.08 = 8%/yr short borrow; charged per hold-day on SHORTS only (D-185)
  barDays?: number;      // calendar-days per bar for borrow accrual: 1d=1, 1h≈1/6.5, 5m≈1/78 (default 1)
}

export interface ForwardTrade {
  entryTs: string; exitTs: string; side: "long" | "short";
  entry: number; stop: number; target: number; exit: number;
  grossR: number; costR: number; netR: number; outcome: "target" | "stop" | "timeout";
}

export function atr(b: Bar[], n: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
  const o = new Array(b.length).fill(NaN); let s = 0;
  for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; }
  return o;
}

export function rsi(cl: number[], n: number): number[] {
  const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); }
  }
  return o;
}

export function sma(cl: number[], n: number): number[] {
  const o = new Array(cl.length).fill(NaN); let s = 0;
  for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n - 1) o[i] = s / n; }
  return o;
}

/**
 * Detect every setup fire and simulate it to a resolved outcome. `feeBpsSide` is the per-side cost in basis
 * points (round-trip = 2×); it is charged as a fraction of the stop distance, exactly as in the D-170 fee test.
 * Only fires whose ENTRY bar (i+1) timestamp is strictly greater than `afterTs` are returned — this is how the
 * forward tracker counts ONLY post-registration trades (a single un-deflated trial).
 */
export function detectTrades(bars: Bar[], p: SetupParams, feeBpsSide: number, afterTs?: string): ForwardTrade[] {
  const cl = bars.map((x) => x.c);
  const at = atr(bars, p.atrLen), r = rsi(cl, p.rsiLen), ma = sma(cl, p.maLen);
  const low = p.lowThresh ?? (100 - p.rsiThresh);
  const feeFrac = feeBpsSide / 10000;
  const out: ForwardTrade[] = [];
  for (let i = p.maLen + 1; i < bars.length - 1; i++) {
    if (!(at[i] > 0) || !(ma[i] > 0) || !Number.isFinite(r[i])) continue;
    const fire = p.dir === 1 ? (r[i] < low && cl[i] > ma[i]) : (r[i] > p.rsiThresh && cl[i] < ma[i]);
    if (!fire) continue;
    const sd = p.stopAtr * at[i];
    if (!(sd > bars[i].c * 1e-4)) continue;         // degenerate-ATR guard (D-169)
    const entryBar = bars[i + 1];
    if (afterTs && !(entryBar.ts > afterTs)) continue;
    const entry = entryBar.o, stop = entry - p.dir * sd, target = entry + p.dir * sd * p.tpMult;
    let grossR: number | null = null, exit = entry, exitTs = entryBar.ts, outcome: ForwardTrade["outcome"] = "timeout", heldBars = 0;
    const last = Math.min(i + p.maxBars, bars.length - 1);
    for (let k = i + 1; k <= last; k++) {
      const hitStop = p.dir === 1 ? bars[k].l <= stop : bars[k].h >= stop;
      const hitTgt = p.dir === 1 ? bars[k].h >= target : bars[k].l <= target;
      if (hitStop) { grossR = -1; exit = stop; exitTs = bars[k].ts; outcome = "stop"; heldBars = k - i; break; }   // pessimistic: stop first
      if (hitTgt) { grossR = p.tpMult; exit = target; exitTs = bars[k].ts; outcome = "target"; heldBars = k - i; break; }
    }
    if (grossR === null) { exit = bars[last].c; exitTs = bars[last].ts; grossR = p.dir * (exit - entry) / sd; outcome = "timeout"; heldBars = last - i; }
    // cost = round-trip spread + (SHORTS only) per-hold-day borrow, both as a fraction of the stop distance (D-185)
    let costR = (entry * feeFrac * 2) / sd;
    if (p.dir === -1 && p.borrowAnnual && p.borrowAnnual > 0) {
      const holdDays = heldBars * (p.barDays ?? 1);
      costR += (entry * p.borrowAnnual * (holdDays / 365)) / sd;
    }
    out.push({ entryTs: entryBar.ts, exitTs, side: p.dir === 1 ? "long" : "short", entry, stop, target, exit, grossR: +grossR.toFixed(4), costR: +costR.toFixed(4), netR: +(grossR - costR).toFixed(4), outcome });
  }
  return out;
}
