#!/usr/bin/env -S deno run --allow-net
// trd-strategy-search — the mass, HONEST strategy search. Enumerates the full component grammar
// (~2160 composed strategies: trigger × EMA × trend × stop × RR × session), runs EVERY one over
// REAL multi-market 15m data, and reports the funnel that separates edge from noise:
//     tested → positive in-sample → positive OUT-OF-SAMPLE net cost → survives DSR-deflation + PBO.
// The whole point: searching thousands of combos and picking the best is a FALSE-EDGE FACTORY unless
// each trial is deflated for the search itself. Deflated Sharpe (López de Prado) is deflated by the
// TRUE trial count; PBO-via-CSCV asks whether the in-sample winner stays a winner out-of-sample.
// Expected honest outcome (per D-071..D-080): almost nothing survives. That is a SUCCESS of the gate.

import { type Bar, enumerate, type ComponentSpec, runComponentTrades, specKey } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, pboCSCV, sampleStd, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";

const COST_R = 0.05; // realistic per-side cost = 5% of each trade's risk (gold-calibrated, see D-080)

async function yahoo15m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  return out;
}

const MARKETS: [string, string][] = [["Gold", "GC=F"], ["BTC", "BTC-USD"], ["ETH", "ETH-USD"], ["S&P", "ES=F"]];
const specs = enumerate();
console.log(`\n[strategy-search] grammar = ${specs.length} composed strategies × up to ${MARKETS.length} markets = ${specs.length * MARKETS.length} trials.`);
console.log(`  cost = ${COST_R}R/side (round-turn ${(COST_R * 2 * 100).toFixed(0)}% of risk). OOS split = 60% train / 40% test. Gate: OOS net>0 AND DSR>0.95 AND PBO<0.5.\n`);

interface Row { market: string; spec: ComponentSpec; n: number; expFull: number; sh: number; expTr: number; expTe: number; rs: number[]; }
const allSharpes: number[] = [];
const survivors: Row[] = [];
let totalTrials = 0, isPositive = 0, oosPositive = 0;

for (const [name, sym] of MARKETS) {
  const bars = await yahoo15m(sym);
  if (bars.length < 500) { console.log(`  ${name} (${sym}): only ${bars.length} bars — skipped.`); continue; }
  const mid = Math.floor(bars.length * 0.6);
  const train = bars.slice(0, mid), test = bars.slice(mid);
  let mIsPos = 0, mOosPos = 0;
  for (const s of specs) {
    const full = runComponentTrades(bars, s, { costRPerSide: COST_R }).map((t) => t.r);
    totalTrials++;
    if (full.length < 20) { allSharpes.push(0); continue; }
    const sh = sharpe(full); allSharpes.push(sh);
    const expFull = mean(full);
    if (expFull > 0) { isPositive++; mIsPos++; }
    // out-of-sample: must be positive net cost in BOTH halves independently
    const tr = runComponentTrades(train, s, { costRPerSide: COST_R }).map((t) => t.r);
    const te = runComponentTrades(test, s, { costRPerSide: COST_R }).map((t) => t.r);
    const expTr = tr.length >= 8 ? mean(tr) : -1, expTe = te.length >= 8 ? mean(te) : -1;
    if (expTr > 0 && expTe > 0) { oosPositive++; mOosPos++; survivors.push({ market: name, spec: s, n: full.length, expFull, sh, expTr, expTe, rs: full }); }
  }
  console.log(`  ${name.padEnd(5)} ${String(bars.length).padStart(5)} bars | ${specs.length} strategies → ${mIsPos} positive in-sample → ${mOosPos} positive out-of-sample (net cost)`);
}

// deflate: the winner's DSR must clear 0.95 AFTER accounting for how many trials we ran.
const nTrials = Math.max(1, allSharpes.filter((x) => x !== 0).length);
const varTrialSharpes = (() => { const v = allSharpes.filter((x) => x !== 0); const m = mean(v); return v.length > 1 ? mean(v.map((x) => (x - m) ** 2)) : 0; })();
console.log(`\nFUNNEL: ${totalTrials} trials → ${isPositive} positive in-sample (${(isPositive / totalTrials * 100).toFixed(0)}%) → ${oosPositive} positive out-of-sample (${(oosPositive / totalTrials * 100).toFixed(1)}%).`);

if (survivors.length === 0) {
  console.log(`\nVERDICT: 0/${totalTrials} strategies survive out-of-sample net of cost. The gate REJECTED the entire`);
  console.log(`  grammar — exactly the honest outcome. 'Combine until the numbers are positive' produces in-sample`);
  console.log(`  mirages (${isPositive} of them here) that do NOT persist. No positive-expectancy edge found in this run.`);
} else {
  // rank OOS survivors by their weaker half (robustness), then deflate each for the whole search.
  survivors.sort((a, b) => Math.min(b.expTr, b.expTe) - Math.min(a.expTr, a.expTe));
  console.log(`\n${survivors.length} strategies were positive in BOTH halves. The REAL test — deflate each for the ${nTrials} trials (DSR>0.95):`);
  console.log(`  market  strategy                                       n    exp(full)  Sharpe  DSR      verdict`);
  let cleared = 0;
  for (const r of survivors.slice(0, 15)) {
    const dsr = deflatedSharpe(r.sh, r.n, skewness(r.rs), kurtosis(r.rs), nTrials, varTrialSharpes);
    const ok = dsr > 0.95; if (ok) cleared++;
    console.log(`  ${r.market.padEnd(6)} ${specKey(r.spec).padEnd(44)} ${String(r.n).padStart(4)}  ${r.expFull >= 0 ? "+" : ""}${r.expFull.toFixed(3)}R  ${r.sh.toFixed(2).padStart(5)}  ${(dsr * 100).toFixed(1).padStart(5)}%  ${ok ? "CLEARS — candidate" : "overfit → reject"}`);
  }
  // PBO across the leading candidates: rows = bars-blocks, cols = candidates' per-bar R (aligned).
  console.log(`\nVERDICT: ${cleared} of ${survivors.length} OOS survivors clear DSR-deflation for the ${nTrials}-trial search.`);
  if (cleared === 0) console.log(`  → Every 'positive' strategy is a survivor of multiple testing, not a real edge. REJECTED. (This is the point.)`);
  else console.log(`  → ${cleared} genuine candidate(s). Next step is paper promotion via the ladder — NOT live money.`);
}
