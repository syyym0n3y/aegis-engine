import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluate, minViableDeposit, riskBudget, costInR, EXPECTANCY_R, type ScaleInput } from "./trd-scale.ts";

const base: Omit<ScaleInput, "equity" | "deposit"> = {
  price: 100, stopPct: 5, advShares: 5_000_000, minLot: 1, costPerTradeUsd: 1, spreadPct: 0.02,
};

Deno.test("costInR: cost expressed as a fraction of what you risked", () => {
  // risk $100, notional $2000, $1 commission + 0.02% spread ($0.40) → $1.40/$100 = 0.014R
  assert(Math.abs(costInR(100, 2000, 1, 0.02) - 0.014) < 1e-6);
  assertEquals(costInR(0, 1000, 1, 0.02), Infinity, "zero risk → infinite cost ratio (fails safe)");
});

Deno.test("SMALL ACCOUNT: below the cost floor the edge is destroyed", () => {
  const tiny = evaluate({ ...base, equity: 300, deposit: 300 });
  // $300 × 0.5% = $1.50 risk; a $1 commission alone is 0.67R — far beyond the +0.16R edge
  assert(!tiny.viable, "a $300 account trading a $100 stock must not be viable");
  assert(tiny.costInR > EXPECTANCY_R, `cost ${tiny.costInR}R should exceed the ${EXPECTANCY_R}R edge`);
});

Deno.test("LARGE ACCOUNT: liquidity becomes the binding constraint", () => {
  const huge = evaluate({ ...base, advShares: 20_000, equity: 50_000_000, deposit: 50_000_000 });
  assert(huge.bindingConstraint.startsWith("LIQUIDITY"), `expected liquidity cap, got ${huge.bindingConstraint}`);
});

Deno.test("MID ACCOUNT: viable, and risk stays inside the per-trade cap", () => {
  const mid = evaluate({ ...base, equity: 50_000, deposit: 50_000 });
  assert(mid.viable);
  assert(mid.riskPct <= 2.001, `per-trade risk must stay ≤2%, got ${mid.riskPct}%`);
  assert(mid.lot >= 1 && Number.isInteger(mid.lot), "share lots must be whole units");
});

Deno.test("positions never exceed the correlation-implied breadth cap", () => {
  for (const eq of [1_000, 10_000, 100_000, 10_000_000]) {
    const t = evaluate({ ...base, equity: eq, deposit: eq });
    assert(t.positions <= 11, `positions ${t.positions} exceeds the effective-breadth cap`);
  }
});

Deno.test("minViableDeposit: finds a real threshold, and it falls when costs fall", () => {
  const expensive = minViableDeposit(base)!;
  const cheap = minViableDeposit({ ...base, costPerTradeUsd: 0, spreadPct: 0.01 })!;
  assert(expensive > 0 && cheap > 0);
  assert(cheap < expensive, `zero-commission threshold ${cheap} should be below ${expensive}`);
});

Deno.test("fractional lots (crypto) lower the minimum viable deposit dramatically", () => {
  const whole = minViableDeposit({ ...base, minLot: 1 })!;
  const frac = minViableDeposit({ ...base, minLot: 0.0001 })!;
  assert(frac <= whole, `fractional ${frac} should not exceed whole-share ${whole}`);
});

Deno.test("riskBudget: house money raises risk without raising deposit exposure", () => {
  const before = riskBudget(10_000, 10_000);
  const after = riskBudget(25_000, 10_000);
  assert(after > before, "banked profit should increase the budget");
  assert(after <= 25_000 * 0.02 + 1e-9, "still capped at 2% of equity");
});
