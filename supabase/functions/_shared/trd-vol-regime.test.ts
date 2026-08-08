// Guard for the D-100 verified risk control. Runs offline: `deno test supabase/functions/_shared/`.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { volRegimeDeRisk, VOL_REGIME_FLOOR, MIN_HISTORY } from "./trd-vol-regime.ts";

// deterministic pseudo-returns (no Math.random → reproducible)
function series(n: number, vol: number, seed = 1): number[] {
  const out: number[] = []; let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(((s / 0x7fffffff) - 0.5) * 2 * vol); }
  return out;
}

Deno.test("insufficient history → no-op multiplier of 1", () => {
  const r = volRegimeDeRisk(series(MIN_HISTORY - 1, 0.01));
  assertEquals(r.deRisk, 1);
  assert(r.reason.includes("insufficient"));
});

Deno.test("calm regime (current vol ≈ historical) → multiplier ≈ 1 and never exceeds 1", () => {
  const r = volRegimeDeRisk(series(400, 0.01));
  assert(r.deRisk <= 1, "must never lever up");
  assert(r.deRisk > 0.8, `steady vol should be near no-op, got ${r.deRisk}`);
});

Deno.test("elevated regime (recent vol spike) → shrinks size, floored, never > 1", () => {
  const calm = series(400, 0.01, 7);
  const spike = series(30, 0.06, 99);            // last 30 days ~6× the vol
  const r = volRegimeDeRisk([...calm, ...spike]);
  assert(r.elevated, "should detect elevated regime");
  assert(r.deRisk < 0.6, `elevated vol must cut size materially, got ${r.deRisk}`);
  assert(r.deRisk >= VOL_REGIME_FLOOR, `must respect floor, got ${r.deRisk}`);
});

Deno.test("floor is honored under an extreme spike", () => {
  const calm = series(400, 0.005, 3);
  const spike = series(25, 0.2, 5);              // enormous vol burst
  const r = volRegimeDeRisk([...calm, ...spike]);
  assertAlmostEquals(r.deRisk, VOL_REGIME_FLOOR, 1e-9);
});

Deno.test("multiplier is monotonic: higher current vol → lower size", () => {
  const base = series(400, 0.01, 11);
  const mild = volRegimeDeRisk([...base, ...series(20, 0.02, 12)]).deRisk;
  const hot = volRegimeDeRisk([...base, ...series(20, 0.05, 12)]).deRisk;
  assert(hot < mild, `hotter vol must de-risk more (${hot} !< ${mild})`);
});
