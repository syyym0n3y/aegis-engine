#!/usr/bin/env -S deno run --allow-net
// trd-universe-breadth — GAP 3 of the D-145 audit: SURVIVORSHIP / instrument-selection. Discovery ran on 4
// liquid instruments that exist today. Does the conditional structure hold across a BROAD cross-section —
// sectors, factors, single names (incl. beaten-down ones), bonds, commodities, international? If the same
// VIX-conditional direction appears across ~40 instruments it is market structure, not instrument selection.
// Daily bars (full Yahoo history, adjusted) — the daily analogue of the intraday candidates. Numbers + N.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","MDY","EFA","EEM","FXI","EWZ","EWJ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","XLRE","SMH","XBI","KRE","ITB","GLD","SLV","USO","DBC","UNG","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: B[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); }
  return out;
}
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi2(cl: number[]) { const n = 2; const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

interface Res { sym: string; calmLong: number; calmN: number; stressShort: number; stressN: number }
const rows: Res[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r2 = rsi2(cl);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const cL: number[] = [], sS: number[] = [];
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0) || !(sma200(i) > 0)) continue; const v = vix.get(b[i].d) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const prevHi = Math.max(...b.slice(i - 5, i).map((x) => x.h)), prevLo = Math.min(...b.slice(i - 5, i).map((x) => x.l));
    const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4)) continue;
    const trade = (dir: 1 | -1) => { const entry = b[i + 1].o, stop = entry - dir * sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } } if (r === null) r = dir * (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[vreg]; };
    // calm-LONG analogue: sweep of prior low reclaimed, or RSI2 extreme, in calm VIX
    if (vreg === "calm" && ((b[i].l < prevLo && cl[i] > prevLo) || r2[i] < 5)) cL.push(trade(1));
    // stress-SHORT analogue: sweep of prior high rejected, in stress VIX
    if (vreg === "stress" && b[i].h > prevHi && cl[i] < prevHi) sS.push(trade(-1));
  }
  if (cL.length >= 20 || sS.length >= 20) rows.push({ sym, calmLong: cL.length ? mean(cL) : NaN, calmN: cL.length, stressShort: sS.length ? mean(sS) : NaN, stressN: sS.length });
}
const cl2 = rows.filter((r) => r.calmN >= 20), ss2 = rows.filter((r) => r.stressN >= 20);
const posCL = cl2.filter((r) => r.calmLong > 0).length, posSS = ss2.filter((r) => r.stressShort > 0).length;
console.log(`UNIVERSE BREADTH (survivorship gate) — ${rows.length} instruments across sectors/factors/singles/bonds/commodities/intl\n`);
console.log(`CALM-LONG:    positive in ${posCL}/${cl2.length} instruments (${(posCL / cl2.length * 100).toFixed(0)}%)  mean ${(mean(cl2.map((r) => r.calmLong)) >= 0 ? "+" : "") + mean(cl2.map((r) => r.calmLong)).toFixed(3)}R  ${posCL / cl2.length > 0.65 ? "✓ BROAD market structure" : "✗ narrow / instrument-specific"}`);
console.log(`STRESS-SHORT: positive in ${posSS}/${ss2.length} instruments (${(posSS / ss2.length * 100).toFixed(0)}%)  mean ${(mean(ss2.map((r) => r.stressShort)) >= 0 ? "+" : "") + mean(ss2.map((r) => r.stressShort)).toFixed(3)}R  ${posSS / ss2.length > 0.65 ? "✓ BROAD market structure" : "✗ narrow / instrument-specific"}`);
console.log(`\nWorst 8 for calm-long (does it fail anywhere systematic?):`);
for (const r of [...cl2].sort((a, b) => a.calmLong - b.calmLong).slice(0, 8)) console.log(`   ${r.sym.padEnd(6)} ${(r.calmLong >= 0 ? "+" : "") + r.calmLong.toFixed(3)}R n=${r.calmN}`);
console.log(`\nBest 8 for calm-long:`);
for (const r of [...cl2].sort((a, b) => b.calmLong - a.calmLong).slice(0, 8)) console.log(`   ${r.sym.padEnd(6)} +${r.calmLong.toFixed(3)}R n=${r.calmN}`);
