#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-insider-backtest — the FIRST real strategy through the gate: an insider
// cluster-buy. Long a name once >=2 distinct insiders bought open-market in the
// trailing 30d (the feature), decomposed against SPY so any "edge" is checked for
// being mere market beta. Persists the verdict. Default REJECT.
//
//   deno run --allow-net --allow-env scripts/trd-insider-backtest.ts [minBuyers]

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { buildPanel, FeatureSeries, PriceSeries, alignedReturns } from "../supabase/functions/_shared/trd-panel.ts";
import { backtest, StrategySpec, TrialContext } from "../supabase/functions/_shared/trd-strategy.ts";
import { gateVerdict } from "../supabase/functions/_shared/trd-backtest-core.ts";

const minBuyers = Number(Deno.args[0] ?? "2");
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB);

function fail(msg: string): never {
  console.log(`\n  INSUFFICIENT DATA — ${msg}`);
  console.log("  Unblock: (1) free Alpaca paper acct → ./scripts/trd-ingest-prices.ts (prices),");
  console.log("           (2) historical buy events → ./scripts/trd-ingest-edgar.ts over more dates.");
  Deno.exit(0);
}

try {
  // tickers with a real insider cluster-buy in the feature store
  const buyRows = await sql`select distinct symbol from trd_features
    where feature_key='insider_open_market_buyers_30d' and value >= ${minBuyers}` as unknown as Array<{ symbol: string }>;
  const tickers: string[] = buyRows.map((r) => r.symbol);
  console.log(`[insider] cluster-buy tickers (>=${minBuyers} buyers): ${tickers.length ? tickers.join(", ") : "(none)"}`);
  if (tickers.length === 0) fail("0 cluster-buy tickers in the feature store (sample has no open-market buys yet)");

  // prices for those tickers + SPY
  const priceRows = await sql`select symbol, ts::text as ts, close::float8 as close
    from trd_price_bars where timeframe='1Day' and symbol in ${sql([...tickers, "SPY"] as [...string[], string])} order by symbol, ts` as unknown as Array<{ symbol: string; ts: string; close: number }>;
  if (priceRows.length === 0) fail("0 price bars (run trd-ingest-prices with Alpaca creds)");

  const bySym = new Map<string, { ts: string; close: number }[]>();
  for (const r of priceRows) (bySym.get(r.symbol) ?? bySym.set(r.symbol, []).get(r.symbol)!).push({ ts: r.ts, close: r.close });
  const spy = bySym.get("SPY");
  if (!spy) fail("no SPY bars for the market-factor decomposition");

  const prices: PriceSeries[] = tickers
    .filter((t) => bySym.has(t))
    .map((t) => ({ symbol: t, bars: bySym.get(t)! }))
    .filter((p) => p.bars.length >= 60); // drop too-new/illiquid names (strict intersection grid)
  console.log(`[insider] priced tickers (>=60 bars): ${prices.map((p) => `${p.symbol}(${p.bars.length})`).join(", ") || "(none)"}`);
  if (prices.length === 0) fail("none of the cluster-buy tickers have enough price history");

  // insider feature records as point-in-time signal per ticker
  const featRows = await sql`select symbol, effective_date::text as ed, value::float8 as v
    from trd_features where feature_key='insider_open_market_buyers_30d' and symbol in ${sql(tickers as [...string[], string])}` as unknown as Array<{ symbol: string; ed: string; v: number }>;
  const features: FeatureSeries[] = prices.map((p) => ({
    symbol: p.symbol, key: "insider_open_market_buyers_30d",
    records: featRows.filter((f) => f.symbol === p.symbol).map((f) => ({ effectiveDate: f.ed, value: f.v })),
  }));

  const panel = buildPanel(prices, features);
  if (panel.dates.length < 30) fail(`only ${panel.dates.length} common trading days — too few to judge`);

  const spec: StrategySpec = {
    family: "insider", name: `cluster_buy_${minBuyers}`, version: 1, universe: prices.map((p) => p.symbol),
    signal: { kind: "feature_threshold", feature: "insider_open_market_buyers_30d", op: ">=", value: minBuyers, side: "long" },
    sizing: { kind: "equal_weight", maxPositions: 5 }, costBps: 10,
  };
  const factorSpy = alignedReturns({ symbol: "SPY", bars: spy }, panel.dates).slice(1);
  const ctx: TrialContext = { nTrials: 1, varTrialSharpes: 0.02, benchmarkSharpe: 0.03, factors: { spy: factorSpy } };

  const res = backtest(spec, panel, ctx);
  const v = gateVerdict(res.stats);

  // persist
  await sql`insert into trd_strategy_specs (family, name, version, spec)
    values (${spec.family}, ${spec.name}, ${spec.version}, ${sql.json(spec as unknown as Parameters<typeof sql.json>[0])})
    on conflict (family, name, version) do nothing`;
  const [{ id: specId }] = await sql`select id from trd_strategy_specs where family=${spec.family} and name=${spec.name} and version=${spec.version}`;
  await sql`insert into trd_trial_counter (family, run_key) values (${spec.family}, ${res.runKey}) on conflict (run_key) do nothing`;
  const stats = { ...res.stats, decomposition: undefined };
  await sql`insert into trd_backtest_runs (spec_id, run_key, n_trials, stats, decomposition, passed)
    values (${specId}, ${res.runKey}, ${res.stats.nTrials}, ${sql.json(stats as Parameters<typeof sql.json>[0])}, ${sql.json((res.stats.decomposition ?? {}) as Parameters<typeof sql.json>[0])}, ${v.passed})
    on conflict (run_key) do nothing`;
  await sql`insert into trd_ladder_state (spec_id, rung, evidence, decided_by)
    values (${specId}, ${v.passed ? "PAPER" : "REJECTED"}, ${sql.json({ failing: v.failing, n: res.stats.n } as Parameters<typeof sql.json>[0])}, 'architect-gate')`;

  console.log(`\n[insider] ${res.runKey}  (n=${res.stats.n} decision bars)`);
  console.log(`[insider] verdict: ${v.passed ? "PASS→PAPER" : "REJECTED"}`);
  console.log(`[insider] reasons: ${v.failing.join(" | ") || "(passed)"}`);
  console.log(`[insider] decomposition: r2=${res.stats.decomposition?.r2.toFixed(2)} spy_beta=${res.stats.decomposition?.betas.spy?.toFixed(2)} residual_alpha_t=${res.stats.decomposition?.residualAlphaT.toFixed(2)}`);
} finally {
  await sql.end();
}
