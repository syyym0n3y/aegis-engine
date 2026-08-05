import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { valueArea, auctionContext, type PBar } from "./trd-auction.ts";

Deno.test("valueArea: POC at the heaviest price, VAL<=POC<=VAH, ~70% enclosed", () => {
  // volume concentrated at 100; thin tails at 90 and 110
  const bars: PBar[] = [
    { h: 90, l: 90, c: 90, v: 5 },
    { h: 100, l: 100, c: 100, v: 100 },
    { h: 100, l: 100, c: 100, v: 100 },
    { h: 110, l: 110, c: 110, v: 5 },
  ];
  const va = valueArea(bars, 0.7, 50)!;
  assert(Math.abs(va.poc - 100) <= va.binSize + 1e-9, `POC ${va.poc} should be ~100`);
  assert(va.val <= va.poc && va.poc <= va.vah, "VAL<=POC<=VAH");
  assertEquals(va.totalVol, 210);
});

Deno.test("valueArea: uniform range → VA covers ~70% of the span", () => {
  const bars: PBar[] = [];
  for (let p = 0; p < 100; p++) bars.push({ h: p, l: p, c: p, v: 1 });
  const va = valueArea(bars, 0.7, 100)!;
  const covered = va.vah - va.val;
  assert(covered >= 55 && covered <= 85, `~70% of 100-wide span, got ${covered}`);
});

Deno.test("auctionContext: developing vs prior vs composite by day tag", () => {
  const bars: PBar[] = [
    { h: 10, l: 10, c: 10, v: 50, day: "2026-01-01" },
    { h: 12, l: 12, c: 12, v: 50, day: "2026-01-01" },
    { h: 20, l: 20, c: 20, v: 50, day: "2026-01-02" },
    { h: 22, l: 22, c: 22, v: 50, day: "2026-01-02" },
    { h: 30, l: 30, c: 30, v: 50, day: "2026-01-03" },
    { h: 32, l: 32, c: 32, v: 50, day: "2026-01-03" },
  ];
  const ctx = auctionContext(bars, 20);
  assertEquals(ctx.sessions, 3);
  assert(ctx.developing!.poc >= 30, "developing = latest session (~30s)");
  assert(ctx.prior!.poc >= 20 && ctx.prior!.poc < 30, "prior = 2026-01-02 (~20s)");
  // composite spans multiple sessions → wider value band than any single developing session
  assert((ctx.composite!.vah - ctx.composite!.val) > (ctx.developing!.vah - ctx.developing!.val), "composite wider than developing");
  assert(ctx.composite!.val <= 20 && ctx.composite!.vah >= 22, "composite value band reaches into mid/upper sessions");
});
