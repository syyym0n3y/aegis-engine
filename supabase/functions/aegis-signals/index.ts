// aegis-signals — serves the causal buy/sell SIGNAL layer to the Aegis cockpit (no-verify-jwt, CORS-open, read-only).
// Single-operator, unpublished. Every signal carries its calibrated causal CONFIDENCE, the WHY decomposition, and the
// honest RESIDUAL (fraction unexplained) — the anti-guru numbers. The engagement gate (engage=true) opens ONLY when a
// force explains the move with cross-era-stable sign; otherwise the honest output is "do not engage, mostly unexplained".
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  try {
    // operator gate: ENGAGED (actionable) signals are single-operator — redacted on the public page unless the
    // operator key matches. Non-engaged ("stand down") signals stay public (they are explicitly not-actionable).
    const opTok = new URL(req.url).searchParams.get("op");
    const isOperator = !!opTok && opTok === Deno.env.get("OPERATOR_TOKEN");
    const sig = await fetch(`${SB}/rest/v1/trd_signal?select=symbol,asof,lean,confidence,engage,residual,why,note&order=confidence.desc,lean.desc`, { headers: H }).then((r) => r.json()).catch(() => []);
    // attribution (layer 1): R2 + adj-R2 + era-stability + driver map. THE FOLDED GATE: engage requires BOTH a directional
    // edge (momentum, cycle-stable) AND genuine understanding = adjusted-R2 × era-stability >= threshold. We never trade an
    // instrument we don't understand, and never trade understanding alone without a directional edge.
    const U_THRESH = 0.30;
    type A = { symbol: string; r2: number; adj_r2: number; residual: number; era_stability: number; betas: Record<string, { beta: number; t: number }> };
    const attr = await fetch(`${SB}/rest/v1/trd_attribution?select=symbol,r2,adj_r2,residual,era_stability,betas`, { headers: H }).then((r) => r.json()).catch(() => []);
    const aMap = new Map<string, A>();
    for (const a of (Array.isArray(attr) ? attr : []) as A[]) aMap.set(a.symbol, a);
    const raw: Record<string, unknown>[] = (Array.isArray(sig) ? sig : []).map((s: Record<string, unknown>) => {
      const a = aMap.get(s.symbol as string);
      if (!a) return { ...s, understanding: 0, engage: false, gate_reason: "not yet attributed" };
      const drivers = Object.entries(a.betas || {}).map(([f, v]) => ({ f, beta: v.beta, t: v.t })).sort((p, q) => Math.abs(q.t) - Math.abs(p.t)).slice(0, 3);
      const understanding = +Math.max(0, (a.adj_r2 || 0) * (a.era_stability || 0)).toFixed(3);
      const directional = !!s.engage;                                   // momentum gate (cycle-stable directional edge)
      const understood = understanding >= U_THRESH;
      const engage = directional && understood;                          // FOLDED GATE — both required
      const gate_reason = engage ? "predict + understand" : !directional ? "no directional edge" : "not understood well enough";
      return { ...s, residual: a.residual, r2: a.r2, adj_r2: a.adj_r2, era_stability: a.era_stability, understanding, drivers, directional, engage, gate_reason };
    });
    const rows: Record<string, unknown>[] = isOperator ? raw : raw.map((s) =>
      s.engage ? { symbol: s.symbol, asof: s.asof, confidence: s.confidence, residual: s.residual, r2: s.r2, drivers: s.drivers, engage: true, redacted: true, lean: null, why: null, note: "operator-only" } : s);
    const job = await fetch(`${SB}/rest/v1/trd_compute_jobs?job_type=eq.deep_factor_ic&status=eq.done&select=result,done_at&order=done_at.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    const grid = Array.isArray(job) && job.length ? job[0].result : null;
    const engaged = rows.filter((r) => r.engage).length;
    const avg = (k: string) => rows.length ? +(rows.reduce((s: number, r) => s + (Number(r[k]) || 0), 0) / rows.length).toFixed(3) : 0;
    return new Response(JSON.stringify({
      ok: true, generated_at: new Date().toISOString(), mode: isOperator ? "operator" : "public",
      summary: { n: rows.length, engaged, avg_confidence: avg("confidence"), avg_residual: avg("residual"), mean_r2: aMap.size ? +([...aMap.values()].reduce((s, a) => s + a.r2, 0) / aMap.size).toFixed(3) : null },
      era_grid: grid?.era_grid ?? null, factor: grid?.factor ?? null, mean_ic: grid?.mean_ic ?? null,
      signals: rows,
    }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
