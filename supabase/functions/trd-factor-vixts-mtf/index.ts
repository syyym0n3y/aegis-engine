// trd-factor-vixts-mtf — second causal factor (vix_ts_slope) through the MTF + disaggregation discipline (D-334/Rule 8).
// FORCE: the VIX term-structure slope prices the variance-risk-premium. Contango (short-dated VIX below longer-dated) =
// risk-on = positive forward equity return; backwardation = risk-off. OBSERVABLE (point-in-time, known at that day's
// close): slope = VIX3M / VIX9D. NOTE ON ORIENTATION: the task text names the ratio "VIX9D/VIX3M" but registers
// hypothesized_sign=+1 with "higher contango -> positive forward return". VIX9D/VIX3M is LOWER in contango, which would
// invert the sign. To keep the value monotone-increasing in contango (and coherent with sign +1) this uses the inverse:
// slope = VIX3M/VIX9D (>1 = contango, normal; <1 = backwardation, stress). Sign-correct = IC POSITIVE.
// The slope is ONE daily series; its predictive relationship is tested across a BASKET of liquid ETFs (cross-sectional
// breadth), WITHIN point-in-time MTF regimes (SPY trend vs 50d MA; VIX level vs trailing median), per forward horizon
// (5d/21d), and across sequential walk-forward epochs. Verdict = the disaggregated grid; the pool is a footnote (Rule 8).
// All keyless Yahoo, $0. Sequential fetches only.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const FACTOR = "vix_ts_slope";
// ~13 liquid, non-redundant ETFs for cross-sectional breadth (broad + sectors).
const ETFS = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLY","XLI","XLP","XLU","SMH"];
const HORIZONS: [string, number][] = [["5d", 5], ["21d", 21]];
const MA_WIN = 50, VIX_MED_WIN = 63; // PIT higher-timeframe lookbacks (trading days)

function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
// returns [dateStr -> {close}] ordered arrays from a Yahoo daily chart (2y)
async function yahoo(sym: string): Promise<{ dates: string[]; close: number[]; tsSec: number[] } | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null; const j = await r.json();
    const res = j?.chart?.result?.[0]; if (!res?.timestamp) return null;
    const ts: number[] = res.timestamp; const cl: (number | null)[] = res.indicators.quote[0].close;
    const dates: string[] = [], close: number[] = [], tsSec: number[] = [];
    for (let i = 0; i < ts.length; i++) { if (cl[i] == null) continue; dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); close.push(cl[i] as number); tsSec.push(ts[i]); }
    return { dates, close, tsSec };
  } catch { return null; }
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    // ---- (1) term-structure slope series (PIT: value known at that day's close) ----
    const v9 = await yahoo("^VIX9D"), v3 = await yahoo("^VIX3M"), vix = await yahoo("^VIX"), spy = await yahoo("SPY");
    if (!v9 || !v3 || !vix || !spy) return new Response(JSON.stringify({ ok: false, err: "vix/spy fetch failed", got: { v9: !!v9, v3: !!v3, vix: !!vix, spy: !!spy } }), { status: 502, headers: cors });
    const slope = new Map<string, number>(), slopeTs = new Map<string, number>();
    { const m9 = new Map<string, number>(); v9.dates.forEach((d, i) => m9.set(d, v9.close[i]));
      v3.dates.forEach((d, i) => { const a = m9.get(d); if (a && a > 0) { slope.set(d, v3.close[i] / a); slopeTs.set(d, v3.tsSec[i]); } }); }
    // ---- (2) PIT higher-timeframe regimes ----
    const spyAbove = new Map<string, boolean>();
    for (let i = MA_WIN; i < spy.dates.length; i++) { const w = spy.close.slice(i - MA_WIN, i); const ma = w.reduce((a, b) => a + b, 0) / MA_WIN; spyAbove.set(spy.dates[i], spy.close[i] > ma); }
    const vixHi = new Map<string, boolean>();
    for (let i = VIX_MED_WIN; i < vix.dates.length; i++) { const w = [...vix.close.slice(i - VIX_MED_WIN, i)].sort((a, b) => a - b); const med = w[Math.floor(w.length / 2)]; vixHi.set(vix.dates[i], vix.close[i] > med); }
    // ---- (3) panel of observations: each (date, ETF) shares the day's slope, carries its own forward returns + PIT regime ----
    type Obs = { sym: string; date: string; ts: number; slope: number; fwd: Record<number, number>; trendUp: boolean; vixHigh: boolean };
    const obs: Obs[] = []; const valSeen = new Set<string>(); const valRows: Record<string, unknown>[] = [];
    for (const sym of ETFS) {
      const e = await yahoo(sym); if (!e) continue;
      const idx = new Map<string, number>(); e.dates.forEach((d, i) => idx.set(d, i));
      for (let i = 0; i < e.dates.length; i++) {
        const d = e.dates[i]; const s = slope.get(d); if (s === undefined) continue;
        const tu = spyAbove.get(d), vh = vixHi.get(d); if (tu === undefined || vh === undefined) continue;
        const fwd: Record<number, number> = {}; let ok = true;
        for (const [, hh] of HORIZONS) { const p0 = e.close[i], p1 = e.close[i + hh]; if (p1 === undefined) { ok = false; break; } fwd[hh] = (p1 - p0) / p0; }
        if (!ok) continue;
        obs.push({ sym, date: d, ts: slopeTs.get(d)!, slope: s, fwd, trendUp: tu, vixHigh: vh });
        if (!valSeen.has(d)) { valSeen.add(d); const iso = new Date(slopeTs.get(d)! * 1000).toISOString(); valRows.push({ factor_id: FACTOR, symbol: "_slope_", ts: iso, effective_date: iso, value: +s.toFixed(6), raw: { def: "VIX3M/VIX9D" } }); }
      }
    }
    // ---- (4) MTF regime grid: rank-IC of slope vs forward return WITHIN each PIT regime, per horizon ----
    const regimes: [string, (o: Obs) => boolean][] = [
      ["all", () => true],
      ["trend_up", (o) => o.trendUp], ["trend_down", (o) => !o.trendUp],
      ["vix_hi", (o) => o.vixHigh], ["vix_lo", (o) => !o.vixHigh],
      ["trend_up|vix_lo", (o) => o.trendUp && !o.vixHigh], ["trend_down|vix_hi", (o) => !o.trendUp && o.vixHigh],
      ["trend_up|vix_hi", (o) => o.trendUp && o.vixHigh], ["trend_down|vix_lo", (o) => !o.trendUp && !o.vixHigh],
    ];
    const grid: Record<string, unknown>[] = [];
    for (const [hname, hh] of HORIZONS) for (const [rname, filt] of regimes) {
      const sub = obs.filter(filt); const ic = rankIC(sub.map((o) => o.slope), sub.map((o) => o.fwd[hh]));
      grid.push({ horizon: hname, regime: rname, ic: ic.ic, t: ic.t, n: ic.n });
      if (!dry && rname !== "all" && ic.n >= 30) {
        await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: "etf13", horizon: hname, ic: ic.ic, ic_t: ic.t, n: ic.n, regime: `mtf:${rname}`, n_trials: 1, detail: `slope VIX3M/VIX9D vs fwd ${hname} | PIT regime ${rname}; sign+1=contango->up` }) }).catch(() => {});
        await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
      }
    }
    // ---- (5) walk-forward: 4 sequential epochs by date; sign +1 must hold in later held-out epochs ----
    const NEPOCH = 4; const sorted = [...obs].sort((a, b) => a.ts - b.ts); const per = Math.ceil(sorted.length / NEPOCH);
    const epochs: Record<string, unknown>[] = [];
    for (let ep = 0; ep < NEPOCH; ep++) {
      const sl = sorted.slice(ep * per, (ep + 1) * per); if (!sl.length) continue;
      const ic5 = rankIC(sl.map((o) => o.slope), sl.map((o) => o.fwd[5])); const ic21 = rankIC(sl.map((o) => o.slope), sl.map((o) => o.fwd[21]));
      epochs.push({ epoch: ep + 1, span: `${sl[0].date}..${sl[sl.length - 1].date}`, ic5: ic5.ic, t5: ic5.t, ic21: ic21.ic, t21: ic21.t, n: sl.length });
    }
    // ---- (6) breadth: per-ETF IC (21d) — how many of the basket are sign-correct (positive) ----
    const bySym: Record<string, unknown>[] = []; let signCorrect = 0, measured = 0;
    for (const sym of ETFS) {
      const s = obs.filter((o) => o.sym === sym); if (s.length < 30) { bySym.push({ sym, n: s.length, skip: true }); continue; }
      const ic = rankIC(s.map((o) => o.slope), s.map((o) => o.fwd[21])); measured++; if (ic.ic > 0) signCorrect++;
      bySym.push({ sym, ic21: ic.ic, t21: ic.t, n: ic.n });
    }
    // ---- (7) persist point-in-time slope values + orient factor to measuring ----
    let valuesWritten = 0;
    if (!dry) {
      for (let i = 0; i < valRows.length; i += 1000) await fetch(`${SB}/rest/v1/trd_factor_value?on_conflict=factor_id,symbol,ts`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(valRows.slice(i, i + 1000)) }).catch(() => {});
      await fetch(`${SB}/rest/v1/trd_factor?id=eq.${FACTOR}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "measuring" }) }).catch(() => {});
      valuesWritten = valRows.length;
    }
    const poolFoot = grid.find((g) => g.regime === "all" && g.horizon === "21d");
    return new Response(JSON.stringify({
      ok: true, factor: FACTOR, slope_def: "VIX3M/VIX9D (>1 contango); sign+1 = higher contango -> positive fwd equity ret",
      hypothesized_sign: 1, total_obs: obs.length, slope_days: valRows.length, etfs: ETFS.length,
      footnote_pooled_21d: poolFoot ? { ic: poolFoot.ic, t: poolFoot.t, n: poolFoot.n } : null,
      mtf_regime_grid: grid, walk_forward_epochs: epochs,
      breadth_21d: { symbols_measured: measured, sign_correct_positive: signCorrect, of: measured, per_symbol: bySym },
      values_written: valuesWritten,
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 400) }), { status: 500, headers: cors }); }
});
