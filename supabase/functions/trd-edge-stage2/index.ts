// trd-edge-stage2 (D-303) — the STAGE-2 full gauntlet. Factory candidates (skill + profit, in-sample) are
// re-tested here with the honest heavy artillery the factory's t-screen skips:
//   (1) DSR deflated by the TRUE trial count (trd_trial_counter, ~150k) — López de Prado; a Sharpe without its N
//       is a lie, and at 150k trials the bar is brutal. (2) K-fold WALK-FORWARD OOS — the edge must stay net-positive
//       in most out-of-sample folds, not just the in-sample whole. (3) PESSIMISTIC cost (2× the factory's) — tight-
//       target strategies that only worked at optimistic cost die here. Survivors → trd_forward_candidates (paper,
//       operator-armed). Verdicts → trd_stage2_results + trd_lineage. Almost nothing survives = D-070 working.
// $0 (cached keyless bars + own DB). Idempotent (trd_stage2_results guards re-runs). CPU-safe small batches.
import { runComponentTrades, MIN_RISK_FRAC, type ComponentSpec } from "../_shared/trd-grammar.ts";
import type { Bar } from "../_shared/trd-liquidity-grab.ts";
import { scoreEdge, type HarnessTrade } from "../_shared/trd-harness.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
// D-303: match the factory's REAL cost model (bps-of-notional per trade via riskFrac), but STRESS it — 20bp/side
// = 2× the factory's realistic 10bp Binance taker, to cover spread + slippage. Flat-R costing is a lie for tight
// stops (a small riskFrac makes the same fee cost far more R); this is why the factory's fix killed all 147.
const FEE_BPS_PESS = 20;
const netR = (t: { r: number; riskFrac: number }) => t.r - 2 * (FEE_BPS_PESS / 1e4) / t.riskFrac;
const WF_FOLDS = 5;         // walk-forward folds; require >=60% net-positive OOS
const MIN_N = 50;           // stage-2 needs a real sample
const HORIZON = 400;
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const mulberry = (s: number) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// D-307 ACCOUNTABILITY: a write that fails must be LOUD. Every write in this pipeline used to be
// `fetch(...).catch(() => {})` — fetch does NOT throw on 4xx/5xx, so a rejected INSERT was discarded
// silently while the response still reported `tested: N`. That is how stage-2 ran 113 cron invocations
// (07:33→13:12, all HTTP 200) writing ZERO rows: a false all-clear, the D-300b/D-303b failure class again.
// This helper surfaces status + body, and the caller READS BACK what actually landed before claiming it.
type WriteResult = { table: string; attempted: number; ok: boolean; status: number; err: string | null };
async function writeRows(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<WriteResult> {
  if (!rows.length) return { table, attempted: 0, ok: true, status: 200, err: null };
  try {
    const r = await fetch(`${SB}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows),
    });
    if (r.ok) return { table, attempted: rows.length, ok: true, status: r.status, err: null };
    return { table, attempted: rows.length, ok: false, status: r.status, err: (await r.text().catch(() => "")).slice(0, 400) };
  } catch (e) { return { table, attempted: rows.length, ok: false, status: 0, err: String(e).slice(0, 300) }; }
}
// read-back: how many of the edges we just claimed to write are ACTUALLY in the table now
async function countPersisted(table: string, edges: string[]): Promise<number> {
  if (!edges.length) return 0;
  const list = edges.map((e) => `"${e.replace(/"/g, '""')}"`).join(",");
  const r = await fetch(`${SB}/rest/v1/${table}?edge=in.(${encodeURIComponent(list)})&select=edge`, { headers: H })
    .then((x) => x.json()).catch(() => []);
  return Array.isArray(r) ? r.length : 0;
}

// D-307 ROOT CAUSE: PostgREST bulk-insert requires EVERY object in the array to have an identical key set
// (PGRST102 "All object keys must match") and rejects the WHOLE batch atomically if not. The three row
// shapes below (no-spec/thin-no-n, thin-with-n, full verdict) differed, so any batch that mixed a thin row
// with a scored row lost all 12 rows — silently, because the write error was swallowed. Every row is now
// built from one template with explicit nulls, so the shapes can never drift apart again.
const STAGE_ROW_TEMPLATE: Record<string, unknown> = {
  edge: null, spec_key: null, market: null, n: null, net_r_pess: null, skill_t: null,
  deflated_sharpe: null, gate_passed: null, wf_folds: null, wf_folds_pos: null,
  verdict: null, killed_by: null, run_at: null,
};
const stageRow = (r: Record<string, unknown>): Record<string, unknown> =>
  ({ ...STAGE_ROW_TEMPLATE, ...r, run_at: r.run_at ?? new Date().toISOString() });

async function getBars(market: string): Promise<Bar[]> {
  const c = await fetch(`${SB}/rest/v1/trd_bars_cache?market=eq.${market}&select=bars`, { headers: H }).then((r) => r.json()).catch(() => []);
  const b = Array.isArray(c) && c.length ? (c[0] as { bars: Bar[] }).bars : [];
  return Array.isArray(b) ? b : [];
}
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
    out.push(r - 2 * (FEE_BPS_PESS / 1e4) / (risk / entry)); // same bps-of-notional stress cost as the setup leg
  }
  return out;
}

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-edge-stage2", p_outcome: o.slice(0, 180) }),
  }).catch(() => {});
const SERVE = (h: (r: Request) => Response | Promise<Response>) =>
  Deno.serve(async (r: Request) => {
    let res: Response;
    try { res = await h(r); } catch (e) { await __beat("THREW " + String(e).slice(0, 150)); throw e; }
    let body = "";
    try { body = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch { /* unreadable body */ }
    await __beat(`${res.status} ${body}`);
    return res;
  });

SERVE(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const batch = Math.min(30, +(u.searchParams.get("batch") || "12"));
    // D-313: deflate by the EFFECTIVE independent-trial count (trd_search_stats.n_eff, Nyholt) when available —
    // the grammar's trials are correlated, so raw N over-penalises. Falls back to the raw counter if unestimated.
    // This corrects a mis-specified N; it does NOT touch the DSR>0.95 threshold.
    const effRow = await fetch(`${SB}/rest/v1/trd_search_stats?id=eq.global&select=n_eff`, { headers: H }).then((r) => r.json()).catch(() => []);
    const trialRow = await fetch(`${SB}/rest/v1/trd_trial_counter?id=eq.global&select=total`, { headers: H }).then((r) => r.json()).catch(() => []);
    const nEff = Number((effRow?.[0] as { n_eff?: number })?.n_eff);
    const nTrials = Math.max(1000, Number.isFinite(nEff) && nEff > 0 ? nEff : (Number((trialRow?.[0] as { total?: number })?.total) || 100000));
    // best untested candidates first (highest in-sample abs_r), skip any already in stage2_results.
    // ACCOUNTABILITY FIX (D-303b): fetch the WHOLE candidate set (bounded, ~hundreds), not top batch*3 — else once
    // the top few are tested the filtered todo is always empty and stage-2 silently stalls at the high-abs_r head
    // while hundreds of lower-ranked candidates never get tested (returns ok:true "all tested" — a false all-clear).
    const done = await fetch(`${SB}/rest/v1/trd_stage2_results?select=edge&limit=100000`, { headers: H }).then((r) => r.json()).catch(() => []);
    const doneSet = new Set((Array.isArray(done) ? done : []).map((r: { edge: string }) => r.edge));
    const cands = await fetch(`${SB}/rest/v1/trd_edge_scorecard?edge=like.fac:*&select=edge,abs_r&order=abs_r.desc&limit=100000`, { headers: H }).then((r) => r.json()).catch(() => []);
    const todo = (Array.isArray(cands) ? cands : []).filter((c: { edge: string }) => !doneSet.has(c.edge)).slice(0, batch) as { edge: string }[];
    if (!todo.length) return new Response(JSON.stringify({ ok: true, done: "all candidates stage-2 tested", nTrials }), { headers: cors });

    // group by market → fetch bars once; also fetch each spec from the queue
    const parsed = todo.map((c) => { const s = c.edge.replace(/^fac:/, ""); const [spec_key, market] = s.split("@"); return { edge: c.edge, spec_key, market }; });
    const barsCache = new Map<string, Bar[]>();
    const results: Record<string, unknown>[] = [], stageRows: Record<string, unknown>[] = [], fwdRows: Record<string, unknown>[] = [], linRows: Record<string, unknown>[] = [];
    for (const { edge, spec_key, market } of parsed) {
      if (!barsCache.has(market)) barsCache.set(market, await getBars(market));
      const bars = barsCache.get(market)!;
      const specRow = await fetch(`${SB}/rest/v1/trd_edge_queue?spec_key=eq.${encodeURIComponent(spec_key)}&market=eq.${market}&select=spec&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
      const spec = (Array.isArray(specRow) && specRow.length ? (specRow[0] as { spec: ComponentSpec }).spec : null);
      if (!spec || bars.length < 500) { stageRows.push(stageRow({ edge, spec_key, market, verdict: "thin", killed_by: "no spec/bars" })); continue; }
      // run GROSS then re-cost each trade from its own riskFrac at the STRESS fee (D-303, matches factory model)
      const trades = runComponentTrades(bars, spec, { costRPerSide: 0 }).filter((t) => t.riskFrac >= MIN_RISK_FRAC); // D-305 tradeability floor
      if (trades.length < MIN_N) { stageRows.push(stageRow({ edge, spec_key, market, n: trades.length, verdict: "thin", killed_by: `<${MIN_N} trades` })); continue; }
      const setupR = trades.map(netR), netRpess = mean(setupR);
      const ctrlR = randomControl(bars, spec, trades.length, spec_key.length * 197 + trades.length);
      const hs: HarnessTrade[] = trades.map((t) => ({ r: netR(t), stopFrac: 1, period: t.entryTs.slice(0, 7) }));
      const hc: HarnessTrade[] = ctrlR.map((r) => ({ r, stopFrac: 1 }));
      const sc = scoreEdge(edge, hs, hc, { costBps: 0, nTrials });   // r is already net → costBps 0; DSR deflated by true N
      // WALK-FORWARD: trades in time order, K contiguous folds, count net-positive OOS folds
      const ord = [...trades].sort((a, b) => a.entryTs.localeCompare(b.entryTs)).map(netR);
      const fs = Math.floor(ord.length / WF_FOLDS); let wfPos = 0;
      for (let k = 0; k < WF_FOLDS; k++) { const seg = ord.slice(k * fs, k === WF_FOLDS - 1 ? ord.length : (k + 1) * fs); if (seg.length && mean(seg) > 0) wfPos++; }
      const survive = sc.gatePassed && sc.vsRandomT >= 2 && netRpess > 0 && wfPos >= Math.ceil(WF_FOLDS * 0.6);
      const verdict = survive ? "stage2-survivor" : "stage2-killed";
      const kb = survive ? null : [!sc.gatePassed ? `DSR-gate(${sc.gateFailing.join(",")})` : "", sc.vsRandomT < 2 ? "skill-t<2" : "", netRpess <= 0 ? "unprofitable@pess-cost" : "", wfPos < Math.ceil(WF_FOLDS * 0.6) ? `WF ${wfPos}/${WF_FOLDS}` : ""].filter(Boolean).join("; ");
      stageRows.push(stageRow({ edge, spec_key, market, n: trades.length, net_r_pess: +netRpess.toFixed(4), skill_t: +sc.vsRandomT.toFixed(2), deflated_sharpe: sc.deflatedSharpe, gate_passed: sc.gatePassed, wf_folds: WF_FOLDS, wf_folds_pos: wfPos, verdict, killed_by: kb }));
      if (survive) {
        fwdRows.push({ edge, spec_key, market, spec, net_r_pess: +netRpess.toFixed(4), deflated_sharpe: sc.deflatedSharpe, wf_folds_pos: wfPos, status: "promoted" });
        linRows.push({ id: `s2:${spec_key}@${market}`, name: `${spec_key}@${market}`, family: "stage2-survivor", hypothesis: `${spec_key} on ${market}`, test_method: "stage-2: DSR deflated by true trial count + K-fold walk-forward + pessimistic cost", key_metric: `DSR ${sc.deflatedSharpe}, WF ${wfPos}/${WF_FOLDS}, net_r@2xcost ${netRpess.toFixed(4)}, skill t=${sc.vsRandomT.toFixed(2)}`, verdict: "survivor", status: "forward-promoted", decision_refs: ["D-303"] });
        results.push({ edge, SURVIVOR: true, dsr: sc.deflatedSharpe, wf: `${wfPos}/${WF_FOLDS}`, net_r_pess: +netRpess.toFixed(4) });
      }
    }
    // D-307: writes are checked, then VERIFIED by read-back. `tested` now means "persisted", not "computed".
    const writes = [
      await writeRows("trd_stage2_results", stageRows, "edge"),
      await writeRows("trd_forward_candidates", fwdRows, "edge"),
      await writeRows("trd_lineage", linRows, "id"),
    ];
    const persisted = await countPersisted("trd_stage2_results", stageRows.map((r) => String(r.edge)));
    const writeErrors = writes.filter((w) => !w.ok);
    const lost = stageRows.length - persisted;
    const remain = await fetch(`${SB}/rest/v1/trd_edge_scorecard?edge=like.fac:*&select=edge`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } }).then((r) => r.headers.get("content-range")).catch(() => null);
    // fail LOUD: a non-200 makes the stall visible to cron/monitor instead of returning a false all-clear
    const healthy = !writeErrors.length && lost === 0;
    return new Response(JSON.stringify({
      ok: healthy, nTrials, computed: stageRows.length, persisted, lost,
      survivors: results.length, survivorRows: results, candidates_total: remain,
      writes, writeErrors: writeErrors.length ? writeErrors : undefined,
    }, null, 2), { status: healthy ? 200 : 500, headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
