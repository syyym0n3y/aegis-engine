import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { simulateUplift } from "./trd-uplift.ts";
import { normalize } from "./trd-normalize.ts";

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

Deno.test("UPLIFT: an oversized but positive-edge account is rescued from ruin", () => {
  // +edge (p=0.55, 1:1) but risking huge chunks → will blow up as traded
  const rnd = mulberry32(3);
  const trades = Array.from({ length: 200 }, () => ({ ts: "2024-01-01", pnl: (rnd() < 0.55 ? 3500 : -3500) }));
  const acct = normalize("t", trades, 10000);
  const u = simulateUplift(acct);
  // managed should preserve more capital and cut drawdown
  assert(u.managed.maxDDpct < u.actual.maxDDpct, "managed drawdown should be lower");
  assert(u.savedDrawdownPts > 0);
  assert(u.tradesSkipped >= 0);
});

Deno.test("UPLIFT: a negative-edge account is NOT turned into a winner (honesty)", () => {
  const rnd = mulberry32(9);
  const trades = Array.from({ length: 200 }, () => ({ ts: "2024-01-01", pnl: (rnd() < 0.45 ? 1000 : -1000) }));
  const acct = normalize("t", trades, 20000);
  const u = simulateUplift(acct);
  // negative edge → disciplined size is 0 → managed sits flat (can't manufacture edge)
  assertEquals(u.targetRiskFrac, 0);
  assert(u.managed.finalMult <= 1.01, "risk management can't manufacture edge — it should refuse to trade");
  assert(/not positive|not to trade|stop you/i.test(u.note));
});

Deno.test("UPLIFT: kill-switch halts trading during deep drawdown", () => {
  // strong overall positive edge (so size > 0) with a mid-sequence loss streak → kill-switch
  const trades: { ts: string; pnl: number }[] = [];
  for (let i = 0; i < 120; i++) trades.push({ ts: "2024-01-01", pnl: i % 10 < 7 ? 500 : -500 }); // 70% win
  for (let i = 0; i < 15; i++) trades.push({ ts: "2024-01-01", pnl: -500 }); // drawdown streak
  const acct = normalize("t", trades, 10000);
  const u = simulateUplift(acct, { killDDpct: 15 });
  assert(u.targetRiskFrac > 0, "should have a positive size to manage");
  assert(u.tradesSkipped > 0, "kill-switch should have skipped trades in the drawdown streak");
});

Deno.test("UPLIFT: report exposes both paths + a plain-English verdict", () => {
  const trades = Array.from({ length: 120 }, (_, i) => ({ ts: "2024-01-01", pnl: i % 2 ? 600 : -500 }));
  const u = simulateUplift(normalize("t", trades, 10000));
  assert(u.actual && u.managed && typeof u.note === "string");
  assert(u.targetRiskFrac >= 0);
});
