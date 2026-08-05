import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { forwardVolForecast, fwdVolDeRisk } from "./trd-fwdvol.ts";

Deno.test("forwardVolForecast: calm inputs → low vol, stress inputs → high vol", () => {
  const calm = forwardVolForecast(0.10, 0.9, 0.85);   // low RV, high-gamma, contango
  const stress = forwardVolForecast(0.40, 0.1, 1.15);  // high RV, low-gamma, backwardation
  assert(calm < 0.12, `calm ~8-11%, got ${calm}`);
  assert(stress > 0.30, `stress >30%, got ${stress}`);
  assert(stress > calm);
});

Deno.test("fwdVolDeRisk: calm → full size (1); stress → shrunk (<0.5); never levers up", () => {
  assertEquals(fwdVolDeRisk(0.10, 0.9, 0.85).deRisk, 1);
  assert(fwdVolDeRisk(0.40, 0.1, 1.15).deRisk < 0.5);
  // any input pathological → still ≤ 1
  for (const d of [fwdVolDeRisk(NaN, NaN, NaN), fwdVolDeRisk(2, 0, 3), fwdVolDeRisk(0, 1, 0.5)]) assert(d.deRisk <= 1 && d.deRisk > 0);
});

Deno.test("fwdVolDeRisk: monotone — more gamma eases, more backwardation/RV tightens", () => {
  const base = fwdVolDeRisk(0.20, 0.5, 1.0).deRisk;
  assert(fwdVolDeRisk(0.20, 0.9, 1.0).deRisk >= base - 1e-9, "higher gamma → not tighter");
  assert(fwdVolDeRisk(0.35, 0.5, 1.0).deRisk <= base + 1e-9, "higher RV → not looser");
  assert(fwdVolDeRisk(0.20, 0.5, 1.2).deRisk <= base + 1e-9, "more backwardation → not looser");
});
