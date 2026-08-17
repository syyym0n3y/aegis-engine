// trd-factor-funding-ic (D-331) — first factor wired end-to-end through the modular causal engine, proving the loop:
// registry → point-in-time values → measured IC. Force: perp funding crowding-fade (proven lead). For each of the 16
// keyless Binance perps it pulls funding history (public at settlement) + aligned 8h klines, computes the trailing-84
// funding z-score as the factor's point-in-time value (effective_date = funding settlement ts → no look-ahead), writes
// trd_factor_value, then measures the pooled rank-IC of z-score vs NEXT-period return. Hypothesis (pre-registered):
// sign = -1 (extreme-positive funding → next return negative). Writes trd_factor_ic + bumps trd_trial_counter. Keyless, $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOGEUSDT","DOTUSDT","MATICUSDT","LTCUSDT","ATOMUSDT","UNIUSDT","APTUSDT","ARBUSDT"];
const ZWIN = 84, LIMIT = 500; // trailing z window; funding rows per symbol (~166 days at 3/day)
const FACTOR = "funding_carry";

function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys); const mx = (n - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
async function jget(u: string) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } }); return r.ok ? await r.json() : null; } catch { return null; } }

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const allZ: number[] = [], allFwd: number[] = []; const valRows: Record<string, unknown>[] = []; const per: Record<string, unknown>[] = [];
    for (const sym of SYMS) {
      const fund = await jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${LIMIT}`);
      const kl = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&limit=${LIMIT + 10}`);
      if (!Array.isArray(fund) || !Array.isArray(kl) || fund.length < ZWIN + 5) { per.push({ sym, skip: "thin" }); continue; }
      // price by 8h-open time (funding settles on the 8h boundary)
      const pxByOpen = new Map<number, number>(); for (const c of kl) pxByOpen.set(Math.floor(c[0] / 1000) * 1000, +c[4]);
      const times = fund.map((f: Record<string, number>) => f.fundingTime as number);
      const rates = fund.map((f: Record<string, string>) => +f.fundingRate);
      let symN = 0;
      for (let i = ZWIN; i < rates.length - 1; i++) {
        const win = rates.slice(i - ZWIN, i); const m = win.reduce((a, b) => a + b, 0) / ZWIN;
        const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (ZWIN - 1)); if (!(sd > 0)) continue;
        const z = (rates[i] - m) / sd;
        // align price at this funding ts and the next (forward one-period return)
        const t0 = Math.floor(times[i] / 8 / 36e5) * 8 * 36e5, t1 = t0 + 8 * 36e5;
        const p0 = pxByOpen.get(t0), p1 = pxByOpen.get(t1); if (!p0 || !p1) continue;
        const fwd = (p1 - p0) / p0;
        allZ.push(z); allFwd.push(fwd); symN++;
        valRows.push({ factor_id: FACTOR, symbol: sym, ts: new Date(times[i]).toISOString(), effective_date: new Date(times[i]).toISOString(), value: +z.toFixed(4), raw: { rate: rates[i] } });
      }
      per.push({ sym, n: symN });
    }
    const ic = rankIC(allZ, allFwd);
    // signed IC oriented to the forward return (hypothesized sign is -1: high funding → negative fwd)
    if (!dry) {
      // write point-in-time factor values (bounded batches)
      for (let i = 0; i < valRows.length; i += 1000) await fetch(`${SB}/rest/v1/trd_factor_value?on_conflict=factor_id,symbol,ts`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(valRows.slice(i, i + 1000)) }).catch(() => {});
      await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: "crypto16", horizon: "8h", ic: ic.ic, ic_t: ic.t, n: ic.n, regime: null, n_trials: 1, detail: `pooled rank-IC z84 vs next-8h ret; hypo sign -1; ${valRows.length} values` }) }).catch(() => {});
      await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
      await fetch(`${SB}/rest/v1/trd_factor?id=eq.${FACTOR}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "measuring" }) }).catch(() => {});
    }
    return new Response(JSON.stringify({ ok: true, factor: FACTOR, hypothesized_sign: -1, ic: ic.ic, ic_t: ic.t, n: ic.n, values_written: dry ? 0 : valRows.length, per_symbol: per }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
