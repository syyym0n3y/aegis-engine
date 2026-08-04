#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// trd-market-scan — collect + analyse the ENTIRE liquid market. Runs the two surviving leads
// (sweep-rr3 long/short, vol-squeeze breakout) across every major instrument in every asset class
// on daily data, deflates the best by trial count, and reports the coverage map + honest survivors.
// The point isn't to find more edges (more instruments = more multiple-testing = higher bar) — it's
// COMPLETE coverage: prove the cross-cutting law holds across the whole market, and locate where the
// leads concentrate. Output written to a JSON for cataloging.

import { type Bar, runComponentTrades } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, sampleStd, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";
const OUT = Deno.env.get("OUT_FILE") ?? "/tmp/market-scan.json";

const UNIVERSE: Record<string, string[]> = {
  "US large-cap": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK-B","JPM","V","UNH","XOM","JNJ","WMT","MA","PG","HD","COST","ABBV","BAC","KO","PEP","AVGO","CVX","MRK","LLY","ADBE","CRM","NFLX","AMD","INTC","QCOM","TXN","ORCL","DIS","NKE","MCD","CAT","BA","GE"],
  "ETF broad/sector": ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GLD","SLV","USO","TLT","HYG","LQD","EEM","EFA","VNQ","ARKK"],
  "global index": ["^GSPC","^IXIC","^DJI","^RUT","^FTSE","^N225","^GDAXI","^FCHI","^HSI","^STOXX50E","^AXJO","^GSPTSE","^KS11"],
  "commodity fut": ["GC=F","SI=F","CL=F","NG=F","HG=F","ZC=F","ZW=F","ZS=F","KC=F","CT=F","PL=F","PA=F"],
  "FX": ["EURUSD=X","GBPUSD=X","JPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X","EURGBP=X","EURJPY=X","GBPJPY=X","USDMXN=X","USDZAR=X"],
  "rates": ["^TNX","^TYX","^FVX","^IRX"],
  "crypto": ["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","AVAX-USD","LINK-USD","DOT-USD","LTC-USD","BCH-USD","UNI-USD","ATOM-USD","XLM-USD"],
};

async function daily(sym: string): Promise<Bar[]> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return []; const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
    const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: Bar[] = [];
    for (let i = 0; i < t.length; i++) { const a = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([a, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ ts: new Date(t[i] * 1000).toISOString(), open: a, high: h, low: l, close: c }); }
    return o;
  } catch { return []; }
}
function ema(v: number[], p: number) { const k = 2 / (p + 1); let e = v[0]; const o = [e]; for (let i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); o.push(e); } return o; }
function squeeze(b: Bar[]): number[] {
  const W = 20; const ret = b.slice(1).map((x, i) => x.close / b[i].close - 1); const vol: number[] = [];
  for (let i = W; i < b.length; i++) vol.push(sampleStd(ret.slice(i - W, i)));
  const sorted = [...vol].sort((a, z) => a - z); const loT = sorted[Math.floor(vol.length / 3)] ?? 0; const rs: number[] = [];
  for (let i = W; i + 1 < b.length; i++) { const vi = vol[i - W]; if (vi === undefined || vi > loT) continue; const win = b.slice(i - W, i); const hh = Math.max(...win.map((x) => x.high)), ll = Math.min(...win.map((x) => x.low)); const rng = hh - ll; if (!(rng > 0)) continue; const nx = b[i]; let side = 0; if (nx.close > hh) side = 1; else if (nx.close < ll) side = -1; if (!side) continue; const entry = nx.close, target = entry + side * 0.45 * rng, stop = entry - side * 0.225 * rng, risk = Math.abs(entry - stop); let r: number | null = null; for (let m = i + 1; m < Math.min(i + 15, b.length); m++) { if (side === 1) { if (b[m].low <= stop) { r = -1; break; } if (b[m].high >= target) { r = (target - entry) / risk; break; } } else { if (b[m].high >= stop) { r = -1; break; } if (b[m].low <= target) { r = (entry - target) / risk; break; } } } if (r === null) { const last = b[Math.min(i + 14, b.length - 1)].close; r = (side === 1 ? last - entry : entry - last) / risk; } rs.push(r - 0.1); }
  return rs;
}

interface Row { market: string; cls: string; strat: string; n: number; exp: number; sh: number; rs: number[]; }
const rows: Row[] = []; const allSh: number[] = [];
let scanned = 0, totalBars = 0;
for (const [cls, syms] of Object.entries(UNIVERSE)) {
  for (const sym of syms) {
    const b = await daily(sym); if (b.length < 300) continue; scanned++; totalBars += b.length;
    // sweep-rr3 long (the pre-registered lead spec), on daily
    const sweep = runComponentTrades(b, { trigger: "sweep", emaPeriod: 20, trendMode: "with", stopLookback: 5, rr: 3, session: "all" }, { costRPerSide: 0.05 }).map((t) => t.r);
    const sq = squeeze(b);
    for (const [strat, rs] of [["sweep-rr3", sweep], ["squeeze", sq]] as [string, number[]][]) {
      if (rs.length < 25) continue; const sh = sharpe(rs); allSh.push(sh); rows.push({ market: sym, cls, strat, n: rs.length, exp: mean(rs), sh, rs });
    }
  }
  console.log(`  ${cls}: scanned (running total ${scanned} instruments)`);
}
const nTrials = Math.max(1, allSh.length); const vm = mean(allSh); const varT = allSh.length > 1 ? mean(allSh.map((x) => (x - vm) ** 2)) : 0;
for (const r of rows) (r as any).dsr = deflatedSharpe(r.sh, r.n, skewness(r.rs), kurtosis(r.rs), nTrials, varT);
const posIS = rows.filter((r) => r.exp > 0).length;
const cleared = rows.filter((r) => (r as any).dsr > 0.95);
rows.sort((a, b) => (b as any).dsr - (a as any).dsr);
// per-class positive rate
const byClass: Record<string, { n: number; pos: number }> = {};
for (const r of rows) { (byClass[r.cls] ??= { n: 0, pos: 0 }); byClass[r.cls].n++; if (r.exp > 0) byClass[r.cls].pos++; }

console.log(`\n═══ ENTIRE-MARKET SCAN ═══`);
console.log(`instruments scanned: ${scanned} across ${Object.keys(UNIVERSE).length} asset classes | ${totalBars.toLocaleString()} bars | ${rows.length} strategy-instrument trials`);
console.log(`positive in-sample: ${posIS}/${rows.length} (${(posIS / rows.length * 100).toFixed(0)}%) | cleared DSR-deflation: ${cleared.length}`);
console.log(`\nper-asset-class positive-in-sample rate:`);
for (const [c, v] of Object.entries(byClass)) console.log(`  ${c.padEnd(16)} ${v.pos}/${v.n} (${(v.pos / v.n * 100).toFixed(0)}%)`);
console.log(`\ntop 12 by deflated Sharpe (of ${rows.length}):`);
for (const r of rows.slice(0, 12)) console.log(`  ${r.market.padEnd(10)} ${r.cls.padEnd(15)} ${r.strat.padEnd(10)} n=${String(r.n).padStart(4)} exp=${r.exp >= 0 ? "+" : ""}${r.exp.toFixed(3)}R dsr=${((r as any).dsr * 100).toFixed(1)}% ${(r as any).dsr > 0.95 ? "*** CLEARS" : ""}`);
await Deno.writeTextFile(OUT, JSON.stringify({ scanned, classes: Object.keys(UNIVERSE).length, totalBars, trials: rows.length, positiveInSample: posIS, clearedDSR: cleared.length, byClass, top: rows.slice(0, 30).map((r) => ({ market: r.market, cls: r.cls, strat: r.strat, n: r.n, exp: +r.exp.toFixed(3), dsr: +(r as any).dsr.toFixed(4) })) }, null, 2));
console.log(`\nVERDICT: ${cleared.length === 0 ? "the entire liquid market confirms the law — 0 instruments clear deflation; the leads concentrate but none certify unconditionally" : cleared.length + " instrument(s) clear — investigate"}. written -> ${OUT}`);
