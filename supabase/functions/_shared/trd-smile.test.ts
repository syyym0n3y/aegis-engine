import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { smileSlope, type OptQuote } from "./trd-smile.ts";

// build a synthetic chain: expiry ~30 DTE, with a known put-over-call skew
function chain(days: number, callIvAtHalf: number, putIvAtHalf: number): OptQuote[] {
  const d = new Date(Date.now() + days * 86400000);
  const exp = `${String(d.getUTCFullYear() % 100).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const q: OptQuote[] = [];
  // deltas bracketing 0.5 on both sides, IV linear in delta so interpolation is exact at 0.5
  for (const [dl, mult] of [[0.3, 1.1], [0.5, 1.0], [0.7, 0.9]] as [number, number][]) {
    q.push({ option: `XYZ${exp}C0010000${0}`.slice(0, 3) + exp + "C" + String(Math.round(dl * 1e7)).padStart(8, "0"), iv: callIvAtHalf * mult, delta: dl });
    q.push({ option: "XYZ" + exp + "P" + String(Math.round(dl * 1e7)).padStart(8, "0"), iv: putIvAtHalf * mult, delta: -dl });
  }
  return q;
}

Deno.test("smileSlope: put IV above call IV → positive slope (Yan's construction)", () => {
  const r = smileSlope(chain(30, 0.20, 0.28));
  assert(r.smileSlope !== null);
  assert(Math.abs(r.smileSlope! - 0.08) < 0.01, `expected ~+0.08, got ${r.smileSlope}`);
  assert(Math.abs(r.cpVolSpread! + 0.08) < 0.01, "cpVolSpread is the mirror");
});

Deno.test("smileSlope: no skew → ~zero", () => {
  const r = smileSlope(chain(30, 0.25, 0.25));
  assert(r.smileSlope !== null && Math.abs(r.smileSlope!) < 0.01, `expected ~0, got ${r.smileSlope}`);
});

Deno.test("smileSlope: call IV above put IV → negative slope", () => {
  const r = smileSlope(chain(30, 0.32, 0.22));
  assert(r.smileSlope! < -0.05, `expected negative, got ${r.smileSlope}`);
});

Deno.test("smileSlope: degenerate/empty input fails safe (nulls, never throws)", () => {
  for (const q of [[], [{ option: "junk", iv: 0.2, delta: 0.5 }], [{ option: "XYZ260101C00100000", iv: 0, delta: 0.5 }]] as OptQuote[][]) {
    const r = smileSlope(q);
    assertEquals(r.smileSlope, null);
  }
});

Deno.test("smileSlope: picks the expiry nearest 30 DTE", () => {
  const near = chain(31, 0.20, 0.30), far = chain(180, 0.20, 0.21);
  const r = smileSlope([...near, ...far], 30);
  assert(r.dteUsed !== null && Math.abs(r.dteUsed! - 31) <= 2, `should use ~31 DTE, used ${r.dteUsed}`);
  assert(r.smileSlope! > 0.05, "should reflect the near expiry's wide skew");
});
