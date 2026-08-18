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
