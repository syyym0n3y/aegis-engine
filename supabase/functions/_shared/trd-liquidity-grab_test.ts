import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backtestLiquidityGrab, type Bar, DEFAULT_LG, ema, summarize } from "./trd-liquidity-grab.ts";

Deno.test("ema tracks a constant series", () => {
  const e = ema([100, 100, 100, 100], 3);
  assert(Math.abs(e[3] - 100) < 1e-9);
});

// Construct a clean long liquidity-grab in an uptrend and prove one trade fires and hits target.
Deno.test("detects a long liquidity grab and can hit 1:1 target", () => {
  // rising series (keeps close > EMA), with a support pivot low then a grab candle that wicks
  // below it and closes above, then a bar that breaks the grab high and runs to target.
  const b: Bar[] = [];
  let p = 100;
  for (let i = 0; i < 40; i++) { b.push({ ts: `t${i}`, open: p, high: p + 1, low: p - 1, close: p + 0.5 }); p += 0.5; }
  // support pivot low at index 41 (low dips), confirmed at 42
  b.push({ ts: "t40", open: p, high: p + 1, low: p - 1, close: p + 0.5 }); p += 0.5;
  b.push({ ts: "t41", open: p, high: p + 0.5, low: p - 3, close: p + 0.2 }); // pivot low (low is lowest)
  const supportLow = p - 3;
  b.push({ ts: "t42", open: p, high: p + 1, low: p - 0.5, close: p + 0.6 }); p += 0.5; // confirms pivot
  // grab candle: wicks below supportLow but closes above it, close>EMA
  b.push({ ts: "t43", open: p, high: p + 2, low: supportLow - 1, close: p + 1 });
  const grabHigh = p + 2, grabLow = supportLow - 1;
  // next bars break grabHigh and run up to the 1:1 target (entry=grabHigh, risk=grabHigh-grabLow)
  const entry = grabHigh, risk = grabHigh - grabLow, target = entry + risk;
  b.push({ ts: "t44", open: p + 1.5, high: entry + 0.1, low: p + 1, close: entry + 0.05 }); // fills entry
  b.push({ ts: "t45", open: entry, high: target + 1, low: entry - 0.1, close: target }); // hits target
  const trades = backtestLiquidityGrab(b, { ...DEFAULT_LG, levelStaleBars: 200, costPerSideUsd: 0 });
  assert(trades.length >= 1, `expected a trade, got ${trades.length}`);
  assertEquals(trades[0].side, "long");
  assert(trades[0].reason === "target", `expected target hit, got ${trades[0].reason}`);
});

// Costs must reduce expectancy: same trades, higher cost → lower expectancyR. This is the crux of
// the "1:1 = high win rate" claim — a per-side cost eats directly into a 1R win.
Deno.test("costs reduce expectancy on a 1:1 target", () => {
  const b: Bar[] = [];
  let p = 100;
  for (let i = 0; i < 40; i++) { b.push({ ts: `t${i}`, open: p, high: p + 1, low: p - 1, close: p + 0.5 }); p += 0.5; }
  b.push({ ts: "t40", open: p, high: p + 1, low: p - 1, close: p + 0.5 }); p += 0.5;
  b.push({ ts: "t41", open: p, high: p + 0.5, low: p - 3, close: p + 0.2 });
  const supportLow = p - 3;
  b.push({ ts: "t42", open: p, high: p + 1, low: p - 0.5, close: p + 0.6 }); p += 0.5;
  b.push({ ts: "t43", open: p, high: p + 2, low: supportLow - 1, close: p + 1 });
  const entry = p + 2, risk = entry - (supportLow - 1), target = entry + risk;
  b.push({ ts: "t44", open: p + 1.5, high: entry + 0.1, low: p + 1, close: entry + 0.05 });
  b.push({ ts: "t45", open: entry, high: target + 1, low: entry - 0.1, close: target });
  const free = summarize(backtestLiquidityGrab(b, { ...DEFAULT_LG, levelStaleBars: 200, costPerSideUsd: 0 }));
  const costly = summarize(backtestLiquidityGrab(b, { ...DEFAULT_LG, levelStaleBars: 200, costPerSideUsd: 0.5 }));
  assert(costly.expectancyR < free.expectancyR, "cost must lower expectancy");
});
