import { computeInsiderFeatures, FilingForFeature } from "./trd-features-edgar.ts";
import { assert, assertEquals } from "./trd-test-helpers.ts";

const filings: FilingForFeature[] = [
  { ticker: "ABC", person: "Alice", disclosed_date: "2026-06-01", openMarketBuy: true, openMarketBuyShares: 1000 },
  { ticker: "ABC", person: "Bob", disclosed_date: "2026-06-05", openMarketBuy: true, openMarketBuyShares: 500 },
  { ticker: "ABC", person: "Alice", disclosed_date: "2026-06-05", openMarketBuy: false, openMarketBuyShares: 0 }, // award, not a buy
  { ticker: "XYZ", person: "Carol", disclosed_date: "2026-06-05", openMarketBuy: false, openMarketBuyShares: 0 },
];

Deno.test("computeInsiderFeatures: counts DISTINCT open-market buyers in the window", () => {
  const feats = computeInsiderFeatures(filings, 30);
  const buyers = (sym: string, d: string) =>
    feats.find((f) => f.feature_key === "insider_open_market_buyers_30d" && f.symbol === sym && f.effective_date === d)?.value;
  // ABC as-of 2026-06-01: only Alice has bought → 1
  assertEquals(buyers("ABC", "2026-06-01"), 1);
  // ABC as-of 2026-06-05: Alice + Bob bought (award doesn't count) → 2
  assertEquals(buyers("ABC", "2026-06-05"), 2);
  // XYZ: no buys → 0
  assertEquals(buyers("XYZ", "2026-06-05"), 0);
});

Deno.test("point-in-time: an earlier date never sees a later disclosure", () => {
  const feats = computeInsiderFeatures(filings, 30);
  // ABC as-of 06-01 must NOT include Bob's 06-05 buy
  const early = feats.find((f) => f.feature_key === "insider_open_market_buyers_30d" && f.symbol === "ABC" && f.effective_date === "2026-06-01");
  assert(early !== undefined && early.value === 1, "06-01 sees only the 06-01 buyer, not the future one");
});

Deno.test("window excludes filings older than windowDays", () => {
  const f: FilingForFeature[] = [
    { ticker: "ABC", person: "Old", disclosed_date: "2026-01-01", openMarketBuy: true, openMarketBuyShares: 1 },
    { ticker: "ABC", person: "New", disclosed_date: "2026-06-05", openMarketBuy: true, openMarketBuyShares: 1 },
  ];
  const feats = computeInsiderFeatures(f, 30);
  const v = feats.find((x) => x.feature_key === "insider_open_market_buyers_30d" && x.effective_date === "2026-06-05")?.value;
  assertEquals(v, 1); // the Jan buyer is >30d stale → excluded
});
