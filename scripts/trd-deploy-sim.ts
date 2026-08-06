#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-deploy-sim — the REAL time-to-10× for the DEPLOYABLE system: the verified dip-buy fired across the
// whole book, in chronological order, sized by house-money + heat cap, compounded on actual outcomes.
// Earlier "49 years" assumed 25 trades/yr on ONE instrument. Across 45 instruments the fire rate is far
// higher — but D-151 showed book-wide dilution and correlation. This resolves the tension with the ACTUAL
// trades: generate every dip-buy signal across the book, order by date, walk the portfolio with the 6% heat
// cap (so correlated same-day fires compete for one budget), and measure real years-to-10× + max drawdown.
import { mean, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
const BOOK = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","TLT","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F","EEM","EFA","FXI","IEF","DBC","EWZ"];
const ATRN = 14, STOP_ATR = 2, TP_MULT = 3, H = 5, COST_R = 0.056, MAX_HEAT = 0.06, BASE = 0.005, HOUSE = 0.02, DEPOSIT = 100;
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
interface Sig { entryDate: string; exitDate: string; r: number; stopPct: number }
const sigs: Sig[] = [];
for (const sym of BOOK) {
  const b = await daily(sym); if (b.length < 300) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma[i] = s / 200; } }
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0) || !(sma[i] > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > sma[i])) continue;
    const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4)) continue;
    const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; let exi = i + H;
    for (let k = i + 1; k <= i + H; k++) { if (b[k].l <= stop) { r = -1; exi = k; break; } if (b[k].h >= entry + sd * TP_MULT) { r = TP_MULT; exi = k; break; } }
    if (r === null) r = (b[i + H].c - entry) / sd;
    sigs.push({ entryDate: b[i + 1].d, exitDate: b[exi].d, r: r - COST_R, stopPct: sd / entry * 100 });
  }
}
sigs.sort((a, b) => a.entryDate < b.entryDate ? -1 : 1);
const yrs = (Date.parse(sigs[sigs.length - 1].entryDate) - Date.parse(sigs[0].entryDate)) / (365.25 * 864e5);
console.log(`DEPLOYABLE SYSTEM SIM — dip-buy across ${BOOK.length} instruments, ${sigs.length.toLocaleString()} signals over ${yrs.toFixed(1)}y (${(sigs.length / yrs).toFixed(0)}/yr)`);
console.log(`Net edge/trade (after ${COST_R}R cost): ${mean(sigs.map((s) => s.r)).toFixed(4)}R  |  win% ${(sigs.filter((s) => s.r > 0).length / sigs.length * 100).toFixed(0)}\n`);
// walk the portfolio with the heat cap
function run(riskMode: "fixed05" | "house") {
  let eq = DEPOSIT; const open: { exit: string; risk: number }[] = []; const curve: number[] = []; let minEq = DEPOSIT, skipped = 0; let firstTenDate: string | null = null;
  for (const s of sigs) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exit <= s.entryDate) open.splice(i, 1);
    const heat = open.reduce((a, o) => a + o.risk, 0);
    const banked = Math.max(0, eq - DEPOSIT);
    let risk = riskMode === "house" ? Math.min((DEPOSIT * BASE + banked * HOUSE), eq * 0.02) : eq * BASE;
    risk = Math.min(risk, Math.max(0, eq * MAX_HEAT - heat));
    if (risk <= 0) { skipped++; continue; }
    open.push({ exit: s.exitDate, risk }); eq += risk * s.r;
    if (eq < minEq) minEq = eq; curve.push(eq);
    if (!firstTenDate && eq >= DEPOSIT * 10) firstTenDate = s.entryDate;
  }
  const rets: number[] = []; for (let i = 1; i < curve.length; i++) rets.push(curve[i] / curve[i - 1] - 1);
  const dd = maxDrawdown(rets) * 100;
  const yearsToTen = firstTenDate ? (Date.parse(firstTenDate) - Date.parse(sigs[0].entryDate)) / (365.25 * 864e5) : null;
  return { end: eq, mult: eq / DEPOSIT, dd, minEq, skipped, yearsToTen };
}
for (const mode of ["fixed05", "house"] as const) {
  const r = run(mode);
  console.log(`── ${mode === "house" ? "HOUSE MONEY (0.5% deposit + 2% profit)" : "FIXED 0.5% of equity"} ──`);
  console.log(`   final $${r.end.toFixed(0)} from $${DEPOSIT} = ${r.mult.toFixed(1)}×  |  max DD ${r.dd.toFixed(0)}%  |  min equity $${r.minEq.toFixed(0)}`);
  console.log(`   time to FIRST 10×: ${r.yearsToTen ? r.yearsToTen.toFixed(1) + " years" : "never reached in " + yrs.toFixed(0) + "y"}  |  signals skipped by heat cap: ${r.skipped}`);
}
console.log(`\nHONEST FRAME: this assumes the trader takes the dip-buy signal itself (the ONE thing that beats a random`);
console.log(`control). It is the realistic ceiling of the verified system on a $100 account — not a promise, a measured path.`);
