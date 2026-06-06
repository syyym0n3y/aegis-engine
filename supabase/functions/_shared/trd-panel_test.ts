import { alignedReturns, buildPanel, FeatureSeries, PriceSeries } from "./trd-panel.ts";
import { parseAlpacaBars } from "./trd-alpaca.ts";
import { evalSignal } from "./trd-strategy.ts";
import { assert, assertAlmost, assertEquals } from "./trd-test-helpers.ts";

Deno.test("parseAlpacaBars: documented shape → ascending PriceBars", () => {
  const j = JSON.stringify({
    symbol: "SRCE",
    bars: [
      { t: "2026-06-04T04:00:00Z", o: 49, h: 51, l: 48, c: 50, v: 1000, n: 10, vw: 49.8 },
      { t: "2026-06-03T04:00:00Z", o: 48, h: 49, l: 47, c: 48.5, v: 900, n: 8, vw: 48.1 },
    ],
    next_page_token: null,
  });
  const bars = parseAlpacaBars(j);
  assertEquals(bars.length, 2);
  assertEquals(bars[0].ts, "2026-06-03T04:00:00Z"); // sorted ascending
  assertEquals(bars[1].close, 50);
});

const prices: PriceSeries[] = [
  { symbol: "AAA", bars: [
    { ts: "2026-06-01T00:00:00Z", close: 100 },
    { ts: "2026-06-02T00:00:00Z", close: 110 }, // +10%
    { ts: "2026-06-03T00:00:00Z", close: 99 }, // -10%
  ] },
  { symbol: "SPY", bars: [
    { ts: "2026-06-01T00:00:00Z", close: 500 },
    { ts: "2026-06-02T00:00:00Z", close: 505 },
    { ts: "2026-06-03T00:00:00Z", close: 505 },
  ] },
];

Deno.test("alignedReturns: close-to-close on the grid, first day 0", () => {
  const dates = ["2026-06-01", "2026-06-02", "2026-06-03"];
  const r = alignedReturns(prices[0], dates);
  assertEquals(r[0], 0);
  assertAlmost(r[1], 0.10, 1e-9);
  assertAlmost(r[2], -0.10, 1e-9);
});

Deno.test("buildPanel: intersection grid + features attached point-in-time", () => {
  const features: FeatureSeries[] = [
    { symbol: "AAA", key: "insider_open_market_buyers_30d", records: [{ effectiveDate: "2026-06-02", value: 2 }] },
  ];
  const panel = buildPanel(prices, features);
  assertEquals(panel.dates.length, 3);
  assertEquals(panel.symbols.length, 2);
  const aaa = panel.symbols.find((s) => s.symbol === "AAA")!;
  // the insider feature is invisible on 06-01, visible from 06-02 (point-in-time)
  assertEquals(evalSignal({ kind: "feature_threshold", feature: "insider_open_market_buyers_30d", op: ">=", value: 1, side: "long" }, aaa.features, "2026-06-01"), 0);
  assertEquals(evalSignal({ kind: "feature_threshold", feature: "insider_open_market_buyers_30d", op: ">=", value: 1, side: "long" }, aaa.features, "2026-06-02"), 1);
});
