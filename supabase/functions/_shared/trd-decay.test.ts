// Guard for the D-102 edge-decay monitor. `deno test supabase/functions/_shared/`.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decayReport, MIN_N } from "./trd-decay.ts";

Deno.test("insufficient sample → status insufficient", () => {
  const d = decayReport([1, -1, 1, -1]);
  assertEquals(d.status, "insufficient");
});

Deno.test("edge that crossed positive→negative → DEAD", () => {
  const early = Array(20).fill(0).map((_, i) => (i % 2 ? -1 : 2));   // +0.5R avg
  const recent = Array(20).fill(0).map((_, i) => (i % 3 ? -1 : 1));  // negative avg
  const d = decayReport([...early, ...recent]);
  assertEquals(d.status, "dead");
  assert(d.earlyExp > 0 && d.recentExp <= 0);
});

Deno.test("clear decay (still positive but falling) → decaying", () => {
  const early = Array(20).fill(2);       // +2R
  const recent = Array(20).fill(0.2);    // +0.2R → delta -1.8
  const d = decayReport([...early, ...recent]);
  assertEquals(d.status, "decaying");
  assert(d.delta <= -0.15);
});

Deno.test("improving edge → improving", () => {
  const d = decayReport([...Array(20).fill(0.1), ...Array(20).fill(1.5)]);
  assertEquals(d.status, "improving");
});

Deno.test("flat edge → stable", () => {
  const d = decayReport([...Array(20).fill(0.5), ...Array(20).fill(0.5)]);
  assertEquals(d.status, "stable");
  assertEquals(d.delta, 0);
});

Deno.test("respects minN and ordering (recent = second half)", () => {
  const d = decayReport(Array(MIN_N).fill(1), MIN_N);
  assertEquals(d.n, MIN_N);
  assert(d.status !== "insufficient");
});
