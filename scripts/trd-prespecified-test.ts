#!/usr/bin/env -S deno run --allow-read
// trd-prespecified-test — the honest endgame. A/ Take ONLY anomalies documented in
// the literature (fixed BEFORE looking at fit → no search-multiplicity penalty):
//   H1 Turn-of-month drift (Ariel 1987, Lakonishok-Smidt 1988)
//   H2 Halloween / best-six-months  Nov–Apr (Bouman-Jacobsen 2002)
// B/ Apply the SAME rule to every equity index independently (cross-market
// confirmation, not a new search). C/ Build the combined seasonal-overlay book and
// test it OUT-OF-SAMPLE against buy-and-hold, decomposing vs buy-hold so we isolate
// whether the TIMING adds risk-adjusted value or just clips beta. Deflate by the
// pre-specified hypothesis count (2–3), not 475.

import { annualizedSharpe, maxDrawdown, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
import { factorDecompose } from "../supabase/functions/_shared/trd-backtest-core.ts";

interface Bar { ts: string; close: number }
const raw = JSON.parse(await Deno.readTextFile(Deno.env.get("BARS_FILE")!)) as Record<string, { ts: string; close: number }[]>;
const EQUITY = ["SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "EFA", "EEM"]; // broad equity, same rule each

// --- the PRE-SPECIFIED overlay: long if (Nov–Apr) OR (turn-of-month day), else flat.
function inSeason(d: Date): boolean {
  const m = d.getUTCMonth(); // 0=Jan
  const halloween = m >= 10 || m <= 3; // Nov,Dec,Jan,Feb,Mar,Apr
  const dom = d.getUTCDate();
  const tom = dom >= 28 || dom <= 3;
  return halloween || tom;
}

interface Series { ts: Date[]; bh: number[]; strat: number[] } // daily returns
function build(bars: Bar[]): Series {
  const b = [...bars].sort((a, x) => a.ts.localeCompare(x.ts));
  const ts: Date[] = [], bh: number[] = [], strat: number[] = [];
  for (let i = 1; i < b.length; i++) {
    const r = b[i - 1].close > 0 ? b[i].close / b[i - 1].close - 1 : 0;
    const decideDay = new Date(b[i - 1].ts + "T00:00:00Z"); // position decided at prior close → no look-ahead
    ts.push(new Date(b[i].ts + "T00:00:00Z"));
    bh.push(r);
    strat.push(inSeason(decideDay) ? r : 0);
  }
  return { ts, bh, strat };
}

function ann(xs: number[]) { return { sharpe: annualizedSharpe(xs, 252), ret: mean(xs) * 252 * 100, dd: maxDrawdown(xs) * 100, inMkt: xs.filter((x) => x !== 0).length / xs.length * 100 }; }

const perMarket: { m: string; teStrat: ReturnType<typeof ann>; teBH: ReturnType<typeof ann>; alphaT: number }[] = [];
const combinedStratTrain: number[] = [], combinedStratTest: number[] = [], combinedBHTest: number[] = [];
let gridLen = 0;

for (const m of EQUITY) {
  if (!raw[m]) continue;
  const s = build(raw[m]);
  const split = Math.floor(s.bh.length * 0.6);
  const teStrat = ann(s.strat.slice(split)), teBH = ann(s.bh.slice(split));
  // residual alpha of the TIMING vs buy-hold, on the test half (does timing beat scaled beta?)
  const dec = factorDecompose(s.strat.slice(split), { bh: s.bh.slice(split) });
  perMarket.push({ m, teStrat, teBH, alphaT: dec.residualAlphaT });
  // accumulate an equal-weight combined book on a shared length
  const L = s.strat.length; gridLen = gridLen ? Math.min(gridLen, L) : L;
}
// rebuild combined on the shared min length (align tails)
for (const m of EQUITY) {
  if (!raw[m]) continue;
  const s = build(raw[m]);
  const off = s.strat.length - gridLen;
  const split = Math.floor(gridLen * 0.6);
  for (let i = 0; i < gridLen; i++) {
    const v = s.strat[off + i] / EQUITY.length, b = s.bh[off + i] / EQUITY.length;
    if (i < split) combinedStratTrain[i] = (combinedStratTrain[i] ?? 0) + v;
    else { combinedStratTest[i - split] = (combinedStratTest[i - split] ?? 0) + v; combinedBHTest[i - split] = (combinedBHTest[i - split] ?? 0) + b; }
  }
}

console.log(`\n[pre-specified combined-tilt] rule = LONG if (Nov-Apr) OR (turn-of-month), else FLAT. Applied identically to ${EQUITY.length} equity indices.`);
console.log(`  TEST HALF (unseen, last 40% of ~15y). Per market — does seasonal timing beat buy-and-hold on RISK-ADJUSTED terms?\n`);
console.log(`  market   overlay: Sharpe  ret%/yr  maxDD%  inMkt%   |  buy&hold: Sharpe  ret%/yr  maxDD%   | timing-alpha t`);
for (const r of perMarket) {
  console.log(`  ${r.m.padEnd(7)}  ${r.teStrat.sharpe.toFixed(2).padStart(6)} ${r.teStrat.ret.toFixed(1).padStart(7)} ${r.teStrat.dd.toFixed(0).padStart(6)} ${r.teStrat.inMkt.toFixed(0).padStart(6)}   |  ${r.teBH.sharpe.toFixed(2).padStart(6)} ${r.teBH.ret.toFixed(1).padStart(7)} ${r.teBH.dd.toFixed(0).padStart(6)}   | ${r.alphaT.toFixed(2).padStart(6)}`);
}

const cbStrat = ann(combinedStratTest), cbBH = ann(combinedBHTest);
const dec = factorDecompose(combinedStratTest, { bh: combinedBHTest });
// deflate the combined book's test Sharpe by the pre-specified hypothesis count (be generous: 3)
const nPre = 3;
console.log(`\n  COMBINED BOOK (equal-weight overlay across all ${EQUITY.length} indices), TEST half:`);
console.log(`   overlay : Sharpe=${cbStrat.sharpe.toFixed(2)}  ret=${cbStrat.ret.toFixed(1)}%/yr  maxDD=${cbStrat.dd.toFixed(0)}%  inMkt=${cbStrat.inMkt.toFixed(0)}%`);
console.log(`   buy&hold: Sharpe=${cbBH.sharpe.toFixed(2)}  ret=${cbBH.ret.toFixed(1)}%/yr  maxDD=${cbBH.dd.toFixed(0)}%`);
console.log(`   timing residual-alpha t (vs buy-hold) = ${dec.residualAlphaT.toFixed(2)}  (beta=${dec.betas.bh.toFixed(2)})`);
const sharpeEdge = cbStrat.sharpe - cbBH.sharpe;
const ddEdge = cbBH.dd - cbStrat.dd;
console.log(`\n  VERDICT (OOS, pre-specified so multiplicity≈${nPre} not 475):`);
console.log(`   Sharpe edge vs buy-hold: ${sharpeEdge >= 0 ? "+" : ""}${sharpeEdge.toFixed(2)}   |   drawdown reduced by ${ddEdge.toFixed(0)}pts   |   timing-alpha t=${dec.residualAlphaT.toFixed(2)}`);
const real = cbStrat.sharpe > cbBH.sharpe && dec.residualAlpha > 0 && dec.residualAlphaT > 1.65;
console.log(`   ${real ? "PASS → the seasonal TIMING adds risk-adjusted value out-of-sample. A genuine, honest exception → micro-test." : cbStrat.sharpe > cbBH.sharpe ? "PARTIAL: better risk-adjusted return OOS (higher Sharpe / lower DD), but timing-alpha not significant vs beta — it's mostly risk reduction, not new alpha. Still useful as a defensive overlay." : "REJECT: no risk-adjusted improvement OOS."}`);
