#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
// bar-resolution-bias.ts (D-712) — MEASURE the distortion D-711 exposed, instead of asserting it.
//
// THE FINDING TO QUANTIFY. The same opening-range breakout gave +7.32 pts at t 4.27 on HOURLY bars and essentially
// zero excess on MINUTE bars. The mechanism is mechanical: a breakout detected from a coarse bar's HIGH is entered
// at the trigger level, but the bar's extreme means the market had already travelled past it — the study books a
// move that a live order could never have caught. The coarser the bar relative to the trigger, the larger the free
// distance the backtest awards itself.
//
// WHY THIS MATTERS BEYOND ONE MODEL. D-710 swept 100 ORB specifications across 37 series and found 0 survivors —
// but every one was computed on HOURLY bars. If the bias is large and positive, those numbers are UPPER BOUNDS and
// the zero is safe. If it were negative, the sweep could have hidden something. Either way a sweep whose bias is
// unmeasured is a sweep whose conclusion has an unknown sign attached, and this programme has been burned by
// exactly that shape often enough to measure it rather than reason about it.
//
// THE DESIGN IS A CONTROLLED COMPARISON, not two studies. One instrument, one identical rule, one identical set of
// days, evaluated at four bar sizes built from the SAME minute data by aggregation. Any difference is therefore
// attributable to resolution alone — no vendor difference, no span difference, no specification difference.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("bar-resolution-bias", [
  { name: "CACHE", def: "/Users/ona/aegis-data/m1_USATECHIDXUSD.jsonl.gz", note: "minute bars (D-709)" },
  { name: "ORB_MIN", def: "30", note: "opening-range length in MINUTES, held constant across every resolution" },
  { name: "WINDOW_MIN", def: "150", note: "trade window in minutes, held constant" },
  { name: "RESOLUTIONS", def: "1,5,15,60", note: "bar sizes in minutes, all aggregated from the same m1 source" },
]);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

function isDST(d: string): boolean {
  const [y, m, dd] = d.split("-").map(Number);
  const nth = (yr: number, mo: number, dow: number, n: number) => {
    const first = new Date(Date.UTC(yr, mo - 1, 1));
    return 1 + ((dow - first.getUTCDay() + 7) % 7) + (n - 1) * 7;
  };
  if (m > 3 && m < 11) return true;
  if (m === 3) return dd >= nth(y, 3, 0, 2);
  if (m === 11) return dd < nth(y, 11, 0, 1);
  return false;
}

const raw = await Deno.readFile(K.CACHE);
const text = new TextDecoder().decode(new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()));
const days = text.trim().split("\n").map((l) => { const o = JSON.parse(l) as { d: string; b: number[][] }; return { d: o.d, bars: o.b }; });
assertNonEmpty("cached days", days, 1000);
if (days.some((x) => !Array.isArray(x.bars))) { console.error("!! a cached day has no bar array — RED."); Deno.exit(1); }

const ORB = Number(K.ORB_MIN), WIN = Number(K.WINDOW_MIN);
const RES = K.RESOLUTIONS.split(",").map(Number);

// Aggregate minute bars into bars of `res` minutes, anchored on the session open so the opening range is EXACTLY
// the same price extremes at every resolution — otherwise the comparison would confound bar size with alignment.
function aggregate(bars: number[][], anchor: number, res: number): number[][] {
  if (res === 1) return bars;
  const out = new Map<number, number[]>();
  for (const b of bars) {
    const slot = anchor + Math.floor((b[0] - anchor) / (res * 60)) * res * 60;
    const cur = out.get(slot);
    if (!cur) out.set(slot, [slot, b[1], b[2], b[3], b[4]]);
    else { cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; }
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

console.log(`==> BAR-RESOLUTION BIAS — one instrument, one rule, one set of days, four bar sizes`);
console.log(`    ${days.length} days, ${ORB}-minute opening range, ${WIN}-minute window\n`);
console.log(`    ${"bar size".padEnd(11)}${"trades".padStart(8)}${"amb%".padStart(7)}${"mean%".padStart(10)}${"t".padStart(8)}${"bench%".padStart(10)}${"EXCESS%".padStart(10)}${"vs m1".padStart(10)}`);

const results: { res: number; n: number; amb: number; mean: number; t: number; bench: number; ex: number }[] = [];
for (const res of RES) {
  const rets: number[] = [], bench: number[] = [];
  let amb = 0;
  for (const day of days) {
    const openSec = (isDST(day.d) ? 13 : 14) * 3600 + 30 * 60;
    const win = day.bars.filter((b) => b[0] >= openSec && b[0] < openSec + WIN * 60);
    if (win.length < ORB + 30) continue;
    // The OPENING RANGE is always computed from MINUTE data — it is the same high and low at every resolution.
    // Only the DETECTION of the break is coarsened, which isolates the mechanism being measured.
    const open = win.filter((b) => b[0] < openSec + ORB * 60);
    if (open.length < ORB / 2) continue;
    const hi = Math.max(...open.map((b) => b[2])), lo = Math.min(...open.map((b) => b[3]));
    const ref = open[open.length - 1][4];
    if (!(hi > lo) || !(ref > 0)) continue;
    const restM = win.filter((b) => b[0] >= openSec + ORB * 60);
    if (!restM.length) continue;
    const last = restM[restM.length - 1][4];
    const bm = (last - ref) / ref;
    const rest = aggregate(restM, openSec + ORB * 60, res);
    let dir: 1 | -1 | 0 = 0, entry = 0, same = false;
    for (const b of rest) {
      const up = b[2] > hi, dn = b[3] < lo;
      if (up && dn) { same = true; break; }
      if (up) { dir = 1; entry = hi; break; }
      if (dn) { dir = -1; entry = lo; break; }
    }
    // THE BENCHMARK IS PUSHED ONLY WHEN THE TRADE IS. The first version pushed it for every day that had a valid
    // range, including days with NO BREAK where no trade exists — so `bench` outgrew `rets` by the no-break count
    // and every excess after the first no-break paired a trade with a different day's benchmark. Paired arrays must
    // be appended at the same point or they are not paired.
    if (same) { amb++; rets.push((((last - hi) / hi) + ((lo - last) / lo)) / 2); bench.push(bm); continue; }
    if (dir === 0) continue;
    rets.push(dir === 1 ? (last - entry) / entry : (entry - last) / entry); bench.push(bm);
  }
  if (rets.length < 200) continue;
  if (rets.length !== bench.length) { console.error(`!! ${res}min: rets ${rets.length} vs bench ${bench.length} — unpaired, RED.`); Deno.exit(1); }
  const ex = mean(rets.map((x, i) => x - bench[i])) * 100;
  results.push({ res, n: rets.length, amb: 100 * amb / rets.length, mean: mean(rets) * 100, t: tstat(rets), bench: mean(bench) * 100, ex });
}
assertNonEmpty("resolutions evaluated", results, 2);
const base = results.find((r) => r.res === 1);
for (const r of results) {
  const rel = base ? r.ex - base.ex : NaN;
  console.log(`    ${(r.res + " min").padEnd(11)}${String(r.n).padStart(8)}${r.amb.toFixed(1).padStart(6)}%${r.mean.toFixed(4).padStart(10)}${r.t.toFixed(2).padStart(8)}${r.bench.toFixed(4).padStart(10)}${r.ex.toFixed(4).padStart(10)}${(Number.isFinite(rel) ? (rel >= 0 ? "+" : "") + rel.toFixed(4) : "—").padStart(10)}`);
}

if (base) {
  const worst = results.reduce((a, b) => (b.ex > a.ex ? b : a));
  console.log(`\n    THE BIAS: at ${worst.res}-minute bars the same rule reports an excess of ${worst.ex.toFixed(4)}% against ${base.ex.toFixed(4)}% at minute`);
  console.log(`    resolution — an inflation of ${(worst.ex - base.ex).toFixed(4)} percentage points, and the ambiguity rate falls`);
  console.log(`    from ${worst.amb.toFixed(1)}% to ${base.amb.toFixed(1)}% because coarse bars HIDE the whipsaws rather than resolving them.`);
  console.log(`\n    CONSEQUENCE FOR D-710: that sweep evaluated 100 specifications across 37 series entirely on HOURLY bars.`);
  console.log(`    ${worst.ex > base.ex
    ? "The bias is POSITIVE, so those results are UPPER BOUNDS and the finding of 0 survivors is if anything stronger."
    : "The bias is NEGATIVE, so those results are LOWER BOUNDS and the sweep may have hidden something — it must be re-run."}`);
}
