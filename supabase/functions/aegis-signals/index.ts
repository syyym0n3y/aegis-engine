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
    type TF = Record<string, { r2: number; adj_r2: number; n: number }>;
    type A = { symbol: string; r2: number; adj_r2: number; residual: number; era_stability: number; betas: Record<string, { beta: number; t: number }>; per_tf?: TF; per_tf_intraday?: Record<string, { r2: number; n: number }> };
    const attr = await fetch(`${SB}/rest/v1/trd_attribution?select=symbol,r2,adj_r2,residual,era_stability,betas,per_tf,per_tf_intraday`, { headers: H }).then((r) => r.json()).catch(() => []);
    const aMap = new Map<string, A>();
    for (const a of (Array.isArray(attr) ? attr : []) as A[]) aMap.set(a.symbol, a);
    // MTF: the timeframe where the force model explains MOST (daily noise can hide a strong relationship — D-333).
    const bestTf = (a: A): { tf: string; adj: number } => {
      let best = { tf: "daily", adj: a.adj_r2 || 0 };
      for (const [tf, v] of Object.entries(a.per_tf || {})) if ((v.adj_r2 || 0) > best.adj) best = { tf, adj: v.adj_r2 };
      return best;
    };
    const sMap = new Map<string, Record<string, unknown>>();
    for (const s of (Array.isArray(sig) ? sig : []) as Record<string, unknown>[]) sMap.set(s.symbol as string, s);
    // build from the UNION of every attributed instrument AND every signalled one — no instrument is shied away from
    const allSyms = new Set<string>([...aMap.keys(), ...sMap.keys()]);
    const raw: Record<string, unknown>[] = [...allSyms].map((sym) => {
      const s = sMap.get(sym) ?? { symbol: sym, lean: null };
      const a = aMap.get(sym);
      if (!a) return { ...s, understanding: 0, engage: false, gate_reason: "not yet attributed" };
      const drivers = Object.entries(a.betas || {}).map(([f, v]) => ({ f, beta: v.beta, t: v.t })).sort((p, q) => Math.abs(q.t) - Math.abs(p.t)).slice(0, 3);
      const bt = bestTf(a);                                              // best-timeframe adjusted-R2 (MTF)
      const understanding = +Math.max(0, bt.adj * (a.era_stability || 0)).toFixed(3);
      const directional = !!s.engage;                                   // momentum gate (cycle-stable directional edge)
      const understood = understanding >= U_THRESH;
      const engage = directional && understood;                          // FOLDED GATE — both required
      const gate_reason = engage ? "predict + understand" : !directional ? "no directional edge" : "not understood well enough";
      return { ...s, residual: a.residual, r2: a.r2, adj_r2: a.adj_r2, best_tf: bt.tf, best_r2: +bt.adj.toFixed(3), per_tf: a.per_tf ?? null, per_tf_intraday: a.per_tf_intraday ?? null, era_stability: a.era_stability, understanding, drivers, directional, engage, gate_reason };
    }).sort((p, q) => Number(q.understanding) - Number(p.understanding));
    const rows: Record<string, unknown>[] = isOperator ? raw : raw.map((s) =>
      s.engage ? { symbol: s.symbol, asof: s.asof, residual: s.residual, r2: s.r2, adj_r2: s.adj_r2, understanding: s.understanding, drivers: s.drivers, engage: true, redacted: true, lean: null, why: null, gate_reason: s.gate_reason, note: "operator-only" } : s);
    const job = await fetch(`${SB}/rest/v1/trd_compute_jobs?job_type=eq.deep_factor_ic&status=eq.done&select=result,done_at&order=done_at.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    const grid = Array.isArray(job) && job.length ? job[0].result : null;
    // GEX vol-regime — the conditioning overlay. PROVEN as SIZING (GEX→vol IC −0.49, every era); NOT a strategy-selection
    // gate (momentum isn't regime-dependent, D-352). size_mult = vol-target/expected-vol → size up in calm high-gamma, down
    // in short-gamma vol-expansion. Applied market-wide to any engaged size; the engage decision itself stays edge×understanding.
    const gx = await fetch(`${SB}/rest/v1/trd_gex_state?id=eq.current&select=regime,gex_percentile,expected_vol_pct,size_mult,asof`, { headers: H }).then((r) => r.json()).catch(() => []);
    const gex = Array.isArray(gx) && gx.length ? gx[0] : null;
    const engaged = rows.filter((r) => r.engage).length;
    const avg = (k: string) => rows.length ? +(rows.reduce((s: number, r) => s + (Number(r[k]) || 0), 0) / rows.length).toFixed(3) : 0;
    return new Response(JSON.stringify({
      ok: true, generated_at: new Date().toISOString(), mode: isOperator ? "operator" : "public",
      summary: { n: rows.length, engaged, u_threshold: U_THRESH, avg_residual: avg("residual"), avg_understanding: avg("understanding"),
        mean_r2: aMap.size ? +([...aMap.values()].reduce((s, a) => s + a.r2, 0) / aMap.size).toFixed(3) : null,
        mean_adj_r2: aMap.size ? +([...aMap.values()].reduce((s, a) => s + (a.adj_r2 || 0), 0) / aMap.size).toFixed(3) : null,
        understood: rows.filter((r) => Number(r.understanding) >= U_THRESH).length },
      gex: gex ? { regime: gex.regime, percentile: gex.gex_percentile, expected_vol_pct: gex.expected_vol_pct, size_mult: gex.size_mult, role: "vol-regime sizing overlay (proven IC −0.49); NOT a selection gate (D-352)" } : null,
      era_grid: grid?.era_grid ?? null, factor: grid?.factor ?? null, mean_ic: grid?.mean_ic ?? null,
      // intraday R2 ladder (below daily → the Epps effect: causal forces dissolve into microstructure noise at the minute)
      intraday: [...aMap.values()].filter((a) => a.per_tf_intraday).map((a) => ({
        symbol: a.symbol, daily_r2: a.r2,
        min1: (a.per_tf_intraday!.min1?.r2) ?? null, min5: (a.per_tf_intraday!.min5?.r2) ?? null, min60: (a.per_tf_intraday!.min60?.r2) ?? null,
      })),
      signals: rows,
    }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
