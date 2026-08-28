#!/usr/bin/env -S deno run --allow-read --allow-env
// capital-ladder.ts (D-678) — how the account actually climbs, simulated on REAL return paths.
//
// D-677 laid out four levels defined by COST REGIME and argued the least-risk holding at every one is the passive
// benchmark that every active overlay built here failed to beat (D-649: passive OOS SR 0.73 at 8.6%/yr against the
// best active variant at 2.9%). This simulates the climb rather than asserting it.
//
// WHY REAL PATHS AND NOT A DISTRIBUTION. A lognormal simulation would report a tidy median and understate exactly
// what matters: the sequence. Starting in 1999 means the dot-com bust arrives while the account is at its smallest
// and contributions dominate; starting in 2009 means a decade of tailwind first. Same expected return, very
// different lived outcome, and only the real sequence carries that. Every start month in the panel is walked, so
// the output is a DISTRIBUTION OVER HISTORY rather than over an assumption.
//
// COSTS ARE LEVEL-DEPENDENT, which is the whole thesis of D-677: a fixed per-trade commission is a rounding error at
// $40,000 and a death sentence at $40. Both regimes are simulated so the difference is measured, not claimed.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("capital-ladder", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "COMMISSION", def: "0", note: "$ per trade; 0 = zero-commission broker with fractional shares" },
  { name: "TRADES_YR", def: "12", note: "rebalances per year for the passive holding" },
  { name: "SPREAD_BP", def: "3", note: "round-trip spread on a broad ETF, proportional to size" },
  { name: "STREAM", def: "/Users/ona/aegis-data/book_passive_daily.tsv" },
  { name: "MAX_YEARS", def: "30" },
]);

const txt = await Deno.readTextFile(K.STREAM);
const rows = txt.trim().split("\n").map((l) => { const p = l.split("\t"); return { d: p[0], r: Number(p[1]) }; })
  .filter((x) => x.d && Number.isFinite(x.r));
assertNonEmpty("daily passive returns", rows, 1000);

// collapse to months — contributions arrive monthly and the ladder is a multi-year question
const byMo = new Map<string, number>();
for (const r of rows) { const m = r.d.slice(0, 7); byMo.set(m, (byMo.get(m) ?? 0) + Math.log1p(r.r)); }
const months = [...byMo.entries()].sort().map(([m, lg]) => ({ m, r: Math.expm1(lg) }));
assertNonEmpty("monthly returns", months, 60);

const START = Number(K.START), MONTHLY = Number(K.MONTHLY), COMM = Number(K.COMMISSION);
const TRADES = Number(K.TRADES_YR), SPREAD = Number(K.SPREAD_BP) / 1e4, MAXY = Number(K.MAX_YEARS);
const LEVELS = [1000, 10000, 100000];

console.log(`==> CAPITAL LADDER — simulated on ${months.length} real months, ${months[0].m} to ${months[months.length - 1].m}`);
console.log(`    start $${START}  contribution $${MONTHLY}/mo  commission $${COMM}/trade  ${TRADES} trades/yr  spread ${K.SPREAD_BP}bp`);

interface Path { start: string; hit: (number | null)[]; end: number; worstDD: number; monthsRun: number }
const paths: Path[] = [];

for (let s = 0; s < months.length; s++) {
  if (months.length - s < 24) break;                    // need a couple of years to say anything
  let cap = START, peak = START, worstDD = 0;
  const hit: (number | null)[] = LEVELS.map(() => null);
  let i = s, mo = 0;
  for (; i < months.length && mo < MAXY * 12; i++, mo++) {
    // costs charged BEFORE the return, on the capital actually at work
    const fixed = COMM * TRADES / 12;                   // per month
    const prop = cap * SPREAD * (TRADES / 12);
    cap = Math.max(0, cap - fixed - prop);
    cap = cap * (1 + months[i].r) + MONTHLY;
    peak = Math.max(peak, cap);
    worstDD = Math.min(worstDD, cap / peak - 1);
    LEVELS.forEach((L, k) => { if (hit[k] === null && cap >= L) hit[k] = mo / 12; });
  }
  paths.push({ start: months[s].m, hit, end: cap, worstDD, monthsRun: mo });
}
assertNonEmpty("simulated paths", paths, 24);

const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

console.log(`\n    ${paths.length} start months walked, each up to ${MAXY} years\n`);
console.log(`    ${"level".padStart(9)}${"reached".padStart(10)}${"median yrs".padStart(12)}${"p25".padStart(8)}${"p75".padStart(8)}${"failed".padStart(8)}${"censored".padStart(10)}`);
// A PATH THAT RAN OUT OF PANEL IS NOT A PATH THAT FAILED. The series is 27 years; a start month in 2020 cannot
// reach a level that takes 25 years, and counting it as "never" would report data truncation as strategy failure —
// the false-negative shape THE POSITIVE-CONTROL RULE exists to catch. Each level is scored only over paths with
// enough remaining months to have plausibly reached it, and the censored count is stated separately.
LEVELS.forEach((L, k) => {
  const got = paths.map((p) => p.hit[k]).filter((x): x is number => x !== null);
  const medYrs = got.length ? pct(got, 0.5) : Infinity;
  // a path is only ELIGIBLE to fail if it ran at least as long as the median winner took
  const eligible = paths.filter((p) => p.monthsRun / 12 >= (Number.isFinite(medYrs) ? medYrs : MAXY));
  const eligFail = eligible.filter((p) => p.hit[k] === null).length;
  const censored = paths.length - eligible.length;
  console.log(`    ${("$" + L.toLocaleString()).padStart(9)}${(got.length + "/" + paths.length).padStart(10)}${(got.length ? pct(got, 0.5).toFixed(1) : "—").padStart(12)}${(got.length ? pct(got, 0.25).toFixed(1) : "—").padStart(8)}${(got.length ? pct(got, 0.75).toFixed(1) : "—").padStart(8)}${String(eligFail).padStart(8)}${String(censored).padStart(10)}`);
});

const dds = paths.map((p) => p.worstDD * 100);
console.log(`\n    WORST DRAWDOWN ALONG THE WAY: median ${pct(dds, 0.5).toFixed(1)}%  |  p10 ${pct(dds, 0.1).toFixed(1)}%  |  worst ${Math.min(...dds).toFixed(1)}%`);

// The decomposition that decides where effort belongs.
const yrsTo1k = paths.map((p) => p.hit[0]).filter((x): x is number => x !== null);
if (yrsTo1k.length) {
  const med = pct(yrsTo1k, 0.5);
  const contributed = START + MONTHLY * 12 * med;
  console.log(`\n    AT THE MEDIAN PATH TO $1,000 (${med.toFixed(1)} years):`);
  console.log(`      contributed $${contributed.toFixed(0)} of $1,000 = ${(100 * contributed / 1000).toFixed(0)}% — the rest is return.`);
  console.log(`      A strategy twice as good moves this by the RETURN share only, which is ${(100 - 100 * contributed / 1000).toFixed(0)}% of the problem.`);
}
