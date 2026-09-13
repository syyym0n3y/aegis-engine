#!/usr/bin/env -S deno run --allow-read
// tenfold-arithmetic.ts (D-864) — the operator's target stated as arithmetic: "any trader ... grow their return on
// investment at least tenfold if we are being conservative". Tenfold is a function of THREE things only — the Sharpe
// of what you run, the volatility you run it at (leverage), and the years you give it — with the drawdown you must
// survive as the constraint. This prints that table from first principles and beside it the Sharpes this programme
// has actually measured, so the gap between the target and the record is a number, not an argument.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("tenfold-arithmetic", [{ name: "SHARPES", def: "0.3,0.5,0.8,1.0,1.5,2.0" }, { name: "VOLS", def: "0.10,0.20,0.40,0.80" }, { name: "RF", def: "0.04" }]);
const S = K.SHARPES.split(",").map(Number), V = K.VOLS.split(",").map(Number), rf = +K.RF;
// geometric growth of a strategy with arithmetic excess mean mu = S*sigma: g = rf + S*sigma - sigma^2/2
const g = (s: number, v: number) => rf + s * v - v * v / 2;
// expected max drawdown of a Brownian motion over long horizons ~ scales with sigma^2/(2*mu) ... use the standard
// approximation for a Sharpe-S strategy at vol v: typical worst-decade drawdown ~ 2*v/ S (Magdon-Ismail et al. give
// E[MDD] ~ v^2/(2 mu) * ln-ish terms for long T); we print the conservative rule of thumb 2*v/S, capped at 100%.
const mdd = (s: number, v: number) => Math.min(1, 2 * v / Math.max(s, 0.05));
console.log(`\n==> TENFOLD ARITHMETIC — years to 10x = ln(10) / g, where g = rf + Sharpe*vol - vol^2/2  (rf ${(100 * rf).toFixed(0)}%)`);
console.log(`  ${"Sharpe".padEnd(7)} ${V.map((v) => `vol ${(100 * v).toFixed(0)}%`.padStart(22)).join("")}`);
console.log(`  ${"".padEnd(7)} ${V.map(() => "yrs/g%/typ.MDD".padStart(22)).join("")}`);
for (const s of S) console.log(`  ${s.toFixed(1).padEnd(7)} ${V.map((v) => { const gr = g(s, v); const yrs = gr > 0 ? Math.log(10) / gr : Infinity; return `${isFinite(yrs) ? yrs.toFixed(1) : "never"}y / ${(100 * gr).toFixed(0)}% / ${(100 * mdd(s, v)).toFixed(0)}%`.padStart(22); }).join("")}`);
console.log(`\n  Read it this way: "tenfold conservatively" inside ~7 years needs g >= 39%/yr, which at a survivable drawdown (<= 40-50%)`);
console.log(`  requires a sustained NET Sharpe of about 1.5 at 30-40% vol. At Sharpe 0.5 the same 10x takes ~25 years at 20% vol.`);
console.log(`\n  WHAT THIS RECORD HAS MEASURED (net, OOS or modern era, from the ledger):`);
for (const [what, sh, ref] of [["combined factor book, modern era", 0.40, "D-527/558"], ["crypto GBM candidate, liquid tercile (unholdable: 3.7y underwater)", 1.11, "D-535/565"], ["hourly adaptive set-ups, 24 instruments", 0.0, "D-861 (gross zero)"], ["diversified TSMOM book, 110 assets, OOS 2015-26 (long basket did 0.80)", 0.62, "D-863"], ["timed ISA basket, class risk parity, VIX overlay — BEST HOLDABLE (maxDD -5%)", 0.83, "D-870/872"]] as [string, number, string][]) console.log(`    ${what.padEnd(64)} Sharpe ${isNaN(sh) ? " pending" : sh.toFixed(2).padStart(8)}   ${ref}`);
console.log(`\n  The distance between the table's 1.5 and the record's best HOLDABLE number is the mission, stated as a number.`);
