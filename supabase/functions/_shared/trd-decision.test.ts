import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decide } from "./trd-decision.ts";

const base = { price: 100, sma200: 90, deRisk: 1, equity: 10000, originalDeposit: 10000, stopDistancePct: 4 };

Deno.test("decide: BUY only when the verified signal fires (oversold within uptrend)", () => {
  assertEquals(decide({ ...base, rsi14: 25 }).action, "BUY");
  assertEquals(decide({ ...base, rsi14: 55 }).action, "STAND_ASIDE");
});

Deno.test("decide: NEVER issues SELL — no short setup beat a random control (D-146)", () => {
  for (const rsi14 of [5, 25, 50, 75, 95]) for (const sma200 of [50, 150]) {
    const d = decide({ ...base, rsi14, sma200 });
    assert(d.action !== "SELL", `must never SELL, got ${d.action}`);
  }
  assert(decide({ ...base, rsi14: 20, sma200: 150 }).reason.includes("never issues SELL"));
});

Deno.test("decide: risk never exceeds the hard cap, and stand-aside risks nothing", () => {
  for (const eq of [1000, 10000, 1e6]) for (const dr of [0, 0.5, 1]) {
    const d = decide({ ...base, rsi14: 20, equity: eq, deRisk: dr });
    assert(d.riskPctOfEquity <= 2.0001, `cap breached: ${d.riskPctOfEquity}%`);
  }
  assertEquals(decide({ ...base, rsi14: 60 }).riskAmount, 0);
});

Deno.test("HOUSE MONEY: before any profit, deposit risk is the conservative base only", () => {
  const d = decide({ ...base, rsi14: 20 });
  assertEquals(d.houseMoneyActive, false);
  assertEquals(d.bankedProfit, 0);
  assert(Math.abs(d.riskAmount - 10000 * 0.005) < 0.01, `expected 0.5% of deposit, got ${d.riskAmount}`);
});

Deno.test("HOUSE MONEY: after profit, risk grows from BANKED profit — deposit exposure unchanged", () => {
  const before = decide({ ...base, rsi14: 20 });
  const after = decide({ ...base, rsi14: 20, equity: 14000 }); // +4000 banked
  assert(after.houseMoneyActive);
  assertEquals(after.bankedProfit, 4000);
  assert(after.riskAmount > before.riskAmount, "house money should increase risk budget");
  // deposit-funded portion is still 0.5% of the ORIGINAL deposit, not of the grown equity
  assert(after.riskAmount <= 10000 * 0.005 + 4000 * 0.02 + 0.01);
});

Deno.test("decide: vol de-risk scales risk down and is honoured", () => {
  const full = decide({ ...base, rsi14: 20, deRisk: 1 });
  const half = decide({ ...base, rsi14: 20, deRisk: 0.5 });
  assert(half.riskAmount < full.riskAmount);
  assert(Math.abs(half.riskAmount - full.riskAmount / 2) < 0.01);
});

Deno.test("decide: position size = risk / stop distance (mechanically correct)", () => {
  const d = decide({ ...base, rsi14: 20, stopDistancePct: 5 });
  assert(Math.abs(d.positionNotional - d.riskAmount / 0.05) < 0.01);
  assert(Math.abs(d.positionSize - d.positionNotional / 100) < 0.01);
});
