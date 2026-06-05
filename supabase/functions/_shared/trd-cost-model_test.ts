import { haircutReturns, netPnl, PESSIMISTIC_DEFAULTS, roundTripCost } from "./trd-cost-model.ts";
import { assert, assertAlmost, assertEquals } from "./trd-test-helpers.ts";

Deno.test("round-trip cost is always positive for a real position", () => {
  const c = roundTripCost({ price: 100, shares: 100, holdingDays: 5 });
  assert(c.total > 0, "cost > 0");
  assert(c.commission > 0 && c.spread > 0 && c.slippage > 0);
  assertEquals(c.borrow, 0); // long → no borrow
  // notional 10_000: spread 2*10000*5/1e4 = 10, slippage = 10, commission 2*max(1,0.5)=2
  assertAlmost(c.spread, 10, 1e-9);
  assertAlmost(c.slippage, 10, 1e-9);
  assertAlmost(c.commission, 2, 1e-9);
  assertAlmost(c.totalBps, (22 / 10000) * 1e4, 1e-9);
});

Deno.test("shorts incur borrow proportional to holding days", () => {
  const short = roundTripCost({ price: 50, shares: 200, holdingDays: 365, isShort: true });
  // notional 10_000, borrow 50bps/yr * 1yr = 0.005*10000 = 50
  assertAlmost(short.borrow, 50, 1e-9);
  const longSame = roundTripCost({ price: 50, shares: 200, holdingDays: 365 });
  assertEquals(longSame.borrow, 0);
  assert(short.total > longSame.total, "short costs more (borrow)");
});

Deno.test("zero notional → zero cost (no divide-by-zero)", () => {
  const c = roundTripCost({ price: 0, shares: 0, holdingDays: 1 });
  assertEquals(c.total, 0);
  assertEquals(c.totalBps, 0);
});

Deno.test("netPnl subtracts the full round-trip cost", () => {
  const spec = { price: 100, shares: 100, holdingDays: 1 };
  const gross = 50;
  assertAlmost(netPnl(gross, spec), gross - roundTripCost(spec).total, 1e-9);
});

Deno.test("haircut drags every paper return by the cost prior", () => {
  const out = haircutReturns([0.01, 0.02, -0.005], 22); // 22 bps
  assertAlmost(out[0], 0.01 - 0.0022, 1e-12);
  assertAlmost(out[2], -0.005 - 0.0022, 1e-12);
});

Deno.test("pessimistic defaults are genuinely conservative", () => {
  // round-trip cost on a typical retail trade should be >= ~20bps
  const c = roundTripCost({ price: 100, shares: 100, holdingDays: 5, params: PESSIMISTIC_DEFAULTS });
  assert(c.totalBps >= 20, `expected >=20bps, got ${c.totalBps}`);
});
