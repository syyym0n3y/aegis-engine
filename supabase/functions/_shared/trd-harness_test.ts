// Tests for the unified edge scorecard (D-263). Verifies it COMPOSES the cores correctly:
// cost→R conversion, vs-random cost-neutrality, split-half OOS, and fail-closed on thin samples.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scoreEdge, scoreByRegime, scoreDollar, type HarnessTrade } from "./trd-harness.ts";

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

Deno.test("regime matrix isolates the favourable bucket (edge in 'up' only, not 'down')", () => {
  // setup: +0.4R edge over control in regime up; ~0 in regime down. control ~0 everywhere.
  const setup: HarnessTrade[] = [], control: HarnessTrade[] = [];
  let s = 99; const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 60; i++) { setup.push({ r: 0.4 + (rand() - 0.5) * 2, stopFrac: 0.01, regime: { trend: "up" } }); control.push({ r: (rand() - 0.5) * 2, stopFrac: 0.01, regime: { trend: "up" } }); }
  for (let i = 0; i < 60; i++) { setup.push({ r: (rand() - 0.5) * 2, stopFrac: 0.01, regime: { trend: "down" } }); control.push({ r: (rand() - 0.5) * 2, stopFrac: 0.01, regime: { trend: "down" } }); }
  const cells = scoreByRegime(setup, control, 5, ["trend"]);
  const up = cells.find((c) => c.bucket === "up")!, down = cells.find((c) => c.bucket === "down")!;
  assert(up.passes, `up bucket should pass (t=${up.vsRandomT})`);
  assert(!down.passes, `down bucket should not pass (t=${down.vsRandomT})`);
});

Deno.test("trial count inflation deflates the Sharpe (DSR falls as nTrials rises)", () => {
  const setup = make(120, 0.3, 11), control = make(120, 0.0, 12);
  const few = scoreEdge("t", setup, control, { costBps: 5, nTrials: 1 });
  const many = scoreEdge("t", setup, control, { costBps: 5, nTrials: 500 });
  assert(many.deflatedSharpe <= few.deflatedSharpe, "more trials must not increase the deflated Sharpe");
});

Deno.test("dollar view: flat = net-R × riskUsd; conviction scales it; gate subsets it", () => {
  const setup = make(80, 0.3, 3), control = make(80, 0.0, 4);
  // tag half the setups 'tight' so conviction (1.5×) and the regime gate can bite
  setup.forEach((t, i) => { t.regime = { range: i % 2 === 0 ? "tight" : "wide" }; });
  const convOf = (r?: Record<string, string>) => r?.range === "tight" ? 1.5 : 1.0;
  const favOf = (r?: Record<string, string>) => r?.range === "tight";
  const d = scoreDollar("t", setup, control, 5, 500, convOf, favOf);
  // conviction dollars must EXCEED flat when some trades are up-weighted and the edge is net-positive
  assert(d.convUsd > d.flatUsd, `conv ${d.convUsd} should exceed flat ${d.flatUsd}`);
  assert(d.gatedN === 40, `gate should keep the 40 tight trades, got ${d.gatedN}`);
  assert(d.avgConv > 1 && d.avgConv < 1.5, `avgConv ${d.avgConv} between 1 and 1.5`);
});

Deno.test("dollar view HONEST ANCHOR: drift dollars are NOT skill dollars", () => {
  // a setup that only earns market DRIFT: setup mean = control mean (both +0.3R). flat dollars are green,
  // but skillUsd (edge over the matched random control) must be ~0 — the exact trap the operator flagged.
  const driftOnly = scoreDollar("drift", make(200, 0.3, 21), make(200, 0.3, 22), 5, 500);
  assert(driftOnly.flatUsd > 0, "flat dollars look profitable (drift)");
  assert(Math.abs(driftOnly.skillUsd) < Math.abs(driftOnly.driftUsd) * 0.5, `skillUsd ${driftOnly.skillUsd} must be small vs driftUsd ${driftOnly.driftUsd}`);
  // a REAL edge (setup 0.3 over control 0.0): skill dollars ≈ flat dollars
  const real = scoreDollar("real", make(200, 0.3, 21), make(200, 0.0, 22), 5, 500);
  assert(real.skillUsd > real.driftUsd, `real edge: skill ${real.skillUsd} should dominate drift ${real.driftUsd}`);
});
