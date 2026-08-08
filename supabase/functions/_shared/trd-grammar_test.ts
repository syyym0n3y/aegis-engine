import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Bar, enumerate, GRAMMAR, runComponent, specKey } from "./trd-grammar.ts";

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
