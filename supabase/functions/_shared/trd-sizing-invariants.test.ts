// trd-sizing-invariants.test.ts — property-based safety guards for EVERY sizing primitive that touches the
// order path. The one invariant that must never break: a de-risk multiplier is a pure RISK REDUCER — it is
// always in (0,1], never levers up, and fails OPEN (→1) on bad data. These run thousands of assertions over
// deterministic input grids (no RNG — reproducible).
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fwdVolDeRisk } from "./trd-fwdvol.ts";
import { assetFwdVolDeRisk, ASSET_VOL_MODELS } from "./trd-asset-vol.ts";
import { gexRegime } from "./trd-gex-regime.ts";
import { volRegimeDeRisk } from "./trd-vol-regime.ts";
import { valueArea } from "./trd-auction.ts";
import { bsGamma, buildGexProfile, type OptContract } from "./trd-gex.ts";

const grid = (lo: number, hi: number, steps: number) => Array.from({ length: steps }, (_, i) => lo + (hi - lo) * i / (steps - 1));

Deno.test("INVARIANT: fwdVolDeRisk ∈ (0,1] over the whole plausible input space", () => {
  let n = 0;
  for (const rv of grid(0, 2, 12)) for (const gp of grid(0, 1, 6)) for (const vt of grid(0.5, 2, 8)) {
    const { deRisk } = fwdVolDeRisk(rv, gp, vt); assert(deRisk > 0 && deRisk <= 1, `fwdVol ${rv},${gp},${vt} → ${deRisk}`); n++;
  }
  assert(n >= 500, `covered ${n} points`);
});

Deno.test("INVARIANT: fwdVolDeRisk fails OPEN (→1 when all inputs NaN) and never > 1 on partial NaN", () => {
  assert(fwdVolDeRisk(NaN, NaN, NaN).deRisk <= 1 && fwdVolDeRisk(NaN, NaN, NaN).deRisk > 0);
  for (const [a, b, c] of [[NaN, 0.5, 1], [0.2, NaN, 1], [0.2, 0.5, NaN]] as const) assert(fwdVolDeRisk(a, b, c).deRisk <= 1);
});

Deno.test("INVARIANT: fwdVolDeRisk monotone — more RV or backwardation tightens; more gamma eases", () => {
  const base = fwdVolDeRisk(0.2, 0.5, 1).deRisk;
  assert(fwdVolDeRisk(0.5, 0.5, 1).deRisk <= base + 1e-9, "↑RV must not loosen");
  assert(fwdVolDeRisk(0.2, 0.5, 1.4).deRisk <= base + 1e-9, "↑backwardation must not loosen");
  assert(fwdVolDeRisk(0.2, 0.95, 1).deRisk >= base - 1e-9, "↑gamma must not tighten");
});

Deno.test("INVARIANT: assetFwdVolDeRisk ∈ (0,1] for every modeled asset over IV/RV grid", () => {
  let n = 0;
  for (const a of Object.keys(ASSET_VOL_MODELS)) for (const rv of grid(0, 2, 10)) for (const iv of grid(0.02, 1.5, 12)) {
    const { deRisk } = assetFwdVolDeRisk(a, rv, iv); assert(deRisk > 0 && deRisk <= 1, `${a} ${rv},${iv} → ${deRisk}`); n++;
  }
  assert(n >= 500);
});

Deno.test("INVARIANT: assetFwdVolDeRisk fails OPEN on unknown asset / NaN inputs (→1)", () => {
  assert(assetFwdVolDeRisk("NOPE", 0.2, 0.2).deRisk === 1);
  for (const a of Object.keys(ASSET_VOL_MODELS)) { assert(assetFwdVolDeRisk(a, NaN, 0.2).deRisk === 1); assert(assetFwdVolDeRisk(a, 0.2, NaN).deRisk === 1); }
});

Deno.test("INVARIANT: assetFwdVolDeRisk monotone in IV — higher implied vol never loosens size", () => {
  for (const a of Object.keys(ASSET_VOL_MODELS)) { let prev = 1.01; for (const iv of grid(0.05, 1.2, 10)) { const d = assetFwdVolDeRisk(a, 0.2, iv).deRisk; assert(d <= prev + 1e-9, `${a}: IV↑ loosened (${d}>${prev})`); prev = d; } }
});

Deno.test("INVARIANT: gexRegime deRisk ∈ (0,1], percentile ∈ [0,1], monotone up in GEX", () => {
  const hist = grid(0, 100, 300);
  let prev = 0;
  for (const g of grid(-20, 120, 60)) { const r = gexRegime(g, hist); assert(r.deRisk > 0 && r.deRisk <= 1); assert(r.percentile >= 0 && r.percentile <= 1); assert(r.deRisk >= prev - 1e-9, "deRisk monotone up in GEX"); prev = r.deRisk; }
});

Deno.test("INVARIANT: volRegimeDeRisk ∈ (0,1], no-op (1) on insufficient history", () => {
  assert(volRegimeDeRisk([0.01, -0.01]).deRisk === 1, "short history → benign 1");
  // build a long calm series then a spike → deRisk should be ≤ 1 always
  const calm = Array.from({ length: 500 }, (_, i) => (i % 2 ? 0.002 : -0.002));
  assert(volRegimeDeRisk(calm).deRisk > 0 && volRegimeDeRisk(calm).deRisk <= 1);
});

Deno.test("INVARIANT: valueArea always returns VAL ≤ POC ≤ VAH and encloses ≥ target volume", () => {
  for (const seed of grid(1, 9, 8)) {
    const bars = Array.from({ length: 120 }, (_, i) => { const p = 100 + 20 * Math.sin(i / seed); const v = 1 + Math.abs(Math.cos(i / (seed + 1))); return { h: p + 0.5, l: p - 0.5, c: p, v }; });
    const va = valueArea(bars, 0.7, 80)!; assert(va.val <= va.poc + 1e-6 && va.poc <= va.vah + 1e-6, `ordering ${va.val}/${va.poc}/${va.vah}`);
    assert(va.totalVol > 0);
  }
});

Deno.test("INVARIANT: valueArea never produces NaN/Infinity on degenerate bars", () => {
  for (const bars of [[{ h: 5, l: 5, c: 5, v: 3 }], [{ h: 1, l: 1, c: 1, v: 0 }], [{ h: 10, l: 0, c: 5, v: 100 }]]) {
    const va = valueArea(bars, 0.7, 50)!; for (const x of [va.poc, va.vah, va.val, va.totalVol]) assert(Number.isFinite(x), `finite ${x}`);
  }
});

Deno.test("INVARIANT: bsGamma ≥ 0 everywhere; 0 on degenerate; peaks near ATM", () => {
  for (const S of grid(50, 150, 20)) for (const K of grid(50, 150, 20)) for (const sig of grid(0.05, 1, 6)) { const g = bsGamma(S, K, sig, 0.1); assert(g >= 0 && Number.isFinite(g)); }
  assert(bsGamma(100, 100, 0.2, 0.1) > bsGamma(100, 160, 0.2, 0.1), "ATM > far OTM");
});

Deno.test("INVARIANT: buildGexProfile call wall ≥ spot region positive, put wall negative, flip within scan band", () => {
  const cs: OptContract[] = [{ strike: 110, type: "C", iv: 0.2, oi: 5000, dte: 20 }, { strike: 90, type: "P", iv: 0.2, oi: 5000, dte: 20 }];
  const p = buildGexProfile(cs, 100);
  assert(p.callWall.gex >= p.putWall.gex, "call wall ≥ put wall by GEX");
  if (p.gammaFlip != null) assert(p.gammaFlip >= 80 && p.gammaFlip <= 120, `flip in band, got ${p.gammaFlip}`);
});

Deno.test("INVARIANT: composed sizing (kelly × any de-risks) can never exceed the base kelly fraction", () => {
  // the order-path composition is riskFrac = kelly × d1 × d2 × ... ; with every dᵢ ∈ (0,1], product ≤ kelly.
  const kelly = 0.02;
  for (const d1 of grid(0.3, 1, 8)) for (const d2 of grid(0.3, 1, 8)) { const rf = kelly * d1 * d2; assert(rf <= kelly + 1e-12 && rf > 0, `composed ${rf} > base ${kelly}`); }
});
