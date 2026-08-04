// Guard for the portfolio-risk engine. `deno test supabase/functions/_shared/`.
import { assert, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { correlation, effectiveBets, bootstrapRuin, type Position } from "./trd-portfolio-risk.ts";

// deterministic pseudo-return series
function series(n: number, vol: number, seed: number): number[] {
  const out: number[] = []; let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(((s / 0x7fffffff) - 0.5) * 2 * vol); }
  return out;
}

Deno.test("correlation: identical=+1, negated=-1", () => {
  const a = series(300, 0.02, 1);
  assertAlmostEquals(correlation(a, a), 1, 1e-9);
  assertAlmostEquals(correlation(a, a.map((x) => -x)), -1, 1e-9);
});

Deno.test("effectiveBets: perfectly-correlated positions collapse to ~1 bet", () => {
  const a = series(400, 0.02, 5); const cols = [a, a]; // identical → one bet
  const pos: Position[] = [{ symbol: "A", side: 1, weight: 0.5 }, { symbol: "B", side: 1, weight: 0.5 }];
  assert(effectiveBets(cols, pos) < 1.2, `two identical longs should be ~1 bet, got ${effectiveBets(cols, pos)}`);
});

Deno.test("effectiveBets: uncorrelated positions give ~2 bets", () => {
  const cols = [series(400, 0.02, 7), series(400, 0.02, 99)];
  const pos: Position[] = [{ symbol: "A", side: 1, weight: 0.5 }, { symbol: "B", side: 1, weight: 0.5 }];
  const eb = effectiveBets(cols, pos);
  assert(eb > 1.5, `two uncorrelated bets should be well above 1, got ${eb}`);
});

Deno.test("ruin: correlated leveraged book is riskier than a single position", () => {
  const a = series(500, 0.03, 3);
  const single = bootstrapRuin([a], [{ symbol: "A", side: 1, weight: 1 }], { seed: 1, nSims: 2000 });
  // five identical longs at 1× each = 5× the same bet
  const stacked = bootstrapRuin([a, a, a, a, a], [1, 2, 3, 4, 5].map((i) => ({ symbol: "A" + i, side: 1, weight: 1 })), { seed: 1, nSims: 2000 });
  assert(stacked.pRuin >= single.pRuin, `stacked correlated book must be >= single: ${stacked.pRuin} vs ${single.pRuin}`);
  assert(stacked.grossExposure === 5, "gross exposure should sum to 5");
});

Deno.test("ruin: a flat (zero-vol) book never ruins", () => {
  const flat = new Array(400).fill(0);
  const r = bootstrapRuin([flat], [{ symbol: "CASH", side: 1, weight: 1 }], { seed: 2, nSims: 1000 });
  assertAlmostEquals(r.pRuin, 0, 1e-9);
});

Deno.test("ruin: deterministic under a fixed seed", () => {
  const a = series(500, 0.02, 11);
  const p: Position[] = [{ symbol: "A", side: 1, weight: 0.5 }];
  const r1 = bootstrapRuin([a], p, { seed: 42, nSims: 1500 });
  const r2 = bootstrapRuin([a], p, { seed: 42, nSims: 1500 });
  assertAlmostEquals(r1.pRuin, r2.pRuin, 1e-12);
});

Deno.test("ruin: a hedge (opposite sides) cuts risk vs same-side stacking", () => {
  const a = series(500, 0.03, 13);
  const stacked = bootstrapRuin([a, a], [{ symbol: "A", side: 1, weight: 1 }, { symbol: "B", side: 1, weight: 1 }], { seed: 5, nSims: 2000 });
  const hedged = bootstrapRuin([a, a], [{ symbol: "A", side: 1, weight: 1 }, { symbol: "B", side: -1, weight: 1 }], { seed: 5, nSims: 2000 });
  assert(hedged.pRuin <= stacked.pRuin, `hedge should not increase ruin: ${hedged.pRuin} vs ${stacked.pRuin}`);
});
