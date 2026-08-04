// Guard for the frozen mean-reversion signal (D-111). `deno test supabase/functions/_shared/`.
import { assert, assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { meanRevSignal, resolveTrade, rsi, type Bar, MR_SPEC } from "./trd-meanrev.ts";

// build an uptrend (above 200MA) that then drops hard for a few days → RSI-2 oversold on the last bar
function bars(pattern: number[]): Bar[] { return pattern.map((c, i) => ({ d: `2026-01-${String(i + 1).padStart(2, "0")}`, o: c, h: c * 1.005, l: c * 0.995, c })); }

Deno.test("rsi-2 hits extreme lows after consecutive down closes", () => {
  const up = Array.from({ length: 210 }, (_, i) => 100 + i);         // steady uptrend
  const drop = [312, 306, 300, 294];                                  // sharp pullback
  const r = rsi([...up, ...drop].map(Number), 2);
  assert(r[r.length - 1] < 15, `RSI-2 should be deeply oversold, got ${r[r.length - 1]}`);
});

Deno.test("long fires on oversold-in-uptrend WHEN vix elevated; blocked when calm", () => {
  const up = Array.from({ length: 210 }, (_, i) => 100 + i * 0.5);
  const b = bars([...up, 205, 202, 199, 196]);                        // above 200MA, sharp dip → oversold
  assert(meanRevSignal(b, 25)?.side === "long", "should fire long in high VIX");
  assertEquals(meanRevSignal(b, 12), null, "should be blocked when VIX < vixMin");
});

Deno.test("short fires on overbought-in-downtrend, not in an uptrend", () => {
  const down = Array.from({ length: 210 }, (_, i) => 400 - i);        // downtrend (below its 200MA)
  const b = bars([...down, 193, 197, 201, 205]);                      // sharp bounce → overbought
  const sig = meanRevSignal(b, 25);
  assert(sig?.side === "short", `should fire short in high-VIX downtrend, got ${sig?.side}`);
});

Deno.test("resolveTrade: hard stop caps the loss at -(1+cost)R", () => {
  const entry = 100, stopDist = 4; // long stop at 96
  const seq: Bar[] = [{ d: "d0", o: 100, h: 100, l: 100, c: 100 }, { d: "d1", o: 99, h: 99, l: 95, c: 95 }]; // gaps through stop
  const r = resolveTrade(seq, "long", entry, stopDist);
  assertAlmostEquals(r!.r, -1 - MR_SPEC.costR, 1e-9);
  assertEquals(r!.reason, "stop");
});

Deno.test("resolveTrade: returns null while still open (not enough bars)", () => {
  const seq: Bar[] = [{ d: "d0", o: 100, h: 100, l: 100, c: 100 }];
  assertEquals(resolveTrade(seq, "long", 100, 4), null);
});
