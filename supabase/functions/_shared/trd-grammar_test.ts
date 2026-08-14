import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Bar, enumerate, GRAMMAR, runComponent, runComponentTrades, specKey } from "./trd-grammar.ts";
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
