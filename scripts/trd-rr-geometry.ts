#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-rr-geometry — the operator asked which instruments have measurably better probabilities and R:R.
// The FIRST attempt asked it wrongly: ranking by our dip-buy signal gave <40 samples per instrument
// (the signal fires <1×/yr per name) and nothing was significant. That question is unanswerable at that N.
//
// THE RIGHT QUESTION, and it is well-powered: from ANY entry, how often does an instrument travel +3R
// BEFORE −1R (stop = 2×ATR)? That is the instrument's R:R GEOMETRY — a property of its price process
// (trendiness vs chop), measured over EVERY bar, thousands of samples per name, independent of any signal.
// It is directly usable: a trader with their own entries should prefer instruments whose geometry pays.
//
// BREAK-EVEN: at 1:3 you need 25% hit rate to break even before costs. Above that = favourable geometry.
// Everything is net of the MEASURED spread (Corwin-Schultz), and we report both long and short geometry.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { corwinSchultzSpread } from "../supabase/functions/_shared/trd-cost.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","MDY","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","ITB","XRT","ITA","JETS","IBB","XME","GDX","GDXJ","URA","TAN","ICLN","COPX","SIL","EFA","EEM","FXI","EWZ","EWJ","EWG","EWU","EWY","EWT","INDA","GLD","SLV","USO","UNG","DBC","TLT","IEF","HYG","LQD","JNK","EMB","FXE","FXY","FXB","UUP","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","ADBE","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","AXP","BLK","SCHW","XOM","CVX","COP","SLB","JNJ","PFE","MRK","ABT","LLY","UNH","TMO","WMT","COST","TGT","HD","LOW","MCD","NKE","SBUX","DIS","KO","PEP","PG","T","VZ","CAT","DE","BA","LMT","HON","MMM","GE","UPS","UNP","F","GM","PYPL","COIN","PLTR","UBER"];
const ATRN = 14, MAXBARS = 48, STOP_ATR = 2, TP = 3, STEP = 5; // sample every 5th bar → independent-ish, still thousands
interface B { d: string; o: number; h: number; l: number; c: number; v: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume?.[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c, v: Number.isFinite(v) ? v : 0 }); } return o; } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
interface Row { sym: string; n: number; hitLong: number; hitShort: number; expLong: number; expShort: number; costR: number; netLong: number; netShort: number; price: number; spreadPct: number; minDep: number; years: number }
const rows: Row[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const at = atr(b, ATRN); const price = b[b.length - 1].c;
  const spread = corwinSchultzSpread(b as any, 250);
  const path = (i: number, dir: 1 | -1): number | null => {
    const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
    const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP;
    for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) {
      if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) return -1;      // pessimistic: stop first
      if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) return TP;
    }
    return dir * (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
  };
  const L: number[] = [], S: number[] = [];
  for (let i = ATRN + 1; i < b.length - MAXBARS - 1; i += STEP) { const a = path(i, 1), c = path(i, -1); if (a !== null) L.push(a); if (c !== null) S.push(c); }
  if (L.length < 200) continue;
  const stopPct = (STOP_ATR * at[at.length - 1]) / price;
  const costR = stopPct > 0 ? (Number.isFinite(spread) ? spread * 2 : 0.001) / stopPct : 0;
  rows.push({
    sym, n: L.length, years: b.length / 252,
    hitLong: L.filter((x) => x >= TP - 1e-9).length / L.length * 100,
    hitShort: S.filter((x) => x >= TP - 1e-9).length / S.length * 100,
    expLong: mean(L), expShort: mean(S), costR,
    netLong: mean(L) - costR, netShort: mean(S) - costR,
    price, spreadPct: Number.isFinite(spread) ? spread * 200 : NaN,
    minDep: Math.ceil((price * stopPct) / 0.005),
  });
}
rows.sort((a, b) => b.netLong - a.netLong);
console.log(`R:R GEOMETRY — how often each instrument travels +3R before −1R, from EVERY 5th bar, full history`);
console.log(`Break-even at 1:3 is a 25% hit rate. ${rows.length} instruments, ~${Math.round(mean(rows.map((r) => r.n)))} samples each.\n`);
console.log(`${"sym".padEnd(6)} ${"yrs".padStart(5)} ${"n".padStart(6)} ${"LONG hit%".padStart(10)} ${"net R".padStart(8)} ${"SHORT hit%".padStart(11)} ${"net R".padStart(8)} ${"cost R".padStart(7)} ${"minDep".padStart(8)}`);
for (const r of rows.slice(0, 22)) console.log(`${r.sym.padEnd(6)} ${r.years.toFixed(0).padStart(5)} ${String(r.n).padStart(6)} ${r.hitLong.toFixed(1).padStart(10)} ${((r.netLong >= 0 ? "+" : "") + r.netLong.toFixed(3)).padStart(8)} ${r.hitShort.toFixed(1).padStart(11)} ${((r.netShort >= 0 ? "+" : "") + r.netShort.toFixed(3)).padStart(8)} ${r.costR.toFixed(3).padStart(7)} ${("$" + r.minDep).padStart(8)}`);
const spy = rows.find((r) => r.sym === "SPY");
if (spy) console.log(`\nSPY: LONG hit ${spy.hitLong.toFixed(1)}% net ${spy.netLong >= 0 ? "+" : ""}${spy.netLong.toFixed(3)}R  →  RANK ${rows.findIndex((r) => r.sym === "SPY") + 1} of ${rows.length}`);
const good = rows.filter((r) => r.hitLong > 25 && r.netLong > 0);
console.log(`\n${good.length}/${rows.length} instruments have LONG geometry above the 25% break-even AND positive net expectancy.`);
console.log(`${rows.filter((r) => r.hitShort > 25 && r.netShort > 0).length}/${rows.length} have favourable SHORT geometry.`);
console.log(`\nBEST for a 1:3 long: ${good.slice(0, 12).map((r) => `${r.sym} ${r.hitLong.toFixed(0)}%`).join(", ")}`);
console.log(`MOST ACCESSIBLE of those (min deposit): ${[...good].sort((a, b) => a.minDep - b.minDep).slice(0, 10).map((r) => `${r.sym} $${r.minDep}`).join(", ")}`);
await Deno.writeTextFile("data/rr-geometry.json", JSON.stringify(rows.map((r) => ({ ...r, hitLong: +r.hitLong.toFixed(1), hitShort: +r.hitShort.toFixed(1), expLong: +r.expLong.toFixed(4), expShort: +r.expShort.toFixed(4), netLong: +r.netLong.toFixed(4), netShort: +r.netShort.toFixed(4), costR: +r.costR.toFixed(4), years: +r.years.toFixed(1) }))));
console.log(`\nWritten → data/rr-geometry.json`);
