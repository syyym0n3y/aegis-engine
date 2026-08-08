#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-ict-sweep-ifvg — LIQUIDITY SWEEPS + INVERSE FAIR VALUE GAPS across all markets/instruments, gated by
// ANALYSIS_CONTRACT Rule 7 (matched random-entry control) FROM THE START — no more measuring drift and
// calling it a setup. Definitions (ICT literature, mechanised):
//   • FVG (fair value gap): 3-bar imbalance — bullish when low[i] > high[i-2] (displacement leaves a gap);
//     bearish when high[i] < low[i-2].
//   • INVERSE FVG (iFVG): a gap that FAILS — price closes decisively back through it, so the imbalance
//     flips polarity and becomes resistance/support. Entry on the close that inverts it.
//   • LIQUIDITY SWEEP: price takes out a prior swing high/low (stop-run) then closes back inside — the
//     classic "sweep + reclaim". Tested BOTH directions, with and without an HTF trend filter.
// Instruments: 45 daily (full history, all asset classes) + intraday indices/crypto 15m for the LTF read.
// Every variant reports setup vs matched random control (same instrument/regime/direction/mechanics).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const DUKA = "data/duka", BIN = "data/binance";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 4;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 90210; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; }
async function loadDuka(p: string): Promise<B[]> { const out: any[] = []; const seen = new Set<number>(); try { for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(p) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4] }); } } } catch { return []; } out.sort((a, b) => a.t - b.t); const bk = 15 * 60000; const m = new Map<number, any>(); for (const x of out) { const k = Math.floor(x.t / bk) * bk; const ex = m.get(k); if (!ex) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t).map((x) => ({ d: new Date(x.t).toISOString().slice(0, 10), o: x.o, h: x.h, l: x.l, c: x.c })); }
async function loadBin(s: string): Promise<B[]> { try { const txt = await Deno.readTextFile(`${BIN}/${s}-1m.csv`); const out: any[] = []; for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12) continue; out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4] }); } out.sort((a, b) => a.t - b.t); const bk = 15 * 60000; const m = new Map<number, any>(); for (const x of out) { const k = Math.floor(x.t / bk) * bk; const ex = m.get(k); if (!ex) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t).map((x) => ({ d: new Date(x.t).toISOString().slice(0, 10), o: x.o, h: x.h, l: x.l, c: x.c })); } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

// ── the ICT setup battery ──
type Fire = (b: B[], i: number, cl: number[], sma200: (i: number) => number, swingHi: (i: number) => number, swingLo: (i: number) => number) => 1 | -1 | null;
const SETUPS: Record<string, Fire> = {
  "liq-sweep LOW + reclaim (long)": (b, i, cl, _s, _h, lo) => { const L = lo(i); return (L > 0 && b[i].l < L && cl[i] > L) ? 1 : null; },
  "liq-sweep HIGH + reject (short)": (b, i, cl, _s, hi) => { const Hh = hi(i); return (Hh > 0 && b[i].h > Hh && cl[i] < Hh) ? -1 : null; },
  "liq-sweep LOW + reclaim, HTF-up (long)": (b, i, cl, sma, _h, lo) => { const L = lo(i); return (L > 0 && b[i].l < L && cl[i] > L && cl[i] > sma(i)) ? 1 : null; },
  "liq-sweep HIGH + reject, HTF-dn (short)": (b, i, cl, sma, hi) => { const Hh = hi(i); return (Hh > 0 && b[i].h > Hh && cl[i] < Hh && cl[i] < sma(i)) ? -1 : null; },
  "FVG bullish continuation (long)": (b, i, cl) => (i > 3 && b[i - 1].l > b[i - 3].h && cl[i] > b[i - 1].l) ? 1 : null,
  "FVG bearish continuation (short)": (b, i, cl) => (i > 3 && b[i - 1].h < b[i - 3].l && cl[i] < b[i - 1].h) ? -1 : null,
  "iFVG bullish inversion (long)": (b, i, cl) => { if (i < 5) return null; for (let k = i - 1; k >= i - 4; k--) { if (b[k].h < b[k - 2].l) { const top = b[k - 2].l; if (cl[i] > top && cl[i - 1] <= top) return 1; } } return null; },
  "iFVG bearish inversion (short)": (b, i, cl) => { if (i < 5) return null; for (let k = i - 1; k >= i - 4; k--) { if (b[k].l > b[k - 2].h) { const bot = b[k - 2].h; if (cl[i] < bot && cl[i - 1] >= bot) return -1; } } return null; },
  "sweep + iFVG confluence (long)": (b, i, cl, _s, _h, lo) => { const L = lo(i); if (!(L > 0 && b[i].l < L && cl[i] > L)) return null; for (let k = i - 1; k >= Math.max(3, i - 4); k--) if (b[k].h < b[k - 2].l && cl[i] > b[k - 2].l) return 1; return null; },
  "sweep + iFVG confluence (short)": (b, i, cl, _s, hi) => { const Hh = hi(i); if (!(Hh > 0 && b[i].h > Hh && cl[i] < Hh)) return null; for (let k = i - 1; k >= Math.max(3, i - 4); k--) if (b[k].l > b[k - 2].h && cl[i] < b[k - 2].h) return -1; return null; },
};
const setupR: Record<string, number[]> = {}, ctrlR: Record<string, number[]> = {};
for (const k of Object.keys(SETUPS)) { setupR[k] = []; ctrlR[k] = []; }

function scan(b: B[], useVix: boolean) {
  if (b.length < 300) return;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const swingHi = (i: number) => i < 12 ? -1 : Math.max(...b.slice(i - 10, i).map((x) => x.h));
  const swingLo = (i: number) => i < 12 ? -1 : Math.min(...b.slice(i - 10, i).map((x) => x.l));
  const regOf = (i: number) => { if (!useVix) return "norm"; const v = vix.get(b[i].d) ?? 15; return v < 15 ? "calm" : v < 25 ? "norm" : "stress"; };
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) byReg[regOf(i)].push(i);
  const price = (i: number, dir: 1 | -1, reg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - dir * sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } } if (r === null) r = dir * (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[reg]; };
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0)) continue; const reg = regOf(i);
    for (const [name, fn] of Object.entries(SETUPS)) {
      const dir = fn(b, i, cl, sma200, swingHi, swingLo); if (!dir) continue;
      const r = price(i, dir, reg); if (r === null) continue;
      setupR[name].push(r);
      const pool = byReg[reg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, dir, reg); if (rc !== null) ctrlR[name].push(rc); }
    }
  }
}
console.log(`LIQUIDITY SWEEPS + INVERSE FVG — Rule-7 gated from the start. Scanning ${UNIVERSE.length} daily instruments + 15m indices/crypto...\n`);
for (const s of UNIVERSE) scan(await daily(s), true);
for (const [nm, ld] of [["S&P 15m", () => loadDuka("usa500idxusd")], ["Nasdaq 15m", () => loadDuka("usatechidxusd")], ["BTC 15m", () => loadBin("BTCUSDT")], ["ETH 15m", () => loadBin("ETHUSDT")]] as [string, () => Promise<B[]>][]) { const b = await ld(); if (b.length > 1000) { scan(b, false); console.log(`  + ${nm}: ${b.length} bars`); } }
console.log(`\n${"setup".padEnd(42)} ${"setup R".padStart(8)} ${"random R".padStart(9)} ${"edge".padStart(8)} ${"t".padStart(7)} ${"n".padStart(8)}  verdict`);
const survivors: string[] = [];
for (const name of Object.keys(SETUPS)) {
  const g = edgeVsRandom(setupR[name], ctrlR[name]);
  if (g.passes && g.setupMean > 0) survivors.push(name);
  console.log(`${name.padEnd(42)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(8)} ${((g.controlMean >= 0 ? "+" : "") + g.controlMean.toFixed(3)).padStart(9)} ${((g.edge >= 0 ? "+" : "") + g.edge.toFixed(3)).padStart(8)} ${g.tStat.toFixed(2).padStart(7)} ${String(setupR[name].length).padStart(8)}  ${g.passes ? (g.setupMean > 0 ? "✓✓ BEATS RANDOM **AND PROFITABLE**" : "✓ beats random but LOSES money (not tradable)") : "✗ no edge over random"}`);
}
console.log(`\n════ ${survivors.length} ICT setup(s) both beat random AND are profitable ════`);
for (const s of survivors) console.log(`   ${s}`);
if (!survivors.length) console.log(`   NONE — liquidity sweeps and inverse FVGs do not beat a random entry in the same regime.`);
