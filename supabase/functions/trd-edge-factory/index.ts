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
const COST_R = 0.05;          // per-side cost in R (grammar nets it in) — pessimistic, gold-calibrated (D-080)
const RISK_USD = 500;         // $ risked per 1R (0.5% of a $100k book) — same basis as trd_edge_dollar
const MIN_N = 30;             // fail closed below 30 trades
// Deep-history keyless Binance markets. The queue SELF-SEEDS the full grammar (4860 specs) per market on
// first sight, so coverage widens by editing this list — no external seed job. Universe expansion (more
// coins) is additive: add symbols here (or a trd_edge_markets table) and the cron fills them in.
const MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"];
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

function mulberry(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// MATCHED random control: same count as the setup, random entry bar, random side, IDENTICAL stop geometry
// (swing over stopLookback) and rr, resolved stop-first with the same cost. Drift cancels between the two.
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
    let r: number | null = null;
    for (let k = i; k < n; k++) {
      const b = bars[k];
      if (side === "long") { if (b.low <= stop) { r = -1; break; } if (b.high >= target) { r = s.rr; break; } }
      else { if (b.high >= stop) { r = -1; break; } if (b.low <= target) { r = s.rr; break; } }
    }
    if (r === null) r = dir * (bars[n - 1].close - entry) / risk;
    out.push(r - 2 * COST_R);
  }
  return out;
}

function toHarness(t: CTrade): HarnessTrade {
  return { r: t.r, stopFrac: 1, period: t.entryTs.slice(0, 7), regime: { trend: t.trend, vol: t.vol, session: t.session } };
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const batch = Math.min(60, +(u.searchParams.get("batch") || "20"));
    const years = +(u.searchParams.get("years") || "2.0");
    const seeded = (u.searchParams.get("seed") === "1" || u.searchParams.get("seed") === null) ? await seedMarkets() : {};
    // pull next pending trials, grouped by market so we fetch each market's bars ONCE
    const pending = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.pending&select=spec_key,market,spec&order=priority.asc&limit=${batch}`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(pending) || !pending.length) return new Response(JSON.stringify({ ok: true, done: "queue empty" }), { headers: cors });
    const byMarket = new Map<string, { spec_key: string; spec: ComponentSpec }[]>();
    for (const p of pending as { spec_key: string; market: string; spec: ComponentSpec }[]) {
      (byMarket.get(p.market) || byMarket.set(p.market, []).get(p.market))!.push({ spec_key: p.spec_key, spec: p.spec });
    }
    const results: Record<string, unknown>[] = [];
    for (const [market, items] of byMarket) {
      const bars = await klines(market, years);
      if (bars.length < 500) { // thin market — mark its trials thin so the queue advances
        await fetch(`${SB}/rest/v1/trd_edge_queue?market=eq.${market}&status=eq.pending`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "thin", run_at: new Date().toISOString() }) }).catch(() => {});
        results.push({ market, skip: "thin", bars: bars.length }); continue;
      }
      for (const { spec_key, spec } of items) {
        const trades = runComponentTrades(bars, spec, { costRPerSide: COST_R });
        const upd: Record<string, unknown> = { status: "done", n: trades.length, run_at: new Date().toISOString() };
        if (trades.length >= MIN_N) {
          const setupR = trades.map((t) => t.r);
          const ctrlR = randomControl(bars, spec, trades.length, spec_key.length * 131 + trades.length);
          const vr = edgeVsRandom(setupR, ctrlR, 2, MIN_N);
          // split-half OOS by median entry-month
          const months = [...new Set(trades.map((t) => t.entryTs.slice(0, 7)))].sort();
          const mid = months[Math.floor(months.length / 2)];
          const h1 = trades.filter((t) => t.entryTs.slice(0, 7) < mid).map((t) => t.r);
          const h2 = trades.filter((t) => t.entryTs.slice(0, 7) >= mid).map((t) => t.r);
          const c1 = ctrlR.slice(0, h1.length), c2 = ctrlR.slice(h1.length);
          const e1 = h1.length && c1.length ? mean(h1) - mean(c1) : NaN, e2 = h2.length && c2.length ? mean(h2) - mean(c2) : NaN;
          const holdsBoth = h1.length >= 10 && h2.length >= 10 && e1 > 0 && e2 > 0;
          const hs = trades.map(toHarness), hc = ctrlR.map((r) => ({ r, stopFrac: 1 } as HarnessTrade));
          const dv = scoreDollar(spec_key, hs, hc, 0, RISK_USD, convOf);
          Object.assign(upd, { vs_random_edge: +vr.edge.toFixed(4), vs_random_t: +vr.tStat.toFixed(2), holds_both: holdsBoth, skill_usd: dv.skillUsd, skill_frac: dv.n ? +(dv.skillUsd / (dv.flatUsd || 1)).toFixed(3) : null, passes: vr.passes && holdsBoth });
          // SURVIVOR → promote into the same tables our validated edges live in
          if (vr.passes && holdsBoth) {
            const eid = `fac:${spec_key}@${market}`;
            await fetch(`${SB}/rest/v1/trd_edge_scorecard?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ edge: eid, run_at: new Date().toISOString(), n: trades.length, n_trials: 1, abs_r: +mean(setupR).toFixed(4), vs_random_edge: +vr.edge.toFixed(4), vs_random_t: +vr.tStat.toFixed(2), vs_random_passes: vr.passes, oos_h1: +e1.toFixed(4), oos_h2: +e2.toFixed(4), holds_both: holdsBoth, gate_passed: false, gate_failing: ["forward-unconfirmed"], detail: { source: "edge-factory grammar", market, spec } }) }).catch(() => {});
            await fetch(`${SB}/rest/v1/trd_edge_dollar?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ edge: eid, n: trades.length, risk_usd: RISK_USD, flat_usd: dv.flatUsd, skill_usd: dv.skillUsd, drift_usd: dv.driftUsd, skill_frac: dv.flatUsd ? +(dv.skillUsd / dv.flatUsd).toFixed(3) : null, skill_per_100: +(vr.edge * 100 * RISK_USD).toFixed(0), conv_applied: true, frameworks: "vs-random+OOS+skill$+conviction$", note: "DISCOVERED by factory — forward-unconfirmed" }) }).catch(() => {});
            await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: eid, hypothesis: `${spec_key} on ${market}`, test: "grammar vs matched-random, split-half OOS, dollar skill/drift+conviction", key_metric: `vs-random +${vr.edge.toFixed(4)}R t=${vr.tStat.toFixed(2)}; skill$ ${dv.skillUsd} (${dv.n} trades); conv$ ${dv.convUsd}`, verdict: "candidate", status: "forward-pending", decision_trail: "D-297 auto-discovered; needs forward confirmation before any promotion" }) }).catch(() => {});
            results.push({ spec_key, market, SURVIVOR: true, t: +vr.tStat.toFixed(2), skill_usd: dv.skillUsd, conv_usd: dv.convUsd });
          }
        } else { upd.status = "thin"; }
        await fetch(`${SB}/rest/v1/trd_edge_queue?spec_key=eq.${encodeURIComponent(spec_key)}&market=eq.${market}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(upd) }).catch(() => {});
      }
      results.push({ market, bars: bars.length, tested: items.length });
    }
    const remain = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.pending&select=spec_key`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } }).then((r) => r.headers.get("content-range")).catch(() => null);
    return new Response(JSON.stringify({ ok: true, seeded, batch: pending.length, remaining: remain, results }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
