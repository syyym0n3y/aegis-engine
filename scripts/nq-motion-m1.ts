#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
// nq-motion-m1.ts (D-711) — the NQ Motion Model at the resolution it was written for.
//
// WHAT D-708 COULD NOT ANSWER. At hourly resolution, 22% of days broke BOTH sides of the opening range inside one
// bar, and which side triggers FIRST is the difference between a winner and a whipsaw. Carried at a coin flip the
// model gave +7.32 pts at t 4.27; at the worst assignment -4.87 at t -2.46. The verdict spanned zero because of the
// DATA, and THE COVERAGE LAW says that is UNTESTED, not a null.
//
// WHAT CHANGED. 1,200,240 minute bars, 2016-2026, 3,334 days (D-709). At minute resolution the ordering of the two
// touches is OBSERVABLE for all but the rare case where both happen inside the same minute — and that residual rate
// is now something to MEASURE and report rather than an assumption to argue about.
//
// AND THE MODEL CAN FINALLY BE TESTED AS SPECIFIED. The checklist implies a short opening range; hourly forced a
// 1-hour substitute, which is a different rule. 5, 15 and 30-minute ranges are tested here, which is what an
// "8:30 ORB" traded until 11:00 actually means.
//
// SESSION HANDLING IS EXPLICIT BECAUSE GETTING IT WRONG IS SILENT. The model's 8:30-11:00 is US CENTRAL. That is
// 13:30-16:00 UTC under daylight time and 14:30-17:00 under standard time. Applying one offset year-round would
// shift the opening range by a full hour for four months of every year — the range would be measured mid-session in
// winter and the result would be a statement about an arbitrary window.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("nq-motion-m1", [
  { name: "CACHE", def: "/Users/ona/aegis-data/m1_USATECHIDXUSD.jsonl.gz", note: "minute bars from D-709" },
  { name: "ORB_MINS", def: "5,15,30", note: "opening-range length in minutes" },
  { name: "WINDOW_MIN", def: "150", note: "minutes from session open to the close of the trade window (8:30->11:00)" },
  { name: "COST_BP", def: "1.5", note: "round-trip in bp: MNQ commission ~$1 on ~$54k notional + 0.25pt spread" },
]);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const pctl = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// US daylight time: second Sunday of March to first Sunday of November.
function isDST(d: string): boolean {
  const [y, m, dd] = d.split("-").map(Number);
  const nth = (yr: number, mo: number, dow: number, n: number) => {
    const first = new Date(Date.UTC(yr, mo - 1, 1));
    const off = (dow - first.getUTCDay() + 7) % 7;
    return 1 + off + (n - 1) * 7;
  };
  const start = nth(y, 3, 0, 2), end = nth(y, 11, 0, 1);
  if (m > 3 && m < 11) return true;
  if (m === 3) return dd >= start;
  if (m === 11) return dd < end;
  return false;
}

const raw = await Deno.readFile(K.CACHE);
const text = new TextDecoder().decode(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer().then((b) => new Uint8Array(b)));
const lines = text.trim().split("\n");
assertNonEmpty("cached days", lines, 1000);

interface Day { d: string; bars: number[][] }   // [secFromMidnightUTC, o, h, l, c]
// The cache stores the bar array under `b` (compact, 1.2M rows). Mapping it explicitly rather than casting: the
// first version declared `bars` and cast the parse, so every day silently had `bars === undefined` and the failure
// surfaced as a null-property error rather than as a wrong number — which is the good outcome of the two.
const days: Day[] = lines.map((l) => { const o = JSON.parse(l) as { d: string; b: number[][] }; return { d: o.d, bars: o.b }; });
if (days.some((x) => !Array.isArray(x.bars))) { console.error("!! a cached day has no bar array — RED."); Deno.exit(1); }
console.log(`==> NQ MOTION MODEL AT MINUTE RESOLUTION — D-711`);
console.log(`    ${days.length} days, ${days.reduce((a, x) => a + x.bars.length, 0).toLocaleString()} minute bars, ${days[0].d}..${days[days.length - 1].d}\n`);

const ORBS = K.ORB_MINS.split(",").map(Number);
const WIN = Number(K.WINDOW_MIN);
const COST = Number(K.COST_BP) / 1e4;

interface Ev { d: string; orb: number; widthPct: number; dir: 1 | -1 | 0; sameMin: boolean; retPct: number; benchPct: number }
for (const ORB of ORBS) {
  const evs: Ev[] = [];
  let sameMinute = 0, noBreak = 0, usable = 0;
  for (const day of days) {
    const openSec = (isDST(day.d) ? 13 : 14) * 3600 + 30 * 60;      // 8:30 US Central in UTC seconds
    const bars = day.bars.filter((b) => b[0] >= openSec && b[0] < openSec + WIN * 60);
    if (bars.length < ORB + 30) continue;
    usable++;
    const open = bars.filter((b) => b[0] < openSec + ORB * 60);
    if (open.length < Math.max(3, ORB / 2)) continue;
    const hi = Math.max(...open.map((b) => b[2])), lo = Math.min(...open.map((b) => b[3]));
    const ref = open[open.length - 1][4];
    if (!(hi > lo) || !(ref > 0)) continue;
    const rest = bars.filter((b) => b[0] >= openSec + ORB * 60);
    if (!rest.length) continue;
    const last = rest[rest.length - 1][4];
    const benchPct = (last - ref) / ref;
    // THE RESOLUTION THAT HOURLY DATA COULD NOT PROVIDE: walk minute by minute and take the FIRST touch.
    let dir: 1 | -1 | 0 = 0, entry = 0, same = false;
    for (const b of rest) {
      const up = b[2] > hi, dn = b[3] < lo;
      if (up && dn) { same = true; sameMinute++; break; }   // still ambiguous, but now measured, not assumed
      if (up) { dir = 1; entry = hi; break; }
      if (dn) { dir = -1; entry = lo; break; }
    }
    if (same) {
      evs.push({ d: day.d, orb: ORB, widthPct: 100 * (hi - lo) / ref, dir: 0, sameMin: true,
        retPct: (((last - hi) / hi) + ((lo - last) / lo)) / 2, benchPct });
      continue;
    }
    if (dir === 0) { noBreak++; continue; }
    evs.push({ d: day.d, orb: ORB, widthPct: 100 * (hi - lo) / ref, dir, sameMin: false,
      retPct: dir === 1 ? (last - entry) / entry : (entry - last) / entry, benchPct });
  }
  const r = evs.map((e) => e.retPct * 100), bch = evs.map((e) => e.benchPct * 100);
  const excess = evs.map((e) => (e.retPct - e.benchPct) * 100);
  console.log(`  ${ORB}-MINUTE OPENING RANGE, traded to ${WIN} minutes after the open`);
  console.log(`    usable days ${usable}  |  resolved trades ${evs.length}  |  no break ${noBreak}`);
  console.log(`    SAME-MINUTE ambiguity ${sameMinute} (${(100 * sameMinute / Math.max(1, evs.length)).toFixed(1)}%)  <- was 22% at HOURLY resolution`);
  if (evs.length < 200) { console.log(`    too few resolved trades — UNTESTED\n`); continue; }
  console.log(`    ${"measure".padEnd(30)}${"mean %".padStart(10)}${"t".padStart(8)}${"win%".padStart(7)}`);
  console.log(`    ${"breakout follow-through".padEnd(30)}${mean(r).toFixed(4).padStart(10)}${tstat(r).toFixed(2).padStart(8)}${(100 * r.filter((x) => x > 0).length / r.length).toFixed(0).padStart(6)}%`);
  console.log(`    ${"BENCHMARK: hold, same window".padEnd(30)}${mean(bch).toFixed(4).padStart(10)}${tstat(bch).toFixed(2).padStart(8)}`);
  console.log(`    ${"EXCESS over holding".padEnd(30)}${mean(excess).toFixed(4).padStart(10)}${tstat(excess).toFixed(2).padStart(8)}`);
  console.log(`    ${`NET of ${K.COST_BP}bp round trip`.padEnd(30)}${(mean(excess) - COST * 100).toFixed(4).padStart(10)}`);
  // the checklist's own filter, normalised — its claim was that middling ranges are tradable and wide ones are not
  console.log(`    by opening-range width (as % of level), on the EXCESS:`);
  const ws = evs.map((e) => e.widthPct);
  const edges = [0, pctl(ws, 0.2), pctl(ws, 0.4), pctl(ws, 0.6), pctl(ws, 0.8), 99];
  for (let i = 0; i < edges.length - 1; i++) {
    const sub = evs.filter((e) => e.widthPct >= edges[i] && e.widthPct < edges[i + 1]);
    if (sub.length < 50) continue;
    const ex = sub.map((e) => (e.retPct - e.benchPct) * 100);
    console.log(`      ${`${edges[i].toFixed(3)}%-${edges[i + 1] >= 99 ? "wide" : edges[i + 1].toFixed(3) + "%"}`.padEnd(20)}n=${String(sub.length).padStart(5)}  excess ${mean(ex).toFixed(4).padStart(8)}%  t ${tstat(ex).toFixed(2).padStart(6)}  net ${(mean(ex) - COST * 100).toFixed(4).padStart(8)}%`);
  }
  // era quartiles on the excess
  const q4 = [0, 1, 2, 3].map((e) => {
    const a = Math.floor(e * excess.length / 4), b = Math.floor((e + 1) * excess.length / 4);
    return mean(excess.slice(a, b));
  });
  console.log(`    era quartiles on the excess: ${q4.map((x) => x.toFixed(4)).join("  ")}  -> ${q4.map((x) => x > 0 ? "+" : "-").join("")}\n`);
}
console.log(`  THE COMPARISON THAT MATTERS: D-708 could only bound this between +7.32 and -4.87 points because the`);
console.log(`  within-hour ordering was unobservable. The same-minute ambiguity rates above are what remains`);
console.log(`  unresolvable at THIS resolution, and they are reported rather than assumed away.`);
