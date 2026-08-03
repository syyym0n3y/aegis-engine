import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allocate, botStep, DEFAULT_BOT, proposeOrder, SetupState } from "./trd-bot.ts";
import { AccountState } from "./trd-firewall.ts";

function rSeq(n: number, winRate: number, win: number, loss: number, seed: number): number[] {
  let a = seed >>> 0; const out: number[] = [];
  for (let i = 0; i < n; i++) { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296; out.push(u < winRate ? win : -loss); }
  return out;
}

Deno.test("ALLOCATE: a live-winning setup gets more weight than a live-losing one", () => {
  const pool: SetupState[] = [
    { key: "winner", rHistory: rSeq(60, 0.6, 1, 1, 1) }, // +expectancy
    { key: "loser", rHistory: rSeq(60, 0.35, 1, 1, 2) }, // -expectancy
  ];
  const m = allocate(pool);
  const w = m.find((x) => x.key === "winner")!, l = m.find((x) => x.key === "loser")!;
  assert(w.weight > l.weight);
  assertEquals(l.weight, 0, "a losing setup is benched (0 capital)");
  assert(Math.abs(w.weight - 1) < 1e-9, "all capital goes to the working setup");
});

Deno.test("ALLOCATE: an unproven setup (too few trades) is throttled by low confidence", () => {
  const pool: SetupState[] = [
    { key: "proven", rHistory: rSeq(60, 0.6, 1, 1, 3) },
    { key: "unproven", rHistory: rSeq(5, 0.8, 1, 1, 4) }, // great but tiny sample
  ];
  const m = allocate(pool);
  assert(m.find((x) => x.key === "unproven")!.confidence < 0.2);
  assert(m.find((x) => x.key === "proven")!.weight > m.find((x) => x.key === "unproven")!.weight);
});

Deno.test("SIZE: vol-scaling cuts risk when the account runs hotter than target", () => {
  // small edge + a high clamp so the vol-scaling is visible (not masked by the per-trade cap)
  const cfg = { ...DEFAULT_BOT, maxRiskPerTradeFrac: 0.05 };
  const m = { key: "s", trades: 60, expectancyR: 0.02, winRate: 0.55, volR: 1, confidence: 1, weight: 1 };
  const setup = { key: "s", side: "long" as const, symbol: "X", hasStopLoss: true, hasTakeProfit: true };
  const calm = proposeOrder(setup, m, 0.06, cfg); // account vol below the 12% target
  const hot = proposeOrder(setup, m, 0.40, cfg); // account vol well above target
  assert(hot.riskFrac < calm.riskFrac, "hotter account => smaller size");
  assert(hot.riskFrac <= cfg.maxRiskPerTradeFrac);
});

Deno.test("BOT never bypasses the firewall — a no-stop order is blocked even from the bot", () => {
  const pool: SetupState[] = [{ key: "s", rHistory: rSeq(60, 0.6, 1, 1, 5) }];
  const state: AccountState = { equity: 10000, peakEquity: 10000, dayPnLFrac: 0, tradesToday: 0, consecutiveLosses: 0, openCorrelatedRiskFrac: {}, openPositions: 0, minutesSinceLastLoss: 999, nowUtcHour: 14 };
  const d = botStep({ key: "s", side: "long", symbol: "X", hasStopLoss: false, hasTakeProfit: true }, pool, 0.10, state);
  assertEquals(d.firewall.decision, "BLOCK");
});

Deno.test("BOT: a benched (losing) setup gets ~0 size", () => {
  const pool: SetupState[] = [{ key: "loser", rHistory: rSeq(60, 0.3, 1, 1, 6) }];
  const state: AccountState = { equity: 10000, peakEquity: 10000, dayPnLFrac: 0, tradesToday: 0, consecutiveLosses: 0, openCorrelatedRiskFrac: {}, openPositions: 0, minutesSinceLastLoss: 999, nowUtcHour: 14 };
  const d = botStep({ key: "loser", side: "long", symbol: "X", hasStopLoss: true, hasTakeProfit: true }, pool, 0.10, state);
  assert(d.order.riskFrac < 1e-6, "losing setup should propose ~0 risk");
});
