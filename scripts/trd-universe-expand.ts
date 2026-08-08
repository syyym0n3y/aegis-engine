#!/usr/bin/env -S deno run --allow-net
// trd-universe-expand — D-150 concluded the frequency constraint is CORRELATION, not the threshold: loosening
// parameters fires more but all at once (correlated market-wide dips) → huge DD + signals the heat budget
// can't hold. The legitimate route to more fires is MORE UNCORRELATED INSTRUMENTS at the UNCHANGED baseline
// spec (RSI14<30 while price>200MA). This tests exactly that: expand 45 → ~110 instruments spanning US
// sectors, international single-country, EM, commodities, rates, credit, FX, crypto proxies and single names,
// then measure (a) fires/yr, (b) edge vs random, (c) SIGNAL CLUSTERING (how many fire the same day = the
// correlation tax), (d) concurrency-capped return ÷ drawdown. Only (d) decides.
import { mean, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const BASE45 = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const EXTRA = ["EWJ","EWG","EWU","EWC","EWA","EWY","EWT","EWH","EWW","EWS","EWL","EWD","EWP","EWI","EWQ","EPP","ILF","INDA","EIDO","THD","TUR","EZA","RSX","ARGT","VNM",
  "IYR","VNQ","XME","GDX","GDXJ","SIL","COPX","URA","LIT","TAN","ICLN","JETS","IBB","IHI","XRT","XHB","ITA","PBW","MOO","WOOD","CORN","WEAT","SOYB","CANE","PPLT","PALL","UNG","BNO",
  "SHY","TIP","MUB","EMB","BNDX","AGG","JNK","PFF","CWB","FLOT",
  "FXE","FXY","FXB","FXF","FXA","FXC","UUP","CYB",
  "WMT","PG","T","VZ","MRK","ABT","CVX","CAT","MMM","HON","UNP","LMT","MCD","NKE","SBUX","DIS","HD","LOW","COST","TGT","UPS","IBM","ORCL","QCOM","TXN","AMD","MU","AMAT","ADBE","CRM","PYPL","SQ","NFLX","GS","MS","BAC","C","WFC","AXP","BLK","SCHW"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 2, DEPOSIT = 10000, MAX_HEAT = 0.06;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 11235; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

interface Tr { date: string; sym: string; r: number; ctrl: number[]; exitDate: string; is: boolean; core: boolean }
const ALL: Tr[] = []; let yearsBase = 0, yearsAll = 0; let okBase = 0, okAll = 0;
for (const sym of [...BASE45, ...EXTRA]) {
  const core = BASE45.includes(sym);
  const b = await daily(sym); if (b.length < 500) continue;
  okAll++; if (core) { okBase++; yearsBase += b.length / 252; } yearsAll += b.length / 252;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma200[i] = s / 200; } }
  const cut = Math.floor(b.length * 0.6);
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const price = (i: number, reg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[reg]; };
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0) || !(sma200[i] > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > sma200[i])) continue;
    const v = vix.get(b[i].d) ?? 15; const reg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const r = price(i, reg); if (r === null) continue;
    const ctrl: number[] = []; const pool = byReg[reg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, reg); if (rc !== null) ctrl.push(rc); }
    ALL.push({ date: b[i].d, sym, r, ctrl, exitDate: b[Math.min(i + H, b.length - 1)].d, is: i < cut, core });
  }
}
ALL.sort((a, b) => a.date < b.date ? -1 : 1);
const CORE = ALL.filter((t) => t.core);
function clustering(trs: Tr[]) { const byDay = new Map<string, number>(); for (const t of trs) byDay.set(t.date, (byDay.get(t.date) ?? 0) + 1); const counts = [...byDay.values()]; return { days: counts.length, avgPerDay: mean(counts), maxPerDay: Math.max(...counts) }; }
function curve(trs: Tr[], label: string) {
  let eq = DEPOSIT; const c: number[] = []; const open: { exit: number; risk: number }[] = []; let minEq = DEPOSIT, skipped = 0;
  for (const t of trs) { const now = Date.parse(t.date); for (let i = open.length - 1; i >= 0; i--) if (open[i].exit <= now) open.splice(i, 1);
    const heat = open.reduce((s, o) => s + o.risk, 0); const banked = Math.max(0, eq - DEPOSIT);
    let risk = Math.min(DEPOSIT * 0.005 + banked * 0.02, eq * 0.02); risk = Math.min(risk, Math.max(0, eq * MAX_HEAT - heat));
    if (risk <= 0) { skipped++; continue; }
    open.push({ exit: Date.parse(t.exitDate), risk }); eq += risk * t.r; if (eq < minEq) minEq = eq; c.push(eq); }
  const rets: number[] = []; for (let i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
  const yrs = (Date.parse(trs[trs.length - 1].date) - Date.parse(trs[0].date)) / (365.25 * 864e5);
  const dd = maxDrawdown(rets) * 100, mult = eq / DEPOSIT;
  console.log(`   ${label.padEnd(26)} $${Math.round(eq).toLocaleString().padStart(10)} ${mult.toFixed(2).padStart(7)}× ${((Math.pow(mult, 1 / yrs) - 1) * 100).toFixed(1).padStart(5)}% ${dd.toFixed(1).padStart(6)}% ${(mult / (dd || 1)).toFixed(3).padStart(8)}  ${String(skipped).padStart(5)}  $${Math.round(minEq).toLocaleString()}`);
}
console.log(`UNIVERSE EXPANSION — same UNCHANGED spec (RSI14<30 >200MA), ${okBase} → ${okAll} instruments\n`);
console.log(`${"book".padEnd(12)} ${"instruments".padStart(11)} ${"signals".padStart(8)} ${"fires/yr".padStart(9)} ${"exp R".padStart(8)} ${"vs-random t".padStart(12)}`);
for (const [nm, trs, n, yy] of [["45 (base)", CORE, okBase, yearsBase], ["expanded", ALL, okAll, yearsAll]] as [string, Tr[], number, number][]) {
  const g = edgeVsRandom(trs.map((t) => t.r), trs.flatMap((t) => t.ctrl));
  console.log(`${nm.padEnd(12)} ${String(n).padStart(11)} ${String(trs.length).padStart(8)} ${(trs.length / yy * n).toFixed(1).padStart(9)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(8)} ${g.tStat.toFixed(2).padStart(12)}`);
}
const cB = clustering(CORE), cA = clustering(ALL);
console.log(`\nSIGNAL CLUSTERING (the correlation tax): base avg ${cB.avgPerDay.toFixed(2)}/day (max ${cB.maxPerDay}) → expanded avg ${cA.avgPerDay.toFixed(2)}/day (max ${cA.maxPerDay})`);
console.log(`   ${cA.avgPerDay / cB.avgPerDay < (okAll / okBase) * 0.85 ? "✓ signals spread out — added instruments fire on DIFFERENT days (genuine diversification)" : "✗ signals cluster — added instruments fire on the SAME days (correlated, no diversification)"}`);
console.log(`\nCONCURRENCY-CAPPED CURVES (heat ≤${MAX_HEAT * 100}%):`);
console.log(`   ${"book".padEnd(26)} ${"final".padStart(11)} ${"mult".padStart(7)} ${"CAGR".padStart(6)} ${"maxDD".padStart(7)} ${"mult/DD".padStart(8)}  ${"skip".padStart(5)}  min-eq`);
curve(CORE, "45 instruments (base)"); curve(ALL, `${okAll} instruments (expanded)`);
