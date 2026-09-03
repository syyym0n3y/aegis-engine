// mtf-structure_test.ts — hand-constructed proofs of each primitive, especially the NO-LOOK-AHEAD contract.
// Run: deno test supabase/functions/_shared/
import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  Bar, clv, priorDayLevels, swings, breaksOfStructure, fvgs, volumeStates,
  utcDayKey, sessionOf, priorPeriodLevels,
} from "./mtf-structure.ts";

// helper: build an hourly bar at a given UTC time
const H = 3600;
function bar(ts: number, o: number, h: number, l: number, c: number, v = 1): Bar {
  return { ts, o, h, l, c, v };
}
// 2021-01-01 00:00 UTC
const D0 = Math.floor(Date.UTC(2021, 0, 1, 0, 0, 0) / 1000);
const D1 = Math.floor(Date.UTC(2021, 0, 2, 0, 0, 0) / 1000);
const D2 = Math.floor(Date.UTC(2021, 0, 3, 0, 0, 0) / 1000);

Deno.test("sessions: UTC day key and approximate session ownership", () => {
  assertEquals(utcDayKey(D0), "2021-01-01");
  assertEquals(sessionOf(D0 + 2 * H), "asia"); // 02:00
  assertEquals(sessionOf(D0 + 9 * H), "london"); // 09:00
  assertEquals(sessionOf(D0 + 15 * H), "ny"); // 15:00
  assertEquals(sessionOf(D0 + 23 * H), "off"); // 23:00
});

Deno.test("CLV: close at high = +1, close at low = -1, flat bar = 0", () => {
  assertEquals(clv(bar(0, 10, 12, 8, 12)), 1);
  assertEquals(clv(bar(0, 10, 12, 8, 8)), -1);
  assertEquals(clv(bar(0, 10, 12, 8, 10)), 0);
  assertEquals(clv(bar(0, 10, 10, 10, 10)), 0); // h==l -> no direction
});

Deno.test("prior-day level: is the prior UTC day's max/min AND is NOT visible intraday of that day (no look-ahead)", () => {
  // Day 0: 24 hourly bars, high=110 reached at hour 5, low=90 at hour 10.
  const bars: Bar[] = [];
  for (let i = 0; i < 24; i++) {
    let h = 100, l = 99;
    if (i === 5) { h = 110; l = 100; }
    if (i === 10) { h = 91; l = 90; }
    bars.push(bar(D0 + i * H, 100, h, l, 100));
  }
  // Day 1: a few bars.
  for (let i = 0; i < 5; i++) bars.push(bar(D1 + i * H, 100, 101, 99, 100));
  const lv = priorDayLevels(bars);
  // Every bar WITHIN day 0 must have NO prior-day level (nothing closed yet) -> null. This is the look-ahead proof:
  // day 0's own high of 110 must never appear as a level during day 0.
  for (let i = 0; i < 24; i++) assertEquals(lv[i], null, `bar ${i} in day0 must see no prior-day level`);
  // The FIRST bar of day 1 must see day 0's completed high/low.
  assertEquals(lv[24]!.high, 110);
  assertEquals(lv[24]!.low, 90);
  // And it must remain day 0's level for all of day 1 (day 1 not yet closed).
  assertEquals(lv[28]!.high, 110);
});

Deno.test("prior-period generic: level only advances after the period closes", () => {
  // three one-bar 'days' via a synthetic key function
  const bars = [bar(D0, 1, 5, 1, 3), bar(D0 + H, 1, 9, 0, 4), bar(D1, 1, 2, 1, 2)];
  const lv = priorPeriodLevels(bars, utcDayKey);
  assertEquals(lv[0], null); // day0 open, nothing prior
  assertEquals(lv[1], null); // still day0
  // day1 bar sees day0's completed high=9 low=0
  assertEquals(lv[2]!.high, 9);
  assertEquals(lv[2]!.low, 0);
});

Deno.test("swing points: fractal w=2 detects the correct pivots and confirms w bars later", () => {
  // prices form a clear swing high at index 3 and swing low at index 8
  const highs = [1, 2, 3, 5, 3, 2, 1.5, 1, 0.5, 1, 1.5, 2];
  const bars = highs.map((p, i) => bar(D0 + i * H, p, p + 0.01, p - 0.01, p));
  const sw = swings(bars, 2);
  const hiPivot = sw.find((s) => s.kind === "high");
  assert(hiPivot, "should find a swing high");
  assertEquals(hiPivot!.index, 3); // the peak at 5
  assertEquals(hiPivot!.confirmedAt, 5); // known only 2 bars later
  const loPivot = sw.find((s) => s.kind === "low");
  assert(loPivot, "should find a swing low");
  assertEquals(loPivot!.index, 8); // the trough at 0.5
});

Deno.test("break of structure: fires ONLY on a CLOSE beyond the confirmed swing, not a wick", () => {
  // Build a swing high at index 2 (price 10). Then a bar that WICKS above 10 but closes below -> no BOS.
  // Then a bar that CLOSES above 10 -> up-BOS.
  const bars: Bar[] = [
    bar(D0 + 0 * H, 8, 8.1, 7.9, 8),
    bar(D0 + 1 * H, 9, 9.1, 8.9, 9),
    bar(D0 + 2 * H, 10, 10.0, 9.9, 10), // swing-high pivot (needs neighbours lower)
    bar(D0 + 3 * H, 9, 9.1, 8.9, 9),
    bar(D0 + 4 * H, 8, 8.1, 7.9, 8), // confirms the pivot at index 2 (w=2 -> confirmedAt=4)
    bar(D0 + 5 * H, 9, 10.5, 8.9, 9.5), // WICK to 10.5 but CLOSE 9.5 < 10 -> NO bos
    bar(D0 + 6 * H, 10, 10.6, 9.9, 10.4), // CLOSE 10.4 > 10 -> up-BOS
  ];
  const bos = breaksOfStructure(bars, 2);
  const ups = bos.filter((b) => b.dir === "up");
  assertEquals(ups.length, 1, "exactly one up-BOS");
  assertEquals(ups[0].index, 6, "BOS is the close-through bar, not the wick bar");
  assertAlmostEquals(ups[0].swingPrice, 10, 1e-9);
});

Deno.test("FVG: a hand-made bullish 3-bar gap is detected with the right zone and size", () => {
  // bullish FVG: bar[i-1].high < bar[i+1].low. Use i=1.
  const bars: Bar[] = [
    bar(D0 + 0 * H, 100, 101, 99, 100), // prev: high 101
    bar(D0 + 1 * H, 101, 110, 101, 109), // middle (big up bar)
    bar(D0 + 2 * H, 109, 111, 105, 110), // next: low 105 > prev high 101 -> gap [101,105]
    bar(D0 + 3 * H, 110, 112, 108, 111),
  ];
  const g = fvgs(bars);
  assertEquals(g.length, 1);
  assertEquals(g[0].dir, "bull");
  assertEquals(g[0].bottom, 101);
  assertEquals(g[0].top, 105);
  assertEquals(g[0].knownAt, 2); // known at the third bar
  assertEquals(g[0].filledAt, null); // price never returns to 101
  assertEquals(g[0].invertedAt, null);
});

Deno.test("FVG fill + IFVG inversion: a bullish gap that price closes BELOW flips (inverts)", () => {
  const bars: Bar[] = [
    bar(D0 + 0 * H, 100, 101, 99, 100),
    bar(D0 + 1 * H, 101, 110, 101, 109),
    bar(D0 + 2 * H, 109, 111, 105, 110), // bull gap [101,105], known at index 2
    bar(D0 + 3 * H, 110, 111, 104, 106), // dips to 104 -> enters gap (fills far edge? far edge=bottom=101; 104>101 no)
    bar(D0 + 4 * H, 106, 107, 100, 100.5), // low 100 <= 101 -> FILLED here; close 100.5 < 101 -> INVERTED here
  ];
  const g = fvgs(bars);
  assertEquals(g.length, 1);
  assertEquals(g[0].filledAt, 4, "fully filled when low pierces the bottom edge 101");
  assertEquals(g[0].invertedAt, 4, "inverts when a close prints below the gap bottom");
});

Deno.test("FVG: a bearish gap is detected and inverts on a close ABOVE the top", () => {
  const bars: Bar[] = [
    bar(D0 + 0 * H, 100, 101, 99, 100), // prev low 99
    bar(D0 + 1 * H, 99, 99, 90, 91), // middle down bar
    bar(D0 + 2 * H, 91, 95, 89, 90), // next high 95 < prev low 99 -> bear gap [95,99]
    bar(D0 + 3 * H, 90, 100, 89, 99.5), // close 99.5 > top 99 -> inverts
  ];
  const g = fvgs(bars);
  assertEquals(g.length, 1);
  assertEquals(g[0].dir, "bear");
  assertEquals(g[0].bottom, 95);
  assertEquals(g[0].top, 99);
  assertEquals(g[0].invertedAt, 3);
});

Deno.test("volume state: trailing window ends at i-1 (no self-inclusion); high-participation flagged", () => {
  const bars: Bar[] = [];
  // 24 bars of volume 10, then a spike of 100.
  for (let i = 0; i < 24; i++) bars.push(bar(D0 + i * H, 100, 101, 99, 100, 10));
  bars.push(bar(D0 + 24 * H, 100, 105, 99, 104, 100)); // the spike, closing near high
  const vs = volumeStates(bars, 24);
  for (let i = 0; i < 24; i++) assert(Number.isNaN(vs[i].partRatio), `bar ${i} has no full trailing window`);
  // spike bar: median of prior 24 volumes = 10 -> partRatio = 100/10 = 10
  assertAlmostEquals(vs[24].partRatio, 10, 1e-9);
  // directional z: prior 24 CLV*v are all 0 (flat-ish closes at mid) -> sd 0 -> dirZ NaN (guarded, not Infinity)
  assert(Number.isNaN(vs[24].dirZ) || Number.isFinite(vs[24].dirZ));
});

Deno.test("volume state: directional z is positive when a high-volume bar closes at its high vs a calm buy-side history", () => {
  const bars: Bar[] = [];
  // history: alternating small +/- directional volume around 0 mean, with spread so sd>0
  for (let i = 0; i < 24; i++) {
    const up = i % 2 === 0;
    bars.push(bar(D0 + i * H, 100, 101, 99, up ? 100.5 : 99.5, 10));
  }
  // test bar: closes at the high on 5x volume -> CLV=+1, dv=+50, well above the ~0 mean
  bars.push(bar(D0 + 24 * H, 100, 102, 98, 102, 50));
  const vs = volumeStates(bars, 24);
  assert(vs[24].dirZ > 1, `expected strong positive directional z, got ${vs[24].dirZ}`);
});
