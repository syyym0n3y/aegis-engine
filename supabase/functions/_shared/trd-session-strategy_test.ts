import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backtestORB, ORBParams, summariseORB, sweepSessions } from "./trd-session-strategy.ts";
import { IntradayBar } from "./trd-session.ts";

// Build one NY-session day (13:00–21:00 UTC, 30-min bars) with a controlled shape.
function nyDay(dateKey: string, bars: { min: number; o: number; h: number; l: number; c: number }[]): IntradayBar[] {
  return bars.map((b) => {
    const hh = String(13 + Math.floor(b.min / 60)).padStart(2, "0");
    const mm = String(b.min % 60).padStart(2, "0");
    return { ts: `${dateKey}T${hh}:${mm}:00Z`, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1000 };
  });
}

Deno.test("ORB breakout long: hits target → +targetR", () => {
  // OR (first 30m) = [100,102]. Then price breaks 102 and runs to target = 102 + 2*(2) = 106.
  const bars = nyDay("2026-07-28", [
    { min: 0, o: 101, h: 102, l: 100, c: 101 }, // OR bar (0..30)
    { min: 30, o: 101, h: 103, l: 101, c: 103 }, // breaks OR-high 102 → long entry @102, risk=2, target=106, stop=100
    { min: 60, o: 103, h: 106, l: 103, c: 106 }, // hits target 106
    { min: 90, o: 106, h: 107, l: 105, c: 106 },
  ]);
  const p: ORBParams = { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout" };
  const trades = backtestORB(bars, p);
  assertEquals(trades.length, 1);
  assertEquals(trades[0].side, "long");
  assertEquals(trades[0].reason, "target");
  assertEquals(Math.round(trades[0].rMultiple), 2);
});

Deno.test("ORB breakout long: hits stop → -1R", () => {
  const bars = nyDay("2026-07-28", [
    { min: 0, o: 101, h: 102, l: 100, c: 101 }, // OR [100,102]
    { min: 30, o: 101, h: 103, l: 101, c: 102 }, // break high → entry @102, stop @100
    { min: 60, o: 102, h: 102, l: 99, c: 100 }, // low 99 <= stop 100 → stopped -1R
  ]);
  const p: ORBParams = { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout" };
  const trades = backtestORB(bars, p);
  assertEquals(trades.length, 1);
  assertEquals(trades[0].reason, "stop");
  assertEquals(Math.round(trades[0].rMultiple), -1);
});

Deno.test("no OR break → no trade (does not force a position)", () => {
  const bars = nyDay("2026-07-28", [
    { min: 0, o: 101, h: 102, l: 100, c: 101 }, // OR [100,102]
    { min: 30, o: 101, h: 101.5, l: 100.5, c: 101 }, // stays inside OR
    { min: 60, o: 101, h: 101.8, l: 100.2, c: 101 },
  ]);
  const trades = backtestORB(bars, { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout" });
  assertEquals(trades.length, 0);
});

Deno.test("weekday filter: 2026-07-28 is Tuesday; a Monday filter yields no trades", () => {
  const bars = nyDay("2026-07-28", [
    { min: 0, o: 101, h: 102, l: 100, c: 101 },
    { min: 30, o: 101, h: 103, l: 101, c: 103 },
    { min: 60, o: 103, h: 106, l: 103, c: 106 },
  ]);
  const tue = backtestORB(bars, { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout", weekday: 2 });
  const mon = backtestORB(bars, { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout", weekday: 1 });
  assertEquals(tue.length, 1);
  assertEquals(mon.length, 0);
});

Deno.test("summariseORB: per-trade equity return = riskFraction × R; N is reported", () => {
  const bars = nyDay("2026-07-28", [
    { min: 0, o: 101, h: 102, l: 100, c: 101 },
    { min: 30, o: 101, h: 103, l: 101, c: 103 },
    { min: 60, o: 103, h: 106, l: 103, c: 106 },
  ]);
  const p: ORBParams = { session: "ny", openingRangeMin: 30, targetR: 2, riskFraction: 0.01, direction: "breakout" };
  const s = summariseORB(backtestORB(bars, p), p, "ny|Tue|breakout");
  assertEquals(s.nTrades, 1);
  assert(Math.abs(s.perTradeReturns[0] - 0.02) < 1e-9); // 0.01 × 2R
});

Deno.test("sweepSessions: nTrials = |sessions|×|weekdays|×|directions| (the multiple-testing surface)", () => {
  const bars = nyDay("2026-07-28", [{ min: 0, o: 101, h: 102, l: 100, c: 101 }, { min: 30, o: 101, h: 103, l: 101, c: 103 }, { min: 60, o: 103, h: 106, l: 103, c: 106 }]);
  const { stats, nTrials } = sweepSessions(bars, { sessions: ["ny", "london"], weekdays: [1, 2, 3], directions: ["breakout", "fade"], openingRangeMin: 30, targetR: 2, riskFraction: 0.01 });
  assertEquals(nTrials, 2 * 3 * 2);
  assertEquals(stats.length, 12);
});
