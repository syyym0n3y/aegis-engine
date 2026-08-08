#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-xsectional — the biggest unexplored lever (PLAYBOOK gap #4): CROSS-SECTIONAL short-term reversal, where most
// equity alpha actually lives. Every H days, rank the universe by past-k-day return; LONG the bottom quintile
// (biggest losers) and SHORT the top quintile (biggest winners) — market-neutral. Measure the forward H-day
// long-short SPREAD return, net of cost (2bp/side + 8%/yr borrow on the short leg), vs a RANDOM quintile-selection
// control (D-146 applied cross-sectionally). Non-overlapping periods → independent obs. Also tests RSI-rank and a
// trend-filtered variant. Free (Yahoo daily), no look-ahead (rank on data through d, enter next day, hold forward).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, sharpe } from "../supabase/functions/_shared/trd-stats.ts";
const U = ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","ADBE","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","XOM","CVX","COP","SLB","JNJ","PFE","MRK","LLY","UNH","WMT","COST","HD","LOW","MCD","NKE","KO","PEP","PG","CAT","DE","BA","GE","F","GM","UBER"];
const KLOOK = 5, HOLD = 5, QFRAC = 0.2, SPREAD_BPS = 2, BORROW_ANNUAL = 0.08;
let seed = 7777; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp, q = res.indicators.quote[0], o: B[] = []; for (let i = 0; i < t.length; i++) { const c = q.close[i]; if (c == null || !Number.isFinite(c)) continue; o.push({ d: new Date(t[i]*1000).toISOString().slice(0,10), c }); } return o; } catch { return []; } }

// load + align on common dates
const series: Record<string, Map<string, number>> = {};
for (const s of U) { const b = await daily(s); if (b.length < 800) continue; const m = new Map<string, number>(); for (const x of b) m.set(x.d, x.c); series[s] = m; }
const names = Object.keys(series);
const dateCounts = new Map<string, number>();
for (const s of names) for (const d of series[s].keys()) dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
const dates = [...dateCounts.entries()].filter(([, n]) => n >= names.length * 0.9).map(([d]) => d).sort();
console.log(`CROSS-SECTIONAL REVERSAL — ${names.length} names, ${dates.length} aligned days, k=${KLOOK}d rank, ${HOLD}d hold, quintile L/S\n`);

const px = (s: string, d: string) => series[s].get(d);
function periodSpread(di: number, mode: "return" | "trend"): { spread: number; rspread: number } | null {
  const d0 = dates[di - KLOOK], dEntry = dates[di], dExit = dates[di + HOLD];
  if (!d0 || !dEntry || !dExit) return null;
  const rows: { s: string; sig: number; fwd: number }[] = [];
  for (const s of names) {
    const p0 = px(s, d0), pe = px(s, dEntry), px2 = px(s, dExit); if (p0 == null || pe == null || px2 == null) continue;
    const pastRet = (pe - p0) / p0;               // rank signal: past k-day return
    const fwd = (px2 - pe) / pe;                    // forward H-day return (entry next-close proxy = dEntry close)
    rows.push({ s, sig: pastRet, fwd });
  }
  if (rows.length < 20) return null;
  rows.sort((a, b) => a.sig - b.sig);
  const q = Math.max(1, Math.floor(rows.length * QFRAC));
  const losers = rows.slice(0, q), winners = rows.slice(-q);      // long losers, short winners (reversal)
  const cost = (SPREAD_BPS / 10000) * 2 * 2 + BORROW_ANNUAL * (HOLD / 365); // both legs spread + short borrow
  const spread = mean(losers.map((r) => r.fwd)) - mean(winners.map((r) => r.fwd)) - cost;
  // random control: two random disjoint quintiles
  const shuf = [...rows]; for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
  const rl = shuf.slice(0, q), rw = shuf.slice(q, 2 * q);
  const rspread = mean(rl.map((r) => r.fwd)) - mean(rw.map((r) => r.fwd)) - cost;
  return { spread, rspread };
}

const yrs = dates.length / 252;
console.log(`${"config".padEnd(14)} ${"n".padStart(5)} ${"meanSpread%".padStart(11)} ${"vsRand%".padStart(8)} ${"edge%".padStart(7)} ${"t".padStart(6)}  verdict`);
// sweep look-back / hold; also longer horizons flip to MOMENTUM (long winners) — we test reversal both raw + cost
for (const [k, h] of [[1,1],[1,3],[1,5],[3,3],[5,5],[10,10],[20,20]] as const) {
  const sig: number[] = [], ctrl: number[] = [];
  for (let di = k; di + h < dates.length; di += h) {
    const d0 = dates[di - k], dEntry = dates[di], dExit = dates[di + h]; if (!d0 || !dEntry || !dExit) continue;
    const rows: { sig: number; fwd: number }[] = [];
    for (const s of names) { const p0 = px(s, d0), pe = px(s, dEntry), p2 = px(s, dExit); if (p0 == null || pe == null || p2 == null) continue; rows.push({ sig: (pe - p0) / p0, fwd: (p2 - pe) / pe }); }
    if (rows.length < 20) continue;
    rows.sort((a, b) => a.sig - b.sig);
    const q = Math.max(1, Math.floor(rows.length * QFRAC));
    const cost = (SPREAD_BPS / 10000) * 2 * 2 + BORROW_ANNUAL * (h / 365);
    sig.push(mean(rows.slice(0, q).map((r) => r.fwd)) - mean(rows.slice(-q).map((r) => r.fwd)) - cost);
    const shuf = [...rows]; for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
    ctrl.push(mean(shuf.slice(0, q).map((r) => r.fwd)) - mean(shuf.slice(q, 2 * q).map((r) => r.fwd)) - cost);
  }
  const g = edgeVsRandom(sig, ctrl), perYr = sig.length / yrs;
  const ok = g.passes && g.setupMean > 0;
  console.log(`${("k"+k+"/h"+h+" revert").padEnd(14)} ${String(sig.length).padStart(5)} ${((g.setupMean>=0?"+":"")+(g.setupMean*100).toFixed(3)).padStart(11)} ${(g.controlMean*100).toFixed(3).padStart(8)} ${((g.edge*100).toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${ok?"✓✓ EDGE":g.setupMean>0?"pos, not sig":"✗ none"}`);
}
console.log(`\nMarket-neutral L/S: drift confound is CANCELLED by construction (PLAYBOOK #2), so t is cleaner than any`);
console.log(`single-name test. "revert"=long losers/short winners. If none clears, short-term reversal is arbitraged`);
console.log(`out of this liquid mega-cap universe — an honest #4-lever result (would need smaller/illiquid names to revive).`);
