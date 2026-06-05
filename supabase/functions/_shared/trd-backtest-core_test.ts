import {
  evaluateStrategy, factorDecompose, gateVerdict, ols, walkForwardFolds,
} from "./trd-backtest-core.ts";
import { assert, assertAlmost, assertEquals, assertInRange } from "./trd-test-helpers.ts";

// deterministic PRNG so the self-test never flakes (no Math.random)
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296; // [0,1)
  };
}
function gauss(rng: () => number): number {
  // Box–Muller
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

Deno.test("OLS recovers exact coefficients", () => {
  // y = 1 + 2*x1 + 3*x2 exactly
  const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 20; i++) {
    const x1 = i, x2 = (i * 7) % 5;
    X.push([x1, x2]);
    y.push(1 + 2 * x1 + 3 * x2);
  }
  const { coef, r2 } = ols(y, X);
  assertAlmost(coef[0], 1, 1e-6);
  assertAlmost(coef[1], 2, 1e-6);
  assertAlmost(coef[2], 3, 1e-6);
  assertAlmost(r2, 1, 1e-9);
});

Deno.test("walk-forward folds tile the series with no overlap, no look-ahead", () => {
  const folds = walkForwardFolds(120, 4);
  assertEquals(folds.length, 4);
  for (const f of folds) {
    // train is always strictly before test (no look-ahead)
    assert(Math.max(...f.trainIdx) < Math.min(...f.testIdx), "train precedes test");
  }
  // test segments are disjoint and cover the tail
  const allTest = folds.flatMap((f) => f.testIdx);
  assertEquals(new Set(allTest).size, allTest.length, "no overlap across OOS segments");
});

Deno.test("SELF-TEST: a noise strategy is REJECTED (no edge)", () => {
  const rng = lcg(42);
  const rng2 = lcg(99);
  // ~zero-mean noise, tiny positive drift but nowhere near surviving deflation
  const returns = Array.from({ length: 250 }, () => 0.0001 + 0.01 * gauss(rng));
  const spy = Array.from({ length: 250 }, () => 0.0003 + 0.008 * gauss(rng2));
  const panel = evaluateStrategy({
    returns, costBps: 22, nTrials: 100, varTrialSharpes: 0.02, benchmarkSharpe: 0.03,
    factors: { spy },
  });
  const v = gateVerdict(panel);
  assert(!v.passed, "noise must be rejected");
  assert(panel.deflatedSharpe < 0.95, `DSR should be low, got ${panel.deflatedSharpe}`);
});

Deno.test("SELF-TEST: a congressional copycat is unmasked as SECTOR BETA, not alpha → REJECTED", () => {
  const rng = lcg(7);
  // build a market factor with real positive drift
  const spy = Array.from({ length: 300 }, () => 0.0005 + 0.009 * gauss(rng));
  const size = Array.from({ length: 300 }, () => 0.003 * gauss(rng));
  // the "copycat" is just 0.8x the market + a little noise — it LOOKS like it
  // beats cash, but it is pure beta with ZERO residual alpha.
  const returns = spy.map((s, i) => 0.8 * s + 0.001 * gauss(rng) + 0.0 * size[i]);

  const decomp = factorDecompose(returns, { spy, size });
  assertAlmost(decomp.betas.spy, 0.8, 0.05); // recovers the beta
  assertInRange(decomp.residualAlpha, -5e-4, 5e-4); // ~no alpha
  assert(Math.abs(decomp.residualAlpha) < 1e-3, "residual alpha ~ 0");

  const panel = evaluateStrategy({
    returns, costBps: 22, nTrials: 50, varTrialSharpes: 0.02, benchmarkSharpe: 0.03,
    factors: { spy, size },
  });
  const v = gateVerdict(panel);
  assert(!v.passed, "copycat must be rejected");
  assert(v.failing.some((f) => f.includes("residual_alpha")), `expected residual_alpha failure, got ${JSON.stringify(v.failing)}`);
});

Deno.test("factor decomposition DETECTS genuine residual alpha when it exists", () => {
  const rng = lcg(123);
  const spy = Array.from({ length: 300 }, () => 0.0005 + 0.009 * gauss(rng));
  // a true, factor-independent edge of +8bps/period on top of 0.5x beta
  const alpha = 0.0008;
  const returns = spy.map((s) => 0.5 * s + alpha + 0.003 * gauss(rng));
  const decomp = factorDecompose(returns, { spy });
  assert(decomp.residualAlpha > 0, `expected positive residual alpha, got ${decomp.residualAlpha}`);
  assertAlmost(decomp.betas.spy, 0.5, 0.06);
  // honesty: detecting alpha is NOT the same as passing the gate at this n —
  // the gate may still (correctly) demand a longer track record.
});
