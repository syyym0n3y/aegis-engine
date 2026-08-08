#!/usr/bin/env -S deno run --allow-net
// trd-prop-edge — the RIGHT question for prop-farming: not "does it beat buy&hold" but "is per-trade
// expectancy > +0.4R?" (the bar that makes eval-farming +EV, D-109). Runs the validated long-only
// trailing-trend rotation (D-108b) and logs each completed trade's R = P&L% ÷ initial-stop-distance%,
// reporting expectancy IS vs OOS. Free Yahoo daily, causal.

import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const UNIVERSE = ["SPY", "QQQ", "IWM", "XLK", "XLE", "XLF", "XLV", "XLU", "XLI", "XLP", "XLY", "SMH", "XBI", "EEM", "EFA", "FXI", "EWZ", "EWJ", "INDA", "GLD", "SLV", "USO", "DBC", "TLT", "HYG", "UUP", "BTC-USD", "ETH-USD"];
const ANN = 252, MALEN = 100, MULT = 3.5, K = 5, COST_R = 0.05; // 0.05R/side cost, matches prereg convention
async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const std = (a: number[]) => sampleStd(a);
const data = new Map<string, Map<string, number>>();
for (const s of UNIVERSE) { const m = await daily(s); if (m.size > 300) data.set(s, m); }
const dates = [...new Set([...data.values()].flatMap((m) => [...m.keys()]))].sort();
const syms = [...data.keys()]; const T = dates.length;
const P = dates.map((d) => syms.map((s) => data.get(s)!.get(d) ?? NaN));
const R = P.map((row, i) => row.map((p, j) => (i > 0 && p > 0 && P[i - 1][j] > 0) ? Math.log(p / P[i - 1][j]) : NaN));
const vol20 = (i: number, j: number) => { const w: number[] = []; for (let k = i - 20; k < i; k++) if (k >= 0 && Number.isFinite(R[k][j])) w.push(R[k][j]); return w.length >= 10 ? std(w) : NaN; };
function score(i: number, j: number): number { const p = P[i][j]; const v = vol20(i, j); if (!(p > 0) || !(v > 0)) return NaN; let s = 0, n = 0; for (const H of [21, 63, 126]) { const pk = i - H >= 0 ? P[i - H][j] : NaN; if (pk > 0) { s += (Math.log(p / pk) / H) / v; n++; } } return n === 3 ? s / n : NaN; }
const ma = (i: number, j: number) => { let s = 0, n = 0; for (let k = i - MALEN; k < i; k++) if (k >= 0 && P[k][j] > 0) { s += P[k][j]; n++; } return n > MALEN * 0.8 ? s / n : NaN; };

// run long-only trailing rotation; log each closed trade's R
interface Tr { entryIdx: number; exitIdx: number; r: number }
const trades: Tr[] = [];
const held = new Map<number, { entry: number; max: number; stopFrac: number; ei: number }>();
for (let i = 1; i < T; i++) {
  for (const [j, h] of held) if (P[i][j] > h.max) h.max = P[i][j];
  for (const [j, h] of [...held]) {
    const v = Number.isFinite(vol20(i, j)) ? vol20(i, j) : 0.02;
    const stop = h.max - MULT * v * P[i][j]; const s = score(i, j) ?? 0;
    if (!(P[i][j] > 0) || P[i][j] < stop || s < 0) { const pnl = P[i][j] / h.entry - 1; trades.push({ entryIdx: h.ei, exitIdx: i, r: pnl / h.stopFrac - 2 * COST_R }); held.delete(j); }
  }
  while (held.size < K) {
    let best = -1, bs = 0;
    for (let j = 0; j < syms.length; j++) { if (held.has(j)) continue; const s = score(i, j); const m = ma(i, j); if (Number.isFinite(s) && s > 0 && P[i][j] > (m || Infinity) && s > bs) { bs = s; best = j; } }
    if (best < 0) break;
    const v = vol20(i, best); if (!(v > 0)) break;
    held.set(best, { entry: P[i][best], max: P[i][best], stopFrac: MULT * v, ei: i });
  }
}
const IS = Math.floor(T * 0.6);
const isT = trades.filter((t) => t.exitIdx < IS).map((t) => t.r), hoT = trades.filter((t) => t.exitIdx >= IS).map((t) => t.r);
const rep = (name: string, a: number[]) => { const w = a.filter((x) => x > 0).length; console.log(`  ${name}: N=${a.length}  expectancy=${mean(a) >= 0 ? "+" : ""}${mean(a).toFixed(3)}R  win=${(w / a.length * 100).toFixed(0)}%  ${mean(a) >= 0.4 ? "✓ CLEARS +0.4R prop bar" : "✗ below +0.4R"}`); };
console.log(`Trailing-trend rotation entries — per-trade R (the prop-farming bar is +0.4R):`);
rep("ALL   ", trades.map((t) => t.r));
rep("IN-SAMP", isT);
rep("HOLDOUT", hoT);
console.log(`\nNote: R = P&L ÷ initial trailing-stop distance, minus ${(2 * COST_R).toFixed(2)}R round-trip cost. Long-only, causal.`);
console.log(`If holdout expectancy ≥ +0.4R, these entries are prop-farmable with our sizing engine (D-109). If not, honest no.`);
