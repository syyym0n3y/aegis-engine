// trd-xsec-crypto (D-315) — a DIFFERENT signal class: cross-sectional (relative-value) instead of price-action.
// Each rebalance, rank the 16 crypto by trailing-k return; go long the top-Q / short the bottom-Q (momentum) or the
// reverse (reversal). The signal is the RELATIONSHIP between instruments, not any single chart. Honest gauntlet:
// the long-short basket's forward return vs a RANDOM-basket control (same Q, random members) → skill in return terms;
// split-half OOS; turnover cost. Non-overlapping periods (step = hold) → independent samples. Free+keyless, $0.
import type { Bar } from "../_shared/trd-liquidity-grab.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const MARKETS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT","XLMUSDT","BCHUSDT"];
const FEE_BPS = 20;          // pessimistic per-side; a rebalance rotates the whole book → cost ≈ 2·fee per period
const BAR_CAP = 22000;       // ~2.3yr of 15m; only closes are kept, so memory is light
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const variance = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const mulberry = (s: number) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

async function closes(m: string): Promise<Map<string, number>> {
  const c = await fetch(`${SB}/rest/v1/trd_bars_cache?market=eq.${m}&select=bars`, { headers: H }).then((r) => r.json()).catch(() => []);
  const b: Bar[] = Array.isArray(c) && c.length ? (c[0] as { bars: Bar[] }).bars : [];
  const arr = b.length > BAR_CAP ? b.slice(-BAR_CAP) : b;
  const out = new Map<string, number>();
  for (const x of arr) out.set(x.ts, x.close);   // ts → close; aligns markets by timestamp
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // load closes per market, build the common (intersection) timestamp axis so ranks are same-bar
    const perMkt: Map<string, number>[] = [];
    for (const m of MARKETS) perMkt.push(await closes(m));
    const counts = new Map<string, number>();
    for (const mp of perMkt) for (const ts of mp.keys()) counts.set(ts, (counts.get(ts) || 0) + 1);
    const axis = [...counts.entries()].filter(([, n]) => n === MARKETS.length).map(([ts]) => ts).sort();
    if (axis.length < 2000) return new Response(JSON.stringify({ ok: false, err: `thin common axis ${axis.length}` }), { status: 500, headers: cors });
    // price matrix P[coin][t] on the common axis
    const P: number[][] = perMkt.map((mp) => axis.map((ts) => mp.get(ts)!));
    const nCoin = MARKETS.length, T = axis.length;
    const cutIdx = Math.floor(T / 2); // OOS split by time

    const results: Record<string, unknown>[] = [], out: Record<string, unknown>[] = [];
    for (const dir of ["mom", "rev"]) {
      for (const k of [24, 48, 96, 192]) {        // trailing lookback (6h/12h/24h/48h at 15m)
        for (const h of [24, 48, 96]) {           // hold / rebalance step (non-overlapping)
          for (const q of [3, 4, 5]) {            // quantile basket size each side
            const setup: { r: number; t: number }[] = [], ctrl: number[] = [];
            const rnd = mulberry(k * 7919 + h * 31 + q * 101 + (dir === "mom" ? 1 : 2));
            for (let i = k; i + h < T; i += h) {
              // trailing-k return per coin, forward-h return per coin
              const tr: number[] = [], fw: number[] = [];
              for (let c = 0; c < nCoin; c++) { tr.push(P[c][i] / P[c][i - k] - 1); fw.push(P[c][i + h] / P[c][i] - 1); }
              const order = [...Array(nCoin).keys()].sort((a, b) => tr[b] - tr[a]); // high→low trailing return
              const top = order.slice(0, q), bot = order.slice(nCoin - q);
              const longs = dir === "mom" ? top : bot, shorts = dir === "mom" ? bot : top;
              const gross = mean(longs.map((c) => fw[c])) - mean(shorts.map((c) => fw[c]));
              setup.push({ r: gross, t: i });
              // matched random control: random q longs + q shorts (disjoint), same period
              const perm = [...Array(nCoin).keys()]; for (let a = nCoin - 1; a > 0; a--) { const j = Math.floor(rnd() * (a + 1)); [perm[a], perm[j]] = [perm[j], perm[a]]; }
              const rl = perm.slice(0, q), rs = perm.slice(q, 2 * q);
              ctrl.push(mean(rl.map((c) => fw[c])) - mean(rs.map((c) => fw[c])));
            }
            if (setup.length < 60) continue;
            const cost = 2 * (FEE_BPS / 1e4);                       // full rotation per rebalance, both sides
            const grossR = mean(setup.map((s) => s.r)), netR = grossR - cost;
            const sr = setup.map((s) => s.r);
            const edge = grossR - mean(ctrl);
            const se = Math.sqrt(variance(sr) / sr.length + variance(ctrl) / ctrl.length);
            const t = se > 0 ? edge / se : 0;
            const h1 = setup.filter((s) => s.t < axis.length * 0 + cutIdx).map((s) => s.r), h2 = setup.filter((s) => s.t >= cutIdx).map((s) => s.r);
            const c1 = ctrl.slice(0, h1.length), c2 = ctrl.slice(h1.length);
            const e1 = h1.length && c1.length ? mean(h1) - mean(c1) : NaN, e2 = h2.length && c2.length ? mean(h2) - mean(c2) : NaN;
            const holdsBoth = h1.length >= 20 && h2.length >= 20 && e1 > 0 && e2 > 0;
            const passes = t >= 2 && holdsBoth && netR > 0;
            const cfg = `${dir}|k${k}|h${h}|q${q}`;
            results.push({ cfg, direction: dir, lookback_k: k, hold_h: h, quantile: q, n_periods: setup.length, gross_r: +grossR.toFixed(6), net_r: +netR.toFixed(6), skill_edge: +edge.toFixed(6), skill_t: +t.toFixed(2), oos_h1: Number.isFinite(e1) ? +e1.toFixed(6) : null, oos_h2: Number.isFinite(e2) ? +e2.toFixed(6) : null, holds_both: holdsBoth, passes, run_at: new Date().toISOString() });
            if (passes || t >= 2) out.push({ cfg, n: setup.length, net_r_per_period: +netR.toFixed(5), skill_t: +t.toFixed(2), holds_both: holdsBoth, PASSES: passes });
          }
        }
      }
    }
    if (results.length) await fetch(`${SB}/rest/v1/trd_xsec_results?on_conflict=cfg`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(results) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-xsec-crypto", p_outcome: `tested ${results.length} cfgs, ${out.filter((o) => o.PASSES).length} pass` }) }).catch(() => {});
    const passers = out.filter((o) => o.PASSES);
    return new Response(JSON.stringify({ ok: true, common_bars: T, configs_tested: results.length, passers: passers.length, notable: out.sort((a, b) => (b.skill_t as number) - (a.skill_t as number)).slice(0, 10) }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
