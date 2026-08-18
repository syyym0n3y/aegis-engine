#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-worker.ts — the OWN COMPUTE NODE. A standalone, UNCAPPED worker you run yourself (`deno run -A scripts/aegis-worker.ts`)
// on your Mac or any box. It talks ONLY to the trd-compute broker (no secret on this machine), draining trd_compute_jobs
// and running heavy era-disaggregated work that the 2s Supabase edge cap physically cannot hold — the substrate that turns
// the factor engine into the causal-ATTRIBUTION engine. Job types: 'deep_factor_ic' (era-disaggregated + deflated IC across
// the 33-yr deep history) which also emits per-instrument buy/sell SIGNALS. Idempotent, resumable, credential-free.
//   Run once:   deno run -A scripts/aegis-worker.ts --once
//   Run daemon: deno run -A scripts/aegis-worker.ts           (polls, uncapped, until killed)
const BROKER = Deno.env.get("AEGIS_BROKER") || "https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-compute";
const WORKER = Deno.env.get("AEGIS_WORKER_ID") || "w-local";
const ONCE = Deno.args.includes("--once");
const POLL_MS = 3000;

const ERAS: [string, number, number][] = [
  ["pre_dotcom_<2000", 0, 2000], ["dotcom_bust_00_02", 2000, 2003], ["bull_03_07", 2003, 2008],
  ["gfc_08_09", 2008, 2010], ["qe_bull_10_19", 2010, 2020], ["covid_20_21", 2020, 2022], ["tightening_22_26", 2022, 2100],
];
function rankIC(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 30) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys), mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
const yearOf = (ts: number) => new Date(ts * 1000).getUTCFullYear();
const eraOf = (ts: number) => { const y = yearOf(ts); return ERAS.find(([, a, b]) => y >= a && y < b)?.[0] || "?"; };

async function getBars(sym: string): Promise<number[][] | null> {
  const r = await fetch(`${BROKER}?bars=${encodeURIComponent(sym)}`).then((x) => x.json()).catch(() => null);
  return r?.row?.bars ?? null; // [[ts,o,h,l,c,v],...]
}
async function getIntraday(sym: string): Promise<number[][] | null> {
  const r = await fetch(`${BROKER}?intraday=${encodeURIComponent(sym)}`).then((x) => x.json()).catch(() => null);
  return r?.row?.bars ?? null; // minute [[ts_sec,o,h,l,c,v],...]
}
function iret(bars: number[][]): Map<number, number> {
  const m = new Map<number, number>(); for (let i = 1; i < bars.length; i++) { const p0 = bars[i - 1][4], p1 = bars[i][4]; if (p0 > 0 && Number.isFinite(p1)) m.set(bars[i][0], p1 / p0 - 1); } return m;
}
// JOB: strategy_sweep — test the FREE documented anomaly battery through the era-disaggregated engine at once. Per
// instrument×date computes each signal (from daily OHLC) + forward 21d return; pools per era; rank-IC + deflation. One pass
// tests trend, momentum variants, 52wk-high, MAX/lottery, short-reversal, low-vol, overnight — honest, most will be null.
async function runStrategySweep(params: { symbols?: string[]; horizon?: number }) {
  const HZ = params.horizon ?? 21;
  const symbols = params.symbols?.length ? params.symbols : await getUniverse();
  const SIGS = ["mom_12_1", "trend_200", "high_52w", "max_lottery", "rev_5d", "lowvol_60", "overnight"] as const;
  const acc: Record<string, Record<string, { x: number[]; y: number[] }>> = {}; // sig → era → {x,y}
  for (const s of SIGS) acc[s] = {};
  for (const sym of symbols) {
    const b = await getBars(sym); if (!b || b.length < 300) continue;
    const o = b.map((r) => r[1]), c = b.map((r) => r[4]), ts = b.map((r) => r[0]);
    for (let i = 260; i < b.length - HZ; i++) {
      const fwd = c[i + HZ] / c[i] - 1; if (!Number.isFinite(fwd)) continue; const era = eraOf(ts[i]);
      const win = c.slice(i - 21, i); const rets = []; for (let k = 1; k < win.length; k++) rets.push(win[k] / win[k - 1] - 1);
      const v60 = c.slice(i - 60, i); const r60: number[] = []; for (let k = 1; k < v60.length; k++) r60.push(v60[k] / v60[k - 1] - 1);
      const sd = r60.length ? Math.sqrt(r60.reduce((a, x) => a + x * x, 0) / r60.length) : 0;
      const sig: Record<string, number> = {
        mom_12_1: c[i - 21] / c[i - 252] - 1,
        trend_200: c[i] / (c.slice(i - 200, i).reduce((a, x) => a + x, 0) / 200) - 1,
        high_52w: c[i] / Math.max(...c.slice(i - 252, i + 1)),
        max_lottery: -Math.max(...rets),            // lottery: high max → lower fwd (sign −)
        rev_5d: -(c[i] / c[i - 5] - 1),              // short-term reversal (sign −)
        lowvol_60: -sd,                              // low-vol: high vol → lower fwd (sign −)
        overnight: (o[i] - c[i - 1]) / c[i - 1],     // overnight gap
      };
      for (const s of SIGS) { const val = sig[s]; if (!Number.isFinite(val)) continue; (acc[s][era] ||= { x: [], y: [] }); acc[s][era].x.push(val); acc[s][era].y.push(fwd); (acc[s].ALL ||= { x: [], y: [] }); acc[s].ALL.x.push(val); acc[s].ALL.y.push(fwd); } // deno-lint-ignore
    }
  }
  const out: Record<string, unknown>[] = [];
  for (const s of SIGS) { const eras = Object.entries(acc[s]).map(([era, d]) => ({ era, ...rankIC(d.x, d.y) })).filter((e) => e.n > 50); out.push({ signal: s, cells: eras }); }
  return { result: { factor: "strategy_sweep", n_symbols: symbols.length, battery: out } };
}

// JOB: xsec_sweep — CORRECTED cross-sectional test (audit D-359 fix). Momentum/reversal/lottery/vol are CROSS-SECTIONAL
// factors: rank symbols WITHIN each date, per-date rank-IC, then Fama-MacBeth average (the pooled panel-IC in strategy_sweep
// diluted real cross-sectional edges toward zero — violated our own no-pooling law). Also: overnight tested as its OWN
// return (close→open), not 21d. Universe MUST be homogeneous (equities). t = mean(dailyIC)/(sd/sqrt(#days)) — honest N.
async function getUniverse(): Promise<string[]> {
  const r = await fetch(`${BROKER}?universe=1`).then((x) => x.json()).catch(() => null);
  return (r?.symbols ?? []) as string[];
}
async function runXsecSweep(params: { symbols?: string[]; horizon?: number }) {
  const HZ = params.horizon ?? 21;
  const symbols = params.symbols?.length ? params.symbols : await getUniverse(); // self-pull the full accumulated universe
  const SIGS = ["mom_12_1", "rev_5d", "max_lottery", "lowvol_60", "trend_200", "high_52w"] as const;
  // per signal: date → {x: signal vals, y: fwd returns} across symbols (the cross-section that date)
  const byDate: Record<string, Map<string, { x: number[]; y: number[] }>> = {}; for (const s of SIGS) byDate[s] = new Map();
  const onDate = new Map<string, { ov: number[]; intr: number[] }>(); // overnight premium (own return)
  for (const sym of symbols) {
    const b = await getBars(sym); if (!b || b.length < 300) continue;
    const o = b.map((r) => r[1]), c = b.map((r) => r[4]), ts = b.map((r) => r[0]);
    for (let i = 260; i < b.length - HZ; i++) {
      const fwd = c[i + HZ] / c[i] - 1; if (!Number.isFinite(fwd)) continue; const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      const win = c.slice(i - 21, i); const rets: number[] = []; for (let k = 1; k < win.length; k++) rets.push(win[k] / win[k - 1] - 1);
      const v60 = c.slice(i - 60, i); const r60: number[] = []; for (let k = 1; k < v60.length; k++) r60.push(v60[k] / v60[k - 1] - 1);
      const sd = r60.length ? Math.sqrt(r60.reduce((a, x) => a + x * x, 0) / r60.length) : 0;
      const sig: Record<string, number> = { mom_12_1: c[i - 21] / c[i - 252] - 1, rev_5d: -(c[i] / c[i - 5] - 1), max_lottery: -Math.max(...rets), lowvol_60: -sd, trend_200: c[i] / (c.slice(i - 200, i).reduce((a, x) => a + x, 0) / 200) - 1, high_52w: c[i] / Math.max(...c.slice(i - 252, i + 1)) };
      for (const s of SIGS) { const v = sig[s]; if (!Number.isFinite(v)) continue; const m = byDate[s].get(d) ?? byDate[s].set(d, { x: [], y: [] }).get(d)!; m.x.push(v); m.y.push(fwd); }
      // overnight premium: the overnight gap return vs the intraday return (own, not cross-sectional)
      const ov = (o[i] - c[i - 1]) / c[i - 1], intr = (c[i] - o[i]) / o[i]; if (Number.isFinite(ov) && Number.isFinite(intr)) { const e = onDate.get(d) ?? onDate.set(d, { ov: [], intr: [] }).get(d)!; e.ov.push(ov); e.intr.push(intr); }
    }
  }
  const out: Record<string, unknown>[] = [];
  for (const s of SIGS) {
    const byEra: Record<string, number[]> = {};
    for (const [d, m] of byDate[s]) { if (m.x.length < 8) continue; const ic = rankIC(m.x, m.y).ic; if (!Number.isFinite(ic)) continue; const era = eraOf(Math.floor(new Date(d).getTime() / 1000)); (byEra[era] ||= []).push(ic); (byEra.ALL ||= []).push(ic); }
    const cells = Object.entries(byEra).filter(([, a]) => a.length >= 30).map(([era, a]) => { const mn = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - mn) ** 2, 0) / (a.length - 1)); return { era, ic: +mn.toFixed(4), t: +(mn / (sd / Math.sqrt(a.length))).toFixed(2), n_days: a.length }; });
    out.push({ signal: s, cells });
  }
  // overnight premium: mean daily overnight vs intraday return, Fama-MacBeth
  const ovM: number[] = [], intrM: number[] = []; for (const [, e] of onDate) { if (e.ov.length < 3) continue; ovM.push(e.ov.reduce((a, b) => a + b, 0) / e.ov.length); intrM.push(e.intr.reduce((a, b) => a + b, 0) / e.intr.length); }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length; const tt = (a: number[]) => { const m = mean(a); const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); return { mean_bp: +(1e4 * m).toFixed(2), t: +(m / (sd / Math.sqrt(a.length))).toFixed(2), n: a.length }; };
  return { result: { factor: "xsec_sweep_famamacbeth", n_symbols: symbols.length, battery: out, overnight_premium: { overnight: tt(ovM), intraday: tt(intrM) } } };
}

// JOB: fundamentals_ic — CROSS-SECTIONAL value/quality/investment/leverage (D-362). Rank names WITHIN each month by each
// fundamental factor (point-in-time via effective_date, the 75d filing lag baked in), per-month rank-IC vs the forward
// quarterly return, Fama-MacBeth average per era. Factors: value (book/mktcap), earnings-yield (NI/mktcap), quality (ROE),
// investment (−asset-growth), leverage (liab/assets). Market cap = shares×price. Honest window: fundamentals are recent
// (2023–2025 frames), so eras skew to the tightening regime — reported next to N, deflated, default REJECT (D-070).
async function runFundamentalsIC(params: { horizon?: number }) {
  const HZ = params.horizon ?? 63; // ~1 quarter forward
  const fr = await fetch(`${BROKER}?fundamentals=1`).then((r) => r.json()).catch(() => null);
  const rows = (fr?.rows ?? []) as { t: string; c: string; e: string; v: number }[];
  // ticker → concept → sorted [{eff(ms), val}]
  const fund = new Map<string, Record<string, { e: number; v: number }[]>>();
  for (const r of rows) { const m = fund.get(r.t) ?? fund.set(r.t, {}).get(r.t)!; (m[r.c] ||= []).push({ e: new Date(r.e).getTime(), v: r.v }); }
  for (const m of fund.values()) for (const k in m) m[k].sort((a, b) => a.e - b.e);
  const pit = (m: Record<string, { e: number; v: number }[]> | undefined, c: string, atMs: number): number | null => {
    const a = m?.[c]; if (!a) return null; let v: number | null = null; for (const x of a) { if (x.e <= atMs) v = x.v; else break; } return v;
  };
  const FACS = ["value_bm", "earnings_yield", "quality_roe", "investment", "leverage"] as const;
  const byMonth: Record<string, Map<string, { x: number[]; y: number[] }>> = {}; for (const f of FACS) byMonth[f] = new Map();
  const symbols = await getUniverse();
  for (const sym of symbols) {
    const fm = fund.get(sym); if (!fm) continue;
    const b = await getBars(sym); if (!b || b.length < HZ + 30) continue;
    const c = b.map((r) => r[4]), ts = b.map((r) => r[0]);
    let lastMonth = "";
    for (let i = 0; i < b.length - HZ; i++) {
      const dt = new Date(ts[i] * 1000); const mo = dt.toISOString().slice(0, 7); if (mo === lastMonth) continue; lastMonth = mo; // one obs/month/name
      const atMs = ts[i] * 1000, px = c[i]; const fwd = c[i + HZ] / c[i] - 1; if (!Number.isFinite(fwd) || !(px > 0)) continue;
      const be = pit(fm, "StockholdersEquity", atMs), ni = pit(fm, "NetIncomeLoss", atMs), assets = pit(fm, "Assets", atMs), liab = pit(fm, "Liabilities", atMs), sh = pit(fm, "EntityCommonStockSharesOutstanding", atMs);
      const assetsPrev = pit(fm, "Assets", atMs - 365 * 864e5);
      const mcap = sh && sh > 0 ? sh * px : null;
      const fac: Record<string, number | null> = {
        value_bm: mcap && be != null ? be / mcap : null,
        earnings_yield: mcap && ni != null ? ni / mcap : null,
        quality_roe: be && be > 0 && ni != null ? ni / be : null,
        investment: assets && assetsPrev && assetsPrev > 0 ? -(assets / assetsPrev - 1) : null,
        leverage: assets && assets > 0 && liab != null ? -(liab / assets) : null, // sign −: high leverage hypothesized distress
      };
      for (const f of FACS) { const v = fac[f]; if (v == null || !Number.isFinite(v)) continue; const m = byMonth[f].get(mo) ?? byMonth[f].set(mo, { x: [], y: [] }).get(mo)!; m.x.push(v); m.y.push(fwd); }
    }
  }
  const out: Record<string, unknown>[] = [];
  for (const f of FACS) {
    const byEra: Record<string, number[]> = {};
    for (const [mo, m] of byMonth[f]) { if (m.x.length < 10) continue; const ic = rankIC(m.x, m.y).ic; if (!Number.isFinite(ic)) continue; const era = eraOf(Math.floor(new Date(mo + "-01").getTime() / 1000)); (byEra[era] ||= []).push(ic); (byEra.ALL ||= []).push(ic); }
    const cells = Object.entries(byEra).filter(([, a]) => a.length >= 6).map(([era, a]) => { const mn = a.reduce((x, y) => x + y, 0) / a.length; const sd = a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mn) ** 2, 0) / (a.length - 1)) : 0; return { era, ic: +mn.toFixed(4), t: sd > 0 ? +(mn / (sd / Math.sqrt(a.length))).toFixed(2) : 0, n_months: a.length }; });
    out.push({ factor: f, cells });
  }
  return { result: { factor: "fundamentals_ic_famamacbeth", horizon_days: HZ, n_symbols_with_fund: [...fund.keys()].length, battery: out } };
}

// JOB: insider_ic — the WORKER-PACED insider test. The edge fn hits Yahoo's IP rate-limit (~5 tickers); the worker runs on
// a different IP and PACES itself (delay/call), so it tests HUNDREDS of insider tickers across the decades. Event study:
// after an open-market insider buy (disclosed_date, knowable), does the stock outperform over the next 21 trading days?
async function runInsiderIC(params: { limit?: number; horizon?: number; pace_ms?: number; opportunistic?: boolean }) {
  const HZ = params.horizon ?? 21, PACE = params.pace_ms ?? 400;
  const sr = await fetch(`${BROKER}?insider=${params.limit ?? 300}${params.opportunistic ? "&opp=1" : ""}`).then((r) => r.json()).catch(() => null);
  const sample = (sr?.sample ?? []) as { ticker: string; dates: string[] }[];
  const fwd: number[] = []; let nT = 0, posT = 0, covered = 0;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  for (const { ticker, dates } of sample) {
    await new Promise((r) => setTimeout(r, PACE)); // pace to respect Yahoo (uncapped worker can afford it)
    const p2 = Math.floor(Date.now() / 1000);
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
    const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue; covered++;
    const c = res.indicators.quote[0].close as number[]; const ds: string[] = res.timestamp.map((t: number) => new Date(t * 1000).toISOString().slice(0, 10));
    const idx = new Map<string, number>(); ds.forEach((d, i) => idx.set(d, i));
    const tf: number[] = [];
    for (const d of dates) { let i = idx.get(d); if (i == null) { const k = ds.findIndex((x) => x >= d); if (k < 0) continue; i = k; } if (i + HZ >= c.length || c[i] == null || c[i + HZ] == null) continue; tf.push(c[i + HZ] / c[i] - 1); }
    if (tf.length) { nT++; if (mean(tf) > 0) posT++; fwd.push(...tf); }
  }
  const n = fwd.length, m = n ? mean(fwd) : 0;
  const sd = n > 1 ? Math.sqrt(fwd.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
  const win = n ? 100 * fwd.filter((x) => x > 0).length / n : 0;
  return { result: { factor: params.opportunistic ? "insider_buys_opportunistic" : "insider_buys", n_events: n, n_tickers: nT, sample_size: sample.length, coverage: covered, mean_fwd_ret_pct: +(100 * m).toFixed(3), t_stat: +t.toFixed(2), win_pct: +win.toFixed(0), breadth: `${posT}/${nT}`, horizon_days: HZ } };
}

// JOB: price_accumulate — drain the broad-price-coverage gap (D-360b). Pull a worklist of fundamentals tickers lacking
// deep bars, fetch Yahoo daily period1=0 (own IP, paced), flush [[ts,o,h,l,c,v]] batches to the broker → trd_bars_deep.
// This is the substrate that finally lets cross-sectional momentum/value run on hundreds of names instead of ~40.
async function runPriceAccumulate(params: { batch?: number; pace_ms?: number }) {
  const BATCH = params.batch ?? 250, PACE = params.pace_ms ?? 250;
  const wl = await fetch(`${BROKER}?worklist=${BATCH}`).then((r) => r.json()).catch(() => null);
  const tickers = (wl?.tickers ?? []) as string[];
  const p2 = Math.floor(Date.now() / 1000);
  let stored = 0, empty = 0; const pending: { symbol: string; asset_class: string; bars: number[][] }[] = [];
  const flush = async () => { if (pending.length) { await fetch(BROKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bars_upsert: pending.splice(0) }) }).catch(() => {}); } };
  for (const sym of tickers) {
    await new Promise((r) => setTimeout(r, PACE));
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
    const res = j?.chart?.result?.[0]; if (!res?.timestamp) { empty++; continue; }
    const q = res.indicators.quote[0], ts = res.timestamp as number[]; const bars: number[][] = [];
    for (let i = 0; i < ts.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i]; if ([o, h, l, c].some((x: number) => x == null || !Number.isFinite(x))) continue; bars.push([ts[i], o, h, l, c, v ?? 0]); }
    if (bars.length < 250) { empty++; continue; } // need ~1yr+ of history to be useful for momentum/value
    pending.push({ symbol: sym, asset_class: "equity", bars }); stored++;
    if (pending.length >= 20) await flush();
  }
  await flush();
  return { result: { factor: "price_accumulate", requested: tickers.length, stored, empty } };
}

// JOB: intraday_attribution — take attribution BELOW daily. Regress a stock's MINUTE returns onto market (SPY) + its own
// sector at 1-min/5-min/60-min (non-overlapping) → the R2 ladder from the minute up. Needs Databento intraday (trd_bars_intraday).
async function runIntradayAttribution(params: { targets: string[] }) {
  const SEC: Record<string, string> = { AAPL: "XLK", MSFT: "XLK", INTC: "XLK", CSCO: "XLK", JPM: "XLF", AXP: "XLF", XOM: "XLE", CVX: "XLE", JNJ: "XLV" };
  const spy = iret(await getIntraday("SPY") ?? []); const secCache = new Map<string, Map<number, number>>();
  const attribution: Record<string, unknown>[] = [], ladderOut: Record<string, unknown>[] = [];
  for (const sym of params.targets) {
    const tb = await getIntraday(sym); const secEtf = SEC[sym]; if (!tb || !secEtf) continue;
    if (!secCache.has(secEtf)) secCache.set(secEtf, iret(await getIntraday(secEtf) ?? []));
    const sec = secCache.get(secEtf)!, tr = iret(tb);
    const Y: number[] = [], Xs: number[] = [], Xc: number[] = [];
    for (const [t, r] of tr) { const sv = spy.get(t), cv = sec.get(t); if (sv != null && cv != null) { Y.push(r); Xs.push(sv); Xc.push(cv); } }
    const ladder: Record<string, unknown> = {};
    for (const [name, k] of [["min1", 1], ["min5", 5], ["min60", 60]] as [string, number][]) {
      const nb = Math.floor(Y.length / k); if (nb < 30) continue; const Yb: number[] = [], Xb: number[][] = [];
      for (let bi = 0; bi < nb; bi++) { let y = 0, xs = 0, xc = 0; for (let j = 0; j < k; j++) { const i = bi * k + j; y += Y[i]; xs += Xs[i]; xc += Xc[i]; } Yb.push(y); Xb.push([1, xs, xc]); }
      const fit = ols(Yb, Xb); if (fit) ladder[name] = { r2: fit.r2, mkt_t: fit.t[1], sector_t: fit.t[2], n: fit.n };
    }
    attribution.push({ symbol: sym, per_tf_intraday: ladder }); ladderOut.push({ sym, sector: secEtf, ...ladder });
  }
  return { result: { factor: "intraday_attribution", n: ladderOut.length, ladder: ladderOut }, attribution };
}

// JOB: deep_factor_ic — 12-1 momentum, era-disaggregated + deflated IC across 33yr history; emits per-symbol signals.
async function runDeepFactorIC(params: { symbols: string[]; lookback?: number; skip?: number; horizon?: number }) {
  const LB = params.lookback ?? 252, SK = params.skip ?? 21, HZ = params.horizon ?? 21;
  const obsByEra: Record<string, { m: number[]; f: number[] }> = {};
  const latest: Record<string, number> = {};
  for (const sym of params.symbols) {
    const bars = await getBars(sym); if (!bars || bars.length < LB + HZ + 30) continue;
    const ts = bars.map((b) => b[0]), c = bars.map((b) => b[4]);
    for (let i = LB; i < bars.length - HZ; i++) {
      const mom = c[i - SK] / c[i - LB] - 1;        // 12-1 momentum (skip last month), known at t
      const fwd = c[i + HZ] / c[i] - 1;             // forward HZ-day return
      if (!Number.isFinite(mom) || !Number.isFinite(fwd)) continue;
      const e = eraOf(ts[i]); (obsByEra[e] ||= { m: [], f: [] }); obsByEra[e].m.push(mom); obsByEra[e].f.push(fwd);
    }
    // current signal input: latest computable 12-1 momentum
    const j = bars.length - 1; if (j - LB >= 0) latest[sym] = c[j - SK] / c[j - LB] - 1;
  }
  const grid = ERAS.map(([e]) => ({ era: e, ...rankIC(obsByEra[e]?.m || [], obsByEra[e]?.f || []) })).filter((g) => g.n > 0);
  const sig = grid.filter((g) => g.n >= 100);
  const meanIC = sig.length ? sig.reduce((s, g) => s + g.ic, 0) / sig.length : 0;
  const signCorrect = sig.filter((g) => g.ic > 0).length;                 // momentum hypo sign +1
  const eraConsistency = sig.length ? signCorrect / sig.length : 0;       // fraction of eras with correct sign
  const asof = new Date().toISOString().slice(0, 10);
  const signals = Object.entries(latest).map(([symbol, mom]) => {
    const lean = Math.max(-1, Math.min(1, mom / 0.3));                    // momentum → lean, scaled/clamped
    const confidence = +(Math.max(0, meanIC) * eraConsistency).toFixed(3); // calibrated by cross-era IC + consistency
    const residual = +(1 - Math.min(1, Math.abs(meanIC))).toFixed(3);      // unexplained fraction (anti-guru number)
    return { symbol, asof, lean: +lean.toFixed(3), confidence,
      engage: confidence >= 0.02 && eraConsistency >= 0.6,               // gate: honest — most will be false
      why: { factor: "mom_12_1", momentum: +mom.toFixed(4), mean_era_ic: +meanIC.toFixed(4), era_consistency: eraConsistency },
      residual, note: `mom12-1 | ${signCorrect}/${sig.length} eras sign-correct | meanIC ${meanIC.toFixed(4)}` };
  });
  return { result: { factor: "mom_12_1", era_grid: grid, mean_ic: +meanIC.toFixed(4), era_consistency: eraConsistency, n_symbols: Object.keys(latest).length }, signals };
}

// ---- multi-factor ATTRIBUTION (layer 1): decompose each instrument's return onto all causal forces via OLS ----
// causal forces (keyless deep history). Composite SIZE = RUT−GSPC (small-minus-big premium). Each has a NAMED mechanism;
// a force earns its place only with a mechanism + adjusted-R2 lift + cross-era stability (ANALYSIS_CONTRACT: no noise regressors).
// cluster-aware causal force sets — each cluster gets mechanism-backed forces suited to its instruments. Equities: market/
// rates/vol/commodities/size. FX: the REAL drivers — short-rate (policy/carry), long-rate, risk-sentiment (safe-haven),
// gold, oil (commodity currencies) — NOT a dollar-index proxy (regressing a USD pair on DXY is definitional, not understanding).
async function buildForces(cluster: string): Promise<{ fret: Map<string, Map<number, number>>; keys: string[] }> {
  const rm = async (sym: string, mode: "ret" | "diff") => { const b = await getBars(sym); return b ? retMap(b, mode) : new Map<number, number>(); };
  const fret = new Map<string, Map<number, number>>();
  if (cluster === "fx") {
    fret.set("SHORT", await rm("^IRX", "diff")); fret.set("LONG", await rm("^TNX", "diff")); fret.set("RISK", await rm("^VIX", "ret"));
    fret.set("GOLD", await rm("GC=F", "ret")); fret.set("OIL", await rm("CL=F", "ret"));
    return { fret, keys: ["SHORT", "LONG", "RISK", "GOLD", "OIL"] };
  }
  // broad USD-strength basket (external dollar factor) — shared by commodity + foreign-index clusters.
  const buildDollar = async () => {
    const pairs: [string, number][] = [["EURUSD=X", -1], ["GBPUSD=X", -1], ["AUDUSD=X", -1], ["NZDUSD=X", -1], ["JPY=X", 1], ["CAD=X", 1], ["CHF=X", 1], ["MXN=X", 1]];
    const legs: Map<number, number>[] = [];
    for (const [sym, sgn] of pairs) { const m = await rm(sym, "ret"); const s = new Map<number, number>(); for (const [d, v] of m) s.set(d, sgn * v); legs.push(s); }
    const dollar = new Map<number, number>(); const allDays = new Set<number>(); for (const l of legs) for (const d of l.keys()) allDays.add(d);
    for (const d of allDays) { let sum = 0, c = 0; for (const l of legs) { const v = l.get(d); if (v != null) { sum += v; c++; } } if (c >= 4) dollar.set(d, sum / c); }
    return dollar;
  };
  if (cluster === "commodity") {
    // commodities priced in USD → broad DOLLAR dominates; plus real-rate demand, risk, growth. Term-structure/roll is a
    // return component (needs the futures curve → Databento), not an external force.
    fret.set("DOLLAR", await buildDollar()); fret.set("RATES", await rm("^TNX", "diff")); fret.set("RISK", await rm("^VIX", "ret")); fret.set("MKT", await rm("^GSPC", "ret"));
    return { fret, keys: ["DOLLAR", "RATES", "RISK", "MKT"] };
  }
  if (cluster === "foreign_index") {
    // foreign indices FOLLOW Wall Street (US lead) + global risk + the USD channel + the global rate anchor. NOTE: true
    // LOCAL-rate forces (JGB/Bund/Gilt) are NOT keyless — that's a Databento/paid gap; US ^TNX is the global rate proxy here.
    fret.set("US_MKT", await rm("^GSPC", "ret")); fret.set("RISK", await rm("^VIX", "ret")); fret.set("DOLLAR", await buildDollar()); fret.set("RATES", await rm("^TNX", "diff"));
    return { fret, keys: ["US_MKT", "RISK", "DOLLAR", "RATES"] };
  }
  if (cluster === "crypto") {
    // alts are dominated by BTC (crypto-market beta) + ETH; plus the macro channel (USD, traditional risk). BTC/ETH are
    // the forces, so they're excluded from the targets (would be definitional).
    fret.set("BTC", await rm("BTC-USD", "ret")); fret.set("ETH", await rm("ETH-USD", "ret")); fret.set("DOLLAR", await buildDollar()); fret.set("RISK", await rm("^VIX", "ret"));
    return { fret, keys: ["BTC", "ETH", "DOLLAR", "RISK"] };
  }
  if (cluster === "equity_sector") {
    // single stocks decompose into MARKET + own-SECTOR + idiosyncratic. Global forces here; the per-target own-sector force
    // is added in the attribution loop (SECTOR_MAP). Raises R2 and splits the "why" into market vs sector vs stock-specific.
    fret.set("MKT", await rm("^GSPC", "ret")); fret.set("RATES", await rm("^TNX", "diff")); fret.set("VOL", await rm("^VIX", "ret"));
    const rut = await rm("^RUT", "ret"), g = fret.get("MKT")!; const sz = new Map<number, number>();
    for (const [d, rv] of rut) { const gv = g.get(d); if (gv != null) sz.set(d, rv - gv); } fret.set("SIZE", sz);
    return { fret, keys: ["MKT", "RATES", "VOL", "SIZE"] };
  }
  fret.set("MKT", await rm("^GSPC", "ret")); fret.set("RATES", await rm("^TNX", "diff")); fret.set("VOL", await rm("^VIX", "ret"));
  fret.set("OIL", await rm("CL=F", "ret")); fret.set("GOLD", await rm("GC=F", "ret"));
  const rut = await rm("^RUT", "ret"), gsp = fret.get("MKT")!; const sz = new Map<number, number>();
  for (const [d, rv] of rut) { const gv = gsp.get(d); if (gv != null) sz.set(d, rv - gv); }
  fret.set("SIZE", sz);
  return { fret, keys: ["MKT", "RATES", "VOL", "OIL", "GOLD", "SIZE"] };
}
const dayKey = (ts: number) => Math.floor(ts / 86400);
function retMap(bars: number[][], mode: "ret" | "diff"): Map<number, number> {
  const m = new Map<number, number>(); for (let i = 1; i < bars.length; i++) { const p0 = bars[i - 1][4], p1 = bars[i][4]; if (!(p0 > 0) || !Number.isFinite(p1)) continue; m.set(dayKey(bars[i][0]), mode === "ret" ? p1 / p0 - 1 : p1 - p0); } return m;
}
function matInv(A: number[][]): number[][] | null {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null; [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
function ols(Y: number[], X: number[][]) { // X rows already include leading 1 (intercept)
  if (!Y.length || !X.length || !X[0]) return null;
  const n = Y.length, p = X[0].length; if (n < p + 10) return null;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) { for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * Y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; } }
  const inv = matInv(XtX); if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const ybar = Y.reduce((s, v) => s + v, 0) / n; let ssres = 0, sstot = 0;
  for (let i = 0; i < n; i++) { const yh = X[i].reduce((s, v, j) => s + v * beta[j], 0); ssres += (Y[i] - yh) ** 2; sstot += (Y[i] - ybar) ** 2; }
  const r2 = sstot > 0 ? 1 - ssres / sstot : 0, sigma2 = ssres / (n - p);
  const t = beta.map((b, j) => { const v = sigma2 * inv[j][j]; return v > 0 ? +(b / Math.sqrt(v)).toFixed(2) : 0; });
  return { beta, t, r2: +r2.toFixed(4), n };
}
async function runAttribution(params: { targets: string[]; cluster?: string }) {
  const cluster = params.cluster || "equity";
  const { fret, keys: FK } = await buildForces(cluster);
  const SECTOR_MAP: Record<string, string> = { AAPL: "XLK", MSFT: "XLK", INTC: "XLK", CSCO: "XLK", ORCL: "XLK", IBM: "XLK", JPM: "XLF", AXP: "XLF", XOM: "XLE", CVX: "XLE", JNJ: "XLV", AMGN: "XLV", PG: "XLP", KO: "XLP", WMT: "XLP", MCD: "XLY", DIS: "XLY", HD: "XLY", NKE: "XLY", CAT: "XLI", BA: "XLI", MMM: "XLI", GE: "XLI", T: "XLC", VZ: "XLC" };
  const secCache = new Map<string, Map<number, number>>();
  const getSec = async (etf: string) => { if (!secCache.has(etf)) { const b = await getBars(etf); secCache.set(etf, b ? retMap(b, "ret") : new Map()); } return secCache.get(etf)!; };
  const attribution: Record<string, unknown>[] = [];
  const asof = new Date().toISOString().slice(0, 10);
  for (const sym of params.targets) {
    const b = await getBars(sym); if (!b || b.length < 300) continue; const tr = retMap(b, "ret");
    const secEtf = cluster === "equity_sector" ? SECTOR_MAP[sym] : undefined;   // own-sector force, per target
    const secRet = secEtf ? await getSec(secEtf) : undefined;
    const FKL = secRet ? [...FK, "SECTOR"] : FK;
    const days: number[] = [], Y: number[] = [], X: number[][] = [], yrs: number[] = [];
    for (const [d, r] of tr) { const row = [1]; let ok = true; for (const key of FK) { const fv = fret.get(key)?.get(d); if (fv == null) { ok = false; break; } row.push(fv); } if (ok && secRet) { const sv = secRet.get(d); if (sv == null) ok = false; else row.push(sv); } if (ok) { days.push(d); Y.push(r); X.push(row); yrs.push(new Date(d * 86400 * 1000).getUTCFullYear()); } }
    const fit = ols(Y, X); if (!fit) continue;
    const p = FKL.length, adj = +(1 - (1 - fit.r2) * (fit.n - 1) / (fit.n - p - 1)).toFixed(4); // ADJUSTED R2 — penalizes added forces
    const betas: Record<string, unknown> = {}; FKL.forEach((key, i) => betas[key] = { beta: +fit.beta[i + 1].toFixed(3), t: fit.t[i + 1] });
    // MULTI-TIMEFRAME: the same force model at daily/weekly/monthly (NON-overlapping blocks → honest N). Reveals whether a
    // force explains MORE once daily noise averages out — a single timeframe hides that (D-333 MTF law). Finer than daily
    // (hourly→minute) needs intraday depth → the dormant Databento key; keyless data stops at daily over history.
    const perTf: Record<string, unknown> = { daily: { r2: fit.r2, adj_r2: adj, n: fit.n } };
    for (const [tfName, k] of [["weekly", 5], ["monthly", 21]] as [string, number][]) {
      const nb = Math.floor(Y.length / k); if (nb < p + 20) continue;
      const Yb: number[] = [], Xb: number[][] = [];
      for (let bi = 0; bi < nb; bi++) { let ys = 0; const xr = new Array(p + 1).fill(0); xr[0] = 1; for (let j = 0; j < k; j++) { const idx = bi * k + j; ys += Y[idx]; for (let c = 1; c <= p; c++) xr[c] += X[idx][c]; } Yb.push(ys); Xb.push(xr); }
      const bf = ols(Yb, Xb); if (bf) perTf[tfName] = { r2: bf.r2, adj_r2: +(1 - (1 - bf.r2) * (bf.n - 1) / (bf.n - p - 1)).toFixed(4), n: bf.n };
    }
    const perEra: Record<string, unknown> = {}; const eraR2: number[] = [];
    for (const [e, a, bb] of ERAS) { const idx = yrs.map((y, i) => (y >= a && y < bb ? i : -1)).filter((i) => i >= 0); if (idx.length < 80) continue; const ef = ols(idx.map((i) => Y[i]), idx.map((i) => X[i])); if (ef) { perEra[e] = { r2: ef.r2, n: ef.n }; eraR2.push(ef.r2); } }
    const eraStab = eraR2.length >= 2 ? +(Math.max(0, Math.min(...eraR2)) / Math.max(1e-9, Math.max(...eraR2))).toFixed(3) : +Math.max(0, adj).toFixed(3); // do we understand it CONSISTENTLY across cycles?
    // attribution OWNS residual/R2/quality + driver map; momentum owns lean/direction. aegis-signals folds BOTH into the gate.
    attribution.push({ symbol: sym, asof, cluster, r2: fit.r2, adj_r2: adj, residual: +(1 - fit.r2).toFixed(4), era_stability: eraStab, n_factors: p, n: fit.n, betas, per_era: perEra, per_tf: perTf });
  }
  const meanR2 = attribution.length ? +(attribution.reduce((s, a) => s + (a.r2 as number), 0) / attribution.length).toFixed(4) : 0;
  const meanAdj = attribution.length ? +(attribution.reduce((s, a) => s + (a.adj_r2 as number), 0) / attribution.length).toFixed(4) : 0;
  return { result: { factor: "multi_factor_attribution", cluster, factors: FK, n_instruments: attribution.length, mean_r2: meanR2, mean_adj_r2: meanAdj }, attribution };
}

async function runOne(): Promise<boolean> {
  const cl = await fetch(`${BROKER}?claim=1&worker=${encodeURIComponent(WORKER)}`).then((r) => r.json()).catch(() => null);
  const job = cl?.job; if (!job) return false;
  console.log(`[${WORKER}] claimed job ${job.id} (${job.job_type})`);
  try {
    let out: { result: unknown; signals?: Record<string, unknown>[]; attribution?: Record<string, unknown>[] };
    if (job.job_type === "deep_factor_ic") out = await runDeepFactorIC(job.params);
    else if (job.job_type === "attribution") out = await runAttribution(job.params);
    else if (job.job_type === "intraday_attribution") out = await runIntradayAttribution(job.params);
    else if (job.job_type === "insider_ic") out = await runInsiderIC(job.params);
    else if (job.job_type === "strategy_sweep") out = await runStrategySweep(job.params);
    else if (job.job_type === "xsec_sweep") out = await runXsecSweep(job.params);
    else if (job.job_type === "price_accumulate") out = await runPriceAccumulate(job.params);
    else if (job.job_type === "fundamentals_ic") out = await runFundamentalsIC(job.params);
    else throw new Error(`unknown job_type ${job.job_type}`);
    await fetch(BROKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, status: "done", result: out.result, signals: out.signals, attribution: out.attribution }) });
    console.log(`[${WORKER}] job ${job.id} done — ${out.signals?.length || 0} signals`, JSON.stringify(out.result).slice(0, 200));
  } catch (e) {
    await fetch(BROKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, status: "error", error: String(e).slice(0, 300) }) });
    console.error(`[${WORKER}] job ${job.id} error`, String(e).slice(0, 200));
  }
  return true;
}

console.log(`aegis-worker ${WORKER} → ${BROKER} ${ONCE ? "(--once)" : "(daemon)"}`);
if (ONCE) { await runOne(); }
else { while (true) { const did = await runOne(); if (!did) await new Promise((r) => setTimeout(r, POLL_MS)); } }
