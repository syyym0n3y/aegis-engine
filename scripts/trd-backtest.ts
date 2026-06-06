#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-backtest — the falsification engine's runtime entrypoint.
//   1. runSelfTest() — REFUSE to run if the engine can't prove it still kills
//      bad strategies (fail loud).
//   2. Run the canonical congressional-copycat backtest and PERSIST the verdict
//      (trd_strategy_specs + trd_trial_counter + trd_backtest_runs + trd_ladder_state)
//      — recording, on the live DB, that the engine correctly REJECTED it.
//
//   deno run --allow-net --allow-env scripts/trd-backtest.ts

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { runCopycatBacktest, runSelfTest } from "../supabase/functions/_shared/trd-selftest.ts";

const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// 1) PRE-FLIGHT — the engine must prove itself before it judges anything.
const self = runSelfTest();
for (const c of self.checks) console.log(`[selftest] ${c.passed ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
if (!self.passed) {
  console.error("[backtest] REFUSING TO RUN — engine self-test failed. A broken gate must never judge real money.");
  Deno.exit(1);
}

// 2) Run + persist the canonical copycat verdict.
const res = runCopycatBacktest();
const [family, name, vraw] = res.runKey.split(":");
const version = Number(vraw.replace("v", ""));
const spec = { family, name, version, kind: "selftest_copycat_demo", note: "always-long high-beta on 'always net buying' — must be killed as sector beta" };

const sql = postgres(DB);
try {
  await sql`insert into trd_strategy_specs (family, name, version, spec)
    values (${family}, ${name}, ${version}, ${sql.json(spec)})
    on conflict (family, name, version) do nothing`;
  const [{ id: specId }] = await sql`select id from trd_strategy_specs where family=${family} and name=${name} and version=${version}`;

  await sql`insert into trd_trial_counter (family, run_key) values (${family}, ${res.runKey}) on conflict (run_key) do nothing`;

  const stats = { ...res.stats, decomposition: undefined };
  await sql`insert into trd_backtest_runs (spec_id, run_key, n_trials, stats, decomposition, passed)
    values (${specId}, ${res.runKey}, ${res.stats.nTrials}, ${sql.json(stats as Parameters<typeof sql.json>[0])}, ${sql.json((res.stats.decomposition ?? {}) as Parameters<typeof sql.json>[0])}, ${res.verdict.passed})
    on conflict (run_key) do nothing`;

  await sql`insert into trd_ladder_state (spec_id, rung, evidence, decided_by)
    values (${specId}, ${res.verdict.passed ? "PAPER" : "REJECTED"}, ${sql.json({ failing: res.verdict.failing, runKey: res.runKey })}, 'architect-gate')`;

  console.log(`\n[backtest] ${res.runKey}`);
  console.log(`[backtest] verdict: ${res.verdict.passed ? "PASS→PAPER" : "REJECTED"}`);
  console.log(`[backtest] reasons: ${res.verdict.failing.join(" | ")}`);
  console.log(`[backtest] decomposition: r2=${res.stats.decomposition?.r2.toFixed(2)} betas=${JSON.stringify(res.stats.decomposition?.betas)} residualAlpha_t=${res.stats.decomposition?.residualAlphaT.toFixed(2)}`);
  console.log(`[backtest] persisted → trd_backtest_runs + trd_ladder_state`);
} finally {
  await sql.end();
}
