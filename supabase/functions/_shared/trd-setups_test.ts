import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Bar, detectFVG, detectSetups, detectSweeps } from "./trd-setups.ts";

function bar(ts: string, o: number, h: number, l: number, c: number): Bar { return { ts, open: o, high: h, low: l, close: c }; }

Deno.test("FVG: a bullish 3-bar gap is detected with a valid stop below and R target", () => {
  // bar[i].low (105) > bar[i-2].high (102) => bullish FVG
  const bars = [bar("t1", 100, 102, 99, 101), bar("t2", 101, 108, 101, 107), bar("t3", 107, 110, 105, 109)];
  const s = detectFVG(bars, 2);
  assertEquals(s.length, 1);
  assertEquals(s[0].side, "long");
  assertEquals(s[0].entry, 102); // prior-2 high
  assertEquals(s[0].stop, 99); // prior-2 low
  assert(s[0].target > s[0].entry);
});

Deno.test("FVG: a bearish gap → short setup", () => {
  // bar[i].high (95) < bar[i-2].low (98)
  const bars = [bar("t1", 100, 101, 98, 99), bar("t2", 98, 98, 92, 93), bar("t3", 93, 95, 90, 91)];
  const s = detectFVG(bars, 2);
  assertEquals(s.length, 1);
  assertEquals(s[0].side, "short");
  assert(s[0].stop > s[0].entry && s[0].target < s[0].entry);
});

Deno.test("SWEEP: taking out prior highs then closing back inside → short reversal", () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) bars.push(bar(`d${String(i).padStart(2, "0")}`, 100, 102, 98, 100)); // range, prior high 102
  bars.push(bar("d20", 101, 106, 100, 101)); // wick to 106 (above 102), closes 101 (< 102) => bearish sweep
  const s = detectSweeps(bars, 20, 2);
  assertEquals(s.length, 1);
  assertEquals(s[0].side, "short");
  assertEquals(s[0].stop, 106); // beyond the swept wick
  assert(s[0].entry === 101);
});

Deno.test("SWEEP: taking out prior lows then reclaiming → long reversal", () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) bars.push(bar(`d${String(i).padStart(2, "0")}`, 100, 102, 98, 100)); // prior low 98
  bars.push(bar("d20", 99, 100, 94, 99)); // wick to 94 (below 98), closes 99 (> 98) => bullish sweep
  const s = detectSweeps(bars, 20, 2);
  assertEquals(s.length, 1);
  assertEquals(s[0].side, "long");
  assertEquals(s[0].stop, 94);
});

Deno.test("every setup carries a positive-risk stop and an R-multiple target (executable)", () => {
  const bars = [bar("t1", 100, 102, 99, 101), bar("t2", 101, 108, 101, 107), bar("t3", 107, 110, 105, 109)];
  for (const s of detectSetups(bars)) {
    const risk = Math.abs(s.entry - s.stop);
    assert(risk > 0, "must have a real stop distance");
    assert(Math.abs(s.target - s.entry) >= risk * s.rMultiple - 1e-9, "target must be at least R×risk");
  }
});
