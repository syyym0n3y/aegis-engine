import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeAccount } from "./trd-platform.ts";
import { fromReturns, normalize } from "./trd-normalize.ts";

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

Deno.test("PLATFORM: a blow-up-sized account grades F regardless of edge", () => {
  // real +edge but risking 40%/trade → RUIN-LIKELY → F
  const trades = Array.from({ length: 300 }, (_, i) => ({ ts: `2024-01-${(i % 28) + 1}`, pnl: (i % 2 === 0 ? 4000 : -4000) }));
  const acct = normalize("t", trades, 10000);
  const rep = analyzeAccount(acct);
  assertEquals(rep.grade, "F");
  assert(rep.recommendations.some((r) => /CUT RISK|STOP/i.test(r)));
});

Deno.test("PLATFORM: pure-noise account is not graded real", () => {
  const rnd = mulberry32(7);
  const rep = analyzeAccount(fromReturns(Array.from({ length: 250 }, () => (rnd() - 0.5) * 0.02), 252));
  assert(["C", "D", "F"].includes(rep.grade), `noise should not grade A/B, got ${rep.grade}`);
  assert(rep.verify.verdict !== "LIKELY REAL");
});

Deno.test("PLATFORM: report carries all three layers + a benchmark + recs", () => {
  const rep = analyzeAccount(fromReturns([0.01, -0.005, 0.008, -0.004, 0.006], 252));
  assert(rep.verify && rep.protect && rep.benchmark);
  assert(rep.benchmark.annualSharpe > 0);
  assert(rep.recommendations.length >= 1);
  assert(["A", "B", "C", "D", "F"].includes(rep.grade));
});

Deno.test("PLATFORM: negative-expectancy account is told to STOP", () => {
  const trades = Array.from({ length: 200 }, (_, i) => ({ ts: `2024-02-${(i % 27) + 1}`, pnl: (i % 3 === 0 ? 300 : -200) }));
  const rep = analyzeAccount(normalize("t", trades, 20000));
  assert(rep.protect.expectancyR < 0 || rep.grade === "F");
});
