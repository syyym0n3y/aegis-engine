#!/usr/bin/env -S deno run --allow-net
// trd-conditional-search — the "WHEN do they work" engine. A setup with no UNCONDITIONAL edge
// often has positive expectancy INSIDE a condition (a trend regime, a volatility band, a session).
// That conditional edge — deployed only when its condition holds, sized by Kelly, protected by the
// firewall, de-risked by macro — is where honest advantage actually lives. This runs the full
// canon (4320 strategies) over real multi-market data, slices every strategy's trades by regime,
// and reports the (strategy × condition) cells that survive OUT-OF-SAMPLE and clear DSR deflated by
// the TRUE, much larger, conditional trial count. Higher bar, honest. Most still die — the few that
// don't are real leads for paper promotion.

import { type Bar, type CTrade, enumerate, runComponentTrades, specKey } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";

const COST_R = 0.05;
const MIN_FULL = 25, MIN_HALF = 8;

async function yahoo15m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  return out;
}

// the conditions we slice every strategy by (each trade already carries its entry regime tags)
const CONDS: { name: string; test: (t: CTrade) => boolean }[] = [
  { name: "all", test: () => true },
  { name: "trend=up", test: (t) => t.trend === "up" }, { name: "trend=down", test: (t) => t.trend === "down" },
  { name: "vol=lo", test: (t) => t.vol === "lo" }, { name: "vol=hi", test: (t) => t.vol === "hi" },
  { name: "sess=asia", test: (t) => t.session === "asia" }, { name: "sess=london", test: (t) => t.session === "london" }, { name: "sess=ny", test: (t) => t.session === "ny" },
];

const MARKETS: [string, string][] = [["Gold", "GC=F"], ["BTC", "BTC-USD"], ["ETH", "ETH-USD"], ["S&P", "ES=F"]];
const specs = enumerate();
console.log(`\n[conditional-search] ${specs.length} strategies × ${MARKETS.length} markets × ${CONDS.length} conditions.`);
console.log(`  Finding WHEN each setup works. Gate: OOS net>0 in the condition (both halves) AND DSR>0.95 deflated by ALL conditional trials.\n`);

interface Cand { market: string; spec: string; cond: string; n: number; exp: number; sh: number; rs: number[]; }
const allSharpes: number[] = []; const cands: Cand[] = [];
let cells = 0, oosPos = 0;

for (const [name, sym] of MARKETS) {
  const bars = await yahoo15m(sym);
  if (bars.length < 800) { console.log(`  ${name}: ${bars.length} bars — skipped`); continue; }
  const mid = Math.floor(bars.length * 0.6);
  const train = bars.slice(0, mid), test = bars.slice(mid);
  let mCells = 0, mOos = 0;
  for (const s of specs) {
    const full = runComponentTrades(bars, s, { costRPerSide: COST_R });
    const tr = runComponentTrades(train, s, { costRPerSide: COST_R });
    const te = runComponentTrades(test, s, { costRPerSide: COST_R });
    for (const c of CONDS) {
      const rf = full.filter(c.test).map((t) => t.r);
      if (rf.length < MIN_FULL) continue;
      cells++; mCells++;
      const sh = sharpe(rf); allSharpes.push(sh);
      const rtr = tr.filter(c.test).map((t) => t.r), rte = te.filter(c.test).map((t) => t.r);
      if (rtr.length < MIN_HALF || rte.length < MIN_HALF) continue;
      if (mean(rtr) > 0 && mean(rte) > 0) { oosPos++; mOos++; cands.push({ market: name, spec: specKey(s), cond: c.name, n: rf.length, exp: mean(rf), sh, rs: rf }); }
    }
  }
  console.log(`  ${name.padEnd(5)} ${String(bars.length).padStart(5)} bars → ${mCells} conditional cells → ${mOos} positive out-of-sample`);
}

const nTrials = Math.max(1, allSharpes.length);
const vMean = mean(allSharpes); const varTrials = allSharpes.length > 1 ? mean(allSharpes.map((x) => (x - vMean) ** 2)) : 0;
console.log(`\nFUNNEL: ${cells} conditional cells (≥${MIN_FULL} trades) → ${oosPos} positive out-of-sample (${(oosPos / cells * 100).toFixed(1)}%).`);

cands.sort((a, b) => b.exp - a.exp);
let cleared = 0;
console.log(`\nDeflating each survivor for the ${nTrials}-cell search (DSR>0.95 = a real conditional edge):`);
console.log(`  market  strategy                                       WHEN         n    exp     DSR     verdict`);
for (const c of cands.slice(0, 20)) {
  const dsr = deflatedSharpe(c.sh, c.n, skewness(c.rs), kurtosis(c.rs), nTrials, varTrials);
  const ok = dsr > 0.95; if (ok) cleared++;
  console.log(`  ${c.market.padEnd(6)} ${c.spec.padEnd(44)} ${c.cond.padEnd(11)} ${String(c.n).padStart(4)}  ${c.exp >= 0 ? "+" : ""}${c.exp.toFixed(3)}  ${(dsr * 100).toFixed(1).padStart(5)}%  ${ok ? "REAL CONDITIONAL EDGE" : "overfit → reject"}`);
}
console.log(`\nVERDICT: ${cleared} of ${cands.length} out-of-sample conditional edges clear DSR-deflation across ${nTrials} cells.`);
if (cleared === 0) console.log(`  → No conditional edge survives honest deflation in this run. The genre is efficiently arbitraged at 15m.\n    Next: finer conditions (news windows, day-of-week), higher timeframes, and the factor book (the one that DID clear).`);
else console.log(`  → ${cleared} genuine conditional edge(s) — deploy ONLY in-condition, paper-first via the ladder. This is the product.`);
