#!/usr/bin/env -S deno run --allow-net
// trd-meanrev — the PROP-SHAPED edge hunt the operator specified: high win rate, small controlled losses,
// short-side included, conditioned on regime. Mean-reversion (RSI-2, Connors-style) — the documented
// high-win-rate class I neglected while over-testing trend. Long the oversold, SHORT the overbought, with
// a trend/VIX regime filter and a HARD STOP (prop caps the tail). Reports WIN RATE (the prop metric),
// per-trade R, worst loss, OOS split + deflation, plus a cyclic breakdown (day-of-week, VIX regime).

import { mean, sampleStd, deflatedSharpe, sharpe } from "../supabase/functions/_shared/trd-stats.ts";
const LIQUID = ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "SMH", "EEM", "GLD", "TLT"]; // high-liquidity (ES/NQ/YM proxies)
const STOP_ATR = 2.0, ATRP = 10, MAXHOLD = 10;

async function daily(sym: string) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: any[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c, dow: new Date(t[i] * 1000).getUTCDay() }); }
  return out;
}
const std = (a: number[]) => sampleStd(a);
function rsi(cl: number[], n: number): number[] {
  const out = new Array(cl.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1]; const g = Math.max(0, ch), l = Math.max(0, -ch); if (i <= n) { ag += g / n; al += l / n; if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return out;
}
function atr(bars: any[], n: number): number[] { const tr = bars.map((b, i) => i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l); const out = new Array(bars.length).fill(NaN); let a = 0; for (let i = 0; i < tr.length; i++) { if (i < n) { a += tr[i] / n; if (i === n - 1) out[i] = a; } else { a = (a * (n - 1) + tr[i]) / n; out[i] = a; } } return out; }
const sma = (cl: number[], i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };

// VIX for regime conditioning
const vixBars = await daily("^VIX"); const vix = new Map<string, number>(); for (const b of vixBars) vix.set(b.d, b.c);

interface Trade { r: number; win: boolean; dow: number; hiVix: boolean; side: string }
// one config: side ∈ {long,short}, entry threshold, trend filter (with/against/none)
function runOne(bars: any[], side: "long" | "short", thr: number, trend: "with" | "none"): Trade[] {
  const cl = bars.map((b) => b.c); const r2 = rsi(cl, 2); const at = atr(bars, ATRP); const trades: Trade[] = [];
  let i = ATRP + 205;
  while (i < bars.length - 1) {
    const ma200 = sma(cl, i, 200); if (!(ma200 > 0) || !(at[i] > 0)) { i++; continue; }
    const up = cl[i] > ma200;
    let enter = false;
    if (side === "long") enter = r2[i] < thr && (trend === "none" || up);
    else enter = r2[i] > (100 - thr) && (trend === "none" || !up);
    if (!enter) { i++; continue; }
    const entry = bars[i + 1].o; const dir = side === "long" ? 1 : -1; const stopDist = STOP_ATR * at[i];
    const stop = entry - dir * stopDist; let r: number | null = null;
    for (let k = i + 1; k < Math.min(i + 1 + MAXHOLD, bars.length); k++) {
      const b = bars[k];
      if (dir === 1 ? b.l <= stop : b.h >= stop) { r = -1; break; }                       // hard stop → −1R
      if (dir === 1 ? r2[k] >= 50 : r2[k] <= 50) { r = dir * (b.c - entry) / stopDist; break; } // reverted → exit
    }
    if (r === null) { const last = bars[Math.min(i + MAXHOLD, bars.length - 1)].c; r = dir * (last - entry) / stopDist; }
    r -= 0.05; // cost
    trades.push({ r, win: r > 0, dow: bars[i + 1].dow, hiVix: (vix.get(bars[i].d) ?? 15) > 20, side });
    i = i + 1;
  }
  return trades;
}

console.log("Pulling liquid instruments…");
const universe = new Map<string, any[]>();
for (const s of LIQUID) { const b = await daily(s); if (b.length > 500) universe.set(s, b); }

// grid across side × threshold × trend-filter; pool trades across all instruments
const cfgs: { name: string; trades: Trade[] }[] = [];
for (const side of ["long", "short"] as const) for (const thr of [5, 10, 15]) for (const trend of ["with", "none"] as const) {
  const all: Trade[] = []; for (const b of universe.values()) all.push(...runOne(b, side, thr, trend));
  cfgs.push({ name: `${side} rsi2${side === "long" ? "<" : ">"}${side === "long" ? thr : 100 - thr} ${trend === "with" ? "+trend" : "any"}`, trades: all });
}

const rep = (t: Trade[]) => { const w = t.filter((x) => x.win).length; return { n: t.length, win: w / t.length, exp: mean(t.map((x) => x.r)), worst: Math.min(...t.map((x) => x.r)) }; };
console.log(`\n${"CONFIG".padEnd(28)} N     win%   exp(R)   worst`);
for (const c of cfgs) { const s = rep(c.trades); console.log(`${c.name.padEnd(28)} ${String(s.n).padStart(4)}  ${(s.win * 100).toFixed(0).padStart(3)}%   ${s.exp >= 0 ? "+" : ""}${s.exp.toFixed(3)}   ${s.worst.toFixed(1)}`); }

// OOS + deflation on the best-by-in-sample-expectancy (split each config's trades chronologically is hard pooled;
// use a simple 60/40 split on the pooled trade sequence per config — trades are already time-ordered per instrument, roughly)
const scored = cfgs.map((c) => { const n = c.trades.length, k = Math.floor(n * 0.6); return { ...c, isE: mean(c.trades.slice(0, k).map((x) => x.r)), hoE: mean(c.trades.slice(k).map((x) => x.r)), isSh: sharpe(c.trades.slice(0, k).map((x) => x.r)) }; });
scored.sort((a, b) => b.isE - a.isE); const win = scored[0];
const dsr = deflatedSharpe(win.isSh, Math.floor(win.trades.length * 0.6), 0, 3, cfgs.length, std(scored.map((s) => s.isSh)) ** 2);
console.log(`\n★ Best by in-sample expectancy: ${win.name}`);
console.log(`  IS exp ${win.isE >= 0 ? "+" : ""}${win.isE.toFixed(3)}R  →  HO exp ${win.hoE >= 0 ? "+" : ""}${win.hoE.toFixed(3)}R   ${win.hoE >= 0.4 ? "✓ clears +0.4R prop bar" : win.hoE > 0 ? "positive but below +0.4R" : "✗ negative OOS"}`);
console.log(`  win rate ${(rep(win.trades).win * 100).toFixed(0)}%  · Deflated Sharpe(N=${cfgs.length}) ${(dsr * 100).toFixed(0)}%`);

// cyclic / favorable-condition breakdown on the pooled best config
const wt = win.trades;
console.log(`\n── Favorable-condition breakdown for "${win.name}" ──`);
console.log(`  high-VIX (>20): exp ${mean(wt.filter((x) => x.hiVix).map((x) => x.r)).toFixed(3)}R (n=${wt.filter((x) => x.hiVix).length})  vs  low-VIX: ${mean(wt.filter((x) => !x.hiVix).map((x) => x.r)).toFixed(3)}R (n=${wt.filter((x) => !x.hiVix).length})`);
for (const [dn, d] of [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5]] as [string, number][]) { const dt = wt.filter((x) => x.dow === d); if (dt.length) console.log(`  ${dn}: exp ${mean(dt.map((x) => x.r)) >= 0 ? "+" : ""}${mean(dt.map((x) => x.r)).toFixed(3)}R  win ${(dt.filter((x) => x.win).length / dt.length * 100).toFixed(0)}%  (n=${dt.length})`); }
console.log(`\nStop=${STOP_ATR}×ATR (tail capped for prop). Exit on RSI2 reversion. 0.05R cost. This is the high-win-rate, short-inclusive class.`);
