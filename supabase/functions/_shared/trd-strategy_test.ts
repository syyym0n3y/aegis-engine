import {
  backtest, evalSignal, Panel, runBacktest, runKeyFor, StrategySpec, SymbolData, TrialContext,
} from "./trd-strategy.ts";
import { PitRecord } from "./trd-point-in-time.ts";
import { assert, assertAlmost, assertEquals } from "./trd-test-helpers.ts";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}
function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function isoDates(n: number): string[] {
  // simple ascending daily grid from 2026-01-01 (weekends ignored — fine for a test)
  const out: string[] = [];
  const base = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

Deno.test("evalSignal: feature_threshold is point-in-time (future data can't be seen)", () => {
  const feats: Record<string, PitRecord[]> = {
    congress_net: [
      { effectiveDate: "2026-02-01", value: 5 }, // disclosed Feb 1
      { effectiveDate: "2026-03-15", value: -9 }, // disclosed later
    ],
  };
  const sig = { kind: "feature_threshold", feature: "congress_net", op: ">", value: 0, side: "long" } as const;
  // On Jan 15 nothing is disclosed yet → flat (fail to cash, never guess)
  assertEquals(evalSignal(sig, feats, "2026-01-15"), 0);
  // On Feb 10 only the +5 is knowable → long
  assertEquals(evalSignal(sig, feats, "2026-02-10"), 1);
  // On Mar 20 the latest knowable is -9 → threshold fails → flat
  assertEquals(evalSignal(sig, feats, "2026-03-20"), 0);
});

Deno.test("runBacktest: buy-and-hold tracks the symbol; turnover cost only on entry", () => {
  const dates = isoDates(6);
  const sym: SymbolData = {
    symbol: "AAA", dates,
    returns: [0, 0.01, 0.02, -0.01, 0.03, 0.00],
    features: {},
  };
  const spec: StrategySpec = {
    family: "test", name: "bh", version: 1, universe: ["AAA"],
    signal: { kind: "always", side: "long" },
    sizing: { kind: "equal_weight", maxPositions: 1 }, costBps: 10,
  };
  const r = runBacktest(spec, panelOf(dates, [sym]));
  assertEquals(r.netReturns.length, 5); // T-1 decision bars
  // first decision bar pays entry turnover (0→1 = 1.0 turnover * 10bps = 0.001)
  assertAlmost(r.turnover[0], 1, 1e-9);
  assertAlmost(r.netReturns[0], (sym.returns[1]) - 0.001, 1e-9);
  // subsequent bars: weight stays 1 → zero turnover → no extra cost
  assertAlmost(r.turnover[1], 0, 1e-9);
  assertAlmost(r.netReturns[1], sym.returns[2], 1e-9);
});

Deno.test("SELF-TEST end-to-end: a congressional-copycat SPEC is rejected as sector beta", () => {
  const rng = lcg(2026);
  const n = 320;
  const dates = isoDates(n);
  // market factor with positive drift
  const mkt: number[] = [0];
  for (let t = 1; t < n; t++) mkt.push(0.0005 + 0.009 * gauss(rng));
  // MEGA is 0.85x the market + small idiosyncratic noise → pure beta, no alpha
  const megaRet: number[] = [0];
  for (let t = 1; t < n; t++) megaRet.push(0.85 * mkt[t] + 0.0015 * gauss(rng));
  // a congressional feature that's basically always "net buying" (always-long signal)
  const congress: PitRecord[] = [{ effectiveDate: "2026-01-01", value: 10 }];
  const mega: SymbolData = { symbol: "MEGA", dates, returns: megaRet, features: { congress_net: congress } };

  const spec: StrategySpec = {
    family: "congress", name: "copycat", version: 1, universe: ["MEGA"],
    signal: { kind: "feature_threshold", feature: "congress_net", op: ">", value: 0, side: "long" },
    sizing: { kind: "equal_weight", maxPositions: 1 }, costBps: 5,
  };
  // factors aligned to the decision grid (length n-1): the market return at t+1
  const factorMkt = mkt.slice(1); // returns earned at t→t+1 for t=0..n-2
  const ctx: TrialContext = { nTrials: 40, varTrialSharpes: 0.02, benchmarkSharpe: 0.03, factors: { mkt: factorMkt } };

  const res = backtest(spec, panelOf(dates, [mega]), ctx);
  assert(!res.verdict.passed, "copycat must be REJECTED");
  assert(
    res.verdict.failing.some((f) => f.includes("residual_alpha")),
    `expected residual_alpha failure, got ${JSON.stringify(res.verdict.failing)}`,
  );
  // the decomposition should attribute most variance to the market beta
  assert((res.stats.decomposition?.r2 ?? 0) > 0.6, "edge explained by market beta");
});

Deno.test("runKey is stable + content-addressed (idempotency)", () => {
  const spec: StrategySpec = {
    family: "f", name: "n", version: 2, universe: ["X"],
    signal: { kind: "always", side: "long" },
    sizing: { kind: "equal_weight", maxPositions: 1 }, costBps: 5,
  };
  assertEquals(runKeyFor(spec), runKeyFor({ ...spec }));
  assert(runKeyFor(spec) !== runKeyFor({ ...spec, version: 3 }), "version change → new key");
});

function panelOf(dates: string[], symbols: SymbolData[]): Panel {
  return { dates, symbols };
}
