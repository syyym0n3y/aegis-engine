import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adjShares, cleanShareSeries, scrubShareFacts, splitFactorAfter } from "./shares-adj.ts";

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

// ---------------------------------------------------------------------------------------------------------------
// D-747f — the THIRD share-base defect: facts that are corrupt AS FILED.
// The two tests that matter most here are the NEGATIVE ones. A cleaner that drops a real corporate action is worse
// than no cleaner: it silently deletes a name's market cap for a year, and nothing downstream can tell the
// difference between "the filer was wrong" and "we threw the truth away". So a 2:1 doubling and a 10:1 reverse
// split are asserted KEPT, and they are kept for a structural reason rather than a lucky threshold — a genuine
// split moves the series to a NEW LEVEL and leaves it there, so the point's two neighbours never agree.
const F = (eff: string, value: number) => ({ eff, value });

Deno.test("cleanShareSeries drops the BTI shape (exactly 1e6 of both agreeing neighbours)", () => {
  const s = [F("2019-05-01", 2.46e9), F("2019-08-01", 2.46e15), F("2019-11-01", 2.46e9), F("2020-02-01", 2.47e9)];
  const { kept, dropped } = cleanShareSeries(s);
  assertEquals(dropped.length, 1);
  assertEquals(dropped[0].eff, "2019-08-01");
  assertEquals(dropped[0].value, 2.46e15);
  assertEquals(kept.length, 3);
  assertEquals(kept.map((k) => k.eff), ["2019-05-01", "2019-11-01", "2020-02-01"]);
});

Deno.test("cleanShareSeries drops the CCL shape (9.32e11 between 5.28e8 and 9.86e8)", () => {
  const s = [F("2020-12-21", 5.28e8), F("2021-03-30", 9.32e11), F("2021-06-25", 9.86e8), F("2021-09-24", 1.02e9)];
  const { kept, dropped } = cleanShareSeries(s);
  assertEquals(dropped.length, 1);
  assertEquals(dropped[0].eff, "2021-03-30");
  assertEquals(kept.length, 3);
  // and the neighbours it was judged against are BOTH still there — the drop must not cascade.
  assertEquals(kept[0].eff, "2020-12-21");
  assertEquals(kept[1].eff, "2021-06-25");
});

Deno.test("cleanShareSeries KEEPS a legitimate 2:1 forward split", () => {
  const s = [F("2020-01-01", 1.00e9), F("2020-04-01", 1.01e9), F("2020-07-01", 2.02e9), F("2020-10-01", 2.03e9)];
  const { kept, dropped } = cleanShareSeries(s);
  assertEquals(dropped.length, 0);
  assertEquals(kept.length, 4);
});

Deno.test("cleanShareSeries KEEPS a legitimate 10:1 reverse split (no return to the old level)", () => {
  const s = [F("2020-01-01", 1.00e9), F("2020-04-01", 1.00e9), F("2020-07-01", 1.00e8), F("2020-10-01", 1.01e8)];
  const { kept, dropped } = cleanShareSeries(s);
  assertEquals(dropped.length, 0);
  assertEquals(kept.length, 4);
});

Deno.test("cleanShareSeries KEEPS an extreme 1-for-500 reverse split — the level never comes back", () => {
  const s = [F("2020-01-01", 5.0e8), F("2020-04-01", 5.0e8), F("2020-07-01", 1.0e6), F("2020-10-01", 1.0e6)];
  const { dropped } = cleanShareSeries(s);
  assertEquals(dropped.length, 0);
});

Deno.test("cleanShareSeries leaves an interior spike ALONE when the neighbours disagree", () => {
  // 1e8 then 1e12 then 1e10: the neighbours are 100x apart, so nothing here is a clean spike and the
  // conservative answer is to keep everything and let a downstream guard speak.
  // It also protects the ENDPOINTS: 1e8 is 1/1e4 of the 1e12 beside it, but 1e12 is not corroborated by anything
  // (its own other neighbour is 100x away), so the healthy 1e8 must NOT be deleted on its word.
  const s = [F("2020-01-01", 1e8), F("2020-04-01", 1e12), F("2020-07-01", 1e10)];
  assertEquals(cleanShareSeries(s).dropped.length, 0);
});

Deno.test("cleanShareSeries drops an EDGE point only past 1000x", () => {
  const near = [F("2020-01-01", 1e11), F("2020-04-01", 1e9), F("2020-07-01", 1.01e9)];   // 100x, first point
  assertEquals(cleanShareSeries(near).dropped.length, 0);
  const far = [F("2020-01-01", 1e15), F("2020-04-01", 1e9), F("2020-07-01", 1.01e9)];    // 1e6x, first point
  const d = cleanShareSeries(far).dropped;
  assertEquals(d.length, 1);
  assertEquals(d[0].eff, "2020-01-01");
});

Deno.test("cleanShareSeries is a no-op on a series too short to have an interior point", () => {
  assertEquals(cleanShareSeries([F("2020-01-01", 1e9)]).dropped.length, 0);
  assertEquals(cleanShareSeries([]).kept.length, 0);
});

Deno.test("scrubShareFacts cleans the factory store in place and names every ticker", () => {
  const fund = new Map<string, Map<string, { eff: string; v: number }[]>>([
    ["BTI", new Map([["EntityCommonStockSharesOutstanding", [
      { eff: "2019-05-01", v: 2.46e9 }, { eff: "2019-08-01", v: 2.46e15 }, { eff: "2019-11-01", v: 2.46e9 }]]])],
    ["AAPL", new Map([["EntityCommonStockSharesOutstanding", [
      { eff: "2019-05-01", v: 1.6e10 }, { eff: "2019-08-01", v: 1.6e10 }, { eff: "2019-11-01", v: 1.6e10 }]]])],
  ]);
  const { line, drops } = scrubShareFacts(fund);
  assertEquals(drops.length, 1);
  assertEquals(drops[0].ticker, "BTI");
  assertEquals(fund.get("BTI")!.get("EntityCommonStockSharesOutstanding")!.length, 2);
  assertEquals(fund.get("AAPL")!.get("EntityCommonStockSharesOutstanding")!.length, 3);   // untouched
  assertEquals(line.includes("BTI"), true);
  assertEquals(line.includes("AAPL"), false);
});

// The two false drops the FIRST live run produced. Both are the same error and it is the one that matters most:
// the rule deleted a REAL share count because the facts beside it were placeholders. PSKY (rank 676 of the liquid
// top-1000) files 1000, 1000, then its real 1,071,666,977; CLUS files 434,473,776 then 4399, 4399. A placeholder
// must never convict its neighbour, so both real counts are asserted KEPT by name.
Deno.test("cleanShareSeries KEEPS a real count whose neighbours are placeholders (PSKY / CLUS / NICH)", () => {
  const psky = [F("2025-07-27", 1000), F("2025-10-14", 1000), F("2026-01-19", 1071666977)];
  assertEquals(cleanShareSeries(psky).dropped.filter((d) => d.value === 1071666977).length, 0);

  const clus = [F("2024-12-14", 434473776), F("2025-03-16", 4399), F("2025-06-14", 4399),
    F("2025-09-13", 40004399), F("2025-12-14", 40004399), F("2026-03-16", 40004385)];
  assertEquals(cleanShareSeries(clus).dropped.filter((d) => d.value === 434473776).length, 0);

  // NICH is the interior version of the same shape: 9.595e8 sat between two agreeing junk values ~1.1e4.
  const nich = [F("2023-08-14", 3.268e8), F("2024-02-13", 1.064e4), F("2024-07-03", 9.595e8),
    F("2024-08-14", 1.191e4), F("2025-11-29", 3.368e8)];
  const d = cleanShareSeries(nich).dropped;
  assertEquals(d.filter((x) => x.value === 9.595e8).length, 0);   // the real count survives
  assertEquals(d.length, 2);                                     // the two junk values do not
});
