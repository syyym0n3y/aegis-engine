// trd-factor-funding-wf (D-335) — walk-forward + breadth test of the weekly-down-conditioned funding signal (D-333),
// obeying the no-aggregate doctrine (D-334): the verdict is the DISAGGREGATED grid, never a pooled number.
//   • TEMPORAL (walk-forward): split the timeline into 4 sequential epochs; the sign was pre-registered (-1), so the
//     signal survives OOS only if the conditioned IC holds NEGATIVE across the LATER (held-out) epochs, not just early.
//   • CROSS-SECTIONAL (breadth): conditioned IC per symbol — a real signal is broad (many alts sign-correct), a fluke
//     is 1-2 coins carrying it.
// Signal = 8h funding z84 conditioned on WEEKLY-DOWNTREND (price < 168h-ago), forward horizon 72h (strongest cell) +
// 24h. Keyless Binance, $0. Every epoch/symbol cell is a trial (deflation-honest).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOGEUSDT","DOTUSDT","LTCUSDT","ATOMUSDT","UNIUSDT","APTUSDT","ARBUSDT"];
const ZWIN = 84, LIMIT = 500, HTF_1W = 21, NEPOCH = 4;

function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 25) return { ic: 0, t: 0, n };
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
    const obs: { sym: string; tms: number; z: number; f24: number; f72: number; wDown: boolean }[] = [];
    for (const sym of SYMS) {
      const fund = await jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${LIMIT}`);
      const kl = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&limit=${LIMIT + 30}`);
      if (!Array.isArray(fund) || !Array.isArray(kl) || fund.length < ZWIN + HTF_1W + 12) continue;
      const px = new Map<number, number>(); for (const c of kl) px.set(Math.floor(c[0] / 1000) * 1000, +c[4]);
      const times = fund.map((f: Record<string, number>) => f.fundingTime as number);
      const rates = fund.map((f: Record<string, string>) => +f.fundingRate);
      for (let i = ZWIN; i < rates.length - 10; i++) {
        const win = rates.slice(i - ZWIN, i); const m = win.reduce((a, b) => a + b, 0) / ZWIN;
        const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (ZWIN - 1)); if (!(sd > 0)) continue;
        const z = (rates[i] - m) / sd;
        const t0 = Math.floor(times[i] / 8 / 36e5) * 8 * 36e5, p0 = px.get(t0), pw = px.get(t0 - HTF_1W * 8 * 36e5);
        const p24 = px.get(t0 + 3 * 8 * 36e5), p72 = px.get(t0 + 9 * 8 * 36e5);
        if (!p0 || !pw || !p24 || !p72) continue;
        obs.push({ sym, tms: times[i], z, f24: (p24 - p0) / p0, f72: (p72 - p0) / p0, wDown: p0 < pw });
      }
    }
    const wd = obs.filter((o) => o.wDown);
    // TEMPORAL walk-forward: 4 sequential epochs by time (held-out later epochs must keep the pre-registered - sign)
    const sorted = [...wd].sort((a, b) => a.tms - b.tms); const per = Math.ceil(sorted.length / NEPOCH);
    const epochs: Record<string, unknown>[] = [];
    for (let e = 0; e < NEPOCH; e++) {
      const slice = sorted.slice(e * per, (e + 1) * per); if (!slice.length) continue;
      const ic72 = rankIC(slice.map((o) => o.z), slice.map((o) => o.f72));
      const ic24 = rankIC(slice.map((o) => o.z), slice.map((o) => o.f24));
      const d0 = new Date(slice[0].tms).toISOString().slice(0, 10), d1 = new Date(slice[slice.length - 1].tms).toISOString().slice(0, 10);
      epochs.push({ epoch: e + 1, span: `${d0}..${d1}`, ic72: ic72.ic, t72: ic72.t, ic24: ic24.ic, t24: ic24.t, n: slice.length });
    }
    // CROSS-SECTIONAL breadth: conditioned IC per symbol (72h) — how many of the alts are sign-correct (negative)
    const bySym: Record<string, unknown>[] = []; let signCorrect = 0, measured = 0;
    for (const sym of SYMS) {
      const s = wd.filter((o) => o.sym === sym); if (s.length < 25) { bySym.push({ sym, n: s.length, skip: true }); continue; }
      const ic = rankIC(s.map((o) => o.z), s.map((o) => o.f72)); measured++; if (ic.ic < 0) signCorrect++;
      bySym.push({ sym, ic72: ic.ic, t72: ic.t, n: ic.n });
    }
    const full = rankIC(wd.map((o) => o.z), wd.map((o) => o.f72));
    return new Response(JSON.stringify({
      ok: true, regime: "weekly_downtrend", hypo_sign: -1,
      footnote_pooled_72h: { ic: full.ic, t: full.t, n: full.n },
      walk_forward_epochs: epochs,
      breadth_72h: { symbols_measured: measured, sign_correct_negative: signCorrect, of: measured },
      per_symbol: bySym,
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
