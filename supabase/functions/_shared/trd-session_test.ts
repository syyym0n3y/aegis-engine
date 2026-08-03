import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { IntradayBar, openingRange, sessionsOf, tagSessions } from "./trd-session.ts";

function bar(ts: string, px = 100): IntradayBar {
  return { ts, open: px, high: px + 1, low: px - 1, close: px, volume: 1000 };
}

Deno.test("sessionsOf: London/NY overlap window (14:00 UTC) belongs to both", () => {
  assertEquals(sessionsOf("2026-07-28T14:00:00Z").sort(), ["london", "ny"]);
});

Deno.test("sessionsOf: 02:00 UTC is Asia only; 22:00 UTC is no listed session", () => {
  assertEquals(sessionsOf("2026-07-28T02:00:00Z"), ["asia"]);
  assertEquals(sessionsOf("2026-07-28T22:00:00Z"), []);
});

Deno.test("tagSessions: first bar in a session window on a date is the open", () => {
  const bars = [
    bar("2026-07-28T13:00:00Z"), // NY open (first NY bar of the day)
    bar("2026-07-28T13:05:00Z"),
    bar("2026-07-28T14:00:00Z"),
  ];
  const tags = tagSessions(bars, 30);
  assertEquals(tags[0].isSessionOpen.ny, true);
  assertEquals(tags[1].isSessionOpen.ny, false);
  assertEquals(tags[0].minutesSinceOpen.ny, 0);
  assertEquals(tags[1].minutesSinceOpen.ny, 5);
  assertEquals(tags[0].inOpeningRange.ny, true);
});

Deno.test("tagSessions: day-of-week is UTC and correct (2026-07-28 is a Tuesday)", () => {
  const tags = tagSessions([bar("2026-07-28T13:00:00Z")]);
  assertEquals(tags[0].dow, 2); // Tuesday
});

Deno.test("tagSessions: opening-range flag turns off past the OR window", () => {
  const bars = [bar("2026-07-28T13:00:00Z"), bar("2026-07-28T13:45:00Z")];
  const tags = tagSessions(bars, 30);
  assertEquals(tags[0].inOpeningRange.ny, true); // 0 min
  assertEquals(tags[1].inOpeningRange.ny, false); // 45 min > 30
});

Deno.test("openingRange: high/low computed only from OR-window bars of that date", () => {
  const bars = [
    { ts: "2026-07-28T13:00:00Z", open: 100, high: 105, low: 99, close: 101, volume: 1 }, // in OR
    { ts: "2026-07-28T13:20:00Z", open: 101, high: 103, low: 98, close: 100, volume: 1 }, // in OR
    { ts: "2026-07-28T14:00:00Z", open: 100, high: 120, low: 90, close: 110, volume: 1 }, // OUTSIDE OR — must be ignored
  ];
  const or = openingRange(bars, "ny", "2026-07-28", 30)!;
  assertEquals(or.high, 105); // not 120
  assertEquals(or.low, 98); // not 90
  assertEquals(or.barCount, 2);
});

Deno.test("openingRange: returns null when no bars fall in the window", () => {
  assertEquals(openingRange([bar("2026-07-28T18:00:00Z")], "ny", "2026-07-28", 30), null);
});
