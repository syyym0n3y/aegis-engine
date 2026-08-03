#!/usr/bin/env -S deno run --allow-net --allow-write
// trd-universe-search — the BROAD sweep. Vertical (timeframes: 15m, 1h, 1d) × horizontal (crypto,
// metals, energy, indices, FX, equities) so every timeframe × session × trigger cell has a strategy
// assigned and tested. Runs the full canon (4320 strategies) conditionally over the whole universe,
// deflates by the true (very large) trial count, and PERSISTS the top candidates (the "goldmine")
// so we keep refining them. Honest expectation: broadening raises the bar; higher timeframes are
// where a survivor is most likely. Writes a JSON result file for cataloging into trd_goldmine.

import { type Bar, type CTrade, enumerate, runComponentTrades, specKey } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";

const COST_R = 0.05, MIN_FULL = 25, MIN_HALF = 8;
const OUT = Deno.env.get("OUT_FILE") ?? "/tmp/universe-result.json";

// timeframe → Yahoo range (max history Yahoo allows per granularity)
const TFS: [string, string][] = [["15m", "60d"], ["1h", "730d"], ["1d", "10y"]];
// broad universe across verticals
const SYMBOLS: [string, string][] = [
  ["BTC", "BTC-USD"], ["ETH", "ETH-USD"], ["SOL", "SOL-USD"], ["BNB", "BNB-USD"],
  ["Gold", "GC=F"], ["Silver", "SI=F"], ["Oil", "CL=F"], ["NatGas", "NG=F"], ["Copper", "HG=F"],
  ["S&P", "ES=F"], ["Nasdaq", "NQ=F"], ["Dow", "YM=F"], ["Russ", "RTY=F"],
  ["EURUSD", "EURUSD=X"], ["GBPUSD", "GBPUSD=X"], ["USDJPY", "JPY=X"], ["AUDUSD", "AUDUSD=X"],
  ["AAPL", "AAPL"], ["TSLA", "TSLA"], ["NVDA", "NVDA"],
];

async function yahoo(sym: string, interval: string, range: string): Promise<Bar[]> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
    const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
    for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
    return out;
  } catch { return []; }
}

const CONDS: { name: string; test: (t: CTrade) => boolean }[] = [
  { name: "all", test: () => true },
  { name: "trend=up", test: (t) => t.trend === "up" }, { name: "trend=down", test: (t) => t.trend === "down" },
  { name: "vol=lo", test: (t) => t.vol === "lo" }, { name: "vol=hi", test: (t) => t.vol === "hi" },
  { name: "sess=asia", test: (t) => t.session === "asia" }, { name: "sess=london", test: (t) => t.session === "london" }, { name: "sess=ny", test: (t) => t.session === "ny" },
];

const specs = enumerate();
interface Cand { market: string; tf: string; spec: string; cond: string; n: number; exp: number; sh: number; rs: number[]; }
const allSharpes: number[] = []; const cands: Cand[] = [];
let totalBars = 0, series = 0, cells = 0, oosPos = 0;

for (const [tf, range] of TFS) {
  for (const [name, sym] of SYMBOLS) {
    const bars = await yahoo(sym, tf, range);
    if (bars.length < 400) { console.log(`  skip ${name} ${tf} (${bars.length} bars)`); continue; }
    totalBars += bars.length; series++;
    const mid = Math.floor(bars.length * 0.6);
    const train = bars.slice(0, mid), test = bars.slice(mid);
    for (const s of specs) {
      const full = runComponentTrades(bars, s, { costRPerSide: COST_R });
      if (full.length < MIN_FULL) continue;
      const tr = runComponentTrades(train, s, { costRPerSide: COST_R });
      const te = runComponentTrades(test, s, { costRPerSide: COST_R });
      for (const c of CONDS) {
        const rf = full.filter(c.test).map((t) => t.r); if (rf.length < MIN_FULL) continue;
        cells++; const sh = sharpe(rf); allSharpes.push(sh);
        const rtr = tr.filter(c.test).map((t) => t.r), rte = te.filter(c.test).map((t) => t.r);
        if (rtr.length < MIN_HALF || rte.length < MIN_HALF) continue;
        if (mean(rtr) > 0 && mean(rte) > 0) { oosPos++; cands.push({ market: name, tf, spec: specKey(s), cond: c.name, n: rf.length, exp: mean(rf), sh, rs: rf }); }
      }
    }
    console.log(`  ${name} ${tf}: ${bars.length} bars | cells=${cells} oosPos=${oosPos} (running)`);
  }
}

const nTrials = Math.max(1, allSharpes.length);
const vm = mean(allSharpes); const varTrials = allSharpes.length > 1 ? mean(allSharpes.map((x) => (x - vm) ** 2)) : 0;
for (const c of cands) (c as any).dsr = deflatedSharpe(c.sh, c.n, skewness(c.rs), kurtosis(c.rs), nTrials, varTrials);
cands.sort((a, b) => (b as any).dsr - (a as any).dsr);
const cleared = cands.filter((c) => (c as any).dsr > 0.95);
const top = cands.slice(0, 60).map((c) => ({ market: c.market, tf: c.tf, spec: c.spec, cond: c.cond, n: c.n, exp: +c.exp.toFixed(3), sharpe: +c.sh.toFixed(3), dsr: +(c as any).dsr.toFixed(4), cleared: (c as any).dsr > 0.95 }));

const summary = { totalBars, series, strategies: specs.length, conditionalCells: cells, positiveOOS: oosPos, nTrials, clearedDSR: cleared.length, top };
await Deno.writeTextFile(OUT, JSON.stringify(summary, null, 2));
console.log(`\n=== UNIVERSE SWEEP COMPLETE ===`);
console.log(`data points: ${totalBars.toLocaleString()} bars across ${series} market×timeframe series`);
console.log(`trials: ${cells.toLocaleString()} conditional cells → ${oosPos.toLocaleString()} positive OOS → ${cleared.length} clear DSR-deflation`);
console.log(`top candidate: ${top[0] ? `${top[0].market} ${top[0].tf} ${top[0].spec} [${top[0].cond}] exp ${top[0].exp}R DSR ${(top[0].dsr * 100).toFixed(1)}%` : "none"}`);
console.log(`written → ${OUT}`);
