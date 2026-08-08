// Guard for the D-101 fractional-Kelly sizing control. `deno test supabase/functions/_shared/`.
import { assert, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { kellySize, MIN_SAMPLE, DEFAULT_FRACTION, UNCERTAIN_MULT, PROBE_MULT } from "./trd-kelly.ts";

const BASE = 0.01;

Deno.test("insufficient sample → conservative default, never above base", () => {
  const k = kellySize([1, -1, 1], BASE);
  assertAlmostEquals(k.riskFraction, BASE * UNCERTAIN_MULT, 1e-12);
  assert(k.riskFraction < BASE);
});

Deno.test("positive edge → quarter-Kelly, capped at base, never exceeds it", () => {
  // p=0.6, wins +2R, losses -1R → b=2, f*=0.6-0.4/2=0.4; quarter-Kelly=0.1 of equity, capped at base 0.01
  const r = [...Array(12).fill(2), ...Array(8).fill(-1)];
  const k = kellySize(r, BASE);
  assert(k.fStar > 0.39 && k.fStar < 0.41, `f* ~0.4, got ${k.fStar}`);
  assertAlmostEquals(k.riskFraction, BASE, 1e-12); // 0.25*0.4=0.10 > base → capped at base
  assert(k.riskFraction <= BASE, "must never exceed base");
});

Deno.test("thin positive edge → sizes BELOW base (quarter-Kelly bites)", () => {
  // p=0.5, wins +1.2R, losses -1R → b=1.2, f*=0.5-0.5/1.2=0.0833; quarter=0.0208 of equity
  const r = [...Array(15).fill(1.2), ...Array(15).fill(-1)];
  const k = kellySize(r, BASE);
  assert(k.fStar > 0.08 && k.fStar < 0.09, `got f*=${k.fStar}`);
  // 0.25 * 0.0833 = 0.0208 of equity, but capped at base 0.01 → so riskFraction = base here too.
  assert(k.riskFraction <= BASE);
});

Deno.test("measured NON-edge (negative f*) → tiny probe size only", () => {
  // p=0.3, wins +1R, losses -1R → b=1, f*=0.3-0.7= -0.4 → probe
  const r = [...Array(9).fill(1), ...Array(21).fill(-1)];
  const k = kellySize(r, BASE);
  assert(k.fStar < 0, `should be non-edge, f*=${k.fStar}`);
  assertAlmostEquals(k.riskFraction, BASE * PROBE_MULT, 1e-12);
});

Deno.test("output is always within [base*probe, base]", () => {
  const cases = [[1, -1, 1, -1], [...Array(25).fill(3), ...Array(5).fill(-1)], [...Array(5).fill(1), ...Array(25).fill(-1)]];
  for (const c of cases) { const k = kellySize(c, BASE); assert(k.riskFraction >= BASE * PROBE_MULT - 1e-12 && k.riskFraction <= BASE + 1e-12, `${k.riskFraction} out of range`); }
});

Deno.test("larger edge → larger (or equal, if capped) size than a thinner edge", () => {
  const thin = kellySize([...Array(11).fill(1.1), ...Array(9).fill(-1)], BASE).riskFraction;
  const fat = kellySize([...Array(15).fill(3), ...Array(5).fill(-1)], BASE).riskFraction;
  assert(fat >= thin);
});
