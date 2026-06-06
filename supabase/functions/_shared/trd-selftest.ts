// trd-selftest.ts — the engine's pre-flight conscience.
//
// Before Aegis is trusted to judge ANY real strategy, it must prove — on
// deterministic adversarial fixtures — that it still kills the things it's
// supposed to kill. agent-trd-backtest calls runSelfTest() at startup and
// REFUSES to run if it fails (fail loud, never silently trust a broken gate).
// CI runs it too. This is the D-069 doctrine: fix the instance, enforce the class.

import { pboCSCV } from "./trd-stats.ts";
import { evaluateStrategy, gateVerdict } from "./trd-backtest-core.ts";
import { asOf, lookaheadViolations, PitRecord } from "./trd-point-in-time.ts";
import { backtest, BacktestResult, StrategySpec, SymbolData, TrialContext } from "./trd-strategy.ts";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}
function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SelfCheck { name: string; passed: boolean; detail: string; }
export interface SelfTestResult { passed: boolean; checks: SelfCheck[]; }

/** Deterministic. Returns a structured pass/fail for every invariant the engine's
 * honesty depends on. If passed===false, the caller must refuse to trade/judge. */
export function runSelfTest(): SelfTestResult {
  const checks: SelfCheck[] = [];

  // 1) An overfit (anti-persistent) selection is flagged by PBO.
  {
    const sBlocks = 8, blockLen = 8, N = 8;
    const M: number[][] = [];
    for (let b = 0; b < sBlocks; b++) {
      for (let i = 0; i < blockLen; i++) {
        const row: number[] = [];
        for (let s = 0; s < N; s++) row.push(s === b ? 1 + 0.001 * i : -1 + 0.001 * (i + s));
        M.push(row);
      }
    }
    const { pbo } = pboCSCV(M, 8);
    checks.push({ name: "overfit_flagged_by_pbo", passed: pbo >= 0.5, detail: `pbo=${pbo.toFixed(2)} (expect >=0.5)` });
  }

  // 2) A noise strategy is REJECTED by the gate.
  {
    const rng = lcg(11);
    const spy = Array.from({ length: 250 }, () => 0.0004 + 0.009 * gauss(rng));
    const returns = Array.from({ length: 250 }, () => 0.0001 + 0.01 * gauss(rng));
    const panel = evaluateStrategy({ returns, costBps: 22, nTrials: 100, varTrialSharpes: 0.02, benchmarkSharpe: 0.03, factors: { spy } });
    const v = gateVerdict(panel);
    checks.push({ name: "noise_rejected", passed: !v.passed, detail: v.passed ? "noise WRONGLY passed" : `rejected: ${v.failing[0]}` });
  }

  // 3) Look-ahead is structurally blocked.
  {
    const recs: PitRecord[] = [
      { effectiveDate: "2026-01-10", value: 1 },
      { effectiveDate: "2026-06-01", value: 2 },
    ];
    const visible = asOf(recs, "2026-02-01");
    const leaked = lookaheadViolations(recs, "2026-02-01");
    const ok = visible.length === 1 && leaked.length === 1 && !visible.some((r) => r.effectiveDate === "2026-06-01");
    checks.push({ name: "lookahead_blocked", passed: ok, detail: `visible=${visible.length} leaked=${leaked.length}` });
  }

  // 4) A congressional copycat is unmasked as sector beta and REJECTED end-to-end.
  {
    const res = runCopycatBacktest();
    const ok = !res.verdict.passed && (res.stats.decomposition?.r2 ?? 0) > 0.6;
    checks.push({ name: "copycat_unmasked_as_beta", passed: ok, detail: `passed=${res.verdict.passed} r2=${(res.stats.decomposition?.r2 ?? 0).toFixed(2)} fail=${JSON.stringify(res.verdict.failing)}` });
  }

  return { passed: checks.every((c) => c.passed), checks };
}

/** The canonical congressional-copycat demonstration backtest: a strategy that is
 * always-long a high-beta name on an "always net buying" signal. The engine must
 * unmask it as sector beta (no significant residual alpha) and REJECT. Exported so
 * the backtest CLI/edge-fn can persist this verdict as a real trd_backtest_runs
 * row — the D-070 success metric, recorded. */
export function runCopycatBacktest(): BacktestResult {
  const rng = lcg(2026);
  const n = 300;
  const base = Date.parse("2026-01-01T00:00:00Z");
  const dates = Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  const mkt: number[] = [0];
  for (let t = 1; t < n; t++) mkt.push(0.0005 + 0.009 * gauss(rng));
  const megaRet: number[] = [0];
  for (let t = 1; t < n; t++) megaRet.push(0.85 * mkt[t] + 0.0015 * gauss(rng));
  const mega: SymbolData = { symbol: "MEGA", dates, returns: megaRet, features: { congress_net: [{ effectiveDate: "2026-01-01", value: 10 }] } };
  const spec: StrategySpec = {
    family: "congress", name: "copycat", version: 1, universe: ["MEGA"],
    signal: { kind: "feature_threshold", feature: "congress_net", op: ">", value: 0, side: "long" },
    sizing: { kind: "equal_weight", maxPositions: 1 }, costBps: 5,
  };
  const ctx: TrialContext = { nTrials: 40, varTrialSharpes: 0.02, benchmarkSharpe: 0.03, factors: { mkt: mkt.slice(1) } };
  return backtest(spec, { dates, symbols: [mega] }, ctx);
}
