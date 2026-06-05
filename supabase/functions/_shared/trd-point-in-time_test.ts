import {
  asOf, assertHasEffectiveDate, disclosureLagDays, lookaheadViolations, PitRecord,
} from "./trd-point-in-time.ts";
import { assert, assertEquals, assertThrows } from "./trd-test-helpers.ts";

const recs: PitRecord[] = [
  { effectiveDate: "2026-01-10", ticker: "AAA" },
  { effectiveDate: "2026-02-15", ticker: "BBB" },
  { effectiveDate: "2026-03-20", ticker: "CCC" },
];

Deno.test("asOf returns only records knowable on/before the cutoff", () => {
  const got = asOf(recs, "2026-02-15");
  assertEquals(got.length, 2);
  assertEquals(got.map((r) => r.ticker).join(","), "AAA,BBB");
});

Deno.test("a future-dated record is a look-ahead violation a naive query would leak", () => {
  const viol = lookaheadViolations(recs, "2026-02-15");
  assertEquals(viol.length, 1);
  assertEquals(viol[0].ticker, "CCC");
  // asOf() must exclude exactly the violators
  const asof = asOf(recs, "2026-02-15");
  assert(!asof.some((r) => r.ticker === "CCC"), "CCC must be excluded");
});

Deno.test("FAIL CLOSED: missing effectiveDate throws", () => {
  assertThrows(() => assertHasEffectiveDate([{ ticker: "X" } as unknown as PitRecord]));
  assertThrows(() => asOf([{ effectiveDate: "not-a-date", ticker: "X" }], "2026-01-01"));
  assertThrows(() => asOf(recs, "garbage-cutoff"));
});

Deno.test("disclosure lag: the 45-day STOCK Act reality is first-class", () => {
  // traded Jan 5, disclosed Feb 19 → 45 days of dead edge
  const lag = disclosureLagDays("2026-01-05", "2026-02-19");
  assertEquals(Math.round(lag), 45);
  assert(lag > 0, "disclosed after the trade (the edge-eroding case)");
});
