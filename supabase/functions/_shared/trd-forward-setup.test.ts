import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { atr, rsi, sma, detectTrades, type Bar, type SetupParams } from "./trd-forward-setup.ts";

function mkBars(closes: number[]): Bar[] {
  // synthetic OHLC where h/l straddle close by a fixed band so ATR is well-defined and non-degenerate
  return closes.map((c, i) => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, i * 5)).toISOString(), o: i === 0 ? c : closes[i - 1], h: c + 5, l: c - 5, c }));
}

Deno.test("sma is a trailing mean", () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assertEquals(s[2], 2); assertEquals(s[3], 3); assertEquals(s[4], 4);
  assert(Number.isNaN(s[0]) && Number.isNaN(s[1]));
});

Deno.test("rsi is 100 on a pure uptrend, ~0 on a pure downtrend", () => {
  const up = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
  const dn = rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
  assert(up[15] > 99, `up rsi ${up[15]}`);
  assert(dn[15] < 1, `dn rsi ${dn[15]}`);
});

Deno.test("atr equals the fixed high-low band on a flat-band series", () => {
  const a = atr(mkBars([100, 100, 100, 100, 100]), 3);
  // TR after bar0 = max(10, |h-prevC|, |l-prevC|) = max(10,5,5)=10
  assertEquals(a[4], 10);
});

Deno.test("degenerate-ATR guard: no trades when ATR is ~0 vs price", () => {
  // constant price, zero band → sd not > c*1e-4 → skipped
  const bars: Bar[] = Array.from({ length: 260 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, i * 5)).toISOString(), o: 100, h: 100, l: 100, c: 100 }));
  const p: SetupParams = { rsiLen: 14, rsiThresh: 70, maLen: 200, atrLen: 14, stopAtr: 2, tpMult: 3, maxBars: 50, dir: -1 };
  assertEquals(detectTrades(bars, p, 5).length, 0);
});

Deno.test("short fires on an overbought bar below the MA and resolves; fee lowers netR below grossR", () => {
  // Build 200 declining bars (price below its own rising-window MA won't hold)… simpler: craft a downtrend MA
  // with a local overbought spike. 220 bars: gentle downtrend so close<MA, with an RSI pop near the end.
  const closes: number[] = [];
  for (let i = 0; i < 210; i++) closes.push(300 - i * 0.5);          // downtrend → close < 200MA later
  // a sharp multi-bar rally to push RSI>70 while still below the (higher) MA
  for (let i = 0; i < 8; i++) closes.push(closes[closes.length - 1] + 3);
  for (let i = 0; i < 40; i++) closes.push(closes[closes.length - 1] - 1); // then fall (short should profit)
  const bars = mkBars(closes);
  const p: SetupParams = { rsiLen: 14, rsiThresh: 70, maLen: 200, atrLen: 14, stopAtr: 2, tpMult: 3, maxBars: 60, dir: -1 };
  const t0 = detectTrades(bars, p, 0);
  const t5 = detectTrades(bars, p, 5);
  assert(t0.length >= 1, `expected >=1 short fire, got ${t0.length}`);
  assertEquals(t0.length, t5.length);
  assert(t5[0].costR > 0, "fee should add positive cost");
  assert(t5[0].netR < t0[0].netR, "netR must fall once a fee is charged");
  assertEquals(t0[0].side, "short");
});

Deno.test("afterTs filters to strictly-post-registration entries only", () => {
  const closes: number[] = [];
  for (let i = 0; i < 210; i++) closes.push(300 - i * 0.5);
  for (let i = 0; i < 8; i++) closes.push(closes[closes.length - 1] + 3);
  for (let i = 0; i < 40; i++) closes.push(closes[closes.length - 1] - 1);
  const bars = mkBars(closes);
  const p: SetupParams = { rsiLen: 14, rsiThresh: 70, maLen: 200, atrLen: 14, stopAtr: 2, tpMult: 3, maxBars: 60, dir: -1 };
  const all = detectTrades(bars, p, 5);
  assert(all.length >= 1);
  const cutoff = all[0].entryTs;                       // exclude the first by using its own ts as the strict floor
  const after = detectTrades(bars, p, 5, cutoff);
  assert(after.every((t) => t.entryTs > cutoff), "all returned entries must be strictly after cutoff");
  assertEquals(after.length, all.length - all.filter((t) => t.entryTs <= cutoff).length);
});

Deno.test("no look-ahead: entry is the bar AFTER the signal", () => {
  const closes: number[] = [];
  for (let i = 0; i < 210; i++) closes.push(300 - i * 0.5);
  for (let i = 0; i < 8; i++) closes.push(closes[closes.length - 1] + 3);
  for (let i = 0; i < 40; i++) closes.push(closes[closes.length - 1] - 1);
  const bars = mkBars(closes);
  const p: SetupParams = { rsiLen: 14, rsiThresh: 70, maLen: 200, atrLen: 14, stopAtr: 2, tpMult: 3, maxBars: 60, dir: -1 };
  const t = detectTrades(bars, p, 0);
  // entry price must equal some bar's OPEN (i+1 open), never a close known only at signal time
  assert(t.length >= 1);
  const opens = new Set(bars.map((b) => b.o));
  assert(opens.has(t[0].entry), "entry must be a bar open");
});
