// deno test supabase/functions/_shared/ — guards the execution-intelligence math (D-365). Offline, no deps.
import { assertEquals, assert } from "jsr:@std/assert@1";
import { appliedLeverage, breadthForIR, deploymentPlan, kellyLeverage, portfolioVol, positionSize, positionsForTargetVol, signalHalfLife, volTargetLeverage } from "./sizing.ts";

Deno.test("kellyLeverage = (S/σ)·fraction", () => { assertEquals(kellyLeverage(1.0, 0.1, 0.25), 2.5); assertEquals(kellyLeverage(0, 0.1), 0); assertEquals(kellyLeverage(1, 0), 0); });
Deno.test("volTargetLeverage = target/σ, capped", () => { assertEquals(volTargetLeverage(0.2, 0.1), 0.5); assertEquals(volTargetLeverage(0.02, 0.1, 3), 3); });
Deno.test("appliedLeverage takes the more conservative guardrail", () => {
  // ¼-Kelly on S=2,σ=0.1 = 5.0; vol-target 0.1/0.1 = 1.0 → min = 1.0
  assertEquals(appliedLeverage(2.0, 0.1, { targetAnnVol: 0.1 }), 1.0);
});
Deno.test("positionSize risks exactly equity·ρ at the stop", () => {
  const p = positionSize(100_000, 0.005, 100, 95); // rps 5, budget 500 → 100 shares
  assertEquals(p.shares, 100); assertEquals(p.dollar_risk, 500); assertEquals(p.dollar_exposure, 10_000);
  assertEquals(positionSize(100_000, 0.005, 100, 100).shares, 0); // zero stop distance → no position
});
Deno.test("breadthForIR = (IR/IC)² — thin IC needs a wide book", () => { assertEquals(breadthForIR(1.0, 0.05), 400); assertEquals(breadthForIR(1.0, 0), Infinity); });
Deno.test("portfolioVol floors at σ·√ρ; single name = σ", () => {
  assertEquals(portfolioVol(0.3, 1, 0.2), 0.3);
  const big = portfolioVol(0.3, 100000, 0.2); assert(Math.abs(big - 0.3 * Math.sqrt(0.2)) < 1e-3);
});
Deno.test("positionsForTargetVol returns Infinity when corr floor exceeds target", () => {
  assertEquals(positionsForTargetVol(0.3, 0.25, 0.10), Infinity); // 0.3·√0.25 = 0.15 > 0.10 → unreachable
  assert(positionsForTargetVol(0.3, 0.0, 0.10) > 1);              // uncorrelated → reachable with enough names
});
Deno.test("signalHalfLife: φ=0.5→1 period; slow factor→long", () => {
  assertEquals(signalHalfLife(0.5), 1);
  assert(signalHalfLife(0.9) > 6 && signalHalfLife(0.9) < 7);
});
Deno.test("deploymentPlan wires it together for a proven edge", () => {
  const plan = deploymentPlan({ annSharpe: 0.8, annVol: 0.12, ic: 0.04, nameVol: 0.35, avgCorr: 0.15, signalAutocorr: 0.92, periodsPerYear: 12 }, 100_000, 1.0, 0.10, 0.005, { entryPx: 50, stopPx: 47 });
  assert(plan.applied_leverage > 0 && plan.applied_leverage <= 3);
  assert(plan.target_positions >= 625);      // (1/0.04)² = 625 lower bound from IR law
  assert(plan.hold_periods > 1);
  assert(plan.per_trade!.example_shares > 0);
});
