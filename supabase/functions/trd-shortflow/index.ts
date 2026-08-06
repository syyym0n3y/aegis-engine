// trd-shortflow — LIVE short-sale-flow AWARENESS from FINRA's free daily RegSHO file. Fetches only the most
// recent trading day and ranks each symbol's short-volume ratio against its own 2018-2026 distribution
// (trd_shortvol_dist, 89,762 symbol-days).
//
// HONESTY BANNER (D-157): this is AWARENESS, never a signal. Short volume was tested properly and FAILED:
//   • Boehmer/Jones/Zhang predict high SVR → LOW returns; our 2018+ data INVERTS that (LONG at high SVR paid
//     OOS +0.227R t=4.17) — consistent with McLean-Pontiff post-publication decay overshooting.
//   • It PASSED the pooled incremental test (IS t=+2.95 / OOS t=+2.91) — the only signal all session to do so —
//   • then FAILED decomposition: ETFs flip sign (IS −2.84 → OOS +3.60), single stocks collapse (+5.90 → +1.13).
//     The pooled stability was an AGGREGATION ARTIFACT. Not tradable.
// It is surfaced because knowing where short flow is unusual is genuine market context, not because it predicts.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}` };
const ETFS = new Set(["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD"]);

async function finraDay(d: Date): Promise<{ date: string; rows: Map<string, number> } | null> {
  const ds = d.toISOString().slice(0, 10).replace(/-/g, "");
  const r = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ds}.txt`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const txt = await r.text(); const rows = new Map<string, number>();
  for (const line of txt.split("\n")) { const p = line.split("|"); if (p.length < 5) continue; const sv = +p[2], tv = +p[4]; if (tv > 0 && Number.isFinite(sv)) rows.set(p[1], sv / tv); }
  return rows.size ? { date: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`, rows } : null;
}
/** interpolate a percentile from the stored 5-point distribution */
function pctOf(v: number, d: any): number {
  const pts: [number, number][] = [[0.10, +d.p10], [0.25, +d.p25], [0.50, +d.p50], [0.75, +d.p75], [0.90, +d.p90]];
  if (v <= pts[0][1]) return 0.05;
  if (v >= pts[4][1]) return 0.95;
  for (let i = 1; i < pts.length; i++) { if (v <= pts[i][1]) { const [q0, v0] = pts[i - 1], [q1, v1] = pts[i]; return v1 > v0 ? q0 + (q1 - q0) * (v - v0) / (v1 - v0) : q0; } }
  return 0.5;
}
Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dist = await fetch(`${SB}/rest/v1/trd_shortvol_dist?select=*`, { headers: H }).then((r) => r.json());
    const dmap = new Map((dist as any[]).map((x) => [x.symbol, x]));
    let day: { date: string; rows: Map<string, number> } | null = null;
    for (let back = 1; back <= 6 && !day; back++) { const d = new Date(); d.setUTCDate(d.getUTCDate() - back); day = await finraDay(d); }
    if (!day) return new Response(JSON.stringify({ ok: false, err: "no recent FINRA file" }), { status: 502, headers: cors });
    const out: any[] = [];
    for (const [sym, d] of dmap) {
      const cur = day.rows.get(sym); if (cur == null) continue;
      const p = pctOf(cur, d);
      out.push({ symbol: sym, kind: ETFS.has(sym) ? "etf" : "stock", short_pct_of_volume: +(cur * 100).toFixed(1), typical: +(+d.mean_ratio * 100).toFixed(1), percentile: +(p * 100).toFixed(0), unusual: p >= 0.9 ? "unusually HIGH short flow" : p <= 0.1 ? "unusually LOW short flow" : null });
    }
    out.sort((a, b) => b.percentile - a.percentile);
    const hi = out.filter((x) => x.percentile >= 90), lo = out.filter((x) => x.percentile <= 10);
    return new Response(JSON.stringify({
      ok: true, asof: day.date, instruments: out.length,
      book_mean_short_pct: +(out.reduce((s, x) => s + x.short_pct_of_volume, 0) / (out.length || 1)).toFixed(1),
      unusually_high: hi.map((x) => `${x.symbol} ${x.short_pct_of_volume}% (${x.percentile}th)`),
      unusually_low: lo.map((x) => `${x.symbol} ${x.short_pct_of_volume}% (${x.percentile}th)`),
      all: out,
      basis: "89,762 symbol-days of FINRA daily short-sale volume, 2018-08 → 2026-08, ranked per symbol against its own history.",
      status: "AWARENESS ONLY — NOT a trading signal.",
      why_not_a_signal: "Tested to destruction (D-157): inverts the published Boehmer effect; passed the pooled incremental test (IS t=+2.95 / OOS t=+2.91) but FAILED decomposition — ETFs flip sign (−2.84→+3.60) and single stocks collapse (+5.90→+1.13), so the pooled stability was an aggregation artifact.",
      note_on_etfs: "ETFs run 59-62% short volume vs 37-41% for single stocks because ETF shorting is dominated by market-maker create/redeem and hedging, not directional bets. Compare each symbol to ITSELF, never across symbols.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
