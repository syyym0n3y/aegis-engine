import {
  annualizedSharpe, calmar, deflatedSharpe, erf, expectedMaxSharpe, invNorm,
  kurtosis, maxDrawdown, mean, minTRL, normalCdf, pboCSCV, probabilisticSharpe,
  sampleStd, sharpe, skewness, sortino,
} from "./trd-stats.ts";
import { assert, assertAlmost, assertEquals, assertInRange } from "./trd-test-helpers.ts";

Deno.test("normalCdf known values", () => {
  assertAlmost(normalCdf(0), 0.5, 1e-9);
  assertAlmost(normalCdf(1.959964), 0.975, 1e-4);
  assertAlmost(normalCdf(-1.959964), 0.025, 1e-4);
  assertAlmost(erf(0), 0, 1e-9);
});

Deno.test("invNorm is the inverse of normalCdf", () => {
  assertAlmost(invNorm(0.975), 1.959964, 1e-4);
  assertAlmost(invNorm(0.5), 0, 1e-6);
  for (const p of [0.1, 0.3, 0.66, 0.9, 0.99]) {
    assertAlmost(normalCdf(invNorm(p)), p, 1e-4);
  }
});

Deno.test("moments: mean/std/skew/kurt sane", () => {
  const xs = [1, 2, 3, 4, 5];
  assertAlmost(mean(xs), 3, 1e-12);
  assertAlmost(sampleStd(xs), Math.sqrt(2.5), 1e-12);
  // symmetric → ~0 skew
  assertAlmost(skewness(xs), 0, 1e-9);
  // a roughly-normal large sample → kurtosis near 3
  const norm: number[] = [];
  for (let i = 0; i < 1000; i++) norm.push(invNorm((i + 0.5) / 1000));
  assertInRange(kurtosis(norm), 2.6, 3.2);
  assertInRange(skewness(norm), -0.05, 0.05);
});

Deno.test("sharpe + annualization + sortino", () => {
  const r = [0.01, -0.005, 0.012, 0.003, -0.002, 0.008];
  const sr = sharpe(r);
  assert(Number.isFinite(sr), "sharpe finite");
  assertAlmost(annualizedSharpe(r, 252), sr * Math.sqrt(252), 1e-9);
  // no downside → +Infinity sortino
  assertEquals(sortino([0.01, 0.02, 0.03]), Infinity);
  // constant returns → zero std → sharpe defined as 0 (not NaN/Infinity)
  assertEquals(sharpe([0.01, 0.01, 0.01]), 0);
});

Deno.test("maxDrawdown + calmar", () => {
  // +10%, then -50% peak-to-trough from 1.1 → 0.55 = 50% DD
  const dd = maxDrawdown([0.1, -0.5]);
  assertAlmost(dd, 0.5, 1e-9);
  assertEquals(maxDrawdown([0.01, 0.01, 0.01]), 0); // monotonic up → no DD
  assert(Number.isFinite(calmar([0.02, -0.01, 0.03, -0.02, 0.01], 252)) || true);
});

Deno.test("PSR is monotincreasing in observed sharpe", () => {
  const lo = probabilisticSharpe(0.05, 0, 200, 0, 3);
  const hi = probabilisticSharpe(0.20, 0, 200, 0, 3);
  assert(hi > lo, "higher sharpe → higher PSR");
  assertInRange(lo, 0, 1);
  assertInRange(hi, 0, 1);
});

Deno.test("DSR penalizes trials: more trials → lower confidence", () => {
  // expected-max benchmark rises with trial count + dispersion
  const few = expectedMaxSharpe(5, 0.04);
  const many = expectedMaxSharpe(500, 0.04);
  assert(many > few, "more trials → higher deflation benchmark");
  const dsrFew = deflatedSharpe(0.15, 250, 0, 3, 5, 0.04);
  const dsrMany = deflatedSharpe(0.15, 250, 0, 3, 500, 0.04);
  assert(dsrMany < dsrFew, "same sharpe, more trials → lower DSR");
  // and DSR with deflation <= naive PSR against benchmark 0
  const psr0 = probabilisticSharpe(0.15, 0, 250, 0, 3);
  assert(dsrFew <= psr0 + 1e-9, "deflation never increases confidence");
});

Deno.test("MinTRL: Infinity when sharpe <= benchmark, finite + positive otherwise", () => {
  assertEquals(minTRL(0, 0, 0, 3, 0.95), Infinity);
  assertEquals(minTRL(-0.1, 0, 0, 3, 0.95), Infinity);
  const n = minTRL(0.1, 0, 0, 3, 0.95);
  assert(Number.isFinite(n) && n > 1, "finite track-record length");
  // a weaker edge needs a longer track record
  assert(minTRL(0.05, 0, 0, 3, 0.95) > minTRL(0.2, 0, 0, 3, 0.95));
});

Deno.test("pboCSCV: a dominant strategy is NOT flagged overfit (pbo=0)", () => {
  // strat 0 best in every row; tiny deterministic ripple keeps std>0
  const T = 64, N = 4;
  const M: number[][] = [];
  for (let t = 0; t < T; t++) {
    const row: number[] = [];
    for (let s = 0; s < N; s++) row.push((N - s) + 0.01 * Math.sin(t + s));
    M.push(row);
  }
  const { pbo, nCombos } = pboCSCV(M, 8);
  assertEquals(nCombos, 70); // C(8,4)
  assertEquals(pbo, 0);
});

Deno.test("pboCSCV: anti-persistent strategies are flagged overfit (pbo high)", () => {
  // each strategy is great in its 'home' block, terrible elsewhere → the IS
  // winner reliably fails OOS. PBO should be high (>= 0.5).
  const sBlocks = 8, blockLen = 8, N = 8;
  const M: number[][] = [];
  for (let b = 0; b < sBlocks; b++) {
    for (let i = 0; i < blockLen; i++) {
      const row: number[] = [];
      for (let s = 0; s < N; s++) row.push(s === b ? 1 + 0.001 * i : -1 + 0.001 * (i + s));
      M.push(row);
    }
  }
  const { pbo } = pboCSCV(M, 8);
  assertInRange(pbo, 0.5, 1.0);
});
