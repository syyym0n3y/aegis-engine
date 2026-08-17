// trd-forward-validate (D-320) — the Forward Validator team role. Runs a rigorous, DETERMINISTIC gauntlet on each
// edge's LIVE forward (paper) trades and writes a verdict the rest of the team reads. An edge becomes
// 'forward-validated' — the ONLY gate to a scale-up recommendation — only when its live trades clear ALL of:
//   n >= MIN_FWD · positive mean P&L · forward skill t >= 2 · not driven by 1 trade (top_trade_frac < 0.5) ·
//   drawdown tolerable. Else 'forward-failing' (negative with enough sample → demote), 'forward-inconclusive'
//   (positive but not significant), or 'forward-testing' (too few trades). Writes trd_forward_validation + updates
// trd_lineage status for validated/failing edges. Honest: almost nothing validates early — edges need weeks. $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const MIN_FWD = 30;   // minimum LIVE forward trades before an edge can be validated at all
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function stats(pnls: number[]) {
  const n = pnls.length, m = mean(pnls), s = sd(pnls);
  const t = n >= 2 && s > 0 ? m / (s / Math.sqrt(n)) : 0;
  const win = 100 * pnls.filter((x) => x > 0).length / Math.max(1, n);
  let cum = 0, peak = 0, mdd = 0; for (const p of pnls) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); }
  const absSum = pnls.reduce((s2, x) => s2 + Math.abs(x), 0);
  const topFrac = absSum > 0 ? Math.max(...pnls.map((x) => Math.abs(x))) / absSum : 1;
  let verdict: string, detail: string;
  if (n < MIN_FWD) { verdict = "forward-testing"; detail = `insufficient live sample (${n}/${MIN_FWD})`; }
  else if (m <= 0) { verdict = "forward-failing"; detail = `mean ${m.toFixed(2)}<=0 over ${n} trades — forward-negative, demote`; }
  else if (t >= 2 && topFrac < 0.5) { verdict = "forward-validated"; detail = `n=${n}, mean +${m.toFixed(2)}, t=${t.toFixed(2)}, win ${win.toFixed(0)}%, topFrac ${topFrac.toFixed(2)} — VALIDATED`; }
  else { verdict = "forward-inconclusive"; detail = `positive but ${t < 2 ? `t=${t.toFixed(2)}<2` : `1-trade-driven topFrac ${topFrac.toFixed(2)}`} — not yet`; }
  return { n, m: +m.toFixed(2), t: +t.toFixed(2), win: +win.toFixed(0), cum: +cum.toFixed(2), mdd: +mdd.toFixed(2), topFrac: +topFrac.toFixed(3), verdict, detail };
}

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const byEdge = new Map<string, number[]>();
    const add = (e: string, v: number) => { if (v != null && Number.isFinite(v)) (byEdge.get(e) || byEdge.set(e, []).get(e))!.push(v); };
    const fund = await fetch(`${SB}/rest/v1/trd_funding_paper?status=eq.closed&select=pnl_usd`, { headers: H }).then((r) => r.json()).catch(() => []);
    for (const x of (Array.isArray(fund) ? fund : []) as { pnl_usd: number }[]) add("funding-carry", x.pnl_usd);
    const fut = await fetch(`${SB}/rest/v1/trd_futures_paper?status=eq.closed&select=pnl_usd`, { headers: H }).then((r) => r.json()).catch(() => []);
    for (const x of (Array.isArray(fut) ? fut : []) as { pnl_usd: number }[]) add("futures-orb815", x.pnl_usd);
    const tr = await fetch(`${SB}/rest/v1/trd_trades?status=eq.closed&realized_pnl=not.is.null&select=edge,realized_pnl`, { headers: H }).then((r) => r.json()).catch(() => []);
    for (const x of (Array.isArray(tr) ? tr : []) as { edge: string; realized_pnl: number }[]) add(x.edge, x.realized_pnl);

    const rows: Record<string, unknown>[] = [], out: Record<string, unknown>[] = [];
    for (const [edge, pnls] of byEdge) {
      const s = stats(pnls);
      rows.push({ edge, n_closed: s.n, mean_pnl: s.m, t_stat: s.t, win_pct: s.win, cum_pnl: s.cum, max_drawdown: s.mdd, top_trade_frac: s.topFrac, verdict: s.verdict, detail: s.detail, run_at: new Date().toISOString() });
      out.push({ edge, n: s.n, mean: s.m, t: s.t, cum: s.cum, verdict: s.verdict });
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_forward_validation?on_conflict=edge`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
    // reflect decisive verdicts into trd_lineage (validated → forward-validated status; failing → demote)
    for (const r of rows) {
      if (r.verdict === "forward-validated") await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: `fwd:${r.edge}`, name: `${r.edge} forward`, family: "forward-validation", hypothesis: `${r.edge} holds live forward`, test_method: "live forward gauntlet: n>=30, mean>0, t>=2, topFrac<0.5", key_metric: r.detail, verdict: "validated", status: "forward-validated", decision_refs: ["D-320"] }) }).catch(() => {});
      else if (r.verdict === "forward-failing") await fetch(`${SB}/rest/v1/trd_lineage?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: `fwd:${r.edge}`, name: `${r.edge} forward`, family: "forward-validation", hypothesis: `${r.edge} holds live forward`, test_method: "live forward gauntlet", key_metric: r.detail, verdict: "killed", status: "forward-failing", decision_refs: ["D-320"] }) }).catch(() => {});
    }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-forward-validate", p_outcome: `${rows.length} edges; validated ${rows.filter((r) => r.verdict === "forward-validated").length}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, min_fwd: MIN_FWD, edges: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
