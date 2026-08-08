import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFactorBook } from "./trd-allocate.ts";

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function stream(n: number, drift: number, vol: number, seed: number) { const r = mulberry32(seed); return Array.from({ length: n }, () => drift + (r() - 0.5) * vol); }

Deno.test("ALLOCATE: blends streams and reports weights for every input", () => {
  const rep = buildFactorBook({ streams: { value: stream(200, 0.003, 0.04, 1), quality: stream(200, 0.003, 0.03, 2), momentum: stream(200, 0.004, 0.05, 3) }, periodsPerYear: 12 });
  assertEquals(Object.keys(rep.weights).sort(), ["momentum", "quality", "value"]);
  assertEquals(rep.portfolio.length, 200);
});

Deno.test("ALLOCATE: diversification — blended vol is below the average single-stream vol", () => {
  // three uncorrelated streams of similar vol: the blend should be less volatile than the mean part
  const s = { a: stream(300, 0.002, 0.05, 11), b: stream(300, 0.002, 0.05, 22), c: stream(300, 0.002, 0.05, 33) };
  const rep = buildFactorBook({ streams: s, periodsPerYear: 12, targetAnnualVol: 100 }); // huge target => no scaling, measure raw blend
  const sd = (x: number[]) => { const m = x.reduce((p, q) => p + q, 0) / x.length; return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / x.length); };
  const singleAvg = (sd(s.a) + sd(s.b) + sd(s.c)) / 3;
  assert(sd(rep.portfolio) < singleAvg, "diversified blend should be less volatile than the average part");
});

Deno.test("ALLOCATE: inverse-vol weighting tilts toward the lower-vol stream", () => {
  const rep = buildFactorBook({ streams: { calm: stream(300, 0.002, 0.02, 5), wild: stream(300, 0.002, 0.10, 6) }, periodsPerYear: 12 });
  assert(rep.weights.calm > rep.weights.wild, "lower-vol stream should get more weight");
});

Deno.test("ALLOCATE: correlation matrix is symmetric with unit diagonal", () => {
  const rep = buildFactorBook({ streams: { a: stream(150, 0.002, 0.04, 7), b: stream(150, 0.002, 0.04, 8) }, periodsPerYear: 12 });
  assertEquals(rep.correlationMatrix.a.a, 1);
  assertEquals(rep.correlationMatrix.a.b, rep.correlationMatrix.b.a);
});
