// trd-effective-n (D-313) — estimate the EFFECTIVE number of independent trials for honest DSR deflation.
// The factory ran ~623k grammar trials, but they are heavily CORRELATED (same trigger × adjacent ema/stop/rr/
// session/stopMode → near-identical trade series). Deflating the Sharpe by the raw count over-penalises massively.
// Method (principled, not hand-tuned): sample M scored specs, run each on ONE common tape (BTC cached bars) → a
// monthly-return vector, build the M×M Pearson correlation matrix, and compute Nyholt/Cheverud's effective number
// of independent tests: M_eff = 1 + (M−1)(1 − Var(λ)/M), where Var(λ) = trace(R²)/M − 1 = (Σ R_ij²)/M − 1 (no eigen-
// decomposition needed — trace(R²) is the sum of squared correlation entries). Extrapolate the sample's independence
// RATIO to the full grid: n_eff = n_raw × (M_eff/M), clamped to [#triggers, n_raw]. Store to trd_search_stats.
// This CORRECTS a mis-specified N; it does not touch the DSR>0.95 threshold. $0, cached bars.
import { runComponentTrades, type ComponentSpec, GRAMMAR } from "../_shared/trd-grammar.ts";
import type { Bar } from "../_shared/trd-liquidity-grab.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

async function getBars(market: string): Promise<Bar[]> {
  const c = await fetch(`${SB}/rest/v1/trd_bars_cache?market=eq.${market}&select=bars`, { headers: H }).then((r) => r.json()).catch(() => []);
  const b = Array.isArray(c) && c.length ? (c[0] as { bars: Bar[] }).bars : [];
  return Array.isArray(b) ? b : [];
}

// Pearson correlation over the months BOTH strategies traded (need enough overlap or return 0 = treated independent)
function corr(a: Map<string, number>, b: Map<string, number>): number {
  const keys = [...a.keys()].filter((k) => b.has(k));
  if (keys.length < 6) return 0;
  const xs = keys.map((k) => a.get(k)!), ys = keys.map((k) => b.get(k)!);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < keys.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const d = Math.sqrt(sxx * syy);
  return d > 0 ? sxy / d : 0;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    const M = Math.min(120, +(u.searchParams.get("m") || "80"));
    const market = u.searchParams.get("market") || "BTCUSDT";
    const bars = await getBars(market);
    if (bars.length < 500) return new Response(JSON.stringify({ ok: false, err: "no cached bars" }), { status: 500, headers: cors });

    // sample M scored specs spread across the grid (fetch a wide page, stride-sample for diversity)
    const pool = await fetch(`${SB}/rest/v1/trd_edge_queue?status=eq.done&select=spec_key,spec&limit=3000`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(pool) || pool.length < M) return new Response(JSON.stringify({ ok: false, err: "not enough scored specs" }), { status: 500, headers: cors });
    const stride = Math.max(1, Math.floor(pool.length / M));
    const picked = [] as { spec: ComponentSpec }[];
    for (let i = 0; i < pool.length && picked.length < M; i += stride) picked.push(pool[i] as { spec: ComponentSpec });

    // each spec → monthly mean-return vector (gross; correlation is scale-free so cost is irrelevant here)
    const vecs: Map<string, number>[] = [];
    for (const { spec } of picked) {
      const trades = runComponentTrades(bars, spec, { costRPerSide: 0 });
      const byMonth = new Map<string, number[]>();
      for (const t of trades) { const m = t.entryTs.slice(0, 7); (byMonth.get(m) || byMonth.set(m, []).get(m))!.push(t.r); }
      const mv = new Map<string, number>();
      for (const [m, rs] of byMonth) if (rs.length >= 2) mv.set(m, mean(rs));
      vecs.push(mv);
    }
    // keep only specs with enough monthly coverage
    const V = vecs.filter((v) => v.size >= 6);
    const m = V.length;
    if (m < 10) return new Response(JSON.stringify({ ok: false, err: `too few usable specs (${m})` }), { status: 500, headers: cors });

    // correlation matrix → trace(R²) = Σ R_ij² ; Var(λ) = trace(R²)/m − 1 ; Nyholt M_eff
    let traceR2 = 0, offSum = 0, offCnt = 0;
    for (let i = 0; i < m; i++) {
      traceR2 += 1; // R_ii = 1
      for (let j = i + 1; j < m; j++) {
        const r = corr(V[i], V[j]);
        traceR2 += 2 * r * r;           // R_ij² counted for (i,j) and (j,i)
        offSum += Math.abs(r); offCnt++;
      }
    }
    const varLambda = traceR2 / m - 1;
    const mEff = 1 + (m - 1) * (1 - varLambda / m);
    const ratio = Math.max(1 / m, Math.min(1, mEff / m));
    const rhoBar = offCnt ? offSum / offCnt : 0;

    const nRawRow = await fetch(`${SB}/rest/v1/trd_trial_counter?id=eq.global&select=total`, { headers: H }).then((r) => r.json()).catch(() => []);
    const nRaw = Math.max(1000, Number((nRawRow?.[0] as { total?: number })?.total) || 100000);
    const triggers = GRAMMAR.trigger.length;
    const nEff = Math.max(triggers, Math.min(nRaw, Math.round(nRaw * ratio)));

    const row = { id: "global", n_raw: nRaw, n_eff: nEff, ratio: +ratio.toFixed(5), rho_bar: +rhoBar.toFixed(4), m_sample: m, method: `Nyholt effective-number-of-tests on ${market} monthly returns`, computed_at: new Date().toISOString() };
    await fetch(`${SB}/rest/v1/trd_search_stats?on_conflict=id`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-effective-n", p_outcome: `n_eff ${nEff} (ratio ${ratio.toFixed(4)}, rho ${rhoBar.toFixed(3)}, m ${m})` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, ...row }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
