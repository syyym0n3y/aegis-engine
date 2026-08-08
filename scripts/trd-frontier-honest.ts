#!/usr/bin/env -S deno run --allow-net
// trd-frontier-honest — corrects TWO self-inflicted errors found in trd-frontier-verify:
//   (E1) SELECTION CONTAMINATION: the "best" frequency variant was chosen by FULL-SAMPLE R/yr, which includes
//        the OOS period → its OOS collapse (IS +0.063 → OOS −0.021) was guaranteed. Correct protocol:
//        rank variants on IN-SAMPLE ONLY, then report the winner's OUT-OF-SAMPLE result untouched.
//   (E2) CONCURRENCY: the equity curve compounded trades sequentially while median 12 / max 93 positions were
//        actually open at once → 12-93× real leverage and a fake 143× / 99.8%-DD curve. Correct: cap TOTAL
//        open risk across concurrent positions (portfolio heat), so sizing reflects what a trader could hold.
import { mean, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 3, DEPOSIT = 10000, MAX_HEAT = 0.06; // 6% total open risk cap
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 8675309; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

interface V { name: string; rsiN: number; thr: number; ma: number }
const VARIANTS: V[] = [];
for (const thr of [25, 30, 35, 40]) VARIANTS.push({ name: `RSI14<${thr} >200MA`, rsiN: 14, thr, ma: 200 });
for (const [n, thr] of [[2, 5], [2, 10], [2, 20], [5, 10], [5, 20], [5, 30]] as [number, number][]) { VARIANTS.push({ name: `RSI${n}<${thr} >200MA`, rsiN: n, thr, ma: 200 }); VARIANTS.push({ name: `RSI${n}<${thr} >100MA`, rsiN: n, thr, ma: 100 }); }
VARIANTS.push({ name: `RSI14<35 >100MA`, rsiN: 14, thr: 35, ma: 100 });
interface Tr { date: string; sym: string; r: number; ctrl: number[]; exitDate: string; is: boolean }
const T: Record<string, Tr[]> = {}; for (const v of VARIANTS) T[v.name] = [];
let isYears = 0, oosYears = 0;
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cut = Math.floor(b.length * 0.6); isYears += cut / 252; oosYears += (b.length - cut) / 252;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN);
  const rs: Record<number, number[]> = { 2: rsi(cl, 2), 5: rsi(cl, 5), 14: rsi(cl, 14) };
  const smaCache: Record<number, number[]> = {}; for (const n of [100, 200]) { const a = new Array(cl.length).fill(NaN); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n) a[i] = s / n; } smaCache[n] = a; }
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const price = (i: number, reg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[reg]; };
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0)) continue; const v = vix.get(b[i].d) ?? 15; const reg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    let cached: number | null | undefined; let ctrlCache: number[] | undefined;
    for (const va of VARIANTS) {
      const rv = rs[va.rsiN][i]; if (!Number.isFinite(rv) || rv >= va.thr) continue;
      const m = smaCache[va.ma][i]; if (!(m > 0) || !(cl[i] > m)) continue;
      if (cached === undefined) { cached = price(i, reg); ctrlCache = []; const pool = byReg[reg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, reg); if (rc !== null) ctrlCache.push(rc); } }
      if (cached === null) continue;
      T[va.name].push({ date: b[i].d, sym, r: cached, ctrl: ctrlCache!, exitDate: b[Math.min(i + H, b.length - 1)].d, is: i < cut });
    }
  }
}
console.log(`HONEST FRONTIER — variants ranked on IN-SAMPLE ONLY, then validated OUT-OF-SAMPLE (no contamination).\n`);
console.log(`${"variant".padEnd(20)} ${"IS R/yr".padStart(9)} ${"IS R".padStart(8)} ${"| OOS R".padStart(9)} ${"OOS R/yr".padStart(9)} ${"OOS t".padStart(7)}  holds?`);
interface Row { name: string; isRyr: number; isE: number; oosE: number; oosRyr: number; oosT: number; holds: boolean }
const rows: Row[] = [];
for (const va of VARIANTS) {
  const tr = T[va.name]; if (tr.length < 100) continue;
  const is = tr.filter((t) => t.is), oos = tr.filter((t) => !t.is);
  if (is.length < 50 || oos.length < 50) continue;
  const isE = mean(is.map((t) => t.r)), oosE = mean(oos.map((t) => t.r));
  const g = edgeVsRandom(oos.map((t) => t.r), oos.flatMap((t) => t.ctrl));
  rows.push({ name: va.name, isRyr: isE * is.length / isYears * UNIVERSE.length, isE, oosE, oosRyr: oosE * oos.length / oosYears * UNIVERSE.length, oosT: g.tStat, holds: g.passes && oosE > 0 });
}
rows.sort((a, b) => b.isRyr - a.isRyr);
for (const r of rows) console.log(`${r.name.padEnd(20)} ${r.isRyr.toFixed(1).padStart(9)} ${((r.isE >= 0 ? "+" : "") + r.isE.toFixed(3)).padStart(8)} ${((r.oosE >= 0 ? "+" : "") + r.oosE.toFixed(3)).padStart(9)} ${r.oosRyr.toFixed(1).padStart(9)} ${r.oosT.toFixed(2).padStart(7)}  ${r.holds ? "✓ HOLDS OOS" : "✗ fails OOS"}`);
const picked = rows[0];
console.log(`\n══ IS-SELECTED WINNER: ${picked.name} (IS ${picked.isRyr.toFixed(1)} R/yr) → OOS ${picked.oosE >= 0 ? "+" : ""}${picked.oosE.toFixed(3)}R, ${picked.oosRyr.toFixed(1)} R/yr, t=${picked.oosT} ${picked.holds ? "✓ HOLDS" : "✗ FAILS"} ══`);
const survivors = rows.filter((r) => r.holds).sort((a, b) => b.oosRyr - a.oosRyr);
console.log(`\nVariants that HOLD OOS (${survivors.length}/${rows.length}), ranked by OOS R/yr — the honest frontier:`);
for (const s of survivors.slice(0, 6)) console.log(`   ${s.name.padEnd(20)} OOS ${(s.oosE >= 0 ? "+" : "") + s.oosE.toFixed(3)}R  ${s.oosRyr.toFixed(1).padStart(6)} R/yr  t=${s.oosT}`);
// concurrency-capped equity curve for the best OOS survivor vs baseline
function curveHeatCapped(name: string) {
  const tr = [...T[name]].sort((a, b) => a.date < b.date ? -1 : 1); if (!tr.length) return;
  let eq = DEPOSIT; const c: number[] = []; const open: { exit: number; risk: number }[] = []; let minEq = DEPOSIT, skipped = 0;
  for (const t of tr) {
    const now = Date.parse(t.date);
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exit <= now) open.splice(i, 1);
    const heat = open.reduce((s, o) => s + o.risk, 0);
    const banked = Math.max(0, eq - DEPOSIT);
    let risk = Math.min(DEPOSIT * 0.005 + banked * 0.02, eq * 0.02);
    const room = Math.max(0, eq * MAX_HEAT - heat); risk = Math.min(risk, room);
    if (risk <= 0) { skipped++; continue; }
    open.push({ exit: Date.parse(t.exitDate), risk });
    eq += risk * t.r; if (eq < minEq) minEq = eq; c.push(eq);
  }
  const rets: number[] = []; for (let i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
  const yrs = (Date.parse(tr[tr.length - 1].date) - Date.parse(tr[0].date)) / (365.25 * 864e5);
  const dd = maxDrawdown(rets) * 100, mult = eq / DEPOSIT;
  console.log(`   ${name.padEnd(20)} $${Math.round(eq).toLocaleString().padStart(11)} ${mult.toFixed(2).padStart(7)}× ${((Math.pow(mult, 1 / yrs) - 1) * 100).toFixed(1).padStart(5)}% ${dd.toFixed(1).padStart(6)}% ${(mult / (dd || 1)).toFixed(3).padStart(8)}  ${skipped} (min-eq $${Math.round(minEq).toLocaleString()})`);
}
console.log(`\nCONCURRENCY-CAPPED equity curves (total open risk ≤ ${(MAX_HEAT * 100).toFixed(0)}% — the E2 fix).`);
console.log(`The decisive practical metric is RETURN ÷ DRAWDOWN — frequency you cannot hold within your heat budget is worthless:`);
console.log(`   ${"variant".padEnd(20)} ${"final".padStart(12)} ${"mult".padStart(7)} ${"CAGR".padStart(6)} ${"maxDD".padStart(7)} ${"mult/DD".padStart(8)}  skipped`);
for (const s of survivors.slice(0, 6)) curveHeatCapped(s.name);
