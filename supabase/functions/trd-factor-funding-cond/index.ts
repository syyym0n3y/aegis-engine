// trd-factor-funding-cond (D-332) — conditional + multi-horizon IC for the funding factor. The linear pooled IC (D-331)
// was sign-correct but weak (t=-1.59) because the funding EDGE lives in the TAIL (extreme z, longer hold), not the
// average response. This measures rank-IC across horizons {8h,24h,72h} × regimes {all, extreme |z|>=1.5} so the engine
// CONFIRMS-or-DENIES the "edge is in the tail" hypothesis with honest evidence instead of assertion. Writes one
// trd_factor_ic row per (horizon×regime) + bumps trials per test. Keyless Binance, $0. Hypothesized sign -1.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOGEUSDT","DOTUSDT","LTCUSDT","ATOMUSDT","UNIUSDT","APTUSDT","ARBUSDT"];
const ZWIN = 84, LIMIT = 500, FACTOR = "funding_carry";
const HORIZONS: [string, number][] = [["8h", 1], ["24h", 3], ["72h", 9]];
const EXTREME = 1.5;

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
    // collect (z, fwd[h]) per observation across all symbols; tag majors (D-317: edge was majors-EXCLUDED)
    const MAJORS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT"]);
    const obs: { z: number; fwd: Record<number, number>; major: boolean }[] = [];
    for (const sym of SYMS) {
      const fund = await jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${LIMIT}`);
      const kl = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&limit=${LIMIT + 20}`);
      if (!Array.isArray(fund) || !Array.isArray(kl) || fund.length < ZWIN + 12) continue;
      const pxByOpen = new Map<number, number>(); for (const c of kl) pxByOpen.set(Math.floor(c[0] / 1000) * 1000, +c[4]);
      const times = fund.map((f: Record<string, number>) => f.fundingTime as number);
      const rates = fund.map((f: Record<string, string>) => +f.fundingRate);
      for (let i = ZWIN; i < rates.length - 10; i++) {
        const win = rates.slice(i - ZWIN, i); const m = win.reduce((a, b) => a + b, 0) / ZWIN;
        const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (ZWIN - 1)); if (!(sd > 0)) continue;
        const z = (rates[i] - m) / sd;
        const t0 = Math.floor(times[i] / 8 / 36e5) * 8 * 36e5, p0 = pxByOpen.get(t0); if (!p0) continue;
        const fwd: Record<number, number> = {}; let okAll = true;
        for (const [, hh] of HORIZONS) { const p = pxByOpen.get(t0 + hh * 8 * 36e5); if (!p) { okAll = false; break; } fwd[hh] = (p - p0) / p0; }
        if (okAll) obs.push({ z, fwd, major: MAJORS.has(sym) });
      }
    }
    const results: Record<string, unknown>[] = [];
    const regimes: [string, (o: { z: number; major: boolean }) => boolean][] = [
      ["all", () => true],
      ["extreme_z1.5", (o) => Math.abs(o.z) >= EXTREME],
      ["alt_only", (o) => !o.major],
      ["alt_extreme", (o) => !o.major && Math.abs(o.z) >= EXTREME],
    ];
    for (const [hname, hh] of HORIZONS) {
      for (const [rname, filt] of regimes) {
        const sub = obs.filter((o) => filt(o));
        const ic = rankIC(sub.map((o) => o.z), sub.map((o) => o.fwd[hh]));
        results.push({ horizon: hname, regime: rname, ic: ic.ic, t: ic.t, n: ic.n });
        if (!dry && ic.n >= 30) {
          await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: "crypto15", horizon: hname, ic: ic.ic, ic_t: ic.t, n: ic.n, regime: rname === "all" ? null : rname, n_trials: 1, detail: `conditional IC z84 vs fwd ${hname}; regime ${rname}; hypo sign -1` }) }).catch(() => {});
          await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, factor: FACTOR, hypothesized_sign: -1, total_obs: obs.length, grid: results }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
