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

// ── LOCKED SPEC guards (D-152 wiring) ──
import { LOCKED_SPEC, LOCKED_UNIVERSE } from "./trd-decision.ts";

Deno.test("PORTFOLIO HEAT: a decision NEVER pushes total risk past the 6% cap (the D-149 E2 fix)", () => {
  const cap = LOCKED_SPEC.maxPortfolioHeatPct / 100 * 10000;
  for (const openRisk of [0, 200, 400, 590, 600, 1000]) {
    const d = decide({ ...base, rsi14: 20, equity: 10000, openRiskAmount: openRisk });
    // the new trade may never take total risk above the cap; if already over, it must add nothing
    assert(openRisk + d.riskAmount <= Math.max(openRisk, cap) + 1e-6, `decision breached cap: open ${openRisk} + new ${d.riskAmount}`);
    if (openRisk >= cap) assertEquals(d.riskAmount, 0, `must add ZERO risk when already at/over cap (open ${openRisk})`);
  }
});

Deno.test("PORTFOLIO HEAT: a signal is BLOCKED (risk 0) once the budget is exhausted", () => {
  const full = decide({ ...base, rsi14: 20, equity: 10000, openRiskAmount: 600 }); // 6% already live
  assertEquals(full.riskAmount, 0);
  assert(full.reason.includes("BLOCKED by portfolio heat"));
  const partial = decide({ ...base, rsi14: 20, equity: 10000, openRiskAmount: 580 });
  assert(partial.riskAmount > 0 && partial.riskAmount <= 20.0001, `should be trimmed to remaining room, got ${partial.riskAmount}`);
  assert(partial.heatCapped);
});

Deno.test("OFF-BOOK: instruments outside the verified book are flagged", () => {
  assert(!decide({ ...base, rsi14: 20, symbol: "SPY" }).offBook, "SPY is in the book");
  const off = decide({ ...base, rsi14: 20, symbol: "DOGE" });
  assert(off.offBook && off.reason.includes("OFF-BOOK"), "unverified instrument must be flagged");
});

Deno.test("LOCKED SPEC constants match the verified evidence (guards against silent drift)", () => {
  assertEquals(LOCKED_SPEC.rsiPeriod, 14); assertEquals(LOCKED_SPEC.rsiThreshold, 30); assertEquals(LOCKED_SPEC.trendMA, 200);
  assertEquals(LOCKED_SPEC.maxPortfolioHeatPct, 6);
  assertEquals(LOCKED_UNIVERSE.length, 45);
  assert(LOCKED_SPEC.oosT > 2, "spec must retain its OOS significance");
});
