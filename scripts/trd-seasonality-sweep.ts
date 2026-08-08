#!/usr/bin/env -S deno run --allow-read
// trd-seasonality-sweep — the horizontal×vertical sweep with OUT-OF-SAMPLE validation.
// For every (market × seasonality-segment) it measures the effect on TRAIN (first 60%
// of history) AND TEST (last 40%), and only calls something an "exception" if it is
// positive + significant in BOTH halves AND strong enough to beat the multiple-testing
// surface. Persistence across an unseen later period is the one thing data-mining
// cannot fake — this is how you become the exception, not how you fool yourself.
//
// Setups (daily): day-of-week, month-of-year, turn-of-month, week-of-month, and
// liquidity-sweep reversal (prior-day high/low swept then closed back inside).
// BARS_FILE = { "SPY":[{ts,open,high,low,close,volume}...], ... }.

import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

interface Bar { ts: string; open: number; high: number; low: number; close: number; volume: number }
const FILE = Deno.env.get("BARS_FILE")!;
const raw = JSON.parse(await Deno.readTextFile(FILE)) as Record<string, Bar[]>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// t-stat of a mean vs 0 (per-observation)
function tStat(xs: number[]): number {
  if (xs.length < 3) return 0;
  const sd = sampleStd(xs);
  return sd > 0 ? mean(xs) / (sd / Math.sqrt(xs.length)) : 0;
}

interface Seg { market: string; setup: string; label: string; trainR: number[]; testR: number[] }
const segs: Seg[] = [];

for (const [market, barsRaw] of Object.entries(raw)) {
  const bars = [...barsRaw].sort((a, b) => a.ts.localeCompare(b.ts));
  if (bars.length < 400) continue;
  // next-day close-to-close return earned by being IN the segment on day t
  const ret: number[] = [], d: Date[] = [];
  for (let i = 1; i < bars.length; i++) {
    const r = bars[i - 1].close > 0 ? bars[i].close / bars[i - 1].close - 1 : 0;
    ret.push(r);
    d.push(new Date(bars[i].ts + "T00:00:00Z"));
  }
  const split = Math.floor(ret.length * 0.6);
  const push = (setup: string, label: string, mask: (i: number) => boolean) => {
    const trainR: number[] = [], testR: number[] = [];
    for (let i = 0; i < ret.length; i++) {
      if (!mask(i)) continue;
      (i < split ? trainR : testR).push(ret[i]);
    }
    if (trainR.length >= 20 && testR.length >= 20) segs.push({ market, setup, label, trainR, testR });
  };

  // day-of-week
  for (let wd = 1; wd <= 5; wd++) push("dow", `${DOW[wd]}`, (i) => d[i].getUTCDay() === wd);
  // month-of-year
  for (let m = 0; m < 12; m++) push("month", MONTHS[m], (i) => d[i].getUTCMonth() === m);
  // week-of-month (1..5 by day-of-month)
  for (let w = 1; w <= 5; w++) push("weekOfMonth", `w${w}`, (i) => Math.floor((d[i].getUTCDate() - 1) / 7) + 1 === w);
  // turn-of-month: last 1 + first 3 calendar-ish trading days (approx via day-of-month)
  push("turnOfMonth", "TOM", (i) => d[i].getUTCDate() >= 28 || d[i].getUTCDate() <= 3);
  // liquidity-sweep reversal: prior bar swept the high-before-it then closed back below → next-day short-side
  const lowSweep: number[] = [], highSweep: number[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1], cur = bars[i];
    const nextR = bars[i].close > 0 ? bars[i + 1].close / bars[i].close - 1 : 0;
    const gi = i - 1; // ret index alignment (ret[i-1] is bars[i-1]->bars[i])
    if (cur.low < prev.low && cur.close > prev.low) lowSweep.push(nextR); // swept low, reclaimed → long
    if (cur.high > prev.high && cur.close < prev.high) highSweep.push(-nextR); // swept high, rejected → short
  }
  const sweepSplitL = Math.floor(lowSweep.length * 0.6), sweepSplitH = Math.floor(highSweep.length * 0.6);
  if (lowSweep.length >= 40) segs.push({ market, setup: "liqSweep", label: "lowReclaim(long)", trainR: lowSweep.slice(0, sweepSplitL), testR: lowSweep.slice(sweepSplitL) });
  if (highSweep.length >= 40) segs.push({ market, setup: "liqSweep", label: "highReject(short)", trainR: highSweep.slice(0, sweepSplitH), testR: highSweep.slice(sweepSplitH) });
}

const nTrials = segs.length;
// score: require positive mean in BOTH halves and significant in TEST; rank by test t.
const scored = segs.map((s) => ({
  market: s.market, setup: s.setup, label: s.label,
  nTr: s.trainR.length, nTe: s.testR.length,
  trainMeanBps: mean(s.trainR) * 1e4, testMeanBps: mean(s.testR) * 1e4,
  trainT: tStat(s.trainR), testT: tStat(s.testR),
}));

// Proper Bonferroni bar: per-test alpha = 0.05/nTrials, one-sided z.
function invNormApprox(p: number): number { // Beasley-Springer-Moro tail is overkill; use rational approx
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const bonf = Math.abs(invNormApprox(1 - 0.05 / (2 * nTrials))); // ~3.7 for 475

// persistent = same sign in BOTH halves and both individually >1.65 (nominally significant)
const persistent = scored
  .filter((r) => Math.sign(r.trainMeanBps) === Math.sign(r.testMeanBps) && Math.abs(r.trainT) > 1.65 && Math.abs(r.testT) > 1.65)
  .sort((a, b) => Math.min(Math.abs(b.trainT), Math.abs(b.testT)) - Math.min(Math.abs(a.trainT), Math.abs(a.testT)));
const clearsBonf = persistent.filter((r) => Math.abs(r.testT) >= bonf);

console.log(`\n[seasonality-sweep] ${Object.keys(raw).length} markets × 5 setups → ${nTrials} segments tested`);
console.log(`  OOS = train(first 60%) → test(last 40%). Bonferroni bar |testT| >= ${bonf.toFixed(2)} (alpha 0.05 / ${nTrials}).`);
console.log(`\n  STRONGEST OOS-persistent segments (same sign both halves, both t>1.65), ranked by weaker-half t:`);
if (!persistent.length) console.log("   (none persisted across the split at all)");
for (const r of persistent.slice(0, 18)) {
  const dir = r.testMeanBps > 0 ? "LONG " : "SHORT";
  const mark = Math.abs(r.testT) >= bonf ? "  <== CLEARS BONFERRONI" : "";
  console.log(`   ${dir} ${r.market.padEnd(8)} ${r.setup.padEnd(12)} ${r.label.padEnd(18)} trainT=${r.trainT.toFixed(2).padStart(6)} testT=${r.testT.toFixed(2).padStart(6)}  test=${r.testMeanBps.toFixed(1)}bps/day n=${r.nTr}/${r.nTe}${mark}`);
}
console.log(`\n  VERDICT: ${persistent.length}/${nTrials} persisted OOS (nominal); ${clearsBonf.length} clear the Bonferroni multiplicity bar.`);
console.log(`  ${clearsBonf.length ? "The Bonferroni-clearing ones are genuine exception candidates → micro-test next." : "None survive strict multiplicity — but the top persistent ones are the honest short-list to probe with a focused (non-searched) test."}`);
