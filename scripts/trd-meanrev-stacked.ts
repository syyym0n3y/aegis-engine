#!/usr/bin/env -S deno run --allow-net
// trd-meanrev-stacked — push the prop-shaped mean-reversion edge by STACKING favorable conditions (the
// operator's ask: which market conditions give the best odds). Buy panic dips in an uptrend / short
// bounces in a high-vol downtrend, at escalating VIX cutoffs. Shows the expectancy↔trade-count tradeoff
// and where (if anywhere) it clears the +0.4R prop bar with a high win rate. Hard stop caps the tail.

import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const LIQUID = ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "SMH", "EEM", "GLD", "TLT", "HYG"];
const STOP_ATR = 2.0, ATRP = 10, MAXHOLD = 10;
async function daily(sym: string) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: any[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); }
  return out;
}
function rsi(cl: number[], n: number): number[] { const out = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch); if (i <= n) { ag += g / n; al += l / n; if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } } return out; }
function atr(b: any[], n: number): number[] { const tr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l); const out = new Array(b.length).fill(NaN); let a = 0; for (let i = 0; i < tr.length; i++) { if (i < n) { a += tr[i] / n; if (i === n - 1) out[i] = a; } else { a = (a * (n - 1) + tr[i]) / n; out[i] = a; } } return out; }
const sma = (cl: number[], i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };

const vixBars = await daily("^VIX"); const vix = new Map<string, number>(); for (const b of vixBars) vix.set(b.d, b.c);
const universe = new Map<string, any[]>();
for (const s of LIQUID) { const b = await daily(s); if (b.length > 500) universe.set(s, b); }

// stacked mean-reversion: long panic dip in uptrend (RSI2<rlo & >200MA), short bounce in downtrend (RSI2>rhi & <200MA), VIX≥cut
function run(bars: any[], rlo: number, rhi: number, vcut: number) {
  const cl = bars.map((b) => b.c); const r2 = rsi(cl, 2); const at = atr(bars, ATRP); const out: { r: number; side: string }[] = [];
  let i = ATRP + 205;
  while (i < bars.length - 1) {
    const ma = sma(cl, i, 200); const v = vix.get(bars[i].d) ?? 15;
    if (!(ma > 0) || !(at[i] > 0) || v < vcut) { i++; continue; }
    const up = cl[i] > ma; let side: "long" | "short" | null = null;
    if (r2[i] < rlo && up) side = "long"; else if (r2[i] > rhi && !up) side = "short";
    if (!side) { i++; continue; }
    const entry = bars[i + 1].o, dir = side === "long" ? 1 : -1, sd = STOP_ATR * at[i], stop = entry - dir * sd; let r: number | null = null;
    for (let k = i + 1; k < Math.min(i + 1 + MAXHOLD, bars.length); k++) { const b = bars[k]; if (dir === 1 ? b.l <= stop : b.h >= stop) { r = -1; break; } if (dir === 1 ? r2[k] >= 50 : r2[k] <= 50) { r = dir * (b.c - entry) / sd; break; } }
    if (r === null) { const last = bars[Math.min(i + MAXHOLD, bars.length - 1)].c; r = dir * (last - entry) / sd; }
    out.push({ r: r - 0.05, side }); i++;
  }
  return out;
}

console.log(`Stacked mean-reversion (long panic-dip in uptrend / short bounce in downtrend), escalating VIX cutoff:`);
console.log(`\n${"conditions".padEnd(34)} N     win%   exp(R)   longEV  shortEV   ~trades/yr`);
const YEARS = 11.5;
for (const [rlo, rhi] of [[10, 90], [5, 95], [2, 98]] as [number, number][]) for (const vcut of [15, 20, 25, 30]) {
  const all: { r: number; side: string }[] = []; for (const b of universe.values()) all.push(...run(b, rlo, rhi, vcut));
  if (all.length < 20) { console.log(`RSI ${rlo}/${rhi} VIX≥${vcut}: too few (${all.length})`); continue; }
  const w = all.filter((x) => x.r > 0).length; const L = all.filter((x) => x.side === "long"), S = all.filter((x) => x.side === "short");
  const clears = mean(all.map((x) => x.r)) >= 0.4;
  console.log(`RSI<${rlo}/>${rhi} VIX≥${vcut}`.padEnd(34) + ` ${String(all.length).padStart(4)}  ${(w / all.length * 100).toFixed(0).padStart(3)}%   ${mean(all.map((x) => x.r)) >= 0 ? "+" : ""}${mean(all.map((x) => x.r)).toFixed(3)}  ${L.length ? (mean(L.map((x) => x.r)) >= 0 ? "+" : "") + mean(L.map((x) => x.r)).toFixed(2) : " n/a"}   ${S.length ? (mean(S.map((x) => x.r)) >= 0 ? "+" : "") + mean(S.map((x) => x.r)).toFixed(2) : " n/a"}    ${(all.length / YEARS).toFixed(0)}${clears ? "  ✓+0.4R" : ""}`);
}
console.log(`\nRead: tighter conditions (lower RSI, higher VIX) → higher expectancy but fewer trades. The prop question is`);
console.log(`whether a condition clears ~+0.4R with ENOUGH trades/yr to hit an eval target in 40 days. Long=buy panic, Short=fade bounce.`);
