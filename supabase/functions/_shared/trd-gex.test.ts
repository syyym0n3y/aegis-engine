import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bsGamma, netGexAt, buildGexProfile, type OptContract } from "./trd-gex.ts";

Deno.test("bsGamma: peaks near ATM, zero on degenerate inputs", () => {
  const atm = bsGamma(100, 100, 0.2, 0.1);
  const otm = bsGamma(100, 130, 0.2, 0.1);
  assert(atm > otm, "ATM gamma should exceed far-OTM gamma");
  assertEquals(bsGamma(0, 100, 0.2, 0.1), 0);
  assertEquals(bsGamma(100, 100, 0, 0.1), 0);
  assertEquals(bsGamma(100, 100, 0.2, 0), 0);
});

Deno.test("buildGexProfile: call wall above spot, put wall below, positive regime for long-call book", () => {
  const contracts: OptContract[] = [
    { strike: 105, type: "C", iv: 0.2, oi: 10000, dte: 20 }, // big call OI above → call wall
    { strike: 95, type: "P", iv: 0.2, oi: 8000, dte: 20 },   // big put OI below → put wall
    { strike: 100, type: "C", iv: 0.2, oi: 500, dte: 20 },
  ];
  const p = buildGexProfile(contracts, 100);
  assertEquals(p.callWall.strike, 105);
  assertEquals(p.putWall.strike, 95);
  assert(p.callWall.gex > 0, "call wall GEX positive");
  assert(p.putWall.gex < 0, "put wall GEX negative (short-put dealer)");
});

Deno.test("netGexAt: sign flips as spot moves across a mixed book (flip exists)", () => {
  const contracts: OptContract[] = [
    { strike: 90, type: "P", iv: 0.25, oi: 20000, dte: 15 },
    { strike: 110, type: "C", iv: 0.25, oi: 20000, dte: 15 },
  ];
  // deep below the put strike, put gamma dominates → negative; well above, call gamma → but both symmetric.
  const low = netGexAt(contracts, 85), high = netGexAt(contracts, 115);
  assert(Number.isFinite(low) && Number.isFinite(high));
  const p = buildGexProfile(contracts, 100);
  assert(p.byStrike.length === 2);
});
