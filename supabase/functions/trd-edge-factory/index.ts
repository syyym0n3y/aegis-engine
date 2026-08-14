// trd-edge-factory (D-297) — the AUTOMATED edge-discovery engine. Every point in the setup grammar
// (trigger × ema × trend × stop × rr × session = 2160 setups) × every free market is a queued trial.
// Each run: pull the next PENDING batch, fetch deep FREE+KEYLESS history (Binance multi-year 15m),
// run the grammar strategy → per-trade R WITH regime tags, build a MATCHED RANDOM control, and score
// through the SAME honest gauntlet as our validated edges:
//   vs-random SKILL (edge over a coin-flip in the same tape) · split-half OOS · dollar SKILL-vs-DRIFT
//   · CONVICTION-sized dollars (D-295 tight/up → larger). Survivors (t>=2 & holds-both) are written to
//   trd_edge_scorecard + trd_edge_dollar + trd_lineage as DISCOVERED edges — the same treatment orbfollow got.
// Idempotent (queue status guards re-runs), cron-driven → the human setup space is covered over time, $0.
// This does NOT trade. It discovers and judges. The base rate is brutal; almost nothing survives — that
// is the engine working, not failing (D-070).
import { runComponentTrades, enumerate, specKey, type ComponentSpec, type CTrade } from "../_shared/trd-grammar.ts";
import type { Bar } from "../_shared/trd-liquidity-grab.ts";
import { scoreDollar, type HarnessTrade } from "../_shared/trd-harness.ts";
import { edgeVsRandom } from "../_shared/trd-random-control.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
// D-303: cost is charged in BPS OF NOTIONAL, converted per-trade through the trade's own riskFrac
// (costR/side = (FEE_BPS/1e4)/riskFrac) — NOT a flat R constant. The old flat 0.05R/side was calibrated on
// gold; on 15m crypto the median stop is ~0.28% of notional, so a 10bp Binance spot taker fee is really
// ~0.36R/side — 7× the constant. Every one of the first 147 promoted candidates died on this correction.
const FEE_BPS = 10;           // Binance spot VIP0 taker, per side; entries are marketable at a bar open
const RISK_USD = 500;         // $ risked per 1R (0.5% of a $100k book) — same basis as trd_edge_dollar
const MIN_N = 30;             // fail closed below 30 trades
// The falsification bar MUST deflate for the search size, or 38,880 trials manufacture ~1,900 false t≥2 edges.
// Bonferroni for the grammar sweep (4860 specs × 8 markets ≈ 3.9e4 trials): promote only at p≈0.05/3.9e4 two-sided
// → t ≈ 4.4. A raw t≥2 is recorded on the queue for analysis, but ONLY t≥DEFLATED_T + holds-both promotes to a
// candidate. This is what keeps the accelerated factory a falsification engine, not a false-edge factory (D-070).
const DEFLATED_T = 4.4;
// Deep-history keyless Binance markets. The queue SELF-SEEDS the full grammar (4860 specs) per market on
// first sight, so coverage widens by editing this list — no external seed job. Universe expansion (more
// coins) is additive: add symbols here (or a trd_edge_markets table) and the cron fills them in.
const MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT",
  "AVAXUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT", "ATOMUSDT", "ETCUSDT", "XLMUSDT", "BCHUSDT"]; // 16 deep-history keyless
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

// self-seed: for any market with no queue rows yet, enumerate the grammar and insert its trials pending.
async function seedMarkets(): Promise<Record<string, number>> {
  const seeded: Record<string, number> = {};
  const specs = enumerate();
  for (const market of MARKETS) {
    const existing = await fetch(`${SB}/rest/v1/trd_edge_queue?market=eq.${market}&select=spec_key&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (Array.isArray(existing) && existing.length) continue;
    const rows = specs.map((s) => ({ spec_key: specKey(s), market, spec: s, source: "grammar", status: "pending", priority: 5 }));
    // chunked insert to stay under payload limits (4860 rows/market)
    for (let i = 0; i < rows.length; i += 1500) {
      await fetch(`${SB}/rest/v1/trd_edge_queue?on_conflict=spec_key,market`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1500)) }).catch(() => {});
    }
    seeded[market] = rows.length;
  }
  return seeded;
}

// D-295 conviction ported to grammar regime tags: tight range (lo vol) & up-trend size UP; wide/down size DOWN.
function convOf(r?: Record<string, string>): number {
  const volM = r?.vol === "lo" ? 1.5 : r?.vol === "hi" ? 0.6 : 1.0;   // lo vol ≈ tight range = highest-quality (D-271)
  const trM = r?.trend === "up" ? 1.2 : r?.trend === "down" ? 0.85 : 1.0;
  return volM * trM;
}

// Binance multi-year 15m (keyless, paginated) — deep history so OOS is real, not a 60-day artifact.
async function klines(sym: string, years: number): Promise<Bar[]> {
  const out: Bar[] = []; let cur = Date.now() - years * 365 * 864e5; const now = Date.now(); let calls = 0;
  while (cur < now && calls < 260) {
    calls++;
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&startTime=${cur}&limit=1000`).catch(() => null);
    if (!r || !r.ok) break; const j = await r.json().catch(() => null);
    if (!Array.isArray(j) || !j.length) break;
    for (const k of j) out.push({ ts: new Date(k[0]).toISOString(), open: +k[1], high: +k[2], low: +k[3], close: +k[4] });
    cur = j[j.length - 1][6] + 1; if (j.length < 1000) break;
  }
  return out;
}

// D-299: read cached bars (refreshed ≤24h) instead of re-pulling ~70 paginated Binance calls (~25s) every run.
async function getBars(market: string, years: number): Promise<Bar[]> {
  const cached = await fetch(`${SB}/rest/v1/trd_bars_cache?market=eq.${market}&select=bars,updated_at`, { headers: H }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(cached) && cached.length) {
    const age = Date.now() - new Date((cached[0] as { updated_at: string }).updated_at).getTime();
    const b = (cached[0] as { bars: Bar[] }).bars;
    if (age < 864e5 && Array.isArray(b) && b.length > 500) return b;
  }
  const bars = await klines(market, years);
  if (bars.length >= 500) await fetch(`${SB}/rest/v1/trd_bars_cache?on_conflict=market`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ market, years, bars, updated_at: new Date().toISOString() }) }).catch(() => {});
  return bars;
}

function mulberry(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// MATCHED random control: same count as the setup, random entry bar, random side, IDENTICAL stop geometry
// (swing over stopLookback) and rr, resolved stop-first with the same cost. Drift cancels between the two.
const HORIZON = 400; // max bars a trade is held before mark-to-market — bounds compute to O(count·HORIZON) and
                     // is realistic (an intraday setup isn't carried for years). Applies to setup & control alike.
function randomControl(bars: Bar[], s: ComponentSpec, count: number, seed: number): number[] {
  const rnd = mulberry(seed); const out: number[] = []; const n = bars.length; let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard++;
    const i = Math.floor(rnd() * (n - s.stopLookback - 5)) + s.stopLookback;
    if (i <= s.stopLookback || i >= n - 2) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - s.stopLookback; j < i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    const side: "long" | "short" = rnd() < 0.5 ? "long" : "short";
    const entry = bars[i].open, stop = side === "long" ? lo : hi, dir = side === "long" ? 1 : -1;
    const risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    const target = entry + dir * s.rr * risk;
    const end = Math.min(n, i + HORIZON); let r: number | null = null;
    for (let k = i; k < end; k++) {
      const b = bars[k];
      if (side === "long") { if (b.low <= stop) { r = -1; break; } if (b.high >= target) { r = s.rr; break; } }
      else { if (b.high >= stop) { r = -1; break; } if (b.low <= target) { r = s.rr; break; } }
    }
    if (r === null) r = dir * (bars[Math.min(n, end) - 1].close - entry) / risk; // mark-to-market at horizon
    out.push(r - 2 * (FEE_BPS / 1e4) / (risk / entry)); // same bps-of-notional costing as the setup leg
  }
  return out;
}

/** Real cost in R for one trade: a bps-of-notional fee divided by how big 1R is as a fraction of notional. */
const netR = (t: CTrade) => t.r - 2 * (FEE_BPS / 1e4) / t.riskFrac;

function toHarness(t: CTrade): HarnessTrade {
  return { r: netR(t), stopFrac: 1, period: t.entryTs.slice(0, 7), regime: { trend: t.trend, vol: t.vol, session: t.session } };
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const years = +(u.searchParams.get("years") || "1.0"); // 1yr: valid split-half OOS + half the CPU/cache of 2yr
    const budgetMs = Math.min(140000, +(u.searchParams.get("budgetMs") || "60000")); // wall safety (CPU is the real cap)
    const page = Math.min(500, +(u.searchParams.get("page") || "40"));
    const maxSpecs = Math.min(2000, +(u.searchParams.get("maxSpecs") || "40")); // CPU ceiling per run (~2s CPU limit)
    const t0 = Date.now();
    const seeded = (u.searchParams.get("seed") === "1") ? await seedMarkets() : {};
    // ONE market per run (bars cached → no refetch). Explicit ?market= lets 8 crons run all markets in parallel;
    // otherwise take the first pending market. Each market's specs advance independently.
    const reqMarket = u.searchParams.get("market");
    let market: string | null = reqMarket;
    if (!market) {
      const first = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.pending&select=market&order=priority.asc,market.asc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
      market = Array.isArray(first) && first.length ? (first[0] as { market: string }).market : null;
    }
    if (!market) return new Response(JSON.stringify({ ok: true, done: "queue empty", seeded }), { headers: cors });
    const bars = await getBars(market, years);
    if (bars.length < 500) {
      await fetch(`${SB}/rest/v1/trd_edge_queue?market=eq.${market}&status=eq.pending`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "thin", run_at: new Date().toISOString() }) }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, market, skip: "thin", bars: bars.length }), { headers: cors });
    }
    const now = new Date().toISOString();
    let processed = 0, thin = 0; const survivors: Record<string, unknown>[] = [];
    const scRows: Record<string, unknown>[] = [], dolRows: Record<string, unknown>[] = [], linRows: Record<string, unknown>[] = [];
    // page through this market's pending specs; flush each page's status in ONE bulk upsert before the next page
    while (Date.now() - t0 < budgetMs && processed < maxSpecs) {
      const specs = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.pending&market=eq.${market}&select=spec_key,spec&limit=${page}`, { headers: H }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(specs) || !specs.length) break;
      const before = processed;
      const updates: Record<string, unknown>[] = [];
      for (const { spec_key, spec } of specs as { spec_key: string; spec: ComponentSpec }[]) {
        if (Date.now() - t0 >= budgetMs || processed >= maxSpecs) break;
        // run GROSS (costRPerSide 0) then re-cost each trade from its own riskFrac (D-303)
        const trades = runComponentTrades(bars, spec, { costRPerSide: 0 }).filter((t) => t.riskFrac > 0);
        // UNIFORM columns across every row — PostgREST merge-duplicates rejects a batch whose rows differ in shape,
        // so thin and scored rows MUST carry the same keys (metrics null-defaulted). `spec` satisfies the INSERT-path
        // NOT NULL; `source` is omitted so provenance (grammar vs ingest:*) is preserved on update.
        const upd: Record<string, unknown> = { spec_key, market, spec, status: "done", n: trades.length, run_at: now,
          vs_random_edge: null, vs_random_t: null, holds_both: null, skill_usd: null, skill_frac: null, passes: false };
        if (trades.length >= MIN_N) {
          const setupR = trades.map(netR);
          const ctrlR = randomControl(bars, spec, trades.length, spec_key.length * 131 + trades.length); // matched-count honest control
          const vr = edgeVsRandom(setupR, ctrlR, 2, MIN_N);
          const months = [...new Set(trades.map((t) => t.entryTs.slice(0, 7)))].sort();
          const mid = months[Math.floor(months.length / 2)];
          const h1 = trades.filter((t) => t.entryTs.slice(0, 7) < mid).map(netR);
          const h2 = trades.filter((t) => t.entryTs.slice(0, 7) >= mid).map(netR);
          const c1 = ctrlR.slice(0, h1.length), c2 = ctrlR.slice(h1.length);
          const e1 = h1.length && c1.length ? mean(h1) - mean(c1) : NaN, e2 = h2.length && c2.length ? mean(h2) - mean(c2) : NaN;
          const holdsBoth = h1.length >= 10 && h2.length >= 10 && e1 > 0 && e2 > 0;
          const hs = trades.map(toHarness), hc = ctrlR.map((r) => ({ r, stopFrac: 1 } as HarnessTrade));
          const dv = scoreDollar(spec_key, hs, hc, 0, RISK_USD, convOf);
          const netAbsR = mean(setupR); // net of REAL bps-of-notional cost, per-trade via riskFrac (D-303)
          // PROMOTE requires BOTH: skill (beats random, deflated t) AND profitability (net abs R > 0). D-302: skill
          // alone promoted 87% "less-bad-than-random LOSERS" (e.g. fvg rr0.5: t=7.7 but abs_r −0.14). A tradeable
          // edge must make money in absolute terms, not merely lose less than a coin flip.
          const promote = vr.tStat >= DEFLATED_T && holdsBoth && netAbsR > 0;
          Object.assign(upd, { vs_random_edge: +vr.edge.toFixed(4), vs_random_t: +vr.tStat.toFixed(2), holds_both: holdsBoth, skill_usd: dv.skillUsd, skill_frac: dv.n ? +(dv.skillUsd / (dv.flatUsd || 1)).toFixed(3) : null, passes: promote });
          if (promote) {
            const eid = `fac:${spec_key}@${market}`;
            scRows.push({ edge: eid, run_at: now, n: trades.length, n_trials: 1, abs_r: +mean(setupR).toFixed(4), vs_random_edge: +vr.edge.toFixed(4), vs_random_t: +vr.tStat.toFixed(2), vs_random_passes: vr.passes, oos_h1: +e1.toFixed(4), oos_h2: +e2.toFixed(4), holds_both: holdsBoth, gate_passed: false, gate_failing: ["forward-unconfirmed"], detail: { source: "edge-factory grammar", market, spec } });
            dolRows.push({ edge: eid, n: trades.length, risk_usd: RISK_USD, flat_usd: dv.flatUsd, skill_usd: dv.skillUsd, drift_usd: dv.driftUsd, skill_frac: dv.flatUsd ? +(dv.skillUsd / dv.flatUsd).toFixed(3) : null, skill_per_100: +(vr.edge * 100 * RISK_USD).toFixed(0), conv_applied: true, frameworks: "vs-random+OOS+skill$+conviction$", note: "DISCOVERED by factory — forward-unconfirmed" });
            linRows.push({ id: eid, name: `${spec_key}@${market}`, family: "edge-factory", hypothesis: `${spec_key} on ${market}`, test_method: "grammar vs matched-random, split-half OOS, dollar skill/drift+conviction", key_metric: `vs-random +${vr.edge.toFixed(4)}R t=${vr.tStat.toFixed(2)}; skill$ ${dv.skillUsd} (${dv.n} trades); conv$ ${dv.convUsd}`, verdict: "candidate", status: "forward-pending", decision_refs: ["D-297"] });
            survivors.push({ spec_key, market, t: +vr.tStat.toFixed(2), skill_usd: dv.skillUsd, conv_usd: dv.convUsd });
          }
        } else { upd.status = "thin"; thin++; }
        updates.push(upd); processed++;
      }
      if (updates.length) await fetch(`${SB}/rest/v1/trd_edge_queue?on_conflict=spec_key,market`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(updates) }).catch(() => {});
      if (processed === before) break; // no-progress guard: never re-fetch the same page forever
    }
    // honour the trial-count invariant: every backtest this run increments the global counter (deflation depends on it)
    if (processed) await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: processed }) }).catch(() => {});
    // flush survivor promotions in bulk (usually 0)
    if (scRows.length) await fetch(`${SB}/rest/v1/trd_edge_scorecard?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(scRows) }).catch(() => {});
    if (dolRows.length) await fetch(`${SB}/rest/v1/trd_edge_dollar?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(dolRows) }).catch(() => {});
    if (linRows.length) await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(linRows) }).catch(() => {});
    const remain = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.pending&select=spec_key`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } }).then((r) => r.headers.get("content-range")).catch(() => null);
    return new Response(JSON.stringify({ ok: true, seeded, market, bars: bars.length, processed, thin, survivors: survivors.length, survivorRows: survivors, remaining: remain, elapsedMs: Date.now() - t0 }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
