// trd-factor-funding-mtf (D-333) — MULTI-TIMEFRAME test of the funding factor. D-332 found the 8h-lens IC null, but a
// single timeframe HIDES information: an aggregate null can be two real opposite-signed signals that a HIGHER timeframe
// separates. This conditions the 8h funding-z signal on point-in-time HIGHER-timeframe context (trailing 72h trend =
// "3-day lens", and trailing 168h/1w trend = "weekly lens"), and measures rank-IC of z vs forward return WITHIN each
// HTF regime, per forward horizon. If the IC separates by HTF regime (opposite significant signs that cancel in
// aggregate), MTF just recovered what the 8h lens could not see. All context is TRAILING (point-in-time, no leak).
// Every regime×horizon cell is a trial (deflation-honest). Keyless Binance, $0. Hypothesized base sign -1.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOGEUSDT","DOTUSDT","LTCUSDT","ATOMUSDT","UNIUSDT","APTUSDT","ARBUSDT"];
const ZWIN = 84, LIMIT = 500, FACTOR = "funding_carry";
const HORIZONS: [string, number][] = [["8h", 1], ["24h", 3], ["72h", 9]];
const HTF_3D = 9, HTF_1W = 21; // higher-timeframe lookbacks in 8h bars: 72h ("3-day") and 168h ("weekly")

function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
async function jget(u: string) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } }); return r.ok ? await r.json() : null; } catch { return null; } }

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    // each obs carries the 8h signal (z), forward returns, and HIGHER-timeframe trend context (all trailing = PIT)
    const obs: { z: number; fwd: Record<number, number>; d3up: boolean; wUp: boolean }[] = [];
    for (const sym of SYMS) {
      const fund = await jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${LIMIT}`);
      const kl = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&limit=${LIMIT + 30}`);
      if (!Array.isArray(fund) || !Array.isArray(kl) || fund.length < ZWIN + HTF_1W + 12) continue;
      const pxByOpen = new Map<number, number>(); for (const c of kl) pxByOpen.set(Math.floor(c[0] / 1000) * 1000, +c[4]);
      const times = fund.map((f: Record<string, number>) => f.fundingTime as number);
      const rates = fund.map((f: Record<string, string>) => +f.fundingRate);
      for (let i = ZWIN; i < rates.length - 10; i++) {
        const win = rates.slice(i - ZWIN, i); const m = win.reduce((a, b) => a + b, 0) / ZWIN;
        const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (ZWIN - 1)); if (!(sd > 0)) continue;
        const z = (rates[i] - m) / sd;
        const t0 = Math.floor(times[i] / 8 / 36e5) * 8 * 36e5, p0 = pxByOpen.get(t0); if (!p0) continue;
        // HIGHER-timeframe TRAILING trend context (point-in-time: only bars at/*before* t0)
        const p3 = pxByOpen.get(t0 - HTF_3D * 8 * 36e5), pw = pxByOpen.get(t0 - HTF_1W * 8 * 36e5); if (!p3 || !pw) continue;
        const fwd: Record<number, number> = {}; let okAll = true;
        for (const [, hh] of HORIZONS) { const p = pxByOpen.get(t0 + hh * 8 * 36e5); if (!p) { okAll = false; break; } fwd[hh] = (p - p0) / p0; }
        if (okAll) obs.push({ z, fwd, d3up: p0 > p3, wUp: p0 > pw });
      }
    }
    const regimes: [string, (o: { d3up: boolean; wUp: boolean }) => boolean][] = [
      ["all", () => true],
      ["3d_up", (o) => o.d3up], ["3d_down", (o) => !o.d3up],
      ["wk_up", (o) => o.wUp], ["wk_down", (o) => !o.wUp],
      ["3d_up|wk_up", (o) => o.d3up && o.wUp], ["3d_down|wk_down", (o) => !o.d3up && !o.wUp],
      ["3d_up|wk_down", (o) => o.d3up && !o.wUp], ["3d_down|wk_up", (o) => !o.d3up && o.wUp],
    ];
    const grid: Record<string, unknown>[] = [];
    for (const [hname, hh] of HORIZONS) for (const [rname, filt] of regimes) {
      const sub = obs.filter((o) => filt(o));
      const ic = rankIC(sub.map((o) => o.z), sub.map((o) => o.fwd[hh]));
      grid.push({ horizon: hname, htf_regime: rname, ic: ic.ic, t: ic.t, n: ic.n });
      if (!dry && rname !== "all" && ic.n >= 30) {
        await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: "crypto15", horizon: hname, ic: ic.ic, ic_t: ic.t, n: ic.n, regime: `mtf:${rname}`, n_trials: 1, detail: `MTF: 8h z84 vs fwd ${hname} | HTF context ${rname}` }) }).catch(() => {});
        await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
      }
    }
    return new Response(JSON.stringify({ ok: true, factor: FACTOR, total_obs: obs.length, note: "hypo base sign -1; look for opposite-signed significant cells that cancel in 'all'", grid }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
