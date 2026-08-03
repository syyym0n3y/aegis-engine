import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allWyckoffFeatures,
  closeLocationValue,
  cvdProxyFeatures,
  effortVsResultFeatures,
  WyckoffBar,
  wyckoffEventFeatures,
} from "./trd-wyckoff.ts";

// A 20-bar flat trading range [100,102] then a probe bar we control on bar 21.
function rangeBars(): WyckoffBar[] {
  const b: WyckoffBar[] = [];
  for (let i = 0; i < 20; i++) {
    const day = String(i + 1).padStart(2, "0");
    b.push({ ts: `2026-01-${day}T00:00:00Z`, high: 102, low: 100, close: 101, volume: 1000 });
  }
  return b;
}

Deno.test("closeLocationValue: +1 at high, -1 at low, 0 on zero-range", () => {
  assertEquals(closeLocationValue({ ts: "x", high: 10, low: 0, close: 10, volume: 1 }), 1);
  assertEquals(closeLocationValue({ ts: "x", high: 10, low: 0, close: 0, volume: 1 }), -1);
  assertEquals(closeLocationValue({ ts: "x", high: 5, low: 5, close: 5, volume: 1 }), 0);
});

Deno.test("spring: dips below support, closes back inside upper half → wy_spring=1", () => {
  const bars = rangeBars();
  // bar 21: low 98 (below rangeLow 100), close 101.5 (inside, upper half)
  bars.push({ ts: "2026-01-21T00:00:00Z", high: 102, low: 98, close: 101.5, volume: 1500 });
  const rows = wyckoffEventFeatures("TEST", bars, 20);
  const spring = rows.find((r) => r.feature_key === "wy_spring" && r.effective_date === "2026-01-21");
  assert(spring, "expected a wy_spring event on the probe bar");
  assertEquals(spring!.value, 1);
  // phase on that bar must be accumulation-leaning (+1)
  const phase = rows.find((r) => r.feature_key === "wy_phase" && r.effective_date === "2026-01-21");
  assertEquals(phase!.value, 1);
});

Deno.test("upthrust: pokes above resistance, closes back inside lower half → wy_upthrust=1", () => {
  const bars = rangeBars();
  bars.push({ ts: "2026-01-21T00:00:00Z", high: 105, low: 100, close: 100.5, volume: 1500 });
  const rows = wyckoffEventFeatures("TEST", bars, 20);
  const ut = rows.find((r) => r.feature_key === "wy_upthrust" && r.effective_date === "2026-01-21");
  assert(ut, "expected wy_upthrust");
  const phase = rows.find((r) => r.feature_key === "wy_phase" && r.effective_date === "2026-01-21");
  assertEquals(phase!.value, -1);
});

Deno.test("SOS: wide-range close above resistance on heavy volume → wy_sos=1", () => {
  const bars = rangeBars();
  bars.push({ ts: "2026-01-21T00:00:00Z", high: 106, low: 101, close: 105.5, volume: 3000 });
  const rows = wyckoffEventFeatures("TEST", bars, 20);
  assert(rows.some((r) => r.feature_key === "wy_sos" && r.effective_date === "2026-01-21"));
});

Deno.test("point-in-time: no feature is stamped before enough history exists", () => {
  const bars = rangeBars(); // exactly 20 bars, lookback 20 → zero event rows
  const rows = wyckoffEventFeatures("TEST", bars, 20);
  // only bars with index >= lookback emit; 20 bars (idx 0..19) → none
  assertEquals(rows.filter((r) => r.feature_key === "wy_phase").length, 0);
});

Deno.test("effort-vs-result: high volume, tiny move → LOW evr (absorption warning)", () => {
  const bars = rangeBars();
  // huge volume, price barely moves vs prior close (101 → 101.05)
  bars.push({ ts: "2026-01-21T00:00:00Z", high: 102, low: 100, close: 101.05, volume: 10000 });
  const rows = effortVsResultFeatures("TEST", bars, 20);
  const evr = rows.find((r) => r.effective_date === "2026-01-21")!;
  assert(evr.value < 0.1, `expected low evr (absorption), got ${evr.value}`);
});

Deno.test("cvd proxy: pure buying (closes at highs) → monotonically rising line", () => {
  const bars: WyckoffBar[] = [];
  for (let i = 0; i < 15; i++) {
    const day = String(i + 1).padStart(2, "0");
    bars.push({ ts: `2026-02-${day}T00:00:00Z`, high: 10, low: 0, close: 10, volume: 100 });
  }
  const rows = cvdProxyFeatures("TEST", bars, 10).filter((r) => r.feature_key === "wy_cvd_proxy");
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i].value > rows[i - 1].value, "A/D line must rise when every close is at the high");
  }
  // slope must be positive once it exists
  const slope = cvdProxyFeatures("TEST", bars, 10).find((r) => r.feature_key === "wy_cvd_proxy_slope");
  assert(slope && slope.value > 0);
});

Deno.test("allWyckoffFeatures: every row carries a parseable effective_date (fail-closed contract)", () => {
  const bars = rangeBars();
  bars.push({ ts: "2026-01-21T00:00:00Z", high: 105, low: 98, close: 104, volume: 3000 });
  const rows = allWyckoffFeatures("TEST", bars);
  assert(rows.length > 0);
  for (const r of rows) assert(!Number.isNaN(Date.parse(r.effective_date)), `bad date ${r.effective_date}`);
});
