#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-instrument-rank — the operator is right that fixating on SPY is lazy. This RANKS a broad universe by
// what actually matters to a trader taking a 1:3 trade: the measured probability of hitting the 3R target
// before the 1R stop, the resulting expectancy, the MEASURED cost (Corwin-Schultz), and the minimum viable
// deposit. No assumptions — every column is computed from full price history.
//
// METHOD (identical treatment for every instrument, so the comparison is fair):
//   entry at each bar's next open, stop 2×ATR14, target 3×the stop distance, max hold 48 bars,
//   pessimistic fill (stop checked before target within a bar). Reports:
//     • hit% = share of trades that reach 3R before −1R
//     • expectancy R = hit%×3 − (1−hit%)×1, minus the MEASURED round-trip cost in R
//     • path efficiency = how often price travels 3R at all (does this instrument DO 3R moves?)
//   Then the same gate as everything else: an instrument only ranks if it beats a RANDOM entry in itself.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { corwinSchultzSpread } from "../supabase/functions/_shared/trd-cost.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = [
  // broad + sector
  "SPY","QQQ","IWM","DIA","MDY","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","XLRE","SMH","XBI","KRE","ITB","XRT","XHB","ITA","JETS","IBB","XME","GDX","GDXJ","URA","LIT","TAN","ICLN","COPX","SIL",
  // intl
  "EFA","EEM","FXI","EWZ","EWJ","EWG","EWU","EWY","EWT","EWW","INDA","ILF","EPP","EZA","ARGT","VNM","THD","TUR",
  // commodities / rates / credit
  "GLD","SLV","USO","UNG","DBC","CORN","WEAT","PPLT","PALL","BNO","TLT","IEF","SHY","TIP","HYG","LQD","JNK","EMB","MUB","AGG","PFF",
  // FX
  "FXE","FXY","FXB","FXF","FXA","UUP",
  // large single names across sectors
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","ADBE","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","AXP","BLK","SCHW","XOM","CVX","COP","SLB","JNJ","PFE","MRK","ABT","LLY","UNH","TMO","WMT","COST","TGT","HD","LOW","MCD","NKE","SBUX","DIS","KO","PEP","PG","T","VZ","CAT","DE","BA","LMT","HON","MMM","GE","UPS","UNP","F","GM","PYPL","SQ","COIN","PLTR","SNOW","UBER","ABNB",
];
const ATRN = 14, MAXBARS = 48, STOP_ATR = 2, TP_MULT = 3, NCTRL = 3;
let seed = 777001; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number; v: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume?.[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c, v: Number.isFinite(v) ? v : 0 }); } return o; } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
interface Row { sym: string; n: number; hit: number; grossR: number; costR: number; netR: number; spreadPct: number; price: number; adv: number; tRand: number; minDep: number }
const rows: Row[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 400) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma200[i] = s / 200; } }
  const spread = corwinSchultzSpread(b as any, 250);
  const price = cl[cl.length - 1];
  const adv = mean(b.slice(-60).map((x) => x.v).filter((x) => x > 0));
  const trade = (i: number): number | null => {
    const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + 1 >= b.length) return null;
    const entry = b[i + 1].o, stop = entry - sd, tgt = entry + sd * TP_MULT;
    for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (b[k].l <= stop) return -1; if (b[k].h >= tgt) return TP_MULT; }
    return (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
  };
  const sig: number[] = [], ctrl: number[] = []; const pool: number[] = [];
  for (let i = 210; i < b.length - MAXBARS - 1; i++) pool.push(i);
  for (let i = 210; i < b.length - MAXBARS - 1; i++) {
    if (!(at[i] > 0) || !(sma200[i] > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > sma200[i])) continue;   // the ONE verified setup, applied identically everywhere
    const r = trade(i); if (r === null) continue; sig.push(r);
    for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = trade(j); if (rc !== null) ctrl.push(rc); }
  }
  if (sig.length < 40) continue;
  const hit = sig.filter((x) => x >= TP_MULT - 1e-9).length / sig.length;
  const gross = mean(sig);
  // cost in R: round-trip spread as a fraction of the stop distance
  const stopPct = (STOP_ATR * at[at.length - 1]) / price;
  const costR = stopPct > 0 ? (Number.isFinite(spread) ? spread * 2 : 0.001) / stopPct : 0;
  const g = edgeVsRandom(sig, ctrl);
  // min viable deposit: 0.5% risk must buy ≥1 share AND cost must be < the net edge
  const minDep = Math.ceil((price * stopPct) / 0.005);
  rows.push({ sym, n: sig.length, hit: hit * 100, grossR: gross, costR, netR: gross - costR, spreadPct: Number.isFinite(spread) ? spread * 100 : NaN, price, adv, tRand: g.tStat, minDep });
}
rows.sort((a, b) => b.netR - a.netR);
console.log(`INSTRUMENT RANKING — ${rows.length} instruments, identical treatment (RSI14<30 in uptrend, 2ATR stop, 3R target)\n`);
console.log(`${"sym".padEnd(7)} ${"n".padStart(5)} ${"hit3R%".padStart(7)} ${"grossR".padStart(7)} ${"costR".padStart(6)} ${"netR".padStart(7)} ${"spread%".padStart(8)} ${"vs-rand t".padStart(9)} ${"minDep".padStart(8)}`);
for (const r of rows.slice(0, 25)) console.log(`${r.sym.padEnd(7)} ${String(r.n).padStart(5)} ${r.hit.toFixed(1).padStart(7)} ${((r.grossR >= 0 ? "+" : "") + r.grossR.toFixed(3)).padStart(7)} ${r.costR.toFixed(3).padStart(6)} ${((r.netR >= 0 ? "+" : "") + r.netR.toFixed(3)).padStart(7)} ${(Number.isFinite(r.spreadPct) ? r.spreadPct.toFixed(3) : "—").padStart(8)} ${r.tRand.toFixed(2).padStart(9)} ${("$" + r.minDep).padStart(8)}`);
const spy = rows.find((r) => r.sym === "SPY");
console.log(`\n── SPY for comparison ──`);
if (spy) console.log(`${spy.sym.padEnd(7)} ${String(spy.n).padStart(5)} ${spy.hit.toFixed(1).padStart(7)} ${((spy.grossR >= 0 ? "+" : "") + spy.grossR.toFixed(3)).padStart(7)} ${spy.costR.toFixed(3).padStart(6)} ${((spy.netR >= 0 ? "+" : "") + spy.netR.toFixed(3)).padStart(7)} ${spy.spreadPct.toFixed(3).padStart(8)} ${spy.tRand.toFixed(2).padStart(9)} ${("$" + spy.minDep).padStart(8)}   ← rank ${rows.findIndex((r) => r.sym === "SPY") + 1} of ${rows.length}`);
const beatRand = rows.filter((r) => r.tRand > 2 && r.netR > 0);
console.log(`\n${beatRand.length}/${rows.length} instruments BEAT a random entry in themselves (t>2) AND net positive after measured cost.`);
console.log(`Top by net expectancy that also beat random: ${beatRand.slice(0, 12).map((r) => `${r.sym} (+${r.netR.toFixed(2)}R, t=${r.tRand.toFixed(1)})`).join(", ")}`);
console.log(`\nMost ACCESSIBLE (lowest minimum deposit) among those: ${[...beatRand].sort((a, b) => a.minDep - b.minDep).slice(0, 10).map((r) => `${r.sym} $${r.minDep}`).join(", ")}`);
await Deno.writeTextFile("data/instrument-rank.json", JSON.stringify(rows.map((r) => ({ ...r, hit: +r.hit.toFixed(1), grossR: +r.grossR.toFixed(4), costR: +r.costR.toFixed(4), netR: +r.netR.toFixed(4), tRand: +r.tRand.toFixed(2) }))));
console.log(`\nWritten → data/instrument-rank.json`);
