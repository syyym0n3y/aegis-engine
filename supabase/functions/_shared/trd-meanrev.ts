// trd-meanrev — the frozen VIX-conditioned mean-reversion signal (D-111), as a pure, tested primitive so
// the live tracker and the backtest run the SAME code (no drift). High-win-rate class: long the oversold
// in an uptrend / SHORT the overbought in a downtrend, ONLY when volatility (VIX) is elevated — the
// condition where reversion pays. Hard 2×ATR stop caps the tail (prop- and account-safe). Daily bars.

export interface Bar { d: string; o: number; h: number; l: number; c: number; }
export interface MRParams { rsiLen: number; rsiLo: number; rsiHi: number; maLen: number; atrLen: number; stopATR: number; vixMin: number; maxHold: number; costR: number; }
export const MR_SPEC: MRParams = { rsiLen: 2, rsiLo: 5, rsiHi: 95, maLen: 200, atrLen: 10, stopATR: 2, vixMin: 20, maxHold: 10, costR: 0.05 };

export function rsi(cl: number[], n: number): number[] {
  const out = new Array(cl.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= n) { ag += g / n; al += l / n; if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
export function atr(b: Bar[], n: number): number[] {
  const tr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l);
  const out = new Array(b.length).fill(NaN); let a = 0;
  for (let i = 0; i < tr.length; i++) { if (i < n) { a += tr[i] / n; if (i === n - 1) out[i] = a; } else { a = (a * (n - 1) + tr[i]) / n; out[i] = a; } }
  return out;
}
const smaAt = (cl: number[], i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };

export interface MRSetup { side: "long" | "short"; entryRef: number; stopDist: number; rsi: number; atr: number; ma: number; }
/** Signal on the LAST bar (index bars.length-1), given the concurrent VIX close. Causal: reads only bars≤last. */
export function meanRevSignal(bars: Bar[], vixNow: number, p: MRParams = MR_SPEC): MRSetup | null {
  const i = bars.length - 1; if (i < p.maLen + 5) return null;
  const cl = bars.map((b) => b.c); const r2 = rsi(cl, p.rsiLen); const at = atr(bars, p.atrLen); const ma = smaAt(cl, i, p.maLen);
  if (!(ma > 0) || !(at[i] > 0) || !Number.isFinite(r2[i]) || !(vixNow >= p.vixMin)) return null;
  const up = cl[i] > ma;
  if (r2[i] < p.rsiLo && up) return { side: "long", entryRef: cl[i], stopDist: p.stopATR * at[i], rsi: r2[i], atr: at[i], ma };
  if (r2[i] > p.rsiHi && !up) return { side: "short", entryRef: cl[i], stopDist: p.stopATR * at[i], rsi: r2[i], atr: at[i], ma };
  return null;
}

/** Resolve an OPEN trade over the bars AFTER entry. Returns R (net of cost) if closed, else null (still open).
 * bars = the bars from the entry bar forward (index 0 = entry bar; exits evaluated from index 1). */
export function resolveTrade(barsFromEntry: Bar[], side: "long" | "short", entry: number, stopDist: number, p: MRParams = MR_SPEC): { r: number; reason: string; heldBars: number } | null {
  const dir = side === "long" ? 1 : -1; const stop = entry - dir * stopDist;
  const cl = barsFromEntry.map((b) => b.c); const r2 = rsi(cl, p.rsiLen);
  for (let k = 1; k < Math.min(1 + p.maxHold, barsFromEntry.length); k++) {
    const b = barsFromEntry[k];
    if (dir === 1 ? b.l <= stop : b.h >= stop) return { r: -1 - p.costR, reason: "stop", heldBars: k };
    if (Number.isFinite(r2[k]) && (dir === 1 ? r2[k] >= 50 : r2[k] <= 50)) return { r: dir * (b.c - entry) / stopDist - p.costR, reason: "reverted", heldBars: k };
  }
  if (barsFromEntry.length >= 1 + p.maxHold) { const b = barsFromEntry[p.maxHold]; return { r: dir * (b.c - entry) / stopDist - p.costR, reason: "maxhold", heldBars: p.maxHold }; }
  return null; // not enough bars yet → still open
}
