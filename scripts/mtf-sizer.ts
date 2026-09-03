#!/usr/bin/env -S deno run --allow-read --allow-env
// mtf-sizer.ts (D-766+) — the operator's "leverage and when" layer. Consumes ONLY the event dumps a measurement
// script already wrote (mtf-psl-fade.ts --DUMP=path.json today; any script following the same dump shape tomorrow),
// never re-derives a signal itself. For every dumped cell that ALREADY cleared cost OOS cross-instrument
// (checked here, not assumed), computes:
//   - Kelly fraction from the empirical per-event net-of-cost return distribution (capped, half-Kelly default)
//   - vol-target leverage: TARGET_VOL / realized annualised vol of the event-return stream
//   - max drawdown and ruin probability AT that leverage, via block-bootstrap resample of the actual event sequence
//     (not a Gaussian assumption — these returns are fat-tailed fade events, D-475 "no completeness" applies to
//     tails too)
// A cell with NO stated cross-instrument sign-stable OOS clearance gets NO sizing number — sizing an unconfirmed
// cell would manufacture false confidence exactly where THE HOLDABILITY LAW and THE PRE-COMMITMENT LAW forbid it.
// DESCRIPTIVE ONLY. No lineage/DECISIONS/forward-clock writes — the operator decides those from this output.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("mtf-sizer", [
  { name: "DUMPS", def: "data/mtf-psl-fade-dump.json", note: "comma-separated dump JSON paths to load (each from a --DUMP run)" },
  { name: "MIN_EVENTS", def: "50", note: "breadth floor (BREADTH LAW)" },
  { name: "MIN_INSTRUMENTS_POSITIVE", def: "6", note: "of 12 candidate instruments, minimum with positive-net OOS to call a cell sign-stable" },
  { name: "KELLY_FRACTION", def: "0.5", note: "fraction of full Kelly used (half-Kelly is the conventional drawdown-tempering choice)" },
  { name: "TARGET_VOL", def: "0.15", note: "annualised vol target for the vol-target leverage line, e.g. 0.15 = 15%/yr" },
  { name: "BARS_PER_YEAR", def: "8760", note: "hourly bars/yr (crypto trades 24/7; used only to annualise vol, not to inflate n)" },
  { name: "BOOT_N", def: "2000", note: "bootstrap resamples for drawdown/ruin" },
  { name: "BOOT_BLOCK", def: "20", note: "block-bootstrap block length (events), preserves local autocorrelation" },
  { name: "RUIN_DD", def: "0.5", note: "drawdown fraction counted as 'ruin' for P(ruin) reporting, e.g. 0.5 = -50%" },
]);

interface DumpEvent { symbol: string; klass: string; ts: number; train: boolean; net: Record<string, number> }
interface DumpCell { cell: string; rt_bp_by_class: Record<string, number>; K: number[]; frozen: { cell: string; K: number } | null; events: DumpEvent[] }
interface DumpFile { source: string; written: string; split: string; cells: DumpCell[] }

const MIN_EVENTS = Number(K.MIN_EVENTS), MIN_POS = Number(K.MIN_INSTRUMENTS_POSITIVE);
const KELLY_FRAC = Number(K.KELLY_FRACTION), TARGET_VOL = Number(K.TARGET_VOL);
const BARS_YR = Number(K.BARS_PER_YEAR), BOOT_N = Number(K.BOOT_N), BLOCK = Number(K.BOOT_BLOCK), RUIN_DD = Number(K.RUIN_DD);

function mean(a: number[]) { return a.reduce((x, y) => x + y, 0) / a.length; }
function sd(a: number[]) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); }
function tstat(a: number[]) { return a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)); }

const files: DumpFile[] = [];
for (const p of K.DUMPS.split(",").map((s) => s.trim()).filter(Boolean)) {
  try { files.push(JSON.parse(await Deno.readTextFile(p))); }
  catch (e) { console.error(`!! could not read dump ${p}: ${(e as Error).message} — run the measurement script with --DUMP=${p} first.`); }
}
if (files.length === 0) { console.error("!! no dumps loaded. Nothing to size. This is UNTESTED, not a null."); Deno.exit(1); }

console.log(`==> MTF SIZER — leverage/drawdown/ruin map, sizing ONLY cells that clear cost OOS cross-instrument here`);
console.log(`    loaded ${files.length} dump file(s): ${files.map((f) => `${f.source}@${f.written.slice(0, 10)}`).join(", ")}\n`);

// block-bootstrap the event sequence (chronological, per instrument pooled by ts order across the whole cell) at a
// given leverage multiple, tracking equity path max-drawdown. Returns {p5DD, medianDD, p95DD, pRuin}.
function bootstrapDD(returns: number[], leverage: number): { p5: number; median: number; p95: number; pRuin: number } {
  const n = returns.length;
  if (n < 10) return { p5: 0, median: 0, p95: 0, pRuin: 0 };
  const dds: number[] = [];
  let ruinCount = 0;
  for (let b = 0; b < BOOT_N; b++) {
    const path: number[] = [];
    while (path.length < n) {
      const start = Math.floor(Math.random() * n);
      for (let j = 0; j < BLOCK && path.length < n; j++) path.push(returns[(start + j) % n]);
    }
    let equity = 1, peak = 1, maxDD = 0;
    for (const r of path) {
      equity *= (1 + Math.max(-0.999, r * leverage)); // floor a single-event wipeout at -99.9%, not below zero
      if (equity <= 0) { equity = 1e-9; }
      peak = Math.max(peak, equity);
      maxDD = Math.min(maxDD, equity / peak - 1);
    }
    dds.push(maxDD);
    if (maxDD <= -RUIN_DD) ruinCount++;
  }
  dds.sort((a, b) => a - b);
  return { p5: dds[Math.floor(BOOT_N * 0.05)], median: dds[Math.floor(BOOT_N * 0.5)], p95: dds[Math.floor(BOOT_N * 0.95)], pRuin: ruinCount / BOOT_N };
}

let sized = 0, rejected = 0;
for (const file of files) {
  for (const cellDump of file.cells) {
    for (const k of cellDump.K) {
      const label = `${cellDump.cell} K${k}`;
      const testEvents = cellDump.events.filter((e) => !e.train);
      const byInst = new Map<string, number[]>();
      for (const e of testEvents) { const v = e.net[String(k)]; if (v == null) continue; (byInst.get(e.symbol) ?? byInst.set(e.symbol, []).get(e.symbol)!).push(v); }
      const pooled = testEvents.map((e) => e.net[String(k)]).filter((v) => v != null);
      const s = { n: pooled.length, mean: mean(pooled), t: tstat(pooled) };
      let posInst = 0, testedInst = 0;
      for (const [, xs] of byInst) { if (xs.length < 20) continue; testedInst++; if (mean(xs) > 0) posInst++; }
      const clears = s.n >= MIN_EVENTS && s.mean > 0 && s.t >= 2 && posInst >= MIN_POS;
      if (!clears) {
        rejected++;
        console.log(`  [${label}]  NOT SIZED — does not clear cost OOS cross-instrument here (n=${s.n}, mean=${(s.mean * 1e4).toFixed(2)}bp, t=${s.t.toFixed(2)}, ${posInst}/${testedInst} inst positive; need n>=${MIN_EVENTS}, t>=2, >=${MIN_POS} inst)`);
        continue;
      }
      sized++;
      // Kelly on the empirical distribution: f* = mean / variance (per-event log-return approximation), capped [0, 3]
      const variance = sd(pooled) ** 2;
      const fullKelly = variance > 0 ? Math.max(0, Math.min(3, s.mean / variance)) : 0;
      const halfKelly = fullKelly * KELLY_FRAC;
      // vol-target: annualise the per-event return series' vol using events/year implied by n and the test span.
      const evPerYear = testEvents.length > 1
        ? (testEvents.length - 1) / (((Math.max(...testEvents.map((e) => e.ts)) - Math.min(...testEvents.map((e) => e.ts))) / (365.25 * 86400)) || 1)
        : BARS_YR / 24;
      const annVol = sd(pooled) * Math.sqrt(Math.max(1, evPerYear));
      const volTargetLev = annVol > 0 ? Math.min(10, TARGET_VOL / annVol) : 0;
      const chosenLev = Math.max(0.1, Math.min(halfKelly, volTargetLev)); // conservative: the SMALLER of the two
      const ddH = bootstrapDD(pooled, halfKelly);
      const ddV = bootstrapDD(pooled, volTargetLev);
      const ddC = bootstrapDD(pooled, chosenLev);
      console.log(`  [${label}]  SIZED — OOS n=${s.n} mean=${(s.mean * 1e4).toFixed(2)}bp t=${s.t.toFixed(2)} ${posInst}/${testedInst} inst positive`);
      console.log(`      full-Kelly ${fullKelly.toFixed(2)}x -> half-Kelly ${halfKelly.toFixed(2)}x   |   vol-target(${(TARGET_VOL * 100).toFixed(0)}%/yr, ann.vol ${(annVol * 100).toFixed(1)}%) ${volTargetLev.toFixed(2)}x`);
      console.log(`      CHOSEN leverage (min of the two, conservative): ${chosenLev.toFixed(2)}x`);
      console.log(`      drawdown @ half-Kelly ${halfKelly.toFixed(2)}x:    p5 ${(ddH.p5 * 100).toFixed(1)}%  median ${(ddH.median * 100).toFixed(1)}%  p95(worst) ${(ddH.p95 * 100).toFixed(1)}%  P(DD<=-${(RUIN_DD * 100).toFixed(0)}%) ${(ddH.pRuin * 100).toFixed(1)}%`);
      console.log(`      drawdown @ vol-target ${volTargetLev.toFixed(2)}x:  p5 ${(ddV.p5 * 100).toFixed(1)}%  median ${(ddV.median * 100).toFixed(1)}%  p95(worst) ${(ddV.p95 * 100).toFixed(1)}%  P(DD<=-${(RUIN_DD * 100).toFixed(0)}%) ${(ddV.pRuin * 100).toFixed(1)}%`);
      console.log(`      drawdown @ CHOSEN   ${chosenLev.toFixed(2)}x:  p5 ${(ddC.p5 * 100).toFixed(1)}%  median ${(ddC.median * 100).toFixed(1)}%  p95(worst) ${(ddC.p95 * 100).toFixed(1)}%  P(DD<=-${(RUIN_DD * 100).toFixed(0)}%) ${(ddC.pRuin * 100).toFixed(1)}%\n`);
    }
  }
}
console.log(`  ================================ SUMMARY ================================`);
console.log(`  cells sized: ${sized}   cells rejected (did not clear cost OOS here): ${rejected}`);
console.log(`  HOLDABILITY LAW: drawdown depth alone is not the risk criterion here — this report gives depth, not duration;`);
console.log(`  a cell with a survivable p95 drawdown but no measured max-time-underwater is not yet a deployment candidate.`);
console.log(`  PRE-COMMITMENT LAW: a sizing number is not a promotion. Nothing here writes to trd_lineage, DECISIONS.md,`);
console.log(`  or a forward clock — this script's job is the honest "if you sized it, here is what it would have cost you".`);
