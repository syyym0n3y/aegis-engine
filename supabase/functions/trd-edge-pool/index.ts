// trd-edge-pool (D-314) — cross-market POOLED validation of the stage-2 leads. The leads (net-profitable at
// pessimistic cost, high skill, walk-forward-consistent) fail the DSR only because each has too few trades per
// market (n=53-139). Pooling the SAME spec across the 16 INDEPENDENT markets multiplies n with independent
// evidence. Per candidate spec: run on every market, cost each trade by its riskFrac at the STRESS fee, pool the
// net-R trades, then apply the full gate — skill vs pooled matched-random, DSR deflated by n_eff (trd_search_stats),
// walk-forward across the pooled timeline, pessimistic-cost profitability, AND a breadth check (edge must be net-
// positive on a MAJORITY of the independent markets, so one market can't carry it). Survivors → trd_forward_candidates.
// $0, cached bars. Idempotent (trd_pool_results guards). Batch small (each spec = 16 backtests).
import { runComponentTrades, type ComponentSpec } from "../_shared/trd-grammar.ts";
import type { Bar } from "../_shared/trd-liquidity-grab.ts";
import { scoreEdge, type HarnessTrade } from "../_shared/trd-harness.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const FEE_BPS_PESS = 20, WF_FOLDS = 5, HORIZON = 400, MIN_POOLED = 200;
const MARKETS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT","XLMUSDT","BCHUSDT"];
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const netR = (t: { r: number; riskFrac: number }) => t.r - 2 * (FEE_BPS_PESS / 1e4) / t.riskFrac;
const mulberry = (s: number) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

function randomControl(bars: Bar[], s: ComponentSpec, count: number, seed: number): number[] {
  const rnd = mulberry(seed); const out: number[] = []; const n = bars.length; let g = 0;
  while (out.length < count && g < count * 40) {
    g++; const i = Math.floor(rnd() * (n - s.stopLookback - 5)) + s.stopLookback;
    if (i <= s.stopLookback || i >= n - 2) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - s.stopLookback; j < i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    const side = rnd() < 0.5 ? "long" : "short", entry = bars[i].open, stop = side === "long" ? lo : hi, dir = side === "long" ? 1 : -1;
    const risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    const target = entry + dir * s.rr * risk, end = Math.min(n, i + HORIZON); let r: number | null = null;
    for (let k = i; k < end; k++) { const b = bars[k]; if (side === "long") { if (b.low <= stop) { r = -1; break; } if (b.high >= target) { r = s.rr; break; } } else { if (b.high >= stop) { r = -1; break; } if (b.low <= target) { r = s.rr; break; } } }
    if (r === null) r = dir * (bars[Math.min(n, end) - 1].close - entry) / risk;
    out.push(r - 2 * (FEE_BPS_PESS / 1e4) / (risk / entry));
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const batch = Math.min(4, +(u.searchParams.get("batch") || "2"));
    const effRow = await fetch(`${SB}/rest/v1/trd_search_stats?id=eq.global&select=n_eff`, { headers: H }).then((r) => r.json()).catch(() => []);
    const nTrials = Math.max(1000, Number((effRow?.[0] as { n_eff?: number })?.n_eff) || 500000);
    // candidate SPECS = distinct profitable-at-cost leads not yet pooled
    const done = new Set(((await fetch(`${SB}/rest/v1/trd_pool_results?select=spec_key&limit=100000`, { headers: H }).then((r) => r.json()).catch(() => [])) as { spec_key: string }[]).map((r) => r.spec_key));
    const leads = await fetch(`${SB}/rest/v1/trd_stage2_results?net_r_pess=gt.0&select=spec_key,net_r_pess&order=net_r_pess.desc&limit=200`, { headers: H }).then((r) => r.json()).catch(() => []);
    const seen = new Set<string>(); const todo: string[] = [];
    for (const l of (Array.isArray(leads) ? leads : []) as { spec_key: string }[]) { if (!seen.has(l.spec_key) && !done.has(l.spec_key)) { seen.add(l.spec_key); todo.push(l.spec_key); } if (todo.length >= batch) break; }
    if (!todo.length) return new Response(JSON.stringify({ ok: true, done: "all leads pooled", nTrials }), { headers: cors });

    // load bars per-market WITHOUT caching all 16 (that piled ~45MB and hit the worker memory limit) — one at a time,
    // let each market's bars GC after its trades are extracted. Slightly more fetches, but memory-safe.
    // cap to the most recent BAR_CAP bars/market — indicator-heavy triggers (supertrend/macd/stoch) × 16 markets
    // blow the CPU budget on the full 35k. ~15k = ~1.5yr of 15m, ample for a pooled cross-market sample.
    const BAR_CAP = 15000;
    const getBars = async (m: string) => { const c = await fetch(`${SB}/rest/v1/trd_bars_cache?market=eq.${m}&select=bars`, { headers: H }).then((r) => r.json()).catch(() => []); const b = Array.isArray(c) && c.length ? (c[0] as { bars: Bar[] }).bars : []; return b.length > BAR_CAP ? b.slice(-BAR_CAP) : b; };
    const rows: Record<string, unknown>[] = [], fwd: Record<string, unknown>[] = [], lin: Record<string, unknown>[] = [], out: Record<string, unknown>[] = [];
    for (const spec_key of todo) {
      const specRow = await fetch(`${SB}/rest/v1/trd_edge_queue?spec_key=eq.${encodeURIComponent(spec_key)}&select=spec&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
      const spec = Array.isArray(specRow) && specRow.length ? (specRow[0] as { spec: ComponentSpec }).spec : null;
      if (!spec) { rows.push({ spec_key, verdict: "thin", killed_by: "no spec", run_at: new Date().toISOString() }); continue; }
      const pooled: HarnessTrade[] = [], ctrl: HarnessTrade[] = []; let nMkt = 0, mktsPos = 0;
      for (const m of MARKETS) {
        const bars = await getBars(m); if (bars.length < 500) continue;
        const trades = runComponentTrades(bars, spec, { costRPerSide: 0 }).filter((t) => t.riskFrac > 0);
        if (trades.length < 10) continue;
        nMkt++; const mNet = trades.map(netR); if (mean(mNet) > 0) mktsPos++;
        trades.forEach((t) => pooled.push({ r: netR(t), stopFrac: 1, period: t.entryTs.slice(0, 7) }));
        randomControl(bars, spec, trades.length, spec_key.length * 131 + trades.length + m.length).forEach((r) => ctrl.push({ r, stopFrac: 1 }));
      }
      if (pooled.length < MIN_POOLED) { rows.push({ spec_key, n_markets: nMkt, n_pooled: pooled.length, verdict: "thin", killed_by: `pooled ${pooled.length}<${MIN_POOLED}`, run_at: new Date().toISOString() }); continue; }
      const netRpess = mean(pooled.map((t) => t.r));
      const sc = scoreEdge(spec_key, pooled, ctrl, { costBps: 0, nTrials });
      const ord = [...pooled].sort((a, b) => (a.period || "").localeCompare(b.period || "")).map((t) => t.r);
      const fs = Math.floor(ord.length / WF_FOLDS); let wfPos = 0;
      for (let k = 0; k < WF_FOLDS; k++) { const seg = ord.slice(k * fs, k === WF_FOLDS - 1 ? ord.length : (k + 1) * fs); if (seg.length && mean(seg) > 0) wfPos++; }
      const breadth = mktsPos >= Math.ceil(nMkt * 0.6);   // edge must hold on a MAJORITY of independent markets
      const survive = sc.gatePassed && sc.vsRandomT >= 2 && netRpess > 0 && wfPos >= Math.ceil(WF_FOLDS * 0.6) && breadth;
      const kb = survive ? null : [!sc.gatePassed ? `DSR(${sc.gateFailing.join(",")})` : "", sc.vsRandomT < 2 ? "skill<2" : "", netRpess <= 0 ? "unprofitable" : "", wfPos < Math.ceil(WF_FOLDS * 0.6) ? `WF${wfPos}/${WF_FOLDS}` : "", !breadth ? `breadth ${mktsPos}/${nMkt}` : ""].filter(Boolean).join(";");
      rows.push({ spec_key, n_markets: nMkt, n_pooled: pooled.length, net_r_pess: +netRpess.toFixed(4), skill_t: +sc.vsRandomT.toFixed(2), deflated_sharpe: sc.deflatedSharpe, gate_passed: sc.gatePassed, wf_folds: WF_FOLDS, wf_folds_pos: wfPos, markets_positive: mktsPos, verdict: survive ? "pool-survivor" : "pool-killed", killed_by: kb, run_at: new Date().toISOString() });
      out.push({ spec_key, n_pooled: pooled.length, markets_pos: `${mktsPos}/${nMkt}`, dsr: sc.deflatedSharpe, skill_t: +sc.vsRandomT.toFixed(2), wf: `${wfPos}/${WF_FOLDS}`, net_r_pess: +netRpess.toFixed(4), SURVIVOR: survive });
      if (survive) {
        fwd.push({ edge: `pool:${spec_key}`, spec_key, market: "POOLED-16", spec, net_r_pess: +netRpess.toFixed(4), deflated_sharpe: sc.deflatedSharpe, wf_folds_pos: wfPos, status: "promoted" });
        lin.push({ id: `pool:${spec_key}`, name: `${spec_key} POOLED-16`, family: "pool-survivor", hypothesis: `${spec_key} pooled across 16 independent markets`, test_method: "cross-market pooled: DSR deflated by n_eff + walk-forward + pessimistic cost + majority-market breadth", key_metric: `n_pooled ${pooled.length}, DSR ${sc.deflatedSharpe}, skill t=${sc.vsRandomT.toFixed(2)}, markets+ ${mktsPos}/${nMkt}, net_r@2xcost ${netRpess.toFixed(4)}`, verdict: "survivor", status: "forward-promoted", decision_refs: ["D-314"] });
      }
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_pool_results?on_conflict=spec_key`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
    if (fwd.length) await fetch(`${SB}/rest/v1/trd_forward_candidates?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(fwd) }).catch(() => {});
    if (lin.length) await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(lin) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-edge-pool", p_outcome: `pooled ${todo.length}, survivors ${out.filter((o) => o.SURVIVOR).length}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, nTrials, pooled: todo.length, results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
