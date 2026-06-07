#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-strategy-backtest — generic falsification backtest for a feature-threshold
// strategy on a price universe, decomposed vs SPY, through the default-REJECT gate.
// Deflates the Sharpe by the TOTAL number of strategies ever tried (honest
// multiple-testing correction — the engine must not commit the sin it exists to catch).
//
//   FAMILY=trend NAME=tsmom_252 FEATURE_KEY=mom_252 OP='>' THRESHOLD=0 \
//   UNIVERSE="SPY,QQQ,IWM,TLT,GLD,DBC,HYG" \
//   deno run --allow-net --allow-env scripts/trd-strategy-backtest.ts

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { alignedReturns, buildPanel, FeatureSeries, PriceSeries } from "../supabase/functions/_shared/trd-panel.ts";
import { backtest, Signal, StrategySpec, TrialContext } from "../supabase/functions/_shared/trd-strategy.ts";
import { gateVerdict } from "../supabase/functions/_shared/trd-backtest-core.ts";

const FAMILY = Deno.env.get("FAMILY") ?? "trend";
const NAME = Deno.env.get("NAME") ?? "tsmom_252";
const FEATURE_KEY = Deno.env.get("FEATURE_KEY") ?? "mom_252";
const OP = (Deno.env.get("OP") ?? ">") as ">" | ">=" | "<" | "<=";
const THRESHOLD = Number(Deno.env.get("THRESHOLD") ?? "0");
const MIN_BARS = Number(Deno.env.get("MIN_BARS") ?? "1000");
const COST_BPS = Number(Deno.env.get("COST_BPS") ?? "10");
const MAX_POS = Number(Deno.env.get("MAX_POS") ?? "12");
const UNIVERSE = (Deno.env.get("UNIVERSE") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB);

function fail(msg: string): never { console.log(`\n  INSUFFICIENT DATA — ${msg}`); Deno.exit(0); }

try {
  let tickers = UNIVERSE;
  if (tickers.length === 0) {
    const r = await sql`select distinct symbol from trd_features where feature_key=${FEATURE_KEY}` as unknown as Array<{ symbol: string }>;
    tickers = r.map((x) => x.symbol);
  }
  if (tickers.length === 0) fail(`no symbols carry feature ${FEATURE_KEY}`);

  const priceRows = await sql`select symbol, ts::text as ts, close::float8 as close
    from trd_price_bars where timeframe='1Day' and symbol in ${sql([...tickers, "SPY"] as [...string[], string])} order by symbol, ts` as unknown as Array<{ symbol: string; ts: string; close: number }>;
  const bySym = new Map<string, { ts: string; close: number }[]>();
  for (const r of priceRows) (bySym.get(r.symbol) ?? bySym.set(r.symbol, []).get(r.symbol)!).push({ ts: r.ts, close: r.close });
  const spy = bySym.get("SPY");
  if (!spy) fail("no SPY bars for the benchmark decomposition");

  const prices: PriceSeries[] = tickers.filter((t) => bySym.has(t))
    .map((t) => ({ symbol: t, bars: bySym.get(t)! })).filter((p) => p.bars.length >= MIN_BARS);
  if (prices.length === 0) fail("no universe symbols with enough history");

  const featRows = await sql`select symbol, effective_date::text as ed, value::float8 as v
    from trd_features where feature_key=${FEATURE_KEY} and symbol in ${sql(prices.map((p) => p.symbol) as [...string[], string])}` as unknown as Array<{ symbol: string; ed: string; v: number }>;
  const features: FeatureSeries[] = prices.map((p) => ({
    symbol: p.symbol, key: FEATURE_KEY,
    records: featRows.filter((f) => f.symbol === p.symbol).map((f) => ({ effectiveDate: f.ed, value: f.v })),
  }));

  const panel = buildPanel(prices, features);
  if (panel.dates.length < 252) fail(`only ${panel.dates.length} common trading days`);

  const signal: Signal = { kind: "feature_threshold", feature: FEATURE_KEY, op: OP, value: THRESHOLD, side: "long" };
  const spec: StrategySpec = { family: FAMILY, name: NAME, version: 1, universe: prices.map((p) => p.symbol), signal, sizing: { kind: "equal_weight", maxPositions: MAX_POS }, costBps: COST_BPS };
  const factorSpy = alignedReturns({ symbol: "SPY", bars: spy }, panel.dates).slice(1);

  // honest multiple-testing: deflate by the TOTAL strategies ever tried + this battery
  const [{ n: triedSoFar }] = await sql`select count(*)::int n from trd_trial_counter` as unknown as Array<{ n: number }>;
  const nTrials = Math.max(9, triedSoFar + 1);

  const ctx: TrialContext = { nTrials, varTrialSharpes: 0.04, benchmarkSharpe: 0.03, factors: { spy: factorSpy } };
  const res = backtest(spec, panel, ctx);
  const v = gateVerdict(res.stats);

  await sql`insert into trd_strategy_specs (family, name, version, spec) values (${FAMILY}, ${NAME}, 1, ${sql.json(spec as unknown as Parameters<typeof sql.json>[0])}) on conflict (family, name, version) do nothing`;
  const [{ id: specId }] = await sql`select id from trd_strategy_specs where family=${FAMILY} and name=${NAME} and version=1` as unknown as Array<{ id: string }>;
  await sql`insert into trd_trial_counter (family, run_key) values (${FAMILY}, ${res.runKey}) on conflict (run_key) do nothing`;
  const stats = { ...res.stats, decomposition: undefined };
  await sql`insert into trd_backtest_runs (spec_id, run_key, n_trials, stats, decomposition, passed)
    values (${specId}, ${res.runKey}, ${nTrials}, ${sql.json(stats as Parameters<typeof sql.json>[0])}, ${sql.json((res.stats.decomposition ?? {}) as Parameters<typeof sql.json>[0])}, ${v.passed}) on conflict (run_key) do nothing`;
  await sql`insert into trd_ladder_state (spec_id, rung, evidence, decided_by)
    values (${specId}, ${v.passed ? "PAPER" : "REJECTED"}, ${sql.json({ failing: v.failing, n: res.stats.n, nTrials } as Parameters<typeof sql.json>[0])}, 'architect-gate')`;

  const d = res.stats.decomposition;
  console.log(`\n[${FAMILY}:${NAME}]  ${prices.length} assets, ${panel.dates.length} days (${panel.dates[0]}…${panel.dates.at(-1)}), N_trials=${nTrials}`);
  console.log(`  ann.return≈${(res.stats.meanNetOfCost * 252 * 100).toFixed(1)}%/yr  maxDD=${(res.stats.maxDrawdown * 100).toFixed(0)}%  Sharpe/day=${res.stats.sharpePerPeriod.toFixed(3)}`);
  console.log(`  vs SPY: beta=${d?.betas.spy?.toFixed(2)}  r2=${d?.r2.toFixed(2)}  residual_alpha_t=${d?.residualAlphaT.toFixed(2)}  DSR=${res.stats.deflatedSharpe.toFixed(3)}`);
  console.log(`  VERDICT: ${v.passed ? "PASS→PAPER" : "REJECTED"} — ${v.failing.join(" | ") || "passed"}`);
} finally {
  await sql.end();
}
