import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Bar, clearEmaCache, enumerate, GRAMMAR, runComponent, runComponentTrades, specKey } from "./trd-grammar.ts";
const WIDE100_MIN = 100;

Deno.test("enumerate covers the full product space and keys are unique", () => {
  const specs = enumerate();
  const expected = GRAMMAR.trigger.length * GRAMMAR.emaPeriod.length * GRAMMAR.trendMode.length * GRAMMAR.stopLookback.length * GRAMMAR.rr.length * GRAMMAR.session.length * GRAMMAR.stopMode.length;
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

Deno.test("riskFrac reports 1R as a fraction of notional (bps→R conversion, D-303)", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "inside" as const, emaPeriod: 2, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // Same construction as the inside-bar test: mother 110/104, inside 109/105, up-break close 111,
  // fill at the NEXT bar's open (111), stop = mother low 104 → risk 7 on a 111 entry → riskFrac ≈ 0.0631.
  const asc = (n: number): Bar[] => Array.from({ length: n }, (_, i) => { const p = 90 + i; return bar(p - 0.3, p + 0.5, p - 0.5, p + 0.2, i); });
  const up: Bar[] = [...asc(10), bar(105, 110, 104, 106, 10), bar(107, 109, 105, 108, 11), bar(108, 112, 107, 111, 12), bar(111, 114, 110, 113, 13), bar(118, 120, 117, 119, 14)];
  const tr = runComponentTrades(up, spec, { costRPerSide: 0 });
  assert(tr.length > 0);
  const t = tr[0];
  assert(Math.abs(t.riskFrac - 7 / 111) < 1e-9, `riskFrac ${t.riskFrac} != ${7 / 111}`);
  // the whole point: a 10bp/side fee costs (0.0010/riskFrac) R per side — here ~0.016R, but a stop 10x
  // tighter would cost ~0.16R/side. The flat cost constant cannot express that.
  assert((0.0010 / t.riskFrac) > 0, "bps→R conversion must be finite and positive");
});

Deno.test("star: morning star fires only on large-down → small-body → up-close-above-midpoint, resolves long", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "star" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 NEUTRAL filler bars, all with the SAME small body → body(i-1) is never < 0.5·body(i-2) → no star can fire.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100.1, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);
  const seq: Bar[] = [...flat,
    bar(100, 100.2, 96, 96.5, 12),      // i-2: large DOWN body 3.5 → midpoint 98.25
    bar(96.4, 96.9, 95.9, 96.5, 13),    // i-1: the STAR, body 0.1 < 0.5·3.5
    bar(96.6, 99, 96.5, 98.5, 14),      // i: UP close 98.5 > midpoint 98.25 → LONG, stop = 95.9
    bar(98.6, 99, 98.4, 98.8, 15),      // fill at open 98.6 → risk 2.7, target 101.3
    bar(98.8, 101.5, 98.7, 101.4, 16)]; // high 101.5 >= target → +1R
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);
  // NEGATIVE control: same 3-candle geometry but the confirming close stops SHORT of the midpoint → no reversal.
  const weak: Bar[] = [...flat,
    bar(100, 100.2, 96, 96.5, 12),
    bar(96.4, 96.9, 95.9, 96.5, 13),
    bar(96.6, 98, 96.5, 97.5, 14),      // close 97.5 < midpoint 98.25 → must NOT fire
    bar(97.6, 98, 97.4, 97.8, 15),
    bar(97.8, 101.5, 97.7, 101.4, 16)];
  assertEquals(runComponentTrades(weak, spec, { costRPerSide: 0 }).length, 0);
});

Deno.test("soldiers: three white soldiers fire only on 3 strong same-colour advancing bodies opening inside the prior body", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "soldiers" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 NEUTRAL filler bars: body 0.1 on a range of 1.0 → `strong` (body >= half range) fails → no soldier ever fires.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100.1, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);
  const seq: Bar[] = [...flat,
    bar(100.2, 101.1, 100.1, 101.0, 12), // soldier 1: body 0.8 of range 1.0
    bar(100.6, 101.9, 100.5, 101.8, 13), // soldier 2: opens inside (100.2,101.0), body 1.2 of range 1.4, closes higher
    bar(101.2, 102.8, 101.1, 102.7, 14), // soldier 3: opens inside (100.6,101.8), body 1.5 of range 1.7 → LONG, stop 100.1
    bar(102.8, 103.2, 102.5, 103.0, 15), // fill at open 102.8 → risk 2.7, target 105.5; neither touched here
    bar(103.0, 105.6, 102.9, 105.5, 16)]; // high 105.6 >= target → +1R
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);
  // NEGATIVE control A — the staircase is broken: soldier 2 GAPS above soldier 1's body instead of opening inside it.
  const gapped: Bar[] = [...flat,
    bar(100.2, 101.1, 100.1, 101.0, 12),
    bar(101.3, 101.9, 101.2, 101.8, 13), // open 101.3 is ABOVE soldier 1's body top (101.0) → must NOT fire
    bar(101.4, 102.8, 101.3, 102.7, 14),
    bar(102.8, 103.8, 102.7, 102.9, 15), // deliberately weak-bodied so no later triple can fire either
    bar(102.9, 103.9, 102.8, 103.0, 16)];
  assertEquals(runComponentTrades(gapped, spec, { costRPerSide: 0 }).length, 0);
  // NEGATIVE control B — same staircase and advancing closes, but the middle candle is a long-wicked doji
  // (body 0.6 of range 2.1) → it is not a "soldier", so the continuation is unconfirmed.
  const weakBody: Bar[] = [...flat,
    bar(100.2, 101.6, 100.1, 101.5, 12), // body 1.3 of range 1.5
    bar(101.0, 103.0, 100.9, 101.6, 13), // opens inside, closes higher, but body 0.6 < 0.5*2.1 → must NOT fire
    bar(101.3, 102.8, 101.2, 102.7, 14),
    bar(102.8, 103.8, 102.7, 102.9, 15),
    bar(102.9, 103.9, 102.8, 103.0, 16)];
  assertEquals(runComponentTrades(weakBody, spec, { costRPerSide: 0 }).length, 0);
});

Deno.test("choch: fires only when a range break REVERSES an established structure", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "choch" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 NEUTRAL filler bars, all with IDENTICAL highs and lows → the strict fractal comparisons
  // (`high > neighbour.high`) can never hold, so the filler contains no pivots and defines no structure.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100.1, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);

  // DOWN structure: swing high 108 (idx 14) → low 98 (17) → LOWER high 106 (20) → LOWER low 96 (23),
  // then bar 26 closes 107.5, back above the most recent swing high → CHoCH long, stop at the 96 swing low.
  const down: Bar[] = [...flat,
    bar(101, 102, 101, 101.8, 12), bar(103, 104, 103, 103.8, 13),
    bar(107, 108, 107, 107.8, 14), // H1 = 108
    bar(104, 105, 104, 104.8, 15), bar(102, 103, 102, 102.8, 16),
    bar(100, 101, 98, 100.5, 17), // L1 = 98
    bar(101, 103, 100, 102.5, 18), bar(103, 104, 102, 103.5, 19),
    bar(105, 106, 104, 105.5, 20), // H0 = 106 (lower high)
    bar(102, 103, 101, 102.5, 21), bar(100, 101, 99, 100.5, 22),
    bar(98, 99, 96, 98.5, 23), // L0 = 96 (lower low) → structure is DOWN
    bar(99, 101, 98, 100.5, 24), bar(101, 103, 100, 102, 25),
    bar(105, 108, 104, 107.5, 26), // close 107.5 > H0 106 → CHoCH LONG, stop 96
    bar(107.5, 108, 107, 107.8, 27), // fill at open 107.5 → risk 11.5, target 119.0; neither touched
    bar(107.8, 119.5, 107.5, 119.2, 28)]; // high 119.5 >= target → +1R
  const tr = runComponentTrades(down, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);

  // NEGATIVE CONTROL A — isolates the STRUCTURE-DIRECTION requirement. Identical mechanics, but the pivots
  // form an UP structure (higher high 108 after 106, higher low 100.5 after 99) and price breaks ABOVE the
  // most recent swing high. That is a plain BOS/continuation, not a change of character → must NOT fire.
  const up: Bar[] = [...flat,
    bar(101, 102, 101, 101.8, 12), bar(103, 104, 103, 103.8, 13),
    bar(105, 106, 105, 105.8, 14), // H1 = 106
    bar(103, 104, 103, 103.8, 15), bar(102, 103, 102, 102.8, 16),
    bar(101, 102, 99, 101.5, 17), // L1 = 99
    bar(102, 104, 101, 103.5, 18), bar(104, 105, 103, 104.5, 19),
    bar(107, 108, 106, 107.5, 20), // H0 = 108 (HIGHER high)
    bar(104, 105, 103, 104.5, 21), bar(103, 104, 102, 103.5, 22),
    bar(101, 103, 100.5, 102.5, 23), // L0 = 100.5 (HIGHER low) → structure is UP
    bar(102, 104, 101, 103.5, 24), bar(104, 106, 103, 105, 25),
    bar(107, 110, 106, 109.5, 26), // breaks above H0 108 — continuation, not a reversal
    bar(109.5, 110, 109, 109.8, 27), bar(109.8, 111, 109.5, 110.5, 28)];
  assertEquals(runComponentTrades(up, spec, { costRPerSide: 0 }).length, 0);

  // NEGATIVE CONTROL B — isolates the STRUCTURE-EXISTS requirement. Same lower-high (106 after 108) and the
  // same break above it, but the lows CONTRACT instead of falling (99 after 98) → neither an up nor a down
  // structure is established, so there is no character to change → must NOT fire.
  const mixed: Bar[] = [...flat,
    bar(101, 102, 101, 101.8, 12), bar(103, 104, 103, 103.8, 13),
    bar(107, 108, 107, 107.8, 14), // H1 = 108
    bar(104, 105, 104, 104.8, 15), bar(102, 103, 102, 102.8, 16),
    bar(100, 101, 98, 100.5, 17), // L1 = 98
    bar(101, 103, 100, 102.5, 18), bar(103, 104, 102, 103.5, 19),
    bar(105, 106, 104, 105.5, 20), // H0 = 106 (lower high — same as the positive case)
    bar(102, 103, 101, 102.5, 21), bar(100.8, 101, 100.5, 100.9, 22),
    bar(100, 100.2, 99, 99.5, 23), // L0 = 99 — HIGHER than L1, so the lows contract
    bar(99.6, 101, 99.5, 100.5, 24), bar(101, 103, 100, 102, 25),
    bar(105, 108, 104, 107.5, 26), // same break above 106, but structure is neither up nor down
    bar(107.5, 108, 107, 107.8, 27), bar(107.8, 109, 107.5, 108.5, 28)];
  assertEquals(runComponentTrades(mixed, spec, { costRPerSide: 0 }).length, 0);
});

// ---- D-305: stop GEOMETRY as a grammar axis -------------------------------------------------------------
// Deterministic LCG walk → realistic oscillating bars (no Math.random, so the tests are reproducible).
function walkBars(n: number, seed = 12345): Bar[] {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out: Bar[] = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = p * (1 + (rnd() - 0.5) * 0.02);
    const hi = Math.max(o, c) * (1 + rnd() * 0.006), lo = Math.min(o, c) * (1 - rnd() * 0.006);
    out.push({ ts: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(), open: o, high: hi, low: lo, close: c });
    p = c;
  }
  return out;
}

Deno.test("specKey + enumerate are backwards-compatible: swing mode keys exactly as before D-305", () => {
  const legacy = { trigger: "sweep" as const, emaPeriod: 20, trendMode: "with" as const, stopLookback: 5, rr: 1, session: "all" as const };
  assertEquals(specKey(legacy), "sweep|ema20|with|sl5|rr1|all");
  assertEquals(specKey({ ...legacy, stopMode: "swing" as const }), specKey(legacy)); // absent === "swing"
  assertEquals(specKey({ ...legacy, stopMode: "atr12" as const }), "sweep|ema20|with|sl5|rr1|all|atr12");
  const specs = enumerate();
  // swing rung is untouched: the full |trigger|·3·3·3·5·4 product, every key a legacy 6-part key. Derived from
  // GRAMMAR.trigger.length, not hardcoded, so adding a trigger cannot silently drop the rung out of the product.
  const perMode = GRAMMAR.trigger.length * 3 * 3 * 3 * 5 * 4;
  const swing = specs.filter((x) => x.stopMode === "swing");
  assertEquals(swing.length, perMode);
  assert(swing.every((x) => specKey(x).split("|").length === 6), "swing keys must stay 6-part");
  assertEquals(new Set(specs.map(specKey)).size, specs.length, "all spec keys unique");
  // every stop mode carries the FULL product (the dedup shortcut was falsified — see the regression guard).
  for (const m of GRAMMAR.stopMode) assertEquals(specs.filter((x) => x.stopMode === m).length, perMode, `mode ${m}`);
});

Deno.test("REGRESSION GUARD: stopLookback is NOT a no-op outside swing mode (the falsified dedup shortcut)", () => {
  // It is tempting to pin stopLookback for the 12 triggers that don't use it in their SIGNAL, since a non-swing
  // mode overrides the stop anyway — that would have cut the seed 2.4x. It is WRONG: triggerSignal bails on
  // `i < max(stopLookback,3)`, suppressing early signals, and one suppressed entry re-phases every later trade
  // (a new signal is blocked while a trade is open). This test fails if anyone re-introduces the shortcut.
  const bars = walkBars(600);
  const diverged: string[] = [];
  for (const trigger of GRAMMAR.trigger) {
    const mk = (sl: number) => ({ trigger, emaPeriod: 20, trendMode: "none" as const, stopLookback: sl, rr: 2, session: "all" as const, stopMode: "atr6" as const });
    const a = runComponentTrades(bars, mk(3), { costRPerSide: 0 });
    const b = runComponentTrades(bars, mk(10), { costRPerSide: 0 });
    if (a.length !== b.length || a.some((t, i) => t.entryTs !== b[i]?.entryTs)) diverged.push(trigger);
  }
  assert(diverged.length > 0, "expected stopLookback to still matter under atr6 for at least some triggers");
});

Deno.test("atr stop mode widens riskFrac exactly as specified, and monotonically in the multiple", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  // 12 neutral fillers with a KNOWN true range of 1.0, then an inside-bar break → one long trade.
  // Every bar's TRUE RANGE is exactly 1.0 → ATR(14) at the signal bar is exactly 1.0, so the expected stops
  // are known in closed form and the assertions below are not circular.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100, i));
  const seq: Bar[] = [...flat,
    bar(100, 100.5, 99.5, 100, 12),    // mother (TR 1)
    bar(100, 100.5, 99.5, 100, 13),    // inside bar (equal extremes still counts as inside; TR 1)
    bar(100, 101, 100, 100.8, 14),     // TR 1; close 100.8 > mother high 100.5 → LONG, trigger stop = 99.5
    bar(100.9, 101, 100.5, 100.7, 15), // fill at open 100.9
    bar(100.7, 200, 50, 100.8, 16)];   // huge range → stop-first exit in EVERY mode, so each trade closes
  const mk = (stopMode: "swing" | "atr2" | "atr6" | "atr12") => ({ trigger: "inside" as const, emaPeriod: 2, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const, stopMode });
  const fr = (m: "swing" | "atr2" | "atr6" | "atr12") => { const t = runComponentTrades(seq, mk(m), { costRPerSide: 0 }); assert(t.length === 1, `${m} should produce exactly 1 trade, got ${t.length}`); return t[0].riskFrac; };
  const sw = fr("swing"), a2 = fr("atr2"), a6 = fr("atr6"), a12 = fr("atr12");
  // ATR(14) here is 1.0 (every bar's true range is 1.0), entry 100.9 → atr12 stop = 100.9 − 12 = 88.9, risk 12.
  assert(Math.abs(a12 - 12 / 100.9) < 1e-9, `atr12 riskFrac ${a12} != ${12 / 100.9}`);
  assert(Math.abs(a2 - 2 / 100.9) < 1e-9, `atr2 riskFrac ${a2} != ${2 / 100.9}`);
  assert(sw < a2 && a2 < a6 && a6 < a12, `riskFrac must widen monotonically: ${sw} ${a2} ${a6} ${a12}`);
  // THE POINT (D-303): a 20bp/side round trip costs (0.40% / riskFrac) in R, so cost falls exactly in
  // proportion to the widening. (This fixture is synthetic — the claim that TODAY's live stops are fee-lethal
  // rests on the measured 0.16-0.25% ATR/price on real 15m crypto, not on these bars.)
  const costR = (f: number) => 0.0040 / f;
  assert(Math.abs(costR(sw) / costR(a12) - a12 / sw) < 1e-9, "cost must be exactly inversely proportional to riskFrac");
  assert(costR(a12) < costR(a6) && costR(a6) < costR(a2) && costR(a2) < costR(sw), "widening must monotonically reduce cost in R");
  assert(costR(a12) < 0.05, `atr12 must be affordable, got ${costR(a12).toFixed(3)}R`);
});

Deno.test("wide100 needs 100 bars of history and never returns a stop tighter than the trigger's own", () => {
  const bars = walkBars(400);
  const mk = (stopMode: "swing" | "wide100") => ({ trigger: "rsi" as const, emaPeriod: 20, trendMode: "none" as const, stopLookback: 5, rr: 2, session: "all" as const, stopMode });
  const sw = runComponentTrades(bars, mk("swing"), { costRPerSide: 0 });
  const wd = runComponentTrades(bars, mk("wide100"), { costRPerSide: 0 });
  assert(sw.length > 0 && wd.length > 0, "expected trades in both modes");
  // every wide100 trade is at least as wide as the swing trade it corresponds to (same entry timestamp)
  const swBy = new Map(sw.map((t) => [t.entryTs, t.riskFrac]));
  let compared = 0;
  for (const t of wd) { const s = swBy.get(t.entryTs); if (s !== undefined) { assert(t.riskFrac >= s - 1e-12, `wide100 narrower than swing at ${t.entryTs}`); compared++; } }
  assert(compared > 0, "expected overlapping entries to compare");
  // signals inside the first 100 bars are DROPPED (history requirement), never silently narrowed
  assert(wd.every((t) => new Date(t.entryTs).getTime() >= new Date(bars[WIDE100_MIN].ts).getTime()), "wide100 must not fill before 100 bars of history");
});

// D-310 — the indicator caches must be keyed on the bars ARRAY, never on bars.length. Every market in
// trd_bars_cache holds exactly 35,040 bars, so a length-derived key collided across all 16 markets and a
// warm edge-function isolate served the FIRST market's EMA/RSI to every market after it. Measured on the
// pre-fix code: `rsi` fabricated 10 trades on a market whose own RSI produced 0, and `pullback` erased all
// 36 of a market's real trades. This test scores market B cold, then scores market A to warm the cache, then
// re-scores B on the SAME warm state — the two B runs must be byte-identical trade-for-trade.
Deno.test("indicator caches are market-identity-keyed, not length-keyed (no cross-market bleed)", () => {
  const series = (n: number, f: (i: number) => number): Bar[] =>
    Array.from({ length: n }, (_, i) => {
      const c = f(i), o = f(Math.max(0, i - 1));
      return { ts: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(), open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c };
    });
  const N = 400; // identical length for both markets — the exact condition that made the old key collide
  const A = series(N, (i) => 100 + 10 * Math.sin(i / 7) + i * 0.01);
  const B = series(N, (i) => 250 + 40 * Math.sin(i / 3.1) - i * 0.05);
  const sig = (ts: { entryTs: string; exitTs: string; r: number }[]) => ts.map((t) => `${t.entryTs}>${t.exitTs}:${t.r.toFixed(6)}`).join(",");
  // both cache consumers: `rsi` reads the RSI series, `pullback` reads the EMA series
  for (const trigger of ["rsi", "pullback"] as const) {
    const spec = { trigger, emaPeriod: 20, trendMode: "none" as const, stopLookback: 5, rr: 1, session: "all" as const };
    clearEmaCache();
    const cold = sig(runComponentTrades(B, spec, { costRPerSide: 0 }));
    clearEmaCache();
    runComponentTrades(A, spec, { costRPerSide: 0 });                  // market A warms the shared cache
    const warm = sig(runComponentTrades(B, spec, { costRPerSide: 0 })); // market B on that warm cache
    assertEquals(warm, cold, `${trigger}: market B's trades changed after market A warmed the cache`);
  }
  // and the memoization still HITS (same array object → one computed series reused across specs)
  clearEmaCache();
  const s1 = { trigger: "pullback" as const, emaPeriod: 20, trendMode: "none" as const, stopLookback: 5, rr: 1, session: "all" as const };
  const first = sig(runComponentTrades(A, s1, { costRPerSide: 0 }));
  assertEquals(sig(runComponentTrades(A, s1, { costRPerSide: 0 })), first, "same market must be stable across repeat runs");
});

Deno.test("supertrend: flips on a VOLATILITY-NORMALISED breach, not on an absolute move", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "supertrend" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 25 NEUTRAL filler bars of IDENTICAL shape → ATR(10) settles at 1.0, the bands sit at mid±3 = 103/97, and the
  // close never breaches either, so the state is seeded up at bar 11 and never flips inside the filler.
  const calm: Bar[] = Array.from({ length: 25 }, (_, i) => bar(100, 100.5, 99.5, 100, i));
  assertEquals(runComponentTrades(calm, spec, { costRPerSide: 0 }).length, 0);

  // A close at 90 breaches the lower band (97) → state flips UP→DOWN → SHORT, stop at the upper band, entry at
  // the next bar's open. Exit is booked at the target price itself, so the R is exactly +1 whatever the band value.
  const drop: Bar[] = [...calm,
    bar(100, 100.2, 89, 90, 25),   // flip bar: close 90 < lower band 97
    bar(90, 92, 88, 89, 26),       // fill at open 90 (entry bar cannot also exit)
    bar(89, 89, 60, 61, 27)];      // low sweeps through the target, high never reaches the stop → +1R
  const tr = runComponentTrades(drop, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "short");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);

  // NEGATIVE CONTROL A — the move is too SMALL to breach the band. Same calm prelude, close 98 > lower band 97.
  assertEquals(runComponentTrades([...calm, bar(100, 100.2, 97.5, 98, 25), bar(98, 99, 97, 98, 26), bar(98, 99, 60, 61, 27)], spec, { costRPerSide: 0 }).length, 0);

  // NEGATIVE CONTROL B — the one that proves the signal is NORMALISED and not a fixed threshold: the IDENTICAL
  // 10-point drop to a close of 90, but after a prelude whose ATR is 8 instead of 1. The lower band now sits at
  // 76, so the same absolute move is unremarkable relative to volatility → must NOT fire. A raw `breakout`/`nbar`
  // trigger cannot tell these two cases apart; that difference is the whole reason this primitive is new.
  const wild: Bar[] = Array.from({ length: 25 }, (_, i) => bar(100, 104, 96, 100, i));
  assertEquals(runComponentTrades(wild, spec, { costRPerSide: 0 }).length, 0);
  assertEquals(runComponentTrades([...wild, bar(100, 101, 89, 90, 25), bar(90, 92, 88, 89, 26), bar(89, 89, 60, 61, 27)], spec, { costRPerSide: 0 }).length, 0);
});

Deno.test("squeeze: fires on a RATIO release (BB escaping KC), not on absolute range compression", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "squeeze" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 40 bars that TRAVEL 8 points each but always CLOSE at 100 → stdev(close)=0 so BB half-width=0, while ATR
  // settles at 8 so KC half-width=12. BB is inside KC → squeeze ON for every defined bar, and the state is only
  // defined from index SQ_WARM=39, so the prelude alone can never contain a release.
  const churn: Bar[] = Array.from({ length: 40 }, (_, i) => bar(100, 104, 96, 100, i));
  assertEquals(runComponentTrades(churn, spec, { costRPerSide: 0 }).length, 0);

  // RELEASE at index 40: a close of 60 makes stdev 8.718 → BB half 17.44, while ATR only rises to 9.65 → KC half
  // 14.475. BB now escapes KC → on flips 1→0 → SHORT (close 60 below the 98 basis), stop at the upper Keltner
  // band 112.475. Fill at the next bar's open (60), so 1R = 52.475 and the target is 7.525.
  const rel: Bar[] = [...churn,
    bar(100, 100, 59, 60, 40),   // release bar
    bar(60, 62, 58, 59, 41),     // fill at open 60 (an entry bar can never also exit)
    bar(59, 59, 5, 6, 42)];      // low sweeps the target, high never reaches the stop → +1R
  const tr = runComponentTrades(rel, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "short");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);

  // NEGATIVE CONTROL A — the one that carries the weight. Bars of range 1.0 (eight times TIGHTER in absolute
  // terms than the churn prelude) but whose closes march +3 per bar: stdev 17.3 → BB half 34.6 vs KC half ~5.25,
  // so BB is OUTSIDE KC and the market was never squeezed. The IDENTICAL drop must therefore produce no trade.
  // `nr7`/`inside`/`delivery` read this prelude as maximally compressed; the ratio says the opposite.
  const march: Bar[] = Array.from({ length: 40 }, (_, i) => { const c = 100 + 3 * i; return bar(c, c + 0.5, c - 0.5, c, i); });
  const last = 100 + 3 * 39;
  assertEquals(runComponentTrades([...march,
    bar(last, last, last - 41, last - 40, 40), bar(last - 40, last - 38, last - 42, last - 41, 41), bar(last - 41, last - 41, 5, 6, 42)],
    spec, { costRPerSide: 0 }).length, 0);

  // NEGATIVE CONTROL B — squeezed, but the move is too small to RELEASE: a close of 90 gives BB half 4.36, still
  // inside KC half 12.2, so the state stays ON and no trade is taken. Proves the trigger is the release event,
  // not merely "a big bar during a squeeze".
  assertEquals(runComponentTrades([...churn,
    bar(100, 100, 89, 90, 40), bar(90, 92, 88, 89, 41), bar(89, 89, 5, 6, 42)],
    spec, { costRPerSide: 0 }).length, 0);
});

Deno.test("rsidiv: fires on price/momentum DISAGREEMENT, not on a lower low and not on an RSI level", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "rsidiv" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  const mk = (cs: number[]): Bar[] => cs.map((c, i) => bar(c, c + 0.2, c - 0.2, c, i));
  // 20 alternating bars around 100. Both gains and losses are non-zero so RSI warms to ~50, and because a
  // fractal pivot needs a STRICT inequality against both neighbours, equal alternating values can never
  // produce one — the prelude is guaranteed pivot-free, so nothing can fire inside it.
  const filler = () => { const a: number[] = []; for (let i = 0; i < 20; i++) a.push(i % 2 === 0 ? 100 : 99.5); return a; };

  // BULLISH DIVERGENCE. Leg A is STEEP (−2/bar × 5) into a trough at close 89.5 / low 89.30; the rally lifts
  // RSI; leg B is SHALLOW (−1.625/bar × 4) into a LOWER trough at close 89.0 / low 88.80. Measured on these
  // exact bars: pivot A = low 89.30, RSI 16.77; pivot B = low 88.80, RSI 30.08 — price lower, momentum higher.
  const base = filler();
  for (let i = 1; i <= 5; i++) base.push(99.5 - 2 * i);
  for (let i = 1; i <= 6; i++) base.push(89.5 + i);
  for (let i = 1; i <= 4; i++) base.push(95.5 - 1.625 * i);
  for (let i = 1; i <= 6; i++) base.push(89.0 + 1.2 * i);
  const tr = runComponentTrades(mk(base), spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);
  // Pivot B is at index 34, so it is CONFIRMED at bar 36 (k+L) and filled at bar 37's open — the first bar on
  // which the divergence is knowable, never earlier. Pinning riskFrac pins BOTH: entry = close[37] = 92.6 and
  // stop = the pivot low 88.80. If the detector ever fired on the pivot bar itself this value would change.
  assert(Math.abs(tr[0].riskFrac - 3.8 / 92.6) < 1e-9, `entry/stop moved: riskFrac=${tr[0].riskFrac}`);

  // NEGATIVE CONTROL A — the one that carries the weight. The SAME structural feature (a confirmed swing low
  // that is LOWER than the prior swing low) but with the legs' force reversed: leg A gentle (−1/bar), leg B
  // steep (−2.5/bar). Measured: pivot A = low 94.30, RSI 24.71; pivot B = low 88.30, RSI 23.46 — price lower
  // AND momentum lower, so there is no disagreement and no trade. `breakout`/`nbar`/`sweep` read this exactly
  // as they read the base case; that difference is the entire reason this primitive is new.
  const ctrlA = filler();
  for (let i = 1; i <= 5; i++) ctrlA.push(99.5 - i);
  for (let i = 1; i <= 4; i++) ctrlA.push(94.5 + i);
  for (let i = 1; i <= 4; i++) ctrlA.push(98.5 - 2.5 * i);
  for (let i = 1; i <= 6; i++) ctrlA.push(88.5 + 1.2 * i);
  assertEquals(runComponentTrades(mk(ctrlA), spec, { costRPerSide: 0 }).length, 0);
  // …and on those IDENTICAL bars the plain `rsi` level-cross trigger takes two longs. Same data, opposite
  // verdicts: `rsidiv` is not a re-skin of `rsi` (it reads no threshold at all).
  assertEquals(runComponentTrades(mk(ctrlA), { ...spec, trigger: "rsi" as const }, { costRPerSide: 0 }).length, 2);

  // NEGATIVE CONTROL B — pins the PRICE side. Momentum disagrees the right way (pivot B RSI 32.85 > pivot A
  // 16.77) but price prints a HIGHER low (90.30 vs 89.30) = ordinary bullish structure, not a divergence.
  const ctrlB = filler();
  for (let i = 1; i <= 5; i++) ctrlB.push(99.5 - 2 * i);
  for (let i = 1; i <= 6; i++) ctrlB.push(89.5 + i);
  for (let i = 1; i <= 4; i++) ctrlB.push(95.5 - 1.25 * i);
  for (let i = 1; i <= 6; i++) ctrlB.push(90.5 + 1.2 * i);
  assertEquals(runComponentTrades(mk(ctrlB), spec, { costRPerSide: 0 }).length, 0);

  // MIRROR — the short branch, tested without hand-building a second fixture. Reflecting every price through
  // 200 maps lows↔highs and RSI r↔100−r exactly, so the bullish base case becomes a textbook bearish
  // divergence (higher swing high at 111.20 with RSI 69.92 vs 110.70 at RSI 83.23).
  const mtr = runComponentTrades(mk(base.map((c) => 200 - c)), spec, { costRPerSide: 0 });
  assertEquals(mtr.length, 1);
  assertEquals(mtr[0].side, "short");
  assert(Math.abs(mtr[0].r - 1) < 1e-9, `expected +1R, got ${mtr[0].r}`);
});

Deno.test("stoch: fires on POSITION-within-range, a quantity `rsi` structurally cannot see", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "stoch" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  const mk = (cs: number[]): Bar[] => cs.map((c, i) => bar(c, c + 0.2, c - 0.2, c, i));
  // 20 alternating bars around 100. MEASURED: %K alternates 59.26/40.74 and %D 53.09/46.91, so %K crosses %D
  // in BOTH directions every other bar — the prelude is saturated with crossings and still fires nothing,
  // because none of them happens in the 20/80 zone. That is the zone gate under test, not an absence of events.
  const filler = () => { const a: number[] = []; for (let i = 0; i < 20; i++) a.push(i % 2 === 0 ? 100 : 99.5); return a; };
  assertEquals(runComponentTrades(mk(filler()), spec, { costRPerSide: 0 }).length, 0);

  // BASE LONG. A −1/bar slide drives %K to 2.56 (deeply oversold, below %D 2.99), then the first up close at
  // index 28 lifts %K to 7.96 above %D 4.49 = the handover. Fill at index 29's open 94.0; the stop is the
  // 3-bar swing low 91.3, so 1R = 2.7 and the target 96.7 is swept by index 30.
  const tail = [98.5, 97.5, 96.5, 95.5, 94.5, 93.5, 92.5, 91.5, 93, 94, 98];
  const base = [...filler(), ...tail];
  const tr = runComponentTrades(mk(base), spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);
  // Pins entry AND stop: if the detector ever fired on a different bar this value moves.
  assert(Math.abs(tr[0].riskFrac - 2.7 / 94) < 1e-9, `entry/stop moved: riskFrac=${tr[0].riskFrac}`);
  // …and plain `rsi` takes NOTHING on these exact bars — %K reached its extreme while RSI never crossed 30.
  assertEquals(runComponentTrades(mk(base), { ...spec, trigger: "rsi" as const }, { costRPerSide: 0 }).length, 0);

  // THE CONTROL THAT CARRIES THE WEIGHT. Byte-identical CLOSES to the base case; the ONLY change is one bar's
  // LOW, deepened to 80 (a capitulation wick). RSI is a function of closes alone, so it is unchanged BY
  // CONSTRUCTION — and indeed still takes 0 trades. `stoch` inverts completely: the deep floor puts the same
  // closes near the TOP of the 14-bar band (%K 81.68 at index 23), so what was an oversold long becomes an
  // overbought SHORT at index 24 — fill 93.5, stop at the 3-bar swing high 97.7, stopped out for −1R.
  // No trigger that reads closes, or absolute range, can produce this flip; that is the whole reason the
  // primitive is new.
  const wick = mk(base); wick[20] = bar(99.5, 98.7, 80, 98.5, 20);
  const wtr = runComponentTrades(wick, spec, { costRPerSide: 0 });
  assertEquals(wtr.length, 1);
  assertEquals(wtr[0].side, "short");
  assert(Math.abs(wtr[0].r + 1) < 1e-9, `expected −1R, got ${wtr[0].r}`);
  assert(Math.abs(wtr[0].riskFrac - 4.2 / 93.5) < 1e-9, `entry/stop moved: riskFrac=${wtr[0].riskFrac}`);
  assertEquals(runComponentTrades(wick, { ...spec, trigger: "rsi" as const }, { costRPerSide: 0 }).length, 0);

  // SECOND CONTROL — the verdict pair inverted the other way, on a different path: a shallow −0.5/bar decline
  // sitting above a deep floor. Closes fall far enough for RSI to cross back up through 30 (1 long), while %K
  // never leaves the 56–72 band, so `stoch` takes nothing. Base case: stoch 1 / rsi 0. Here: stoch 0 / rsi 1.
  const ctrl: Bar[] = mk(filler());
  [95, 94.5, 94, 93.5, 93, 92.5, 92, 91.5, 93, 94, 98].forEach((c, j) => {
    const i = 20 + j; ctrl.push(j === 0 ? bar(99.5, 99.6, 80, c, i) : bar(c, c + 0.2, c - 0.2, c, i));
  });
  assertEquals(runComponentTrades(ctrl, spec, { costRPerSide: 0 }).length, 0);
  assertEquals(runComponentTrades(ctrl, { ...spec, trigger: "rsi" as const }, { costRPerSide: 0 }).length, 1);

  // MIRROR — the short branch. Reflecting every price through 200 maps lows↔highs exactly, so %K ↦ 100−%K and
  // the oversold cross-up becomes a textbook overbought cross-down.
  const mtr = runComponentTrades(mk(base.map((c) => 200 - c)), spec, { costRPerSide: 0 });
  assertEquals(mtr.length, 1);
  assertEquals(mtr[0].side, "short");
  assert(Math.abs(mtr[0].r - 1) < 1e-9, `expected +1R, got ${mtr[0].r}`);
});

Deno.test("macd: fires on the SECOND DERIVATIVE — a decelerating advance, not a price level or an MA touch", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  // `atr6` stop mode is used deliberately: the SHORT below happens while price is printing a new high on every
  // bar, so a swing-high stop would have to come from an upper WICK — and a wick that closes back inside the
  // prior range is exactly what `sweep` fades, confounding the control. With an ATR stop the fixture needs no
  // wicks at all, so every bar is a clean monotone up-bar and no wick-fade trigger can fire.
  const spec = { trigger: "macd" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const, stopMode: "atr6" as const };
  // 92 bars of IDENTICAL closes: EMA12 and EMA26 are seeded at the same value and fed the same constant, so
  // they are equal bar-for-bar → the MACD line is exactly 0 and so is its 9-bar signal. Two speeds that have
  // not separated cannot cross, so the warm-up window is provably signal-free (m0 > s0 is 0 > 0 = false).
  // It also clears MACD_WARM = 3·26 + 9 = 87 before the first tradeable bar.
  // Then a 20-bar +4/bar advance, then `slope2` per bar for 8 bars, then one resolution bar.
  const build = (slope2: number): Bar[] => {
    const bs: Bar[] = []; let i = 0;
    for (; i < 92; i++) bs.push(bar(100, 100.2, 99.8, 100, i));
    let c = 100;
    for (let k = 0; k < 20; k++, i++) { const p = c; c = p + 4; bs.push(bar(p, c + 0.2, p - 0.2, c, i)); }
    for (let k = 0; k < 8; k++, i++) { const p = c; c = p + slope2; bs.push(bar(p, c + 0.2, p - 0.2, c, i)); }
    return [...bs, bar(c, c + 0.2, c - 25, c - 24, i)];
  };

  // BASE — the advance DECELERATES from +4/bar to +0.2/bar at index 112. Price still rises on every single bar
  // and never prints a lower low. MEASURED: the +4 ramp separates the two speeds (a LONG cross at index 93,
  // filled at 94, +1R); then the fast EMA collapses back toward the slow one while the signal line lags, and
  // the MACD line crosses DOWN through its own average at index 118 → SHORT, filled at index 119's open.
  const base = build(0.2);
  const tr = runComponentTrades(base, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 2);
  assertEquals(tr.map((t) => t.side), ["long", "short"]);
  assert(tr.every((t) => Math.abs(t.r - 1) < 1e-9), `expected +1R on both, got ${tr.map((t) => t.r)}`);
  // Pin the entry bar of each (riskFrac = |entry − stop| / entry, so it moves if the detector fires elsewhere).
  assert(Math.abs(tr[0].riskFrac - 0.03956043956043983) < 1e-12, `long entry moved: ${tr[0].riskFrac}`);
  assert(Math.abs(tr[1].riskFrac - 0.07677435914223771) < 1e-12, `short entry moved: ${tr[1].riskFrac}`);

  // WHAT MAKES THE SHORT UNREACHABLE FOR AN MA-RELATION TRIGGER. At the signal bar 118 the close is 181.40 —
  // a 26-bar high — while EMA20 = 164.13, EMA30 = 153.53, EMA50 = 139.41. Price is 10.5% ABOVE the nearest
  // trend filter in the grammar and has not touched one in 26 bars. `pullback` is the only other trigger that
  // reads an EMA, and it fires only when a bar TAGS the EMA and closes back through it, so it structurally
  // cannot express this bar: on the identical bars it takes exactly one trade, and it is a LONG.
  const pb = runComponentTrades(base, { ...spec, trigger: "pullback" as const }, { costRPerSide: 0 });
  assertEquals(pb.length, 1);
  assertEquals(pb[0].side, "long");

  // THE CONTROL THAT CARRIES THE WEIGHT. Same 92-bar prelude, same 20-bar ramp, same bar SHAPES (every bar is
  // a clean up-bar with the same 0.2 wicks), same resolution bar — the ONLY change is that the advance never
  // decelerates: `slope2` stays at +4 instead of dropping to +0.2. First-order price geometry is otherwise
  // unchanged in kind, and macd's SHORT vanishes entirely; only the long survives. The short is therefore
  // caused by the second derivative of the series, not by any bar's shape, its level, or its distance from
  // an average. No first-order trigger in the grammar can make that distinction.
  const ctrl = build(4);
  const ctr = runComponentTrades(ctrl, spec, { costRPerSide: 0 });
  assertEquals(ctr.length, 1);
  assertEquals(ctr[0].side, "long");

  // HONEST LIMIT — `macd` is NOT the only trigger that shorts the base fixture. `stoch` also takes one short,
  // for an unrelated reason: as the +4 ramp's low rolls out of the 14-bar window the range compresses faster
  // than price advances, so %K drifts down out of the overbought zone. The two co-fire on decelerating
  // advances; they are not the same condition (stoch reads position-in-range, macd reads the spread between
  // two speeds), and the control separates neither — it removes both, because it removes the deceleration.
  // This is stated rather than asserted-around: the primitive's novelty is the QUANTITY it reads, not
  // exclusivity on this one fixture.
  assertEquals(runComponentTrades(base, { ...spec, trigger: "stoch" as const }, { costRPerSide: 0 }).map((t) => t.side), ["short"]);
  assertEquals(runComponentTrades(ctrl, { ...spec, trigger: "stoch" as const }, { costRPerSide: 0 }).length, 0);

  // MIRROR — the opposite branch, without a hand-built second fixture. Reflecting every price through 200 maps
  // highs↔lows exactly, so EMA12−EMA26 ↦ −(EMA12−EMA26) and each cross flips: the decelerating DECLINE hands
  // over to the upside and the sides invert.
  const mir = base.map((b) => ({ ts: b.ts, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close }));
  const mtr = runComponentTrades(mir, spec, { costRPerSide: 0 });
  assertEquals(mtr.map((t) => t.side), ["short", "long"]);
  assert(mtr.every((t) => Math.abs(t.r - 1) < 1e-9), `expected +1R on both, got ${mtr.map((t) => t.r)}`);
});

Deno.test("harami: fires on BODY contraction against the prior bar — not range containment, not same-colour", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "harami" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 NEUTRAL filler bars, all identical → pbody (0.1) is never >= 2·body (0.2) → no harami can fire.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100.1, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);

  const seq: Bar[] = [...flat,
    bar(100, 100.2, 95.8, 96, 12),      // i-1: large DOWN body 4.0 (body 96→100), low 95.8
    bar(96.5, 97.4, 96.3, 97.0, 13),    // i: small UP body 0.5 INSIDE [96,100] → LONG, stop = min(95.8, 96.3) = 95.8
    bar(97.2, 97.5, 97.0, 97.3, 14),    // fill at open 97.2 → risk 1.4, target 98.6; neither touched here
    bar(97.3, 98.8, 97.2, 98.7, 15)];   // high 98.8 >= 98.6 → +1R
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "long");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);

  // NEGATIVE control A — pins BODY containment against RANGE containment (the `inside` neighbour). The small bar's
  // whole HIGH–LOW range (95.4–95.9) sits inside the prior bar's range (95.0–101.0), and it is the right colour
  // and the right size — but its body (95.5–95.8) is BELOW the prior body (96.0–100.0), so the large bar was
  // extended, not answered. An inside-bar detector fires here; harami must not.
  const rangeOnly: Bar[] = [...flat,
    bar(100, 101, 95, 96, 12),          // large DOWN body 4.0, but a WIDE range 95–101
    bar(95.5, 95.9, 95.4, 95.8, 13),    // body 0.3 inside the RANGE but not inside the BODY → must NOT fire
    bar(95.8, 96.0, 95.7, 95.9, 14),    // body [95.8,95.9] escapes prior body top 95.8 → no fire
    bar(95.9, 96.1, 95.8, 96.0, 15)];   // pbody 0.1 vs body 0.1 → ratio fails → no fire
  assertEquals(runComponentTrades(rangeOnly, spec, { costRPerSide: 0 }).length, 0);

  // NEGATIVE control B — same contraction, SAME colour: a small down bar inside a large down bar is a trend
  // pausing, not supply meeting demand at the extreme. Harami is a reversal read and must stay silent.
  const sameColour: Bar[] = [...flat,
    bar(100, 100.2, 95.8, 96, 12),
    bar(97.0, 97.4, 96.4, 96.5, 13),    // small DOWN body inside the prior DOWN body → must NOT fire
    bar(96.4, 96.6, 96.3, 96.5, 14),    // body bottom 96.4 < prior body bottom 96.5 → not contained → no fire
    bar(96.5, 97.0, 96.4, 96.9, 15)];   // pbody 0.1 vs body 0.4 → ratio fails → no fire
  assertEquals(runComponentTrades(sameColour, spec, { costRPerSide: 0 }).length, 0);

  // MIRROR — the bearish harami is the exact reflection (large UP body answered by a small DOWN body inside it).
  const mir = seq.map((b) => ({ ts: b.ts, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close }));
  const mtr = runComponentTrades(mir, spec, { costRPerSide: 0 });
  assertEquals(mtr.length, 1);
  assertEquals(mtr[0].side, "short");
  assert(Math.abs(mtr[0].r - 1) < 1e-9, `expected +1R, got ${mtr[0].r}`);
});

Deno.test("doubletop: enters at the NECKLINE between two equal peaks — not at either peak, and not on a bare break", () => {
  const bar = (o: number, h: number, l: number, c: number, idx: number): Bar => ({ ts: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(), open: o, high: h, low: l, close: c });
  const spec = { trigger: "doubletop" as const, emaPeriod: 5, trendMode: "none" as const, stopLookback: 3, rr: 1, session: "all" as const };
  // 12 NEUTRAL filler bars, all with IDENTICAL highs and lows → the strict fractal comparisons can never hold, so
  // the filler contains no pivots and no pattern. Provably signal-free before anything is built on top of it.
  const flat: Bar[] = Array.from({ length: 12 }, (_, i) => bar(100, 100.5, 99.5, 100.1, i));
  assertEquals(runComponentTrades(flat, spec, { costRPerSide: 0 }).length, 0);

  // DOUBLE TOP: peak 110 (idx 14) → neckline low 100 (17) → peak 110.5 (20), the two peaks 0.5 apart against a
  // pattern height of 10.5 (well inside the 10% tolerance) → bar 23 closes 99.5, THROUGH the neckline, while bar 22
  // closed 103.5 above it → the crossing bar fires SHORT with the stop at the higher peak, 110.5.
  const seq: Bar[] = [...flat,
    bar(101, 102, 100.8, 101.8, 12), bar(103, 104, 102.8, 103.8, 13),
    bar(108, 110, 107, 109.5, 14),   // P1 = 110
    bar(106, 107, 105, 106.5, 15), bar(104, 105, 103, 104.5, 16),
    bar(101, 102, 100, 101.5, 17),   // NECKLINE = 100
    bar(103, 104, 102, 103.5, 18), bar(105, 106, 104, 105.5, 19),
    bar(108, 110.5, 107, 109, 20),   // P2 = 110.5 → |110.5 − 110| = 0.5 <= 0.10 × (110.5 − 100)
    bar(106, 107, 105, 106.5, 21), bar(103, 104, 102, 103.5, 22),
    bar(101, 102, 99, 99.5, 23),     // close 99.5 < 100 → SHORT, stop 110.5
    bar(99.5, 100, 99, 99.6, 24),    // fill at open 99.5 → risk 11.0, target 88.5; neither touched
    bar(99.6, 100, 88, 88.2, 25)];   // low 88 <= 88.5 → +1R
  const tr = runComponentTrades(seq, spec, { costRPerSide: 0 });
  assertEquals(tr.length, 1);
  assertEquals(tr[0].side, "short");
  assert(Math.abs(tr[0].r - 1) < 1e-9, `expected +1R, got ${tr[0].r}`);

  // NEGATIVE CONTROL A — isolates the TWICE-REJECTED precondition, and pins the difference from `breakout`. The
  // neckline (100) and the identical break bar are kept; only the second peak changes, from 110.5 to 105.5, so the
  // two highs now differ by 4.5 against a pattern height of 10 — one rejection at 110 and a lower failure, not a
  // level that rejected twice. `doubletop` must be silent, while a plain range-break detector on the SAME bars
  // trades — so the silence is the precondition, not the absence of a break.
  const unequal: Bar[] = [...flat,
    bar(101, 102, 100.8, 101.8, 12), bar(103, 104, 102.8, 103.8, 13),
    bar(108, 110, 107, 109.5, 14),   // P1 = 110
    bar(106, 107, 105, 106.5, 15), bar(104, 105, 103, 104.5, 16),
    bar(101, 102, 100, 101.5, 17),   // NECKLINE = 100
    bar(101.5, 102.5, 101, 102, 18), bar(103, 104, 102.5, 103.5, 19),
    bar(104, 105.5, 103.5, 105, 20), // P2 = 105.5 → |105.5 − 110| = 4.5 > 0.10 × (110 − 100)
    bar(103, 104, 102, 103.5, 21), bar(101, 102, 100.5, 101.5, 22),
    bar(100.5, 101, 99, 99.5, 23),   // same close THROUGH the neckline as the positive case
    bar(99.5, 100, 99, 99.6, 24), bar(99.6, 100, 88, 88.2, 25)];
  assertEquals(runComponentTrades(unequal, spec, { costRPerSide: 0 }).length, 0);
  const asBreakout = runComponentTrades(unequal, { ...spec, trigger: "breakout" as const }, { costRPerSide: 0 });
  assert(asBreakout.length > 0, "control A must contain a real range break — otherwise it proves nothing");

  // NEGATIVE CONTROL B — isolates the BREAK. The identical twin-peak pattern is left intact and only the last three
  // bars change: price sags towards the neckline but every close stays above 100. The pattern alone is not a trade;
  // the trigger is the crossing event.
  const noBreak: Bar[] = [...seq.slice(0, 23),
    bar(101, 102, 100.2, 100.5, 23), bar(100.5, 101, 100.1, 100.6, 24), bar(100.6, 101, 100.2, 100.8, 25)];
  assertEquals(runComponentTrades(noBreak, spec, { costRPerSide: 0 }).length, 0);

  // MIRROR — the double bottom is the exact reflection: two equal troughs, entry on the close back ABOVE the peak
  // between them, stop at the lower trough.
  const mir = seq.map((b) => ({ ts: b.ts, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close }));
  const mtr = runComponentTrades(mir, spec, { costRPerSide: 0 });
  assertEquals(mtr.length, 1);
  assertEquals(mtr[0].side, "long");
  assert(Math.abs(mtr[0].r - 1) < 1e-9, `expected +1R, got ${mtr[0].r}`);
});
