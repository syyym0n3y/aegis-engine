import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adjShares, splitFactorAfter } from "./shares-adj.ts";

// AAPL's two splits since 2013: 7:1 on 2014-06-09 and 4:1 on 2020-08-31. A share count filed 2013-10-30 is
// therefore 7 x 4 = 28 of today's shares, and that is exactly the factor a 2013 market cap needs before it can be
// multiplied by a split-adjusted 2013 close.
const AAPL: { d: string; v: number }[] = [
  { d: "2014-06-09", v: 7 },
  { d: "2020-08-31", v: 4 },
];

Deno.test("AAPL: shares filed 2013-10-30 are multiplied by 28", () => {
  assertEquals(splitFactorAfter(AAPL, "2013-10-30"), 28);
  assertEquals(adjShares(900_000_000, AAPL, "2013-10-30"), 900_000_000 * 28);
});

Deno.test("only splits AFTER the filing date count", () => {
  assertEquals(splitFactorAfter(AAPL, "2015-01-02"), 4);    // the 7:1 already happened
  assertEquals(splitFactorAfter(AAPL, "2021-05-28"), 1);    // both already happened -> raw == adjusted
  assertEquals(splitFactorAfter(AAPL, "2014-06-09"), 4);    // boundary: strictly-after, same-day split excluded
});

Deno.test("no-split case is the identity", () => {
  assertEquals(splitFactorAfter([], "2015-01-02"), 1);
  assertEquals(splitFactorAfter(undefined, "2015-01-02"), 1);
  assertEquals(adjShares(1_234_567, [], "2015-01-02"), 1_234_567);
  // the "checked, no splits" sentinel is inert
  assertEquals(splitFactorAfter([{ d: "1900-01-01", v: 1 }], "2015-01-02"), 1);
});

Deno.test("reverse splits shrink the count (the GWAV shape)", () => {
  // a 1-for-100 reverse after the filing: 493.7M filed shares are 4.937M of today's shares.
  assertAlmostEquals(splitFactorAfter([{ d: "2022-01-05", v: 0.01 }], "2021-05-28"), 0.01, 1e-12);
  assertAlmostEquals(adjShares(493_700_000, [{ d: "2022-01-05", v: 0.01 }], "2021-05-28"), 4_937_000, 1e-6);
});

Deno.test("malformed rows are ignored, not propagated as NaN", () => {
  const bad = [{ d: "2020-01-01", v: NaN }, { d: "", v: 2 }, { d: "2020-01-01", v: 0 }];
  assertEquals(splitFactorAfter(bad, "2019-01-01"), 1);
});

// D-747, the ISSUANCE case. `issuance` differences two RAW share counts from two different filings. If a 2:1 split
// falls between them the raw count doubles with no shares issued, and the naive difference prints a -100% "issuance"
// — the single largest value the signal can take, on exactly the names that split. Restating BOTH filings into
// today's units before differencing makes the split invisible, which is the correct answer.
Deno.test("issuance: a 2:1 split between two filings is ~0 issuance, not -100%", () => {
  const splits = [{ d: "2020-06-01", v: 2 }];
  const shPrevRaw = 1_000_000, shPrevEff = "2020-01-31";   // filed before the split
  const shRaw = 2_000_000, shEff = "2020-12-31";           // same company, same shares, post-split units

  const naive = -(shRaw / shPrevRaw - 1);
  assertAlmostEquals(naive, -1, 1e-12);                     // the defect: "-100% issuance" out of thin air

  const shAdj = adjShares(shRaw, splits, shEff);            // x1 — the split is already in these units
  const shPAdj = adjShares(shPrevRaw, splits, shPrevEff);   // x2 — restated forward
  assertAlmostEquals(-(shAdj / shPAdj - 1), 0, 1e-12);
});

Deno.test("issuance: a REAL 10% issuance across a split still measures 10%", () => {
  const splits = [{ d: "2020-06-01", v: 2 }];
  const shPAdj = adjShares(1_000_000, splits, "2020-01-31");   // 2,000,000 today-units
  const shAdj = adjShares(2_200_000, splits, "2020-12-31");    // 2,200,000 today-units: 10% more shares
  assertAlmostEquals(-(shAdj / shPAdj - 1), -0.1, 1e-12);
});
