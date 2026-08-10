// Tests for the unified edge scorecard (D-263). Verifies it COMPOSES the cores correctly:
// cost→R conversion, vs-random cost-neutrality, split-half OOS, and fail-closed on thin samples.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scoreEdge, type HarnessTrade } from "./trd-harness.ts";

// deterministic pseudo-trades: a setup with a real +0.3R gross edge over random, both with stopFrac=0.01
function make(n: number, meanR: number, seed: number): HarnessTrade[] {
  let s = seed; const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: HarnessTrade[] = [];
  for (let i = 0; i < n; i++) out.push({ r: meanR + (rand() - 0.5) * 2, stopFrac: 0.01, period: i < n / 2 ? "2023Q1" : "2025Q1" });
  return out;
}

Deno.test("cost is converted from price-fraction to R via stopFrac", () => {
  const setup = make(60, 0.3, 1), control = make(60, 0.0, 2);
  // costBps=10 → costFrac=0.001; stopFrac=0.01 → costR = 0.001/0.01 = 0.10 R per trade
  const sc = scoreEdge("t", setup, control, { costBps: 10, nTrials: 1 });
  assert(Math.abs(sc.costR - 0.10) < 1e-9, `costR=${sc.costR} expected 0.10`);
  assert(Math.abs(sc.netR - (sc.absR - 0.10)) < 1e-9, "netR must equal absR - costR");
});

Deno.test("vs-random edge is COST-NEUTRAL (cost cancels between setup and control)", () => {
  const setup = make(60, 0.3, 1), control = make(60, 0.0, 2);
  const cheap = scoreEdge("t", setup, control, { costBps: 0, nTrials: 1 });
  const dear = scoreEdge("t", setup, control, { costBps: 50, nTrials: 1 });
  // skill (vs random) must not move with cost; absolute net R must fall with cost
  assertEquals(cheap.vsRandomEdge, dear.vsRandomEdge);
  assert(dear.netR < cheap.netR, "higher cost must lower absolute net R");
});

Deno.test("a genuine +0.3R setup beats random; a null setup does not", () => {
  const real = scoreEdge("real", make(80, 0.3, 3), make(80, 0.0, 4), { costBps: 5, nTrials: 1 });
  const null_ = scoreEdge("null", make(80, 0.0, 5), make(80, 0.0, 6), { costBps: 5, nTrials: 1 });
  assert(real.vsRandomPasses, `real edge should pass vs random (t=${real.vsRandomT})`);
  assert(!null_.vsRandomPasses, `null edge must NOT pass vs random (t=${null_.vsRandomT})`);
});

Deno.test("split-half OOS reports both halves and holdsBoth", () => {
  const sc = scoreEdge("t", make(80, 0.3, 7), make(80, 0.0, 8), { costBps: 5, nTrials: 1 });
  assert(Number.isFinite(sc.oosH1) && Number.isFinite(sc.oosH2), "both halves must be finite");
  assertEquals(sc.holdsBoth, sc.oosH1 > 0 && sc.oosH2 > 0);
});

Deno.test("fails closed on a thin sample (<30) — no accidental promotion", () => {
  const sc = scoreEdge("thin", make(10, 0.5, 9), make(10, 0.0, 10), { costBps: 5, nTrials: 1 });
  assert(!sc.vsRandomPasses, "under 30 trades must not pass the random control");
  assert(!sc.gatePassed, "thin sample must not pass the gate");
});

Deno.test("trial count inflation deflates the Sharpe (DSR falls as nTrials rises)", () => {
  const setup = make(120, 0.3, 11), control = make(120, 0.0, 12);
  const few = scoreEdge("t", setup, control, { costBps: 5, nTrials: 1 });
  const many = scoreEdge("t", setup, control, { costBps: 5, nTrials: 500 });
  assert(many.deflatedSharpe <= few.deflatedSharpe, "more trials must not increase the deflated Sharpe");
});
