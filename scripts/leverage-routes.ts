// D-908 — what leverage actually costs by ROUTE, which is the thing that killed every previous attempt.
// Every route this record has measured charges financing ON TOP OF the risk-free rate: CFD at a broker spread (D-866,
// made a comparable book negative), perps at funding (D-880, Sharpe 0.54 -> 0.40/0.22/0.16). EXCHANGE-TRADED FUTURES
// do not: the carry is embedded in the futures price, so a long position earns the underlying minus the risk-free rate
// while the trader's cash sits in bills earning it back. Net financing excess is approximately ZERO.
// On a book earning 3.7% excess, a 3% broker spread on 5x notional is a 12%/yr drag — larger than the entire return.
// THIS IS A CONDITIONAL COMPUTATION AND IS LABELLED AS ONE: this record holds only 16 commodity futures with long
// history and NO index futures, so the futures column says what the route WOULD deliver, not what has been measured
// on a futures-implemented book. The missing input is named rather than assumed away.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("leverage-routes", [
  { name: "BLEND", def: "data/d896-blend-long.json" },
  { name: "RF", def: "0.04" }, { name: "CFD_SPREAD", def: "0.03", note: "broker financing over the risk-free, the D-866 shape" },
  { name: "ROLL_BP", def: "0", note: "futures roll cost per year in bp, charged on notional; swept separately" },
  { name: "DD_FLOOR", def: "-0.50", note: "worse than this is NOT HOLDABLE whatever the growth (D-565)" },
  { name: "TARGET_X", def: "100000" }, { name: "LEVS", def: "1,2,3,5,8,12" },
]);
const j = JSON.parse(await Deno.readTextFile(new URL(`../${K.BLEND}`, import.meta.url).pathname)) as { series: Record<string, number>; ann_obs: number };
const days = Object.keys(j.series).sort(); const R = days.map((d) => j.series[d]);
assertNonEmpty("blend daily observations", R, 2500);
const ANN = j.ann_obs;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const mu = mean(R) * ANN, vol = sd(R) * Math.sqrt(ANN), SR = mu / vol;
// realised maximum drawdown of the unlevered series, scaled linearly with leverage — an approximation that UNDERSTATES
// the risk of a levered position, because a margin call forces liquidation at the worst moment and a continuous-series
// drawdown cannot see that. Stated, not modelled.
let eq = 0, peak = 0, mdd = 0; for (const r of R) { eq += r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); }
const M = Math.log(+K.TARGET_X), RF = +K.RF;
const yrs = (g: number) => g > 0 ? M / g : Infinity;
const fmt = (g: number) => g > 0 ? `${yrs(g).toFixed(0)}y` : "never";
console.log(`==> D-908 LEVERAGE ROUTES — the blend: excess ${(100 * mu).toFixed(2)}%/yr, vol ${(100 * vol).toFixed(1)}%, Sharpe ${SR.toFixed(2)}, unlevered maxDD ${(100 * (Math.exp(mdd) - 1)).toFixed(1)}%`);
console.log(`  Growth g(L) = rf + L*excess - (L*vol)^2/2, minus the route's financing. Target ${(+K.TARGET_X).toLocaleString("en-US")}x.`);
console.log(`  FUTURES is CONDITIONAL — this record holds 16 commodity futures and NO index futures, so that column is`);
console.log(`  what the route would deliver, not a measurement of a futures-implemented book.\n`);
console.log(`  ${"lev".padStart(4)} ${"maxDD".padStart(7)} ${"FUTURES (rf only)".padStart(19)} ${"CFD (rf+3%)".padStart(17)} ${"PERP (D-880 measured)".padStart(22)}`);
const DEG: Record<string, number> = { "1": 0.40 / 0.54, "2": 0.22 / 0.54, "3": 0.16 / 0.54 };
for (const lS of K.LEVS.split(",")) {
  const L = +lS, dd = Math.exp(mdd * L) - 1;
  const gF = RF + L * mu - (L * vol) ** 2 / 2 - L * (+K.ROLL_BP / 1e4);
  const gC = RF + L * mu - (L - 1) * +K.CFD_SPREAD - (L * vol) ** 2 / 2;
  const deg = DEG[lS];
  const gP = deg === undefined ? NaN : RF + L * (SR * deg) * vol - (L * vol) ** 2 / 2;
  const hold = dd > +K.DD_FLOOR ? "" : "  NOT HOLDABLE";
  console.log(`  ${(L + "x").padStart(4)} ${(100 * dd).toFixed(0).padStart(6)}% ${`${(100 * gF).toFixed(1)}%/yr ${fmt(gF)}`.padStart(19)} ${`${(100 * gC).toFixed(1)}%/yr ${fmt(gC)}`.padStart(17)} ${(isNaN(gP) ? "not measured past 3x" : `${(100 * gP).toFixed(1)}%/yr ${fmt(gP)}`).padStart(22)}${hold}`);
}
// THE MULTIPLE IS THE CLOCK, AND THE STAKE SETS THE MULTIPLE. 10 dollars to a million is 100,000x, and the ladder has
// been quoting that one number as if the strategy set the timeline. It does not: the STARTING STAKE does, because time
// scales with log(target/stake). From a realistic stake the same book at the same leverage is a different problem.
{
  const routes: [string, (L: number) => number][] = [
    ["unlevered 1x", () => RF + mu - vol * vol / 2],
    ["futures 5x", () => RF + 5 * mu - (5 * vol) ** 2 / 2 - 5 * (+K.ROLL_BP / 1e4)],
    ["futures 8x", () => RF + 8 * mu - (8 * vol) ** 2 / 2 - 8 * (+K.ROLL_BP / 1e4)],
  ];
  console.log(`\n  TIME BY MULTIPLE — the stake sets the multiple, and the multiple sets the clock (roll ${K.ROLL_BP}bp):`);
  console.log(`    ${"from -> to".padEnd(24)} ${"multiple".padStart(9)} ${routes.map(([n]) => n.padStart(13)).join("")}`);
  for (const [from, to] of [[10, 1e6], [1000, 1e6], [10000, 1e6], [50000, 1e6], [10000, 100000]] as [number, number][]) {
    const m = Math.log(to / from);
    const cells = routes.map(([, f]) => { const g = f(0); return (g > 0 ? `${(m / g).toFixed(0)}y` : "never").padStart(13); }).join("");
    console.log(`    ${`£${from.toLocaleString("en-US")} -> £${to.toLocaleString("en-US")}`.padEnd(24)} ${(to / from).toLocaleString("en-US").padStart(8)}x${cells}`);
  }
}
const kelly = mu / (vol * vol);
console.log(`\n  Kelly leverage for this book is ${kelly.toFixed(1)}x — far past the drawdown floor, which binds first.`);
console.log(`  THE POINT: at 5x the futures route and the CFD route differ by ${(100 * (5 - 1) * +K.CFD_SPREAD).toFixed(0)} percentage points of annual drag on a book`);
console.log(`  earning ${(100 * mu).toFixed(1)}% excess. THE FINANCING ROUTE, NOT THE LEVERAGE, IS WHAT KILLED EVERY PREVIOUS ATTEMPT.`);
