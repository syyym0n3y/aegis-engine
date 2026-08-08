#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// trd-wyckoff-evolve — run the TRIAL-HONEST evolutionary search over Wyckoff specs
// on a price universe, then push the WINNER through the same default-REJECT gate as
// every hand-written strategy (factor decomposition vs SPY, DSR deflated by the TRUE
// number of candidates the evolution ever tried).
//
// TWO DATA MODES (so the ladder is runnable before the live stack exists):
//   1. BARS_FILE=path.json  — offline. JSON: { "AAPL":[{ts,open,high,low,close,volume},...],
//                             ..., "SPY":[...] }. No DB, no broker, no network.
//   2. (default)            — reads trd_price_bars (OHLCV) + persists the verdict to
//                             the ledger, exactly like scripts/trd-strategy-backtest.ts.
//
//   BARS_FILE=/tmp/bars.json UNIVERSE="AAA,BBB,CCC" POP=40 GENS=8 SEED=123 \
//   deno run --allow-read scripts/trd-wyckoff-evolve.ts
//
// This NEVER promotes to real money. A PASS here means "cleared the statistical gate,
// now goes to PAPER on the ladder" — nothing more. The most likely outcome is REJECT,
// which per D-070 is a SUCCESS of the engine.

import { allWyckoffFeatures, WyckoffBar } from "../supabase/functions/_shared/trd-wyckoff.ts";
import { alignedReturns, buildPanel, FeatureSeries, PriceSeries } from "../supabase/functions/_shared/trd-panel.ts";
import { backtest, runBacktest, TrialContext } from "../supabase/functions/_shared/trd-strategy.ts";
import { gateVerdict } from "../supabase/functions/_shared/trd-backtest-core.ts";
import { evolve } from "../supabase/functions/_shared/trd-evolve.ts";

const BARS_FILE = Deno.env.get("BARS_FILE");
const UNIVERSE = (Deno.env.get("UNIVERSE") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const POP = Number(Deno.env.get("POP") ?? "40");
const GENS = Number(Deno.env.get("GENS") ?? "8");
const SEED = Number(Deno.env.get("SEED") ?? "123");
const COST_BPS = Number(Deno.env.get("COST_BPS") ?? "10");
const MIN_BARS = Number(Deno.env.get("MIN_BARS") ?? "300");
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

interface OHLCV { ts: string; open: number; high: number; low: number; close: number; volume: number }

function fail(msg: string): never { console.log(`\n  INSUFFICIENT DATA — ${msg}`); Deno.exit(0); }

// ---------- load bars (file or DB) ----------
async function loadBars(): Promise<{ bars: Map<string, OHLCV[]>; persist: boolean; sql?: unknown }> {
  if (BARS_FILE) {
    const raw = JSON.parse(await Deno.readTextFile(BARS_FILE)) as Record<string, OHLCV[]>;
    const m = new Map<string, OHLCV[]>();
    for (const [sym, rows] of Object.entries(raw)) {
      m.set(sym.toUpperCase(), [...rows].sort((a, b) => a.ts.localeCompare(b.ts)));
    }
    return { bars: m, persist: false };
  }
  const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.5/mod.js");
  const sql = postgres(DB);
  let tickers = UNIVERSE.length ? UNIVERSE : [];
  if (!tickers.length) {
    const r = await sql`select distinct symbol from trd_price_bars where timeframe='1Day'` as unknown as Array<{ symbol: string }>;
    tickers = r.map((x) => x.symbol);
  }
  const rows = await sql`select symbol, ts::text as ts, open::float8 as open, high::float8 as high,
    low::float8 as low, close::float8 as close, volume::float8 as volume
    from trd_price_bars where timeframe='1Day' and symbol in ${sql([...tickers, "SPY"] as [...string[], string])}
    order by symbol, ts` as unknown as Array<OHLCV & { symbol: string }>;
  const m = new Map<string, OHLCV[]>();
  for (const r of rows) (m.get(r.symbol) ?? m.set(r.symbol, []).get(r.symbol)!).push(r);
  return { bars: m, persist: true, sql };
}

const { bars, persist, sql } = await loadBars();
try {
  const spy = bars.get("SPY");
  if (!spy) fail("no SPY bars for the benchmark decomposition");
  const universe = (UNIVERSE.length ? UNIVERSE : [...bars.keys()]).filter((t) => t !== "SPY" && bars.has(t));
  const prices: PriceSeries[] = universe
    .map((t) => ({ symbol: t, bars: bars.get(t)!.map((b) => ({ ts: b.ts, close: b.close })) }))
    .filter((p) => p.bars.length >= MIN_BARS);
  if (!prices.length) fail(`no universe symbols with >= ${MIN_BARS} bars`);

  // Wyckoff + confidence-lever features, point-in-time, per symbol.
  const features: FeatureSeries[] = [];
  for (const p of prices) {
    const wb: WyckoffBar[] = bars.get(p.symbol)!.map((b) => ({ ts: b.ts, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const rows = allWyckoffFeatures(p.symbol, wb);
    const byKey = new Map<string, { effectiveDate: string; value: number }[]>();
    for (const r of rows) (byKey.get(r.feature_key) ?? byKey.set(r.feature_key, []).get(r.feature_key)!).push({ effectiveDate: r.effective_date, value: r.value });
    for (const [key, records] of byKey) features.push({ symbol: p.symbol, key, records });
  }

  const panel = buildPanel(prices, features);
  if (panel.dates.length < 252) fail(`only ${panel.dates.length} common trading days`);
  const factorSpy = alignedReturns({ symbol: "SPY", bars: spy.map((b) => ({ ts: b.ts, close: b.close })) }, panel.dates).slice(1);

  // ---- the evolution: runSpec returns NET returns; every candidate is a trial ----
  const univSyms = prices.map((p) => p.symbol);
  const res = evolve(
    { universe: univSyms, costBps: COST_BPS, populationSize: POP, generations: GENS, seed: SEED },
    (spec) => runBacktest(spec, panel).netReturns,
  );

  console.log(`\n[wyckoff-evolve]  ${prices.length} assets, ${panel.dates.length} days (${panel.dates[0]}…${panel.dates.at(-1)})`);
  console.log(`  search: pop=${POP} gens=${GENS} → N_trials=${res.nTrials} distinct candidates, seed=${SEED}`);

  if (!res.best) fail("no evaluable candidates");
  console.log(`  best in-sample: ${res.best.spec.name}`);
  console.log(`  best raw Sharpe/day=${res.best.sharpe.toFixed(3)}  →  DSR(deflated by ${res.nTrials})=${res.deflatedSharpeBest.toFixed(3)}  PBO=${res.pbo.toFixed(2)}`);
  console.log(`  ${res.note}`);

  // ---- honest full gate on the winner: residual alpha vs the factor zoo ----
  const ctx: TrialContext = {
    nTrials: res.nTrials,
    varTrialSharpes: res.varTrialSharpes,
    benchmarkSharpe: 0.03,
    factors: { spy: factorSpy },
  };
  const full = backtest(res.best.spec, panel, ctx);
  const v = gateVerdict(full.stats);
  const d = full.stats.decomposition;
  console.log(`  vs SPY: beta=${d?.betas.spy?.toFixed(2)}  r2=${d?.r2.toFixed(2)}  residual_alpha_t=${d?.residualAlphaT?.toFixed(2)}`);
  console.log(`  GATE VERDICT: ${v.passed ? "PASS → PAPER (ladder, not money)" : "REJECTED"} — ${v.failing.join(" | ") || "passed"}`);
  if (v.passed && res.overfit) console.log(`  ⚠ but PBO flags overfit — treat as REJECT until re-run out-of-sample.`);

  if (persist && sql) {
    const s = sql as (strings: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
    // record the winner as a spec + a backtest run carrying the TRUE trial count.
    await s`insert into trd_strategy_specs (family, name, version, spec)
      values (${res.best.spec.family}, ${res.best.spec.name}, 1, ${(sql as { json: (x: unknown) => unknown }).json(res.best.spec)})
      on conflict (family, name, version) do nothing`;
    const specRow = await s`select id from trd_strategy_specs where family=${res.best.spec.family} and name=${res.best.spec.name} and version=1` as unknown as Array<{ id: string }>;
    const specId = specRow[0]?.id;
    await s`insert into trd_trial_counter (family, run_key) values (${res.best.spec.family}, ${full.runKey}) on conflict (run_key) do nothing`;
    if (specId) {
      const stats = { ...full.stats, decomposition: undefined };
      await s`insert into trd_backtest_runs (spec_id, run_key, n_trials, stats, decomposition, passed)
        values (${specId}, ${full.runKey}, ${res.nTrials}, ${(sql as { json: (x: unknown) => unknown }).json(stats)}, ${(sql as { json: (x: unknown) => unknown }).json(full.stats.decomposition ?? {})}, ${v.passed})
        on conflict (run_key) do nothing`;
      await s`insert into trd_ladder_state (spec_id, rung, evidence, decided_by)
        values (${specId}, ${v.passed && !res.overfit ? "PAPER" : "REJECTED"}, ${(sql as { json: (x: unknown) => unknown }).json({ failing: v.failing, nTrials: res.nTrials, pbo: res.pbo })}, 'wyckoff-evolve')`;
    }
    console.log(`  ledger: winner + ${res.nTrials}-trial context persisted.`);
  }
} finally {
  if (persist && sql) await (sql as { end: () => Promise<void> }).end();
}
