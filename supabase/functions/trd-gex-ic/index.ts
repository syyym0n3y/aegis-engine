// trd-gex-ic (D-351) — GEX completed on the FREE keyless SqueezeMetrics feed (2011→), no OPRA spend. Tests three things,
// deflated + per-era: (1) GEX z → next-day SPY return (DIRECTIONAL edge?), (2) GEX z → forward 5d realized vol (the
// documented gamma REGIME effect: high positive gamma suppresses vol), (3) DIX z → next-day return (dark-pool directional).
// Forward data from keyless Yahoo SPY. Reports the honest verdict for each.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const ERAS: [string, number, number][] = [["2011_15", 2011, 2016], ["2016_19", 2016, 2020], ["covid_20_21", 2020, 2022], ["2022_26", 2022, 2100]];
function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
const zscore = (arr: number[], i: number, w: number) => { const s = arr.slice(Math.max(0, i - w), i); if (s.length < 30) return null; const m = s.reduce((a, b) => a + b, 0) / s.length; const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)); return sd > 0 ? (arr[i] - m) / sd : null; };

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const csv = await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
    const rows = csv.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("date")).map((l) => l.split(","));
    const dates: string[] = [], dix: number[] = [], gex: number[] = [];
    for (const p of rows) { if (p.length < 4) continue; const d = p[0], dx = +p[2], gx = +p[3]; if (!Number.isFinite(dx) || !Number.isFinite(gx)) continue; dates.push(d); dix.push(dx); gex.push(gx); }
    // SPY daily (keyless Yahoo)
    const p2 = Math.floor(Date.now() / 1000);
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&period1=${p2 - 5500 * 86400}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json());
    const res = j.chart.result[0]; const cByDate = new Map<string, number>(); const cDates: string[] = [];
    for (let i = 0; i < res.timestamp.length; i++) { const c = res.indicators.quote[0].close[i]; if (c == null) continue; const d = new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10); cByDate.set(d, c); cDates.push(d); }
    const cIdx = new Map<string, number>(); cDates.forEach((d, i) => cIdx.set(d, i)); const closes = cDates.map((d) => cByDate.get(d)!);
    // build aligned observations
    type Obs = { yr: number; gz: number; dz: number; fwdRet: number; fwdVol: number };
    const obs: Obs[] = [];
    for (let i = 252; i < dates.length; i++) {
      const gz = zscore(gex, i, 252), dz = zscore(dix, i, 252); if (gz == null || dz == null) continue;
      const ci = cIdx.get(dates[i]); if (ci == null || ci + 6 >= closes.length) continue;
      const fwdRet = closes[ci + 1] / closes[ci] - 1;
      const r5: number[] = []; for (let k = 1; k <= 5; k++) r5.push(closes[ci + k] / closes[ci + k - 1] - 1);
      const m5 = r5.reduce((a, b) => a + b, 0) / 5, fwdVol = Math.sqrt(r5.reduce((a, b) => a + (b - m5) ** 2, 0) / 4) * Math.sqrt(252);
      obs.push({ yr: +dates[i].slice(0, 4), gz, dz, fwdRet, fwdVol });
    }
    const grid = (label: string, xf: (o: Obs) => number, yf: (o: Obs) => number) => ({ signal: label, pooled: rankIC(obs.map(xf), obs.map(yf)), by_era: ERAS.map(([e, a, b]) => { const s = obs.filter((o) => o.yr >= a && o.yr < b); return { era: e, ...rankIC(s.map(xf), s.map(yf)) }; }).filter((g) => g.n > 20) });
    await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 3 }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, n_obs: obs.length, span: `${dates[252]}..${dates[dates.length - 1]}`, tests: [
      grid("GEX_z → next-day SPY return (DIRECTIONAL)", (o) => o.gz, (o) => o.fwdRet),
      grid("GEX_z → forward 5d realized vol (REGIME)", (o) => o.gz, (o) => o.fwdVol),
      grid("DIX_z → next-day SPY return (dark-pool DIRECTIONAL)", (o) => o.dz, (o) => o.fwdRet),
    ] }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
