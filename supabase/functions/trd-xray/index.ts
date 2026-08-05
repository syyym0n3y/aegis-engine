// trd-xray — universal instrument X-ray. Point it at ANY listed ticker and get its full history + behaviour
// under all conditions, from free Yahoo daily. Not narrow to S&P: ?symbol=AAPL|NVDA|TLT|XLE|whatever.
// Returns: span, annualized vol + current regime, CAGR, drawdown profile, fat-tail stats, beta to SPY, and
// the conditional behaviour table (returns/vol by VIX regime and by 200MA trend) — "how does it act when
// the world is calm/stressed, in an uptrend/downtrend". Plus the live forward-vol de-risk it would get now.
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts";

async function daily(sym: string): Promise<{ d: string; c: number }[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const adj = res.indicators.adjclose?.[0]?.adjclose as number[] | undefined; const cl = res.indicators.quote[0].close as number[];
  const c = adj ?? cl; const out: { d: string; c: number }[] = [];
  for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), c: c[i] });
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const std = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const P = new URL(req.url).searchParams; const symbol = (P.get("symbol") ?? "").toUpperCase().trim();
    if (!symbol) return new Response(JSON.stringify({ ok: false, err: "pass ?symbol=TICKER" }), { status: 400, headers: cors });
    const [bars, vixB, spyB] = [await daily(symbol), await daily("^VIX"), await daily("SPY")];
    if (bars.length < 60) return new Response(JSON.stringify({ ok: false, err: `no/thin data for ${symbol} (${bars.length} days)` }), { status: 404, headers: cors });
    const vix = new Map(vixB.map((x) => [x.d, x.c])); const spy = new Map(spyB.map((x) => [x.d, x.c]));
    const c = bars.map((x) => x.c); const ret = c.map((p, i) => i === 0 ? 0 : p / c[i - 1] - 1);
    const H = 5; // forward horizon for conditional behaviour
    // distribution / tails
    const rs = ret.slice(1); const m = mean(rs), sd = std(rs);
    const skew = mean(rs.map((r) => ((r - m) / sd) ** 3)), kurt = mean(rs.map((r) => ((r - m) / sd) ** 4));
    const sortedR = [...rs].sort((a, b) => a - b); const worst1 = sortedR[Math.floor(sortedR.length * 0.01)];
    // drawdown
    let peak = c[0], maxDD = 0; for (const p of c) { if (p > peak) peak = p; const dd = (peak - p) / peak; if (dd > maxDD) maxDD = dd; }
    const ath = Math.max(...c); const curDD = (ath - c[c.length - 1]) / ath;
    // moving averages (current)
    const sma = (n: number) => c.length >= n ? mean(c.slice(-n)) : NaN;
    const ma50 = sma(50), ma200 = sma(200); const last = c[c.length - 1];
    // beta to SPY
    const pairs: [number, number][] = []; for (let i = 1; i < bars.length; i++) { const s0 = spy.get(bars[i - 1].d), s1 = spy.get(bars[i].d); if (s0 && s1) pairs.push([ret[i], s1 / s0 - 1]); }
    const sr = pairs.map((p) => p[1]); const beta = pairs.length > 30 ? (mean(pairs.map((p) => p[0] * p[1])) - mean(pairs.map((p) => p[0])) * mean(sr)) / (std(sr) ** 2) : NaN;
    // conditional behaviour: by VIX regime and by 200MA trend → forward-Hd return + realized vol
    const cond = (pick: (i: number) => boolean) => { const fr: number[] = [], rr: number[] = []; for (let i = 200; i < bars.length - H; i++) { if (!pick(i)) continue; fr.push(c[i + H] / c[i] - 1); rr.push(ret[i]); } return fr.length ? { n: fr.length, fwdRet: +(mean(fr) * 100).toFixed(2), winPct: +(fr.filter((x) => x > 0).length / fr.length * 100).toFixed(0), vol: +(std(rr) * Math.sqrt(252) * 100).toFixed(1) } : { n: 0 }; };
    const vixAt = (i: number) => vix.get(bars[i].d) ?? 15; const above200 = (i: number) => { const w = c.slice(i - 200, i); return w.length === 200 && c[i] > mean(w); };
    // seasonality
    const byMon: number[][] = Array.from({ length: 12 }, () => []); for (let i = 1; i < bars.length; i++) byMon[+bars[i].d.slice(5, 7) - 1].push(ret[i]);
    const seas = byMon.map((a, i) => ({ mon: i + 1, r: a.length ? +(mean(a) * 100 * 21).toFixed(2) : 0 }));
    const bestMon = [...seas].sort((a, b) => b.r - a.r)[0], worstMon = [...seas].sort((a, b) => a.r - b.r)[0];
    // live regime
    const vr = volRegimeDeRisk(ret.slice(1));
    const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const out = {
      ok: true, symbol, history: { from: bars[0].d, to: bars[bars.length - 1].d, years: +((bars.length) / 252).toFixed(1), days: bars.length },
      annualized_vol_pct: +(sd * Math.sqrt(252) * 100).toFixed(1), cagr_pct: +((Math.pow(c[c.length - 1] / c[0], 252 / bars.length) - 1) * 100).toFixed(1),
      tails: { skew: +skew.toFixed(2), kurtosis: +kurt.toFixed(1), worst_day_pct: +(sortedR[0] * 100).toFixed(1), worst_1pct_day: +(worst1 * 100).toFixed(1), fat_tailed: kurt > 5 },
      drawdown: { max_dd_pct: +(maxDD * 100).toFixed(0), current_dd_from_ath_pct: +(curDD * 100).toFixed(1) },
      beta_to_spy: Number.isFinite(beta) ? +beta.toFixed(2) : null,
      trend: { last, vs_50dma: ma50 ? (last > ma50 ? "above" : "below") : "n/a", vs_200dma: ma200 ? (last > ma200 ? "above" : "below") : "n/a" },
      behaviour_by_vix: { calm_lt15: cond((i) => vixAt(i) < 15), normal_15_25: cond((i) => vixAt(i) >= 15 && vixAt(i) < 25), stress_gt25: cond((i) => vixAt(i) >= 25) },
      behaviour_by_trend: { above_200ma: cond((i) => above200(i)), below_200ma: cond((i) => !above200(i)) },
      seasonality: { best_month: `${MON[bestMon.mon]} (+${bestMon.r}%)`, worst_month: `${MON[worstMon.mon]} (${worstMon.r}%)` },
      live_sizing: { vol_regime_deRisk: +vr.deRisk.toFixed(3), elevated: vr.elevated, reason: vr.reason },
      read: "Behaviour table = forward-5d return / win% / realized-vol in each condition. 'stress_gt25' shows how it acts in a VIX>25 panic; 'below_200ma' how it acts in a downtrend. Sizing deRisk is what the engine would apply to it right now.",
      disclaimer: "Historical behaviour, not a forecast or advice. Any listed ticker, free Yahoo daily.",
    };
    return new Response(JSON.stringify(out, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
