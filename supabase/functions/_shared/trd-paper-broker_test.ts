import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newAccount, onBar, openPosition, toFirewallState } from "./trd-paper-broker.ts";

const noCost = { commissionBps: 0, slippageBps: 0, barsPerYear: 252 };

Deno.test("BROKER: a long that hits target gains ~R×risk (net of nothing at zero cost)", () => {
  const a = newAccount(10000);
  openPosition(a, { setupKey: "s", symbol: "X", side: "long", entry: 100, stop: 95, target: 110 }, 0.01, "2024-01-01", noCost);
  // risk = 5/unit; target 110 = +10 = 2R. onBar with a high >= 110 closes at target.
  onBar(a, "X", { ts: "2024-01-02", high: 111, low: 100, close: 110 }, noCost);
  assertEquals(a.closed.length, 1);
  assertEquals(a.closed[0].reason, "target");
  assert(Math.abs(a.closed[0].r - 2) < 1e-6, "target at 2R");
  assert(Math.abs(a.equity - (10000 + 0.02 * 10000)) < 1e-6, "+2R × 1% risk = +2% equity");
});

Deno.test("BROKER: a long that hits stop loses ~1R (the risked amount)", () => {
  const a = newAccount(10000);
  openPosition(a, { setupKey: "s", symbol: "X", side: "long", entry: 100, stop: 95, target: 110 }, 0.01, "2024-01-01", noCost);
  onBar(a, "X", { ts: "2024-01-02", high: 101, low: 94, close: 96 }, noCost);
  assertEquals(a.closed[0].reason, "stop");
  assert(Math.abs(a.closed[0].r + 1) < 1e-6, "stop = -1R");
  assert(Math.abs(a.equity - 9900) < 1e-6, "-1R × 1% = -1% equity");
  assertEquals(a.consecutiveLosses, 1);
});

Deno.test("BROKER: slippage + commission make the real fill worse than the ideal", () => {
  const a = newAccount(10000);
  const cfg = { commissionBps: 5, slippageBps: 3, barsPerYear: 252 };
  openPosition(a, { setupKey: "s", symbol: "X", side: "long", entry: 100, stop: 95, target: 110 }, 0.01, "2024-01-01", cfg);
  onBar(a, "X", { ts: "2024-01-02", high: 111, low: 100, close: 110 }, cfg);
  // net gain should be a bit below the frictionless +2% (slippage on entry + commissions)
  assert(a.equity < 10200 && a.equity > 10150, `expected ~+1.8%, got ${a.equity}`);
});

Deno.test("BROKER: firewall state reflects open correlated risk + drawdown", () => {
  const a = newAccount(10000);
  openPosition(a, { setupKey: "s", symbol: "EURUSD", side: "long", entry: 1, stop: 0.99, target: 1.02, corrGroup: "USD" }, 0.01, "2024-01-01", noCost);
  openPosition(a, { setupKey: "s", symbol: "GBPUSD", side: "long", entry: 1, stop: 0.99, target: 1.02, corrGroup: "USD" }, 0.01, "2024-01-01", noCost);
  const st = toFirewallState(a, 14);
  assertEquals(st.openPositions, 2);
  assert(Math.abs(st.openCorrelatedRiskFrac.USD - 0.02) < 1e-9, "summed USD risk = 2%");
});
