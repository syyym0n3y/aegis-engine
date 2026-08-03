#!/usr/bin/env -S deno run --allow-net
// trd-macro-correlation — ties the identified patterns back to the ECONOMY. Runs the key strategies
// on DAILY bars (years of history, where macro actually varies) and tags every trade with the
// contemporaneous macro regime: VIX tercile (risk-on/off) and yield-curve sign (normal/inverted).
// Reports expectancy by macro bucket + the correlation of per-trade R with VIX and the curve. This
// is how "when do these work" connects to fragility (D-079): if a pattern's edge concentrates in a
// macro regime, that regime becomes its deployment gate — honest conditional advantage.

import { type Bar, type ComponentSpec, runComponentTrades } from "../supabase/functions/_shared/trd-grammar.ts";

async function daily(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  return out;
}
async function series(sym: string): Promise<Map<string, number>> {
  const b = await daily(sym); const m = new Map<string, number>();
  for (const x of b) m.set(x.ts.slice(0, 10), x.close);
  return m;
}
function tercile(v: number, sorted: number[]): "lo" | "mid" | "hi" { const a = sorted[Math.floor(sorted.length / 3)], b = sorted[Math.floor(2 * sorted.length / 3)]; return v <= a ? "lo" : v <= b ? "mid" : "hi"; }
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 3) return 0; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

console.log(`\n[macro-correlation] does the edge of these patterns tie to the economy (VIX regime, yield curve)?\n`);
const vix = await series("^VIX");
const tnx = await series("^TNX"); const irx = await series("^IRX");
const vixSorted = [...vix.values()].sort((a, b) => a - b);

const SPECS: [string, ComponentSpec][] = [
  ["sweep-rr3", { trigger: "sweep", emaPeriod: 20, trendMode: "with", stopLookback: 5, rr: 3, session: "all" }],
  ["breakout-rr2", { trigger: "breakout", emaPeriod: 30, trendMode: "with", stopLookback: 5, rr: 2, session: "all" }],
  ["pullback-rr2", { trigger: "pullback", emaPeriod: 50, trendMode: "with", stopLookback: 5, rr: 2, session: "all" }],
  ["pinbar-rr3", { trigger: "pinbar", emaPeriod: 50, trendMode: "none", stopLookback: 5, rr: 3, session: "all" }],
];
const MARKETS: [string, string][] = [["BTC", "BTC-USD"], ["Gold", "GC=F"], ["S&P", "ES=F"], ["Nasdaq", "NQ=F"]];

for (const [mName, sym] of MARKETS) {
  const bars = await daily(sym); if (bars.length < 300) { console.log(`  ${mName}: ${bars.length} bars — skip`); continue; }
  console.log(`── ${mName} (${bars.length} daily bars) ──`);
  for (const [sName, spec] of SPECS) {
    const trades = runComponentTrades(bars, spec, { costRPerSide: 0.05 });
    if (trades.length < 30) { console.log(`   ${sName}: only ${trades.length} trades`); continue; }
    const byVix: Record<string, number[]> = { lo: [], mid: [], hi: [] };
    const byCurve: Record<string, number[]> = { normal: [], inverted: [] };
    const rArr: number[] = [], vArr: number[] = [], cArr: number[] = [];
    for (const t of trades) {
      const d = t.entryTs.slice(0, 10); const v = vix.get(d); const cv = (tnx.get(d) ?? NaN) - (irx.get(d) ?? NaN);
      if (v !== undefined) { byVix[tercile(v, vixSorted)].push(t.r); rArr.push(t.r); vArr.push(v); }
      if (Number.isFinite(cv)) { byCurve[cv < 0 ? "inverted" : "normal"].push(t.r); cArr.push(cv); }
    }
    const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const corrV = pearson(rArr, vArr);
    const cR: number[] = [], cC: number[] = [];
    for (const t of trades) { const d = t.entryTs.slice(0, 10); const cv = (tnx.get(d) ?? NaN) - (irx.get(d) ?? NaN); if (Number.isFinite(cv)) { cR.push(t.r); cC.push(cv); } }
    const corrC = pearson(cR, cC);
    console.log(`   ${sName.padEnd(13)} n=${String(trades.length).padStart(4)} | VIX exp: lo ${mean(byVix.lo).toFixed(2)}R(${byVix.lo.length}) mid ${mean(byVix.mid).toFixed(2)}R(${byVix.mid.length}) hi ${mean(byVix.hi).toFixed(2)}R(${byVix.hi.length}) | curve: normal ${mean(byCurve.normal).toFixed(2)}R(${byCurve.normal.length}) inverted ${mean(byCurve.inverted).toFixed(2)}R(${byCurve.inverted.length})`);
    console.log(`   ${" ".repeat(13)}    corr(R,VIX)=${corrV >= 0 ? "+" : ""}${corrV.toFixed(3)}  corr(R,curve)=${corrC >= 0 ? "+" : ""}${corrC.toFixed(3)}`);
  }
}
console.log(`\nRead: a bucket where expectancy is consistently higher = a macro regime the pattern likes (its deployment gate).`);
console.log(`corr(R,VIX)>0 ⇒ the pattern pays MORE in high-fear regimes; corr(R,curve)<0 ⇒ pays more when the curve inverts (late-cycle).`);
console.log(`This is the honest bridge from chart patterns to the economic cycle — feeds the D-079 de-risk overlay's deployment logic.`);
