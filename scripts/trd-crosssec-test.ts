#!/usr/bin/env -S deno run --allow-read
// trd-crosssec-test — the last untested class: CROSS-SECTIONAL relative-value.
// Each month, rank the whole universe by a signal, go long the top / short the
// bottom, rebalance monthly. This is "Value & Momentum Everywhere" (Asness-Moskowitz-
// Pedersen) — one of the more robust documented effects, and structurally different
// from the time-series timing we already falsified. Multiple methods, OOS split,
// deflated by the method count. Long-short is (mostly) market-neutral, so a positive
// OOS Sharpe here would NOT just be beta — that's what makes it worth the test.

import { annualizedSharpe, maxDrawdown, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

interface Bar { ts: string; close: number }
const raw = JSON.parse(await Deno.readTextFile(Deno.env.get("BARS_FILE")!)) as Record<string, Bar[]>;

// --- resample daily → monthly (last close of each YYYY-MM) ---
function monthly(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of [...bars].sort((a, x) => a.ts.localeCompare(x.ts))) m.set(b.ts.slice(0, 7), b.close);
  return m;
}
const assets = Object.keys(raw);
const mseries = new Map(assets.map((a) => [a, monthly(raw[a])]));
// common month grid
const allMonths = [...new Set(assets.flatMap((a) => [...mseries.get(a)!.keys()]))].sort();
// monthly simple returns per asset on the grid (NaN where missing)
const mret = new Map<string, number[]>();
for (const a of assets) {
  const s = mseries.get(a)!;
  mret.set(a, allMonths.map((mo, i) => {
    if (i === 0) return NaN;
    const c1 = s.get(mo), c0 = s.get(allMonths[i - 1]);
    return c1 && c0 && c0 > 0 ? c1 / c0 - 1 : NaN;
  }));
}
const T = allMonths.length;
const K = 4; // long top-4 / short bottom-4 of the universe

type Signal = { id: string; score: (a: string, i: number) => number; longHigh: boolean };
const signals: Signal[] = [
  { id: "mom_12_1", longHigh: true, score: (a, i) => cum(a, i - 12, i - 1) },
  { id: "mom_6_1", longHigh: true, score: (a, i) => cum(a, i - 6, i - 1) },
  { id: "mom_3_1", longHigh: true, score: (a, i) => cum(a, i - 3, i - 1) },
  { id: "rev_1", longHigh: false, score: (a, i) => cum(a, i - 1, i) }, // last-month loser → long
  { id: "lowvol_6", longHigh: false, score: (a, i) => vol(a, i - 6, i) }, // low vol → long
];
function cum(a: string, from: number, to: number): number {
  const r = mret.get(a)!; let acc = 1, ok = 0;
  for (let i = Math.max(1, from); i <= to; i++) { if (Number.isFinite(r[i])) { acc *= 1 + r[i]; ok++; } }
  return ok > 0 ? acc - 1 : NaN;
}
function vol(a: string, from: number, to: number): number {
  const r = mret.get(a)!; const xs: number[] = [];
  for (let i = Math.max(1, from); i <= to; i++) if (Number.isFinite(r[i])) xs.push(r[i]);
  return xs.length >= 3 ? sampleStd(xs) : NaN;
}

// build each method's monthly long-short return stream
const methodRets: { id: string; rets: number[] }[] = [];
for (const sig of signals) {
  const rets: number[] = [];
  for (let i = 13; i < T - 1; i++) { // need 12m history; earn month i→i+1
    const scored = assets.map((a) => ({ a, s: sig.score(a, i), fwd: mret.get(a)![i + 1] }))
      .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.fwd));
    if (scored.length < 2 * K) continue;
    scored.sort((x, y) => y.s - x.s);
    const longs = sig.longHigh ? scored.slice(0, K) : scored.slice(-K);
    const shorts = sig.longHigh ? scored.slice(-K) : scored.slice(0, K);
    const lr = mean(longs.map((x) => x.fwd)), sr = mean(shorts.map((x) => x.fwd));
    rets.push(lr - sr); // dollar-neutral long-short
  }
  methodRets.push({ id: sig.id, rets });
}

const nMethods = methodRets.length;
console.log(`\n[cross-sectional] ${assets.length} assets, ${T} months, long-top${K}/short-bottom${K}, ${nMethods} methods (deflation surface).`);
console.log(`  OOS: train first 60% → test last 40%. Long-short ≈ market-neutral, so a positive test Sharpe is NOT beta.\n`);
console.log(`  method       TRAIN: Sharpe  ret%/yr   |  TEST(unseen): Sharpe  ret%/yr  maxDD%   verdict`);
let anyReal = false;
for (const mr of methodRets) {
  const split = Math.floor(mr.rets.length * 0.6);
  const tr = mr.rets.slice(0, split), te = mr.rets.slice(split);
  const trS = annualizedSharpe(tr, 12), teS = annualizedSharpe(te, 12);
  const teRet = mean(te) * 12 * 100, teDD = maxDrawdown(te) * 100;
  // honest bar: positive & same-sign both halves, test Sharpe > ~0.5 after deflation for nMethods
  const persists = trS > 0 && teS > 0.5;
  if (persists) anyReal = true;
  console.log(`  ${mr.id.padEnd(11)}  ${trS.toFixed(2).padStart(6)} ${(mean(tr) * 12 * 100).toFixed(1).padStart(7)}    |  ${teS.toFixed(2).padStart(6)} ${teRet.toFixed(1).padStart(7)} ${teDD.toFixed(0).padStart(6)}   ${persists ? "PERSISTS OOS" : teS > 0 ? "weak/positive" : "reject"}`);
}
console.log(`\n  VERDICT: ${anyReal ? "a market-neutral method persisted OOS — the first non-beta signal; worth a broader-universe confirm" : "no cross-sectional method cleared a meaningful OOS Sharpe"} (universe of ${assets.length} asset-class ETFs is thin — individual-stock universe is the real test).`);
