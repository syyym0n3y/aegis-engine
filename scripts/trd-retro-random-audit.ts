#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-retro-random-audit — apply the D-146 Rule-7 RANDOM-CONTROL gate RETROACTIVELY to every strategy family
// this project ever tested. For each family we fire the setup, then fire matched random entries (same
// instrument, same regime bucket, same direction, same stop/target mechanics) and Welch-test the difference.
// Anything that does not beat its control was never an edge — it was drift/beta. Free data: Yahoo daily
// (50-instrument cross-section, full history) + Dukascopy 1m intraday. Per ANALYSIS_CONTRACT rules 1-7.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 4;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 20260806; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number; v: number }
async function daily(sym: string): Promise<B[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: B[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c, v: v ?? 0 }); }
  return out;
}
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

// every strategy family the project has tested (daily analogues), name → (bars,i,ctx) → dir|null
type Ctx = { cl: number[]; r2: number[]; r14: number[]; at: number[]; sma200: (i: number) => number; sma50: (i: number) => number };
const FAMILIES: Record<string, (b: B[], i: number, c: Ctx) => 1 | -1 | null> = {
  "meanrev RSI2<5 (long)": (_b, i, c) => c.r2[i] < 5 ? 1 : null,
  "meanrev RSI2>95 (short)": (_b, i, c) => c.r2[i] > 95 ? -1 : null,
  "dip-buy RSI<30 >200MA": (_b, i, c) => (c.r14[i] < 30 && c.cl[i] > c.sma200(i)) ? 1 : null,
  "breakout 20d high (long)": (b, i, c) => c.cl[i] > Math.max(...b.slice(i - 20, i).map((x) => x.h)) ? 1 : null,
  "breakdown 20d low (short)": (b, i, c) => c.cl[i] < Math.min(...b.slice(i - 20, i).map((x) => x.l)) ? -1 : null,
  "sweep-reversal (long)": (b, i, c) => { const lo = Math.min(...b.slice(i - 5, i).map((x) => x.l)); return (b[i].l < lo && c.cl[i] > lo) ? 1 : null; },
  "sweep-reversal (short)": (b, i, c) => { const hi = Math.max(...b.slice(i - 5, i).map((x) => x.h)); return (b[i].h > hi && c.cl[i] < hi) ? -1 : null; },
  "trend-follow 50>200 (long)": (_b, i, c) => (c.sma50(i) > c.sma200(i) && c.cl[i] > c.sma50(i)) ? 1 : null,
  "trend-pullback to 50MA (long)": (_b, i, c) => (c.cl[i] > c.sma200(i) && c.cl[i] < c.sma50(i) && c.cl[i - 1] > c.sma50(i - 1)) ? 1 : null,
  "Minervini trend-template (long)": (_b, i, c) => (c.cl[i] > c.sma50(i) && c.sma50(i) > c.sma200(i) && c.cl[i] > c.sma200(i) * 1.25) ? 1 : null,
  "volume-spike reversal (long)": (b, i, c) => { const av = b.slice(i - 20, i).reduce((s, x) => s + x.v, 0) / 20; return (b[i].v > 2 * av && c.cl[i] < b[i].o) ? 1 : null; },
  "gap-fade (short)": (b, i, c) => (b[i].o > b[i - 1].c * 1.01 && c.cl[i] < b[i].o) ? -1 : null,
  "inside-bar breakout (long)": (b, i, c) => (b[i - 1].h < b[i - 2].h && b[i - 1].l > b[i - 2].l && c.cl[i] > b[i - 1].h) ? 1 : null,
  "engulfing bull (long)": (b, i, c) => (c.cl[i] > b[i].o && b[i - 1].c < b[i - 1].o && c.cl[i] > b[i - 1].o && b[i].o < b[i - 1].c) ? 1 : null,
};
const setupR: Record<string, number[]> = {}, ctrlR: Record<string, number[]> = {};
for (const k of Object.keys(FAMILIES)) { setupR[k] = []; ctrlR[k] = []; }

for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r2 = rsi(cl, 2); const r14 = rsi(cl, 14);
  const sm = (i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };
  const ctx: Ctx = { cl, r2, r14, at, sma200: (i) => sm(i, 200), sma50: (i) => sm(i, 50) };
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const price = (i: number, dir: 1 | -1, vreg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - dir * sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } } if (r === null) r = dir * (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[vreg]; };
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0) || !(ctx.sma200(i) > 0)) continue;
    const v = vix.get(b[i].d) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    for (const [name, fn] of Object.entries(FAMILIES)) {
      const dir = fn(b, i, ctx); if (!dir) continue;
      const r = price(i, dir, vreg); if (r === null) continue;
      setupR[name].push(r);
      const pool = byReg[vreg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, dir, vreg); if (rc !== null) ctrlR[name].push(rc); }
    }
  }
}
console.log(`RETROACTIVE RULE-7 AUDIT — every strategy family vs its MATCHED RANDOM CONTROL (${UNIVERSE.length} instruments, full history, 5d/2ATR, regime costs)\n`);
console.log(`${"family".padEnd(32)} ${"setup R".padStart(9)} ${"random R".padStart(9)} ${"edge".padStart(8)} ${"t".padStart(7)}  ${"n".padStart(7)}  verdict`);
const results: { name: string; t: number; passes: boolean }[] = [];
for (const name of Object.keys(FAMILIES)) {
  const g = edgeVsRandom(setupR[name], ctrlR[name]);
  results.push({ name, t: g.tStat, passes: g.passes });
  console.log(`${name.padEnd(32)} ${(g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)}`.padEnd(43) + `${(g.controlMean >= 0 ? "+" : "") + g.controlMean.toFixed(3)}`.padStart(9) + `${(g.edge >= 0 ? "+" : "") + g.edge.toFixed(3)}`.padStart(9) + `${g.tStat.toFixed(2)}`.padStart(8) + `${String(setupR[name].length)}`.padStart(9) + `  ${g.passes ? "✓ BEATS RANDOM" : "✗ no edge (drift)"}`);
}
const passed = results.filter((r) => r.passes);
console.log(`\n════ RESULT: ${passed.length} of ${results.length} strategy families beat a random entry in the same regime ════`);
if (passed.length) for (const p of passed) console.log(`   SURVIVOR: ${p.name} (t=${p.t})`);
else console.log(`   NONE. Every family this project ever tested is regime drift, not setup edge.`);
console.log(`\nThis is the retroactive application of ANALYSIS_CONTRACT Rule 7 (D-146) to the entire corpus.`);
