import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blendDeRisk, classifyRegime, type MacroIndicators } from "./trd-macro.ts";

// A benign expansion: no signal fires → EXPANSION, de-risk is a near no-op (factor ~1).
Deno.test("benign expansion → no de-risk", () => {
  const ind: MacroIndicators = {
    economy: "US", asOf: "2017-06-30",
    yieldCurve10y3m: 1.4, creditSpread: 0.9, creditSpreadMedian12m: 0.95,
    unemploymentRate: 4.3, unemploymentMin12m: 4.3, pmi: 57, pmiPrior3m: 56,
    cpiYoY: 1.9, cpiYoYPrior3m: 2.1, volPercentile: 0.2,
  };
  const r = classifyRegime(ind);
  assertEquals(r.phase, "EXPANSION");
  assert(r.deRiskFactor > 0.95, `expected ~no-op, got ${r.deRiskFactor}`);
  assertEquals(r.signals.length, 0);
});

// A 2008-style fragile regime: inverted curve + blown-out credit + Sahm + PMI contraction + vol.
// → CONTRACTION, fragility high, size cut hard (toward the 0.3 floor).
Deno.test("2008-style crisis → strong de-risk", () => {
  const ind: MacroIndicators = {
    economy: "US", asOf: "2008-10-31",
    yieldCurve10y3m: -0.4, creditSpread: 3.4, creditSpreadMedian12m: 1.2,
    unemploymentRate: 6.5, unemploymentMin12m: 4.4, pmi: 38, pmiPrior3m: 49,
    cpiYoY: 3.7, cpiYoYPrior3m: 5.4, volPercentile: 0.99,
  };
  const r = classifyRegime(ind);
  assertEquals(r.phase, "CONTRACTION");
  assert(r.fragility > 0.8, `expected high fragility, got ${r.fragility}`);
  assert(r.deRiskFactor < 0.45, `expected hard cut, got ${r.deRiskFactor}`);
  assert(r.deRiskFactor >= 0.3, "must never cut below the 0.3 floor");
});

// Inversion alone (curve inverted, everything else fine) = LATE_CYCLE, moderate trim — NOT a
// direction call, NOT a full de-risk. This is the honest middle ground.
Deno.test("inverted curve alone → late-cycle, moderate trim", () => {
  const ind: MacroIndicators = {
    economy: "US", asOf: "2023-07-31",
    yieldCurve10y3m: -1.5, creditSpread: 1.1, creditSpreadMedian12m: 1.1,
    unemploymentRate: 3.5, unemploymentMin12m: 3.4, pmi: 54, pmiPrior3m: 53,
    cpiYoY: 3.2, cpiYoYPrior3m: 4.0, volPercentile: 0.4,
  };
  const r = classifyRegime(ind);
  assertEquals(r.phase, "LATE_CYCLE");
  assert(r.deRiskFactor < 1 && r.deRiskFactor > 0.7, `expected moderate trim, got ${r.deRiskFactor}`);
});

// The live autonomous path has only TWO signals (curve + vol from Yahoo). Two benign signals is a
// real read → must be a near no-op, NOT down-capped to the fail-safe floor.
Deno.test("curve + vol only, both benign → no de-risk (not fail-safe capped)", () => {
  const r = classifyRegime({ economy: "US", asOf: "2026-08-03", yieldCurve10y3m: 0.99, volPercentile: 0.28 });
  assertEquals(r.phase, "EXPANSION");
  assert(r.deRiskFactor > 0.95, `two benign signals must be ~no-op, got ${r.deRiskFactor}`);
});

// Fail SAFE on near-empty data: unknown regime must NOT be treated as calm.
Deno.test("no data → fail safe (assume some fragility)", () => {
  const r = classifyRegime({ economy: "ZZ", asOf: "2020-01-01" });
  assertEquals(r.phase, "UNKNOWN");
  assert(r.deRiskFactor <= 0.6, `unknown must default cautious, got ${r.deRiskFactor}`);
});

// Blend: the most-fragile relevant economy dominates (contagion floor).
Deno.test("blend is dominated by the most fragile economy", () => {
  const calm = classifyRegime({ economy: "US", asOf: "2017-01-01", yieldCurve10y3m: 1.2, creditSpread: 0.9, creditSpreadMedian12m: 0.9, unemploymentRate: 4.5, unemploymentMin12m: 4.5, pmi: 56, pmiPrior3m: 55, volPercentile: 0.2 });
  const crisis = classifyRegime({ economy: "EA", asOf: "2011-11-01", yieldCurve10y3m: -0.2, creditSpread: 3.0, creditSpreadMedian12m: 1.1, unemploymentRate: 10.5, unemploymentMin12m: 9.9, pmi: 44, pmiPrior3m: 49, volPercentile: 0.95 });
  const { deRiskFactor, drivers } = blendDeRisk([calm, crisis]);
  assert(deRiskFactor <= crisis.deRiskFactor + 1e-9, "blend must not exceed the worst economy's factor");
  assert(drivers.some((d) => d.startsWith("EA")), "the crisis economy should be named a driver");
});
