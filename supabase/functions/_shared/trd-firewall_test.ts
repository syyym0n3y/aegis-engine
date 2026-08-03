import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AccountState, DEFAULT_POLICY, evaluateOrder, ProposedOrder } from "./trd-firewall.ts";

const baseState: AccountState = { equity: 10000, peakEquity: 10000, dayPnLFrac: 0, tradesToday: 0, consecutiveLosses: 0, openCorrelatedRiskFrac: {}, openPositions: 0, minutesSinceLastLoss: 999, nowUtcHour: 14 };
const baseOrder: ProposedOrder = { symbol: "EURUSD", side: "long", riskFrac: 0.01, hasStopLoss: true, hasTakeProfit: true };

Deno.test("FIREWALL: daily-loss kill-switch blocks all trading", () => {
  const d = evaluateOrder(baseOrder, { ...baseState, dayPnLFrac: -0.035 }, DEFAULT_POLICY);
  assertEquals(d.decision, "BLOCK");
  assert(/daily loss limit/i.test(d.message));
});

Deno.test("FIREWALL: no stop-loss is blocked outright", () => {
  const d = evaluateOrder({ ...baseOrder, hasStopLoss: false }, baseState);
  assertEquals(d.decision, "BLOCK");
  assert(/stop-loss/i.test(d.message));
});

Deno.test("FIREWALL: oversize is RESIZED to the per-trade cap, not blocked", () => {
  const d = evaluateOrder({ ...baseOrder, riskFrac: 0.08 }, baseState); // 8% -> cap 1%
  assertEquals(d.decision, "RESIZE");
  assert(Math.abs(d.approvedRiskFrac - 0.01) < 1e-9);
});

Deno.test("FIREWALL: anti-tilt cooldown after consecutive losses", () => {
  const d = evaluateOrder(baseOrder, { ...baseState, consecutiveLosses: 3, minutesSinceLastLoss: 10 }, DEFAULT_POLICY);
  assertEquals(d.decision, "BLOCK");
  assert(/cooldown|anti-tilt|losses in a row/i.test(d.message));
});

Deno.test("FIREWALL: correlated-exposure cap blocks the 'same bet' stacked up", () => {
  const d = evaluateOrder({ ...baseOrder, correlationGroup: "USD", riskFrac: 0.01 }, { ...baseState, openCorrelatedRiskFrac: { USD: 0.02 } }, DEFAULT_POLICY);
  assertEquals(d.decision, "BLOCK");
  assert(/correlated|same bet/i.test(d.message));
});

Deno.test("FIREWALL: overtrading + no-trade window + leverage cap all block", () => {
  assertEquals(evaluateOrder(baseOrder, { ...baseState, tradesToday: 5 }).decision, "BLOCK");
  assertEquals(evaluateOrder(baseOrder, baseState, { ...DEFAULT_POLICY, noTradeHoursUtc: [14] }).decision, "BLOCK");
  assertEquals(evaluateOrder({ ...baseOrder, leverage: 50 }, baseState).decision, "BLOCK");
});

Deno.test("FIREWALL: a clean, sane order is ALLOWED", () => {
  const d = evaluateOrder(baseOrder, baseState);
  assertEquals(d.decision, "ALLOW");
  assertEquals(d.approvedRiskFrac, 0.01);
});
