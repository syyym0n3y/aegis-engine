import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Bar, enumerate, GRAMMAR, runComponent, runComponentTrades, specKey } from "./trd-grammar.ts";

Deno.test("enumerate covers the full product space and keys are unique", () => {
  const specs = enumerate();
  const expected = GRAMMAR.trigger.length * GRAMMAR.emaPeriod.length * GRAMMAR.trendMode.length * GRAMMAR.stopLookback.length * GRAMMAR.rr.length * GRAMMAR.session.length;
  assertEquals(specs.length, expected);
  assertEquals(new Set(specs.map(specKey)).size, specs.length);
});

Deno.test("Pranam's strategy is one point in the grammar (sweep + with-EMA + rr1)", () => {
  const specs = enumerate();
  const hit = specs.find((s) => s.trigger === "sweep" && s.trendMode === "with" && s.rr === 1 && s.emaPeriod === 30);
  assert(hit, "the liquidity-grab strategy must be expressible in the algebra");
});

Deno.test("inside-bar break: fires only on a real inside bar + break, in the break direction, no look-ahead", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "inside" as const, emaPeriod: 2, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 10 ascending, distinct-range filler bars (each higher H AND higher L → NEVER inside the prior → no trigger)
  const asc = (n: number): Bar[] => Array.from({ length: n }, (_, i) => { const p = 90 + i; return bar(p - 0.3, p + 0.5, p - 0.5, p + 0.2, i); });
  // …then a narrow MOTHER (110/104), an INSIDE bar (109/105), an up-BREAK close (111>110), and two bars to
  // fill (next-open) and resolve at the +1R target (entry 111, stop 104, risk 7, target 118).
  const up: Bar[] = [...asc(10), bar(105, 110, 104, 106, 10), bar(107, 109, 105, 108, 11), bar(108, 112, 107, 111, 12), bar(111, 114, 110, 113, 13), bar(118, 120, 117, 119, 14)];
  const tr = runComponentTrades(up, spec, { costRPerSide: 0 });
  assert(tr.length > 0, "inside-bar break should generate a trade on the up-break");
  assertEquals(tr[0].side, "long");
  // pure ascending (no inside bar ever) must produce ZERO inside-break trades
  const none = runComponentTrades(asc(14), spec, { costRPerSide: 0 });
  assertEquals(none.length, 0, "no inside bar → no inside-break trade");
});

Deno.test("channel (Donchian): fires only on a break of the prior 20-bar high, resolves long", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "channel" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 22 flat bars in a tight range (h=101,l=99) → NO close ever exceeds the prior-20 channel high (101) → no trigger…
  const flat: Bar[] = Array.from({ length: 22 }, (_, i) => bar(100, 101, 99, 100, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);
  // …then a decisive break above the 20-bar high (close 105 > 101), a fill bar, and a bar that reaches the +1R target.
  // entry ~ next open 104, stop = 3-bar swing low (~99), risk ~5, target ~109 → reached by the final bar's high 111.
  const brk: Bar[] = [...flat, bar(102, 105, 101, 105, 22), bar(104, 108, 103, 107, 23), bar(108, 111, 106, 110, 24)];
  const tr = runComponentTrades(brk, spec, { costRPerSide: 0 });
  assert(tr.length > 0, "a genuine 20-bar channel break should trade");
  assertEquals(tr[0].side, "long");
});

Deno.test("nbar reversal: fires only after 3 consecutive down-closes then an up-close, resolves long", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "nbar" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // pure ascending (never a down-close) must produce ZERO nbar trades…
  const asc: Bar[] = Array.from({ length: 14 }, (_, i) => { const p = 90 + i; return bar(p - 0.3, p + 0.5, p - 0.5, p + 0.2, i); });
  assertEquals(runComponentTrades(asc, spec, { costRPerSide: 0 }).length, 0);
  // …FLAT-close filler (no close change → no spurious up/down runs), then exactly 3 down-closes (99<100, 98.5<99,
  // 98<98.5) and an up-close trigger (99.5>98) → LONG, stop = 3-bar swing low (96). Fill next open (~99.6, risk ~3.6),
  // resolve at +1R (target ~103.2, reached by high 104).
  const flat: Bar[] = Array.from({ length: 10 }, (_, i) => bar(100, 101, 99, 100, i));
  const seq: Bar[] = [...flat,
    bar(100, 100.5, 96, 99.0, 10), bar(99.0, 99.2, 96, 98.5, 11), bar(98.5, 98.7, 96, 98.0, 12),
    bar(98.0, 100, 97.5, 99.5, 13), bar(99.6, 101, 99, 100.5, 14), bar(101, 104, 100, 103.5, 15)];
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assert(tr.length > 0, "3-down-then-up should trigger a reversal trade");
  assertEquals(tr[0].side, "long");
});

Deno.test("ssweep: fades a sweep of the PRIOR session's high (Asia high swept in London), resolves short", () => {
  const b = (hh: number, mm: number, o: number, h: number, l: number, c: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, hh, mm)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "ssweep" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 ASIA bars (04:00–06:45 UTC, all hour<7), session high=105, low=95. First asia bars have no prior session → no trigger.
  const asia: Bar[] = Array.from({ length: 12 }, (_, i) => {
    const hh = 4 + Math.floor((i * 15) / 60), mm = (i * 15) % 60;
    const h = i === 5 ? 105 : 102, l = i === 6 ? 95 : 98;                 // establish the session extremes
    return b(hh, mm, 100, h, l, 100);
  });
  // LONDON: a clean bar (no sweep), then a bar that WICKS above the Asia high (106>105) and CLOSES back inside (103<105)
  // → short, stop=106. Fill next open (102, risk 4), resolve at the −1R target (98) on the final bar's low (97).
  const london: Bar[] = [b(7, 0, 103, 104, 102, 103), b(7, 15, 103, 106, 102, 103), b(7, 30, 102, 103, 98, 99), b(7, 45, 99, 100, 97, 98)];
  const tr = runComponentTrades([...asia, ...london], spec, { costRPerSide: 0 });
  assert(tr.length > 0, "a sweep of the prior session's high should trade");
  assertEquals(tr[0].side, "short");
  // pure-Asia bars alone (no prior session to sweep) must yield ZERO trades
  assertEquals(runComponentTrades(asia, spec, { costRPerSide: 0 }).length, 0);
});

Deno.test("nr7: fires only when the prior bar is the narrowest of 7 and this bar breaks it, resolves long", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "nr7" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 11 flat filler bars (range 2, identical → no break of any prior bar → no trigger)…
  const flat: Bar[] = Array.from({ length: 11 }, (_, i) => bar(100, 101, 99, 100, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);
  // …then a NARROW bar (range 0.5 = narrowest of the last 7), an up-break of its range, fill, and +1R resolve.
  const seq: Bar[] = [...flat,
    bar(100, 100.25, 99.75, 100, 11),   // NR7 bar (range 0.5)
    bar(100, 101.5, 100, 101, 12),      // break: close 101 > 100.25 → long, stop 99.75
    bar(101, 102, 100.5, 101.5, 13),    // fill at open ~101, risk ~1.25, target ~102.25
    bar(101.5, 103, 101, 102.5, 14)];   // high 103 >= target → +1R
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assert(tr.length > 0, "NR7 compression break should trade");
  assertEquals(tr[0].side, "long");
});

Deno.test("runComponent produces trades and applies cost", () => {
  // synthetic trending bars with noise → breakout trigger should fire some trades
  const bars: Bar[] = [];
  for (let i = 0; i < 300; i++) { const dip = (i % 12) < 3 ? -4 : 0; const p = 100 + i * 1.5 + dip; bars.push({ ts: new Date(Date.UTC(2026, 0, 1, 0, i * 15 % 1440)).toISOString(), open: p - 0.3, high: p + 0.6, low: p - 0.6, close: p + 0.3 }); }
  const spec = { trigger: "breakout" as const, emaPeriod: 30, trendMode: "with" as const, stopLookback: 5, rr: 1, session: "all" as const };
  const free = runComponent(bars, spec, { costRPerSide: 0 });
  const costly = runComponent(bars, spec, { costRPerSide: 0.1 });
  assert(free.length > 0, "expected some trades");
  assertEquals(free.length, costly.length);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  assert(sum(costly) < sum(free), "cost must reduce total R");
});
