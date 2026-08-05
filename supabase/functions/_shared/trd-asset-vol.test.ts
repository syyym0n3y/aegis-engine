import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assetFwdVolDeRisk, ASSET_VOL_MODELS } from "./trd-asset-vol.ts";

Deno.test("assetFwdVolDeRisk: gold calm GVZ → full size; stressed GVZ → shrunk", () => {
  const calm = assetFwdVolDeRisk("GLD", 0.10, 0.12);  // GVZ 12% = calm gold
  const stress = assetFwdVolDeRisk("GLD", 0.25, 0.35); // GVZ 35% = stressed gold
  assertEquals(calm.deRisk, 1);
  assert(stress.deRisk < 0.7, `stressed gold should shrink, got ${stress.deRisk}`);
  assertEquals(calm.model, "^GVZ");
});

Deno.test("assetFwdVolDeRisk: unknown asset or NaN IV → no-op (1)", () => {
  assertEquals(assetFwdVolDeRisk("XYZ", 0.2, 0.2).deRisk, 1);
  assertEquals(assetFwdVolDeRisk("GLD", 0.2, NaN).deRisk, 1);
  assertEquals(assetFwdVolDeRisk("GLD", NaN, 0.2).deRisk, 1);
});

Deno.test("assetFwdVolDeRisk: never levers up, all models present", () => {
  for (const a of Object.keys(ASSET_VOL_MODELS)) {
    for (const iv of [0.05, 0.2, 0.8]) { const d = assetFwdVolDeRisk(a, 0.15, iv); assert(d.deRisk > 0 && d.deRisk <= 1, `${a}@${iv} → ${d.deRisk}`); }
  }
});
