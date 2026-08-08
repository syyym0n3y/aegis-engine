import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gexRegime } from "./trd-gex-regime.ts";

const hist = Array.from({ length: 300 }, (_, i) => i); // 0..299

Deno.test("gexRegime: low GEX → low-gamma, higher expected vol, de-risked below 1", () => {
  const r = gexRegime(10, hist); // ~3rd percentile
  assertEquals(r.regime, "low-gamma");
  assert(r.expectedFwdVolPct > 15, `low-gamma should predict high vol, got ${r.expectedFwdVolPct}`);
  assert(r.deRisk < 0.8, `low-gamma should de-risk, got ${r.deRisk}`);
});

Deno.test("gexRegime: high GEX → high-gamma, low vol, full size (deRisk=1)", () => {
  const r = gexRegime(290, hist); // ~97th percentile
  assertEquals(r.regime, "high-gamma");
  assert(r.expectedFwdVolPct < 11, `high-gamma predicts calm, got ${r.expectedFwdVolPct}`);
  assertEquals(r.deRisk, 1, "calm regime never levers up, caps at 1");
});

Deno.test("gexRegime: monotonic — more gamma never de-risks harder", () => {
  let prev = 0;
  for (const g of [0, 50, 100, 150, 200, 250, 299]) { const r = gexRegime(g, hist); assert(r.deRisk >= prev - 1e-9, "deRisk monotonic up in GEX"); prev = r.deRisk; }
});
