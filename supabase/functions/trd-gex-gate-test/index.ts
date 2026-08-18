// trd-gex-gate-test (D-352) — BEFORE wiring GEX into the gate, measure the claim: does momentum's forward-return IC
// actually improve in SHORT-gamma (trending) vs HIGH-gamma (mean-reverting) regimes? Splits each (stock,date) momentum
// observation by that date's GEX percentile and computes momentum→fwd-21d IC in each regime. Keyless (SqueezeMetrics GEX +
// Yahoo). If short-gamma IC >> high-gamma IC, GEX is a valid momentum gate; if not, GEX is sizing-only. Honest either way.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UNIV = ["AAPL","MSFT","JPM","XOM","CVX","JNJ","PG","KO","WMT","CAT","BA","HD","INTC","CSCO","DIS","MCD","NKE","MMM","GE","AMGN"];
function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // GEX series → percentile per date (trailing 252)
    const csv = await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
    const gd: string[] = [], gv: number[] = [];
    for (const l of csv.split("\n")) { const p = l.trim().split(","); if (p.length < 4 || p[0] === "date") continue; const g = +p[3]; if (Number.isFinite(g)) { gd.push(p[0]); gv.push(g); } }
    const gexPct = new Map<string, number>();
    for (let i = 252; i < gd.length; i++) { const w = gv.slice(i - 252, i); const below = w.filter((x) => x <= gv[i]).length; gexPct.set(gd[i], below / w.length); }
    // per (stock,date): momentum + fwd 21d return, tagged by GEX regime
    const hiM: number[] = [], hiF: number[] = [], loM: number[] = [], loF: number[] = [];
    const p2 = Math.floor(Date.now() / 1000);
    for (const sym of UNIV) {
      const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${p2 - 5200 * 86400}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
      const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue; const c = res.indicators.quote[0].close as number[]; const ds = res.timestamp.map((t: number) => new Date(t * 1000).toISOString().slice(0, 10));
      for (let i = 252; i < c.length - 21; i++) { if (c[i] == null || c[i - 21] == null || c[i - 252] == null || c[i + 21] == null) continue;
        const pct = gexPct.get(ds[i]); if (pct == null) continue;
        const mom = c[i - 21] / c[i - 252] - 1, fwd = c[i + 21] / c[i] - 1;
        if (pct >= 0.6) { hiM.push(mom); hiF.push(fwd); } else if (pct <= 0.4) { loM.push(mom); loF.push(fwd); }
      }
    }
    await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 2 }) }).catch(() => {});
    const hi = rankIC(hiM, hiF), lo = rankIC(loM, loF);
    const verdict = (lo.ic > hi.ic + 0.01 && Math.abs(lo.t) >= 2) ? "GEX gates momentum: short-gamma IC materially higher → valid strategy-selection gate"
      : (Math.abs(hi.ic - lo.ic) < 0.01) ? "no regime difference → GEX is SIZING-only for momentum, not a selection gate"
      : "weak/mixed → treat GEX as sizing + mechanism-labeled regime, not a proven momentum gate";
    return new Response(JSON.stringify({ ok: true, momentum_ic_by_gex_regime: { high_gamma_meanrev: hi, short_gamma_trend: lo }, verdict }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
