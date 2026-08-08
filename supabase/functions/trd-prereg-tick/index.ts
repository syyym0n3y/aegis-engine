// trd-prereg-tick — forward tracker for PRE-REGISTERED hypotheses. For each frozen spec in
// trd_prereg, it runs the EXACT grammar code that found it over fresh BTC 15m bars and records
// ONLY trades ENTERED after registered_at (so the forward result is a single, un-deflated trial —
// the honest verdict a million-sibling search cannot give). Applies the live macro de-risk factor
// for the "sized" P&L column, but the truth metric is raw expectancy in R. Keyless, $0, no orders.
import { type Bar, type ComponentSpec, runComponentTrades } from "./trd-grammar.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const COST_R = 0.05;

async function yahoo(sym: string, tf: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${tf}&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return [];
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // live macro de-risk (for the sized column)
    let deRisk = 1, macroPhase = "UNKNOWN";
    try { const mr = await fetch(`${SB}/rest/v1/trd_macro_state?id=eq.default&select=blended_de_risk,economies`, { headers: hdr }); const m = await mr.json(); const v = Number(m?.[0]?.blended_de_risk); if (Number.isFinite(v) && v > 0) deRisk = Math.min(1, v); macroPhase = m?.[0]?.economies?.[0]?.phase ?? "UNKNOWN"; } catch { /* fail open */ }

    const hyps = await fetch(`${SB}/rest/v1/trd_prereg?active=eq.true&select=*`, { headers: hdr }).then((r) => r.json());
    const report: any[] = [];
    for (const h of hyps as any[]) {
      const spec = h.spec as ComponentSpec;
      const bars = await yahoo(h.market, h.timeframe);
      if (bars.length < 100) { report.push({ id: h.id, err: `only ${bars.length} bars` }); continue; }
      const trades = runComponentTrades(bars, spec, { costRPerSide: COST_R });
      // state
      const st = await fetch(`${SB}/rest/v1/trd_prereg_state?hyp_id=eq.${h.id}&select=*`, { headers: hdr }).then((r) => r.json());
      const prev = st?.[0] ?? { forward_trades: [], last_entry_ts: null };
      const cutoff = prev.last_entry_ts && prev.last_entry_ts > h.registered_at ? prev.last_entry_ts : h.registered_at;
      // forward = entered strictly after the registration (and after the last we recorded)
      const fresh = trades.filter((t) => t.entryTs > cutoff).map((t) => ({ entryTs: t.entryTs, exitTs: t.exitTs, side: t.side, r: +t.r.toFixed(4), trend: t.trend, session: t.session }));
      const merged = [...(prev.forward_trades ?? []), ...fresh];
      const rs = merged.map((t: any) => t.r);
      const fwdExp = mean(rs), fwdTot = rs.reduce((a: number, b: number) => a + b, 0);
      const lastTs = merged.length ? merged[merged.length - 1].entryTs : prev.last_entry_ts;
      await fetch(`${SB}/rest/v1/trd_prereg_state?on_conflict=hyp_id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hyp_id: h.id, forward_trades: merged, last_entry_ts: lastTs, fwd_n: merged.length, fwd_expectancy_r: +fwdExp.toFixed(4), fwd_total_r: +fwdTot.toFixed(3), updated_at: new Date().toISOString() }) });
      // baseline (pre-registration, in-sample) for context — NOT counted in the verdict
      const baseline = trades.filter((t) => t.entryTs <= h.registered_at).map((t) => t.r);
      report.push({ id: h.id, registered_at: h.registered_at, newTradesThisTick: fresh.length, forwardN: merged.length, forwardExpectancyR: +fwdExp.toFixed(4), forwardTotalR: +fwdTot.toFixed(3), macroPhase, deRiskApplied: deRisk, sizedForwardR: +(fwdTot * deRisk).toFixed(3), baseline_inSampleN: baseline.length, baseline_inSampleExpR: +mean(baseline).toFixed(4), verdict: merged.length < 30 ? `accumulating (${merged.length}/30 forward trades before a read)` : fwdExp > 0 ? "forward-positive — continue" : "forward-negative — the lead does not hold out of sample" });
    }
    return new Response(JSON.stringify({ ok: true, hypotheses: report }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
