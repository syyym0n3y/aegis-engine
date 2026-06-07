import { Bar, smaCrossFeatures, trailingReturnFeatures } from "./trd-price-features.ts";
import { assert, assertAlmost, assertEquals } from "./trd-test-helpers.ts";

const bars: Bar[] = Array.from({ length: 300 }, (_, i) => ({
  ts: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
  close: 100 * Math.pow(1.001, i), // steadily rising
}));

Deno.test("trailingReturnFeatures: 252d momentum positive on a rising series, look-ahead-safe", () => {
  const f = trailingReturnFeatures("X", bars, 252, "mom_252");
  // first feature appears only at index 252 (needs 252d of history)
  assertEquals(f.length, bars.length - 252);
  assertEquals(f[0].effective_date, bars[252].ts.slice(0, 10));
  // value = close[252]/close[0]-1 = 1.001^252 - 1
  assertAlmost(f[0].value, Math.pow(1.001, 252) - 1, 1e-9);
  assert(f.every((r) => r.value > 0), "rising series → positive momentum throughout");
});

Deno.test("smaCrossFeatures: +1 when above MA on a rising series", () => {
  const f = smaCrossFeatures("X", bars, 200, "sma200");
  assert(f.length > 0);
  assert(f.every((r) => r.value === 1), "monotonic rise → always above its trailing SMA");
});
