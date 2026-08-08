import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { edgeVsRandom } from "./trd-random-control.ts";

const seq = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

Deno.test("edgeVsRandom: a genuine edge (setup clearly above control) PASSES", () => {
  const setup = seq(400, (i) => 0.5 + Math.sin(i) * 0.3);   // mean ~0.5
  const control = seq(400, (i) => 0.0 + Math.sin(i) * 0.3); // mean ~0.0
  const r = edgeVsRandom(setup, control);
  assert(r.passes, `should pass, got t=${r.tStat}`);
  assert(r.edge > 0.4);
});

Deno.test("edgeVsRandom: the D-146 case — setup ≈ control → FAILS (regime drift)", () => {
  const setup = seq(400, (i) => 0.15 + Math.sin(i) * 0.8);
  const control = seq(2000, (i) => 0.17 + Math.sin(i * 1.7) * 0.8);
  const r = edgeVsRandom(setup, control);
  assertEquals(r.passes, false);
  assert(r.verdict.includes("REGIME DRIFT"));
});

Deno.test("edgeVsRandom: setup WORSE than random → fails", () => {
  const setup = seq(300, (i) => 0.05 + Math.sin(i) * 0.5);
  const control = seq(1500, (i) => 0.30 + Math.sin(i * 1.3) * 0.5);
  const r = edgeVsRandom(setup, control);
  assertEquals(r.passes, false);
  assert(r.edge < 0);
});

Deno.test("edgeVsRandom: FAILS CLOSED on thin samples (never promotes on small N)", () => {
  const r = edgeVsRandom(seq(10, () => 1), seq(10, () => 0));
  assertEquals(r.passes, false);
  assert(r.verdict.includes("insufficient"));
});
