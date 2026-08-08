import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Bar, findExtrema, monteCarloThreshold, rayleigh, scanPeriods } from "./trd-cycles.ts";

Deno.test("rayleigh is high for perfectly periodic extrema, low for spread ones", () => {
  const periodic = [0, 300, 600, 900, 1200, 1500].map((d) => d); // exact 300-day spacing
  const spread = [0, 137, 410, 601, 998, 1301];
  assert(rayleigh(periodic, 300).R > 0.98, "exact-period extrema must cluster");
  assert(rayleigh(spread, 300).R < rayleigh(periodic, 300).R, "irregular extrema less clustered");
});

Deno.test("scan finds the injected period as a peak above the MC null", () => {
  // extrema every 250 days over ~3000 days → 13 points
  const days: number[] = []; for (let d = 0; d <= 3000; d += 250) days.push(d);
  const scan = scanPeriods(days, 100, 800, 1);
  const peak = scan.reduce((a, b) => (b.R > a.R ? b : a));
  // the true period (or one of its integer divisors, which also cluster) must top the scan
  assert([250].some((P) => P % peak.period === 0 && rayleigh(days, P).R > 0.98), `peak ${peak.period} should divide 250`);
  const mc = monteCarloThreshold(days.length, 3000, 100, 800, 1, 300);
  assert(rayleigh(days, 250).R > mc.p95, "the injected 250d cycle must beat the Monte-Carlo 95th pct");
});

Deno.test("findExtrema locates a clear high and low", () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 121; i++) { const p = 100 + (i === 60 ? 50 : i === 30 ? -30 : 0); bars.push({ ts: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(), open: p, high: p + (i === 60 ? 5 : 1), low: p - (i === 30 ? 5 : 1), close: p }); }
  const ex = findExtrema(bars, 20);
  assert(ex.some((e) => e.kind === "high"), "should find a high");
  assert(ex.some((e) => e.kind === "low"), "should find a low");
});
