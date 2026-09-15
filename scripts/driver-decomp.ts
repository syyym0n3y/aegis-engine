// D-920 — return-driver variance decomposition: account for the measurable variables behind each instrument.
// For each held instrument, OLS-regress daily log returns on a fixed panel of measurable market drivers and report
// total adjusted R^2, residual share, the standardized betas, and the INCREMENTAL R^2 of the macro block over a
// market-only model (tests whether the 'many variables' are one risk factor in disguise). The residual is the only
// part any timing rule could monetize; its lag autocorrelation says whether there is a cheap handle or just noise.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("driver-decomp", [
  { name: "CLASSES", def: "etf,sector,index,intl_index,commodity,rate,crypto,fx", note: "asset_class filter" },
  { name: "PER", def: "12", note: "max instruments per class (longest history first)" },
  { name: "MIN_OBS", def: "500" }, { name: "RUN_ID", def: "D-920-driver-variance-decomposition" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

// ---- OLS via normal equations (X'X)^-1 X'y with Gaussian elimination ----
function ols(X: number[][], y: number[]): { beta: number[]; r2: number; r2adj: number; resid: number[] } {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) { for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; } }
  // solve XtX beta = Xty
  // ridge for numerical stability against near-collinear drivers (tiny: does not move R2)
  let tr = 0; for (let a = 0; a < p; a++) tr += XtX[a][a]; const lam = 1e-9 * tr / p;
  for (let a = 1; a < p; a++) XtX[a][a] += lam; // skip intercept
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const pv = Math.abs(A[c][c]) < 1e-12 ? 1e-12 : A[c][c]; // capture pivot BEFORE normalizing
    for (let j = c; j <= p; j++) A[c][j] /= pv;
    for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= p; j++) A[r][j] -= f * A[c][j]; }
  }
  const beta = A.map((row) => row[p]);
  const yb = mean(y); let ssr = 0, sst = 0; const resid = new Array(n);
  for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a < p; a++) yh += X[i][a] * beta[a]; resid[i] = y[i] - yh; ssr += resid[i] ** 2; sst += (y[i] - yb) ** 2; }
  const r2 = 1 - ssr / (sst || 1); const r2adj = 1 - (1 - r2) * (n - 1) / (n - p);
  return { beta, r2, r2adj, resid };
}
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function autocorr(a: number[], lag: number) { const m = mean(a); let num = 0, den = 0; for (let i = 0; i < a.length; i++) den += (a[i] - m) ** 2; for (let i = lag; i < a.length; i++) num += (a[i] - m) * (a[i - lag] - m); return num / (den || 1); }

// ---- load driver level series, difference to daily changes ----
async function series(id: string): Promise<Map<number, number>> {
  const rows = await q(`trd_macro_series?series=eq.${id}&select=d,v&order=d`) as { d: string; v: number }[];
  const m = new Map<number, number>(); for (const r of rows) { const day = Math.floor(Date.parse(r.d + "T00:00:00Z") / 86400000); if (r.v != null && isFinite(+r.v)) m.set(day, +r.v); } return m;
}
async function barsRet(sym: string): Promise<Map<number, number>> {
  const row = (await q(`trd_bars_deep?symbol=eq.${sym}&select=bars`) as { bars: number[][] }[])[0];
  const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]);
  const m = new Map<number, number>(); for (let i = 1; i < b.length; i++) { const day = Math.floor(b[i][0] / 86400); if (b[i - 1][4] > 0) m.set(day, Math.log(b[i][4] / b[i - 1][4])); } return m;
}
console.log("loading drivers...");
const ust10 = await series("ust_10y"), ust3 = await series("ust_3m"), credit = await series("credit_baa_10y");
const vix3 = await series("cboe_vix3m"), be10 = await series("breakeven_10y"), ry10 = await series("real_yield_10y"), cg = await series("ratio_copper_gold");
const mkt = await barsRet("^GSPC"), btc = await barsRet("BTC-USD");
// build driver daily-change map keyed by day; MKT & BTC already returns
function dchange(m: Map<number, number>): Map<number, number> { const days = [...m.keys()].sort((a, b) => a - b); const out = new Map<number, number>(); for (let i = 1; i < days.length; i++) { if (days[i] - days[i - 1] <= 5) out.set(days[i], m.get(days[i])! - m.get(days[i - 1])!); } return out; }
const dRATE = dchange(ust10), dCREDIT = dchange(credit), dVOL = dchange(vix3), dBE = dchange(be10), dRY = dchange(ry10), dGROWTH = dchange(cg);
const slope = new Map<number, number>(); for (const [d, v] of ust10) if (ust3.has(d)) slope.set(d, v - ust3.get(d)!); const dSLOPE = dchange(slope);
const DRV: [string, Map<number, number>][] = [["MKT", mkt], ["dSLOPE", dSLOPE], ["dCREDIT", dCREDIT], ["dVOL", dVOL], ["dBE", dBE], ["dRY", dRY], ["dGROWTH", dGROWTH], ["BTC", btc]];  // dRATE dropped: = dBE+dRY (Fisher)
const DN = DRV.map((x) => x[0]);
console.log("driver obs:", DRV.map(([n, m]) => `${n}:${m.size}`).join(" "));

const meta = await q(`trd_bars_deep?select=symbol,asset_class,n_bars&order=n_bars.desc`) as { symbol: string; asset_class: string; n_bars: number }[];
const classes = K.CLASSES.split(",");
const pick: { symbol: string; asset_class: string }[] = [];
for (const c of classes) { const names = meta.filter((m) => m.asset_class === c).slice(0, +K.PER); for (const n of names) pick.push(n); }
assertNonEmpty("instruments", pick, 10);
console.log(`\n==> D-920 DRIVER DECOMPOSITION — ${pick.length} instruments across ${classes.length} classes; drivers: ${DN.join(" ")}\n`);
console.log(`  ${"instrument".padEnd(14)} ${"class".padEnd(11)} ${"obs".padStart(5)} ${"R2".padStart(6)} ${"mkt-only".padStart(8)} ${"macro+".padStart(6)} ${"resid%".padStart(6)} ${"resACF1".padStart(7)}  top drivers (|std beta|)`);
type Agg = { r2: number[]; inc: number[]; acf: number[] };
const agg = new Map<string, Agg>();
const rows: string[] = [];
for (const ins of pick) {
  const ret = await barsRet(ins.symbol);
  // assemble aligned matrix
  const days = [...ret.keys()].filter((d) => DRV.every(([, m]) => m.has(d))).sort((a, b) => a - b);
  if (days.length < +K.MIN_OBS) { console.log(`  ${ins.symbol.padEnd(14)} ${ins.asset_class.padEnd(11)} ${String(days.length).padStart(5)}  (<${K.MIN_OBS} obs — UNTESTED)`); continue; }
  const y = days.map((d) => ret.get(d)!);
  // standardize each driver over the aligned window for comparable betas
  const cols = DRV.map(([, m]) => days.map((d) => m.get(d)!));
  const colStd = cols.map((c) => sd(c) || 1); const colMean = cols.map((c) => mean(c));
  const Xstd = days.map((_, i) => [1, ...cols.map((c, k) => (c[i] - colMean[k]) / colStd[k])]);
  const full = ols(Xstd, y);
  const Xmkt = days.map((_, i) => [1, (cols[0][i] - colMean[0]) / colStd[0]]);
  const mktOnly = ols(Xmkt, y);
  const residShare = 1 - full.r2;
  const acf1 = autocorr(full.resid, 1);
  const betas = DN.map((n, k) => ({ n, b: full.beta[k + 1] })).sort((a, b) => Math.abs(b.b) - Math.abs(a.b)).slice(0, 3).map((x) => `${x.n}${x.b >= 0 ? "+" : ""}${x.b.toFixed(4)}`).join(" ");
  console.log(`  ${ins.symbol.padEnd(14)} ${ins.asset_class.padEnd(11)} ${String(days.length).padStart(5)} ${(full.r2adj * 100).toFixed(1).padStart(6)} ${(mktOnly.r2adj * 100).toFixed(1).padStart(8)} ${((full.r2adj - mktOnly.r2adj) * 100).toFixed(1).padStart(6)} ${(residShare * 100).toFixed(1).padStart(6)} ${acf1.toFixed(3).padStart(7)}  ${betas}`);
  const a = agg.get(ins.asset_class) ?? { r2: [], inc: [], acf: [] }; a.r2.push(full.r2adj); a.inc.push(full.r2adj - mktOnly.r2adj); a.acf.push(acf1); agg.set(ins.asset_class, a);
  rows.push(`${ins.symbol},${ins.asset_class},${days.length},${(full.r2adj*100).toFixed(2)},${(mktOnly.r2adj*100).toFixed(2)},${(residShare*100).toFixed(2)},${acf1.toFixed(4)}`);
}
console.log(`\n  === per-class summary (median adj-R2 | median macro-incremental | median resid-ACF1) ===`);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
for (const [c, a] of [...agg].sort((x, y) => med(y[1].r2) - med(x[1].r2))) console.log(`  ${c.padEnd(12)} n=${String(a.r2.length).padStart(2)}  R2 ${(med(a.r2) * 100).toFixed(1).padStart(5)}%   macro+ ${(med(a.inc) * 100).toFixed(1).padStart(4)}%   resACF1 ${med(a.acf).toFixed(3)}`);
const allR2 = [...agg.values()].flatMap((a) => a.r2), allInc = [...agg.values()].flatMap((a) => a.inc), allAcf = [...agg.values()].flatMap((a) => a.acf);
console.log(`\n  === AGGREGATE across ${allR2.length} instruments ===`);
console.log(`  median total adj-R2 explained by the 9 measurable drivers: ${(med(allR2) * 100).toFixed(1)}%`);
console.log(`  median INCREMENTAL adj-R2 of the 8-macro block over market-only: ${(med(allInc) * 100).toFixed(1)}pp  (small => the 'many variables' are largely the one risk factor)`);
console.log(`  median residual share (unexplained): ${((1 - med(allR2)) * 100).toFixed(1)}%`);
console.log(`  median residual lag-1 autocorrelation: ${med(allAcf).toFixed(4)}  (near 0 => the residual is noise, no cheap timing handle)`);
await Deno.writeTextFile(new URL("../data/d920-driver-decomp.csv", import.meta.url), "symbol,class,obs,r2adj,mktonly_r2,resid_pct,resid_acf1\n" + rows.join("\n") + "\n");
console.log(`\n  wrote data/d920-driver-decomp.csv (${rows.length} rows)`);
