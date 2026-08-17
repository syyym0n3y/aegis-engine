// trd-signal-refresh (D-340) — keeps the buy/sell SIGNAL layer LIVE from the cloud, independent of the local worker.
// The heavy 33-yr era-IC grid (the confidence calibration) changes negligibly day to day, so the worker recomputes it
// only occasionally; this LIGHT edge-cron refreshes each instrument's CURRENT reading every few hours from fresh keyless
// Yahoo bars and re-derives lean/confidence/engage/residual using the cached era grid. Cron-driven → the dashboard stays
// current with no machine of ours running. $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["AAPL","MSFT","IBM","GE","KO","JPM","XOM","CVX","JNJ","PG","WMT","MCD","DIS","INTC","CSCO","ORCL","T","VZ","MMM","CAT","BA","HD","AMGN","NKE","AXP"];
const LB = 252, SK = 21;

async function yBars(sym: string): Promise<number[] | null> {
  try {
    const p2 = Math.floor(Date.now() / 1000);
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p2 - 3 * 365 * 86400}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null; const j = await r.json(); const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    return Array.isArray(c) ? c.filter((x: number) => x != null && Number.isFinite(x)) : null;
  } catch { return null; }
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // cached calibration from the last heavy worker job (deep_factor_ic)
    const job = await fetch(`${SB}/rest/v1/trd_compute_jobs?job_type=eq.deep_factor_ic&status=eq.done&select=result&order=done_at.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    const res = Array.isArray(job) && job.length ? job[0].result : null;
    const meanIC = Number(res?.mean_ic ?? 0), eraConsistency = Number(res?.era_consistency ?? 0);
    const asof = new Date().toISOString().slice(0, 10);
    const rows: Record<string, unknown>[] = [];
    for (const sym of SYMS) {
      const c = await yBars(sym); if (!c || c.length < LB + SK + 2) continue;
      const j = c.length - 1; const mom = c[j - SK] / c[j - LB] - 1; if (!Number.isFinite(mom)) continue;
      const lean = Math.max(-1, Math.min(1, mom / 0.3));
      const confidence = +(Math.max(0, meanIC) * eraConsistency).toFixed(3);
      const residual = +(1 - Math.min(1, Math.abs(meanIC))).toFixed(3);
      rows.push({ symbol: sym, asof, lean: +lean.toFixed(3), confidence,
        engage: confidence >= 0.02 && eraConsistency >= 0.6,
        why: { factor: "mom_12_1", momentum: +mom.toFixed(4), mean_era_ic: +meanIC.toFixed(4), era_consistency: eraConsistency },
        residual, note: `refreshed ${asof} | meanIC ${meanIC.toFixed(4)} | era_consistency ${eraConsistency}`, updated_at: new Date().toISOString() });
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_signal?on_conflict=symbol`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-signal-refresh", p_outcome: `refreshed ${rows.length} signals | meanIC ${meanIC.toFixed(4)}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, refreshed: rows.length, mean_ic: meanIC, era_consistency: eraConsistency }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
