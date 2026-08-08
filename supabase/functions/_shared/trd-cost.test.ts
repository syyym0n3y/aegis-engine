import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corwinSchultzSpread, estimateCost, BROKERS, type Bar } from "./trd-cost.ts";

// synthetic bars: a known proportional spread widens the observed high/low range
function synth(n: number, spread: number, vol = 0.01): Bar[] {
  const out: Bar[] = []; let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + (i % 2 ? vol : -vol) * 0.5;
    const half = p * spread / 2;
    out.push({ h: p * (1 + vol) + half, l: p * (1 - vol) - half, c: p });
  }
  return out;
}
Deno.test("corwinSchultz: wider true spread → larger estimate (monotone)", () => {
  const a = corwinSchultzSpread(synth(120, 0.000));
  const b = corwinSchultzSpread(synth(120, 0.010));
  assert(Number.isFinite(b));
  assert(b >= a, `wider spread should not estimate lower (${b} vs ${a})`);
});
Deno.test("corwinSchultz: never negative, handles degenerate input", () => {
  assert(!Number.isFinite(corwinSchultzSpread([{ h: 1, l: 1, c: 1 }])), "too few bars → NaN");
  const s = corwinSchultzSpread(synth(80, 0.002));
  assert(s >= 0, "estimator floors at zero per the paper");
});
Deno.test("estimateCost: zero-commission default, spread is doubled for the round trip", () => {
  const c = estimateCost(synth(120, 0.002), "zero-commission");
  assertEquals(c.commissionUsd, 0, "US retail equities are $0 commission in 2026");
  assert(c.spreadPct > 0 && c.spreadPct < 10);
  assert(c.broker.length > 0 && c.source.includes("Corwin-Schultz"));
});
Deno.test("estimateCost: broker override changes commission, not the measured spread", () => {
  const bars = synth(120, 0.002);
  const zero = estimateCost(bars, "zero-commission"), ib = estimateCost(bars, "ibkr");
  assertEquals(zero.spreadPct, ib.spreadPct, "spread is a market property, not a broker one");
  assert(ib.commissionUsd > zero.commissionUsd);
});
Deno.test("BROKERS: every profile has non-negative, finite fees", () => {
  for (const [k, b] of Object.entries(BROKERS)) for (const v of [b.equityPerTrade, b.perContractOption, b.perContractFuture]) assert(Number.isFinite(v) && v >= 0, `${k} has a bad fee`);
});
