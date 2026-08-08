#!/usr/bin/env -S deno run --allow-net
// trd-survivor-verify — the ONE family that beat random AND is profitable (dip-buy RSI14<30 while >200MA,
// +0.122R vs random −0.028R, t=4.86) now faces every gate that killed the others:
//   (1) breadth: positive in how many of 45 instruments? (killed stress-short: 0/50)
//   (2) era walk-forward: positive in how many years? (killed stress-short: one-era artifact)
//   (3) random control WITHIN each regime & each era (not just pooled)
//   (4) OOS split + realistic regime costs
// If it survives all four it is the first thing in this project's history to do so. Free Yahoo daily.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 4;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: B[] = []; for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); } return out; }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

interface Tr { r: number; ctrl: number[]; yr: number; reg: string; sym: string; is: boolean }
const all: Tr[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const price = (i: number, vreg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[vreg]; };
  const cut = Math.floor(b.length * 0.6);
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0) || !(sma200(i) > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > sma200(i))) continue;
    const v = vix.get(b[i].d) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const r = price(i, vreg); if (r === null) continue;
    const ctrl: number[] = []; const pool = byReg[vreg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, vreg); if (rc !== null) ctrl.push(rc); }
    all.push({ r, ctrl, yr: +b[i].d.slice(0, 4), reg: vreg, sym, is: i < cut });
  }
}
const flat = (t: Tr[]) => t.flatMap((x) => x.ctrl);
console.log(`SURVIVOR VERIFICATION — dip-buy (RSI14<30 while price>200MA), ${UNIVERSE.length} instruments, full history\n`);
console.log(`OVERALL: ${(mean(all.map((t) => t.r)) >= 0 ? "+" : "") + mean(all.map((t) => t.r)).toFixed(3)}R  n=${all.length}  vs random ${mean(flat(all)).toFixed(3)}R`);
const g0 = edgeVsRandom(all.map((t) => t.r), flat(all)); console.log(`  Rule-7 gate: edge ${g0.edge >= 0 ? "+" : ""}${g0.edge} t=${g0.tStat} → ${g0.passes ? "PASSES" : "FAILS"}`);
// (4) OOS
const isT = all.filter((t) => t.is), oosT = all.filter((t) => !t.is);
const gO = edgeVsRandom(oosT.map((t) => t.r), flat(oosT));
console.log(`\n(4) IS ${mean(isT.map((t) => t.r)).toFixed(3)}R (n=${isT.length}) → OOS ${mean(oosT.map((t) => t.r)).toFixed(3)}R (n=${oosT.length})  OOS-vs-random t=${gO.tStat} ${gO.passes ? "✓" : "✗"}`);
// (1) breadth
const bySym = new Map<string, number[]>(); for (const t of all) (bySym.get(t.sym) ?? bySym.set(t.sym, []).get(t.sym)!).push(t.r);
const symRows = [...bySym.entries()].filter(([, a]) => a.length >= 15).map(([s, a]) => ({ s, e: mean(a), n: a.length }));
const pos = symRows.filter((x) => x.e > 0).length;
console.log(`\n(1) BREADTH: positive in ${pos}/${symRows.length} instruments (${(pos / symRows.length * 100).toFixed(0)}%)  ${pos / symRows.length > 0.65 ? "✓ broad" : "✗ narrow"}`);
console.log(`    worst: ${[...symRows].sort((a, b) => a.e - b.e).slice(0, 5).map((x) => `${x.s} ${x.e.toFixed(2)}`).join(", ")}`);
console.log(`    best:  ${[...symRows].sort((a, b) => b.e - a.e).slice(0, 5).map((x) => `${x.s} +${x.e.toFixed(2)}`).join(", ")}`);
// (2) eras
const byYr = new Map<number, number[]>(); for (const t of all) (byYr.get(t.yr) ?? byYr.set(t.yr, []).get(t.yr)!).push(t.r);
const yrRows = [...byYr.entries()].filter(([, a]) => a.length >= 10).map(([y, a]) => ({ y, e: mean(a), n: a.length })).sort((a, b) => a.y - b.y);
const posY = yrRows.filter((x) => x.e > 0).length;
console.log(`\n(2) ERAS: positive in ${posY}/${yrRows.length} years (${(posY / yrRows.length * 100).toFixed(0)}%)  ${posY / yrRows.length > 0.65 ? "✓ persists" : "✗ concentrated"}`);
console.log(`    ${yrRows.map((x) => `${x.y}:${x.e >= 0 ? "+" : ""}${x.e.toFixed(2)}`).join(" ")}`);
// (3) random control within each regime
console.log(`\n(3) RANDOM CONTROL WITHIN EACH REGIME:`);
for (const reg of ["calm", "norm", "stress"]) { const s = all.filter((t) => t.reg === reg); if (s.length < 40) { console.log(`    ${reg}: thin`); continue; } const g = edgeVsRandom(s.map((t) => t.r), flat(s)); console.log(`    ${reg.padEnd(7)} setup ${(g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)}R vs random ${(g.controlMean >= 0 ? "+" : "") + g.controlMean.toFixed(3)}R  edge ${g.edge >= 0 ? "+" : ""}${g.edge}  t=${g.tStat}  n=${s.length}  ${g.passes ? "✓" : "✗"}`); }
