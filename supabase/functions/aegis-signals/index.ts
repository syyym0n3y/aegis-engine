// aegis-signals — serves the causal buy/sell SIGNAL layer to the Aegis cockpit (no-verify-jwt, CORS-open, read-only).
// Single-operator, unpublished. Every signal carries its calibrated causal CONFIDENCE, the WHY decomposition, and the
// honest RESIDUAL (fraction unexplained) — the anti-guru numbers. The engagement gate (engage=true) opens ONLY when a
// force explains the move with cross-era-stable sign; otherwise the honest output is "do not engage, mostly unexplained".
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  try {
    const sig = await fetch(`${SB}/rest/v1/trd_signal?select=symbol,asof,lean,confidence,engage,residual,why,note&order=confidence.desc,lean.desc`, { headers: H }).then((r) => r.json()).catch(() => []);
    const rows = Array.isArray(sig) ? sig : [];
    const job = await fetch(`${SB}/rest/v1/trd_compute_jobs?job_type=eq.deep_factor_ic&status=eq.done&select=result,done_at&order=done_at.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    const grid = Array.isArray(job) && job.length ? job[0].result : null;
    const engaged = rows.filter((r: { engage: boolean }) => r.engage).length;
    const avg = (k: string) => rows.length ? +(rows.reduce((s: number, r: Record<string, number>) => s + (r[k] || 0), 0) / rows.length).toFixed(3) : 0;
    return new Response(JSON.stringify({
      ok: true, generated_at: new Date().toISOString(),
      summary: { n: rows.length, engaged, avg_confidence: avg("confidence"), avg_residual: avg("residual") },
      era_grid: grid?.era_grid ?? null, factor: grid?.factor ?? null, mean_ic: grid?.mean_ic ?? null,
      signals: rows,
    }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
