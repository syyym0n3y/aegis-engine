import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evolve,
  geneKey,
  geneToSpec,
  mulberry32,
  RunSpec,
  sideOf,
  WyckoffGene,
} from "./trd-evolve.ts";
import type { StrategySpec } from "./trd-strategy.ts";

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Deterministic PURE-NOISE evaluator: returns are seeded by the spec name, so the
 * same spec always yields the same series (consistency) but there is NO real edge in
 * the data — any "winner" is selection noise. This is the adversarial input. */
function noiseRun(len: number): RunSpec {
  return (spec: StrategySpec) => {
    const rnd = mulberry32(hashStr(spec.name));
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push((rnd() - 0.5) * 0.02); // ±1% daily, mean ~0
    return out;
  };
}

Deno.test("sideOf: bullish events long, bearish events short", () => {
  assertEquals(sideOf("wy_spring"), "long");
  assertEquals(sideOf("wy_sos"), "long");
  assertEquals(sideOf("wy_upthrust"), "short");
  assertEquals(sideOf("wy_sow"), "short");
});

Deno.test("geneToSpec: gates compile into an AND of feature thresholds", () => {
  const g: WyckoffGene = {
    event: "wy_spring", useEvrGate: true, evrMin: 0.5,
    useCvdGate: true, cvdSlopeSide: ">", cvdSlopeThresh: 100, maxPositions: 3,
  };
  const spec = geneToSpec(g, ["AAA"], 10);
  assertEquals(spec.family, "wyckoff-evolved");
  assertEquals(spec.sizing.maxPositions, 3);
  assert(spec.signal.kind === "and");
  if (spec.signal.kind === "and") {
    assertEquals(spec.signal.rules.length, 3); // event + evr + cvd
    assertEquals(spec.signal.side, "long");
  }
});

Deno.test("geneToSpec: no gates → a single feature_threshold (not an AND)", () => {
  const g: WyckoffGene = {
    event: "wy_upthrust", useEvrGate: false, evrMin: 0,
    useCvdGate: false, cvdSlopeSide: "<", cvdSlopeThresh: 0, maxPositions: 1,
  };
  const spec = geneToSpec(g, ["AAA"], 10);
  assertEquals(spec.signal.kind, "feature_threshold");
});

Deno.test("determinism: same seed → identical result (idempotency invariant)", () => {
  const cfg = { universe: ["AAA", "BBB"], costBps: 10, populationSize: 12, generations: 4, seed: 42 };
  const a = evolve(cfg, noiseRun(120));
  const b = evolve(cfg, noiseRun(120));
  assertEquals(a.nTrials, b.nTrials);
  assertEquals(a.deflatedSharpeBest, b.deflatedSharpeBest);
  assertEquals(a.pbo, b.pbo);
  assertEquals(a.best?.spec.name, b.best?.spec.name);
});

Deno.test("honest N: nTrials counts DISTINCT candidates (dedup by geneKey)", () => {
  const seen = new Set<string>();
  const cfg = { universe: ["AAA"], costBps: 10, populationSize: 20, generations: 6, seed: 7 };
  const wrapped: RunSpec = (spec) => { seen.add(spec.name); return noiseRun(100)(spec); };
  const res = evolve(cfg, wrapped);
  // nTrials must equal the number of distinct specs actually run
  assertEquals(res.nTrials, seen.size);
  assert(res.nTrials >= 20, "at least the initial population of distinct genes");
});

Deno.test("THE SAFETY TEST: a large search over PURE NOISE must NOT clear the gate", () => {
  // 40 population × 8 generations over noise → hundreds of trials. A naive search
  // reports the lucky best as an edge; the deflation + PBO must refuse it.
  const cfg = { universe: ["AAA", "BBB", "CCC"], costBps: 10, populationSize: 40, generations: 8, seed: 123 };
  const res = evolve(cfg, noiseRun(250));
  assert(res.nTrials > 50, `expected a large search, got ${res.nTrials} trials`);
  // The winner will have a POSITIVE raw in-sample Sharpe (selection guarantees it)...
  assert((res.best?.sharpe ?? 0) > 0, "in-sample winner should look good — that's the trap");
  // ...but the engine must NOT be fooled: no clearance on noise.
  assertEquals(res.clearsDsr, false, `noise cleared the gate! DSR=${res.deflatedSharpeBest} PBO=${res.pbo}`);
  assert(
    res.deflatedSharpeBest < 0.95 || res.overfit,
    `either DSR must be crushed by N or PBO must flag overfit; got DSR=${res.deflatedSharpeBest} PBO=${res.pbo}`,
  );
});

Deno.test("geneKey: stable + collapses duplicate genes", () => {
  const g1: WyckoffGene = {
    event: "wy_sos", useEvrGate: false, evrMin: 0.3,
    useCvdGate: false, cvdSlopeSide: ">", cvdSlopeThresh: 5, maxPositions: 2,
  };
  const g2 = { ...g1, evrMin: 0.9, cvdSlopeThresh: 999 }; // differ only in UNUSED gate params
  // both gates off → those params don't appear in the key → same key
  assertEquals(geneKey(g1), geneKey(g2));
});
