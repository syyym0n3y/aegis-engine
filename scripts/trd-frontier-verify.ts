#!/usr/bin/env -S deno run --allow-net
// trd-frontier-verify — the frequency frontier winner (RSI5<30 while price>100MA: 459.7 fires/yr, +0.028R,
// 12.87 total R/yr = 4.3× the baseline survivor) faces the full gauntlet BEFORE it replaces anything:
//   (1) COST SENSITIVITY — a +0.028R/trade edge dies if costs are underestimated. Sweep cost 0→0.30R.
//   (2) BREADTH across instruments   (3) ERA walk-forward   (4) IS→OOS
//   (5) RANDOM CONTROL within each regime
//   (6) CONCURRENCY — 460 fires/yr means many simultaneous positions; count real overlap (correlation risk).
//   (7) EQUITY CURVE under the house-money model vs the baseline survivor.
import { mean, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 3, DEPOSIT = 10000;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 5150; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

interface Tr { date: string; sym: string; gross: number; reg: string; yr: number; is: boolean; ctrl: number[]; exitDate: string }
const A: Tr[] = [], BASE: Tr[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r5 = rsi(cl, 5), r14 = rsi(cl, 14);
  const sma = (i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const gross = (i: number): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)); };
  const cut = Math.floor(b.length * 0.6);
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0)) continue; const v = vix.get(b[i].d) ?? 15; const reg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const m100 = sma(i, 100), m200 = sma(i, 200);
    const mk = (g: number): Tr => { const ctrl: number[] = []; const pool = byReg[reg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = gross(j); if (rc !== null) ctrl.push(rc - RCOST[reg]); } return { date: b[i].d, sym, gross: g, reg, yr: +b[i].d.slice(0, 4), is: i < cut, ctrl, exitDate: b[Math.min(i + H, b.length - 1)].d }; };
    if (r5[i] < 30 && m100 > 0 && cl[i] > m100) { const g = gross(i); if (g !== null) A.push(mk(g)); }
    if (r14[i] < 30 && m200 > 0 && cl[i] > m200) { const g = gross(i); if (g !== null) BASE.push(mk(g)); }
  }
}
A.sort((a, b) => a.date < b.date ? -1 : 1); BASE.sort((a, b) => a.date < b.date ? -1 : 1);
const net = (t: Tr, mult = 1) => t.gross - RCOST[t.reg] * mult;
console.log(`FRONTIER WINNER VERIFICATION — RSI5<30 >100MA (n=${A.length}) vs baseline RSI14<30 >200MA (n=${BASE.length})\n`);
// (1) cost sensitivity
console.log(`(1) COST SENSITIVITY (the critical test for a thin +0.028R edge):`);
console.log(`    ${"cost multiple".padEnd(16)} ${"winner R".padStart(9)} ${"baseline R".padStart(11)}`);
for (const m of [0, 0.5, 1, 1.5, 2, 3]) {
  const w = mean(A.map((t) => net(t, m))), bs = mean(BASE.map((t) => net(t, m)));
  console.log(`    ${(m === 1 ? "1.0× (assumed)" : m.toFixed(1) + "×").padEnd(16)} ${((w >= 0 ? "+" : "") + w.toFixed(4)).padStart(9)} ${((bs >= 0 ? "+" : "") + bs.toFixed(4)).padStart(11)}  ${w > 0 ? "" : "← winner turns NEGATIVE"}`);
}
// (2) breadth  (3) eras  (4) OOS  (5) regime control
const bySym = new Map<string, number[]>(); for (const t of A) (bySym.get(t.sym) ?? bySym.set(t.sym, []).get(t.sym)!).push(net(t));
const symR = [...bySym.entries()].filter(([, a]) => a.length >= 30).map(([s, a]) => ({ s, e: mean(a) }));
console.log(`\n(2) BREADTH: positive in ${symR.filter((x) => x.e > 0).length}/${symR.length} instruments (${(symR.filter((x) => x.e > 0).length / symR.length * 100).toFixed(0)}%)`);
const byYr = new Map<number, number[]>(); for (const t of A) (byYr.get(t.yr) ?? byYr.set(t.yr, []).get(t.yr)!).push(net(t));
const yrR = [...byYr.entries()].filter(([, a]) => a.length >= 20).map(([y, a]) => ({ y, e: mean(a) })).sort((a, b) => a.y - b.y);
console.log(`(3) ERAS: positive in ${yrR.filter((x) => x.e > 0).length}/${yrR.length} years (${(yrR.filter((x) => x.e > 0).length / yrR.length * 100).toFixed(0)}%)`);
const isA = A.filter((t) => t.is), oosA = A.filter((t) => !t.is);
const gO = edgeVsRandom(oosA.map((t) => net(t)), oosA.flatMap((t) => t.ctrl));
console.log(`(4) IS ${mean(isA.map((t) => net(t))).toFixed(4)}R (n=${isA.length}) → OOS ${mean(oosA.map((t) => net(t))).toFixed(4)}R (n=${oosA.length})  OOS-vs-random t=${gO.tStat} ${gO.passes ? "✓" : "✗"}`);
console.log(`(5) RANDOM CONTROL BY REGIME:`);
for (const reg of ["calm", "norm", "stress"]) { const s = A.filter((t) => t.reg === reg); if (s.length < 50) continue; const g = edgeVsRandom(s.map((t) => net(t)), s.flatMap((t) => t.ctrl)); console.log(`    ${reg.padEnd(7)} setup ${(g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)}R vs random ${(g.controlMean >= 0 ? "+" : "") + g.controlMean.toFixed(3)}R  t=${g.tStat} n=${s.length}  ${g.passes ? "✓" : "✗"}`); }
// (6) concurrency
const open = new Map<string, number>(); let maxConc = 0; const concs: number[] = [];
for (const t of A) { for (const [k, v] of open) if (v < Date.parse(t.date)) open.delete(k); open.set(t.sym + t.date, Date.parse(t.exitDate)); concs.push(open.size); if (open.size > maxConc) maxConc = open.size; }
console.log(`\n(6) CONCURRENCY: median ${concs.sort((a, b) => a - b)[Math.floor(concs.length / 2)]} simultaneous positions, max ${maxConc} — correlated-book risk if traded all at once`);
// (7) equity curve, house money
function curve(trs: Tr[], label: string) {
  let eq = DEPOSIT; const c: number[] = []; let minEq = DEPOSIT;
  for (const t of trs) { const banked = Math.max(0, eq - DEPOSIT); const risk = Math.min(DEPOSIT * 0.005 + banked * 0.02, eq * 0.02); eq += risk * net(t); if (eq < minEq) minEq = eq; c.push(eq); }
  const rets: number[] = []; for (let i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
  const yrs = (Date.parse(trs[trs.length - 1].date) - Date.parse(trs[0].date)) / (365.25 * 864e5);
  console.log(`    ${label.padEnd(34)} final $${Math.round(eq).toLocaleString().padStart(12)}  ${(eq / DEPOSIT).toFixed(2).padStart(6)}×  CAGR ${((Math.pow(eq / DEPOSIT, 1 / yrs) - 1) * 100).toFixed(1).padStart(5)}%  maxDD ${(maxDrawdown(rets) * 100).toFixed(1).padStart(5)}%  min-eq $${Math.round(minEq).toLocaleString()}`);
}
console.log(`\n(7) HOUSE-MONEY EQUITY CURVE:`);
curve(A, "FRONTIER RSI5<30 >100MA"); curve(BASE, "BASELINE RSI14<30 >200MA");
