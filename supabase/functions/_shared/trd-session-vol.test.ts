import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sessionExpectedVol, SESSION_VOL_PCT } from "./trd-session-vol.ts";

Deno.test("sessionExpectedVol: NY > London > Asia at every regime (ordering preserved)", () => {
  for (const v of [8, 13.4, 25]) { const r = sessionExpectedVol(v); const m = Object.fromEntries(r.map((x) => [x.session, x.expectedPct])); assert(m.NY > m.London && m.London > m.Asia, `ordering @${v}: ${JSON.stringify(m)}`); }
});

Deno.test("sessionExpectedVol: at median forecast, expected == baseline; higher forecast scales all up", () => {
  const atMed = sessionExpectedVol(13.4); for (const x of atMed) assert(Math.abs(x.expectedPct - x.baselinePct) < 0.2, `${x.session} ~baseline`);
  const hi = sessionExpectedVol(26.8); for (const x of hi) assert(x.expectedPct > SESSION_VOL_PCT[x.session] * 1.5, `${x.session} scaled up`);
});

Deno.test("sessionExpectedVol: NaN forecast → multiplier 1 (fail-open to baseline)", () => {
  const r = sessionExpectedVol(NaN); for (const x of r) assertEquals(x.expectedPct, x.baselinePct);
});
