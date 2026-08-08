import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyTrackRecord } from "./trd-verify.ts";

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function series(n: number, drift: number, vol: number, seed: number) { const r = mulberry32(seed); return Array.from({ length: n }, () => drift + (r() - 0.5) * vol); }

Deno.test("VERIFY: a short lucky streak (few obs, unknown trials) is NOT called real", () => {
  const rep = verifyTrackRecord({ returns: series(30, 0.01, 0.02, 1), periodsPerYear: 252 });
  assert(rep.verdict !== "LIKELY REAL", `30 obs should never be LIKELY REAL, got ${rep.verdict}`);
  assert(rep.flags.some((f) => /too few|observations/i.test(f)));
});

Deno.test("VERIFY: negative-expectancy record is flagged and not real", () => {
  const rep = verifyTrackRecord({ returns: series(500, -0.0005, 0.02, 2), periodsPerYear: 252 });
  assertEquals(rep.verdict, "LIKELY OVERFIT / LUCK");
  assert(rep.flags.some((f) => /mean return is not positive/i.test(f)));
});

Deno.test("VERIFY: deflation punishes a huge claimed search (multiple testing)", () => {
  const rets = series(800, 0.0004, 0.01, 3);
  const few = verifyTrackRecord({ returns: rets, periodsPerYear: 252, claimedTrials: 2 });
  const many = verifyTrackRecord({ returns: rets, periodsPerYear: 252, claimedTrials: 5000 });
  assert(many.deflatedSharpe <= few.deflatedSharpe, "more trials → lower DSR (honest deflation)");
  assert(many.authenticityScore <= few.authenticityScore);
});

Deno.test("VERIFY: implausibly high Sharpe raises a look-ahead flag", () => {
  const rep = verifyTrackRecord({ returns: series(500, 0.01, 0.005, 4), periodsPerYear: 252 });
  assert(rep.annualSharpe > 3);
  assert(rep.flags.some((f) => /implausibly high/i.test(f)));
});
