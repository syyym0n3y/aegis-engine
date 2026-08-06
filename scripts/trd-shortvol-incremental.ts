#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-shortvol-incremental — FINRA short-volume INVERTED the literature: LONG at high SVR paid OOS
// (+0.227R, t=4.17 at 20d) whereas Boehmer/Jones/Zhang predict SHORT. Before claiming a discovery, apply the
// D-156 rule that killed the VIX-term signal: **is it INCREMENTAL to price, and does it hold in BOTH halves?**
//   STEP 1: fwd20d ~ trailing20dRet + RSI14            (the confound alone)
//   STEP 2: + SVR percentile                            (does short-flow survive?)
//   STEP 3: IS vs OOS separately                        (sign stability — where every prior candidate died)
//   STEP 4: ETF vs SINGLE-STOCK split                   (flagged BEFORE results: ETF short volume is
//           market-maker create/redeem + hedging (ETFs run 59-62% SVR vs 37-41% single stocks); Boehmer used
//           single stocks, so if this is real information it should be STRONGER in single names.)
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const ETFS = new Set(["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD"]);
function invMat(A: number[][]): number[][] { const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map((r) => r.slice(n)); }
function ols(y: number[], X: number[][], names: string[], label: string) {
  const n = y.length, k = X[0].length; if (n < 100) { console.log(`  ${label}: thin (n=${n})`); return; }
  const Xd = X.map((r) => [1, ...r]);
  const XtX: number[][] = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)); const Xty = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a <= k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b <= k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; }
  const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  let ssr = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a <= k; a++) yh += beta[a] * Xd[i][a]; ssr += (y[i] - yh) ** 2; }
  const s2 = ssr / (n - k - 1);
  console.log(`  ${label} (n=${n.toLocaleString()})`);
  for (let j = 1; j <= k; j++) { const se = Math.sqrt(s2 * inv[j][j]); const t = beta[j] / se; const perStd = beta[j] * sampleStd(X.map((r) => r[j - 1])) * 100; console.log(`     ${names[j - 1].padEnd(20)} t=${t.toFixed(2).padStart(7)}   per +1σ: ${perStd >= 0 ? "+" : ""}${perStd.toFixed(2)}% fwd-20d  ${Math.abs(t) > 2 ? "✓" : "✗"}`); }
}
const svr = new Map<string, Map<string, number>>();
const txt = await Deno.readTextFile("data/finra/shortvol.csv");
for (const l of txt.split("\n")) { const p = l.split(","); if (p.length < 4) continue; const d = `${p[0].slice(0, 4)}-${p[0].slice(4, 6)}-${p[0].slice(6, 8)}`; const sv = +p[2], tv = +p[3]; if (!(tv > 0)) continue; (svr.get(p[1]) ?? svr.set(p[1], new Map()).get(p[1])!).set(d, sv / tv); }
interface B { d: string; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=1514764800&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const c = (res.indicators.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close) as number[]; const o: B[] = []; for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), c: c[i] }); return o; } catch { return []; } }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const H = 20;
interface Row { y: number; x: number[]; is: boolean; etf: boolean; sym: string }
const rows: Row[] = [];
for (const sym of svr.keys()) {
  const bars = await daily(sym); if (bars.length < 300) continue;
  const cl = bars.map((b) => b.c); const r14 = rsi(cl, 14); const m = svr.get(sym)!;
  const ser: (number | null)[] = bars.map((b) => m.get(b.d) ?? null);
  const cut = Math.floor(bars.length * 0.6);
  for (let i = 80; i < bars.length - H - 1; i++) {
    const cur = ser[i]; if (cur == null || !Number.isFinite(r14[i])) continue;
    const win: number[] = []; for (let k = i - 60; k < i; k++) { const v = ser[k]; if (v != null) win.push(v); }
    if (win.length < 40) continue;
    const s2 = [...win].sort((a, b) => a - b); let rk = 0; while (rk < s2.length && s2[rk] < cur) rk++;
    const pct = rk / s2.length;
    const trail20 = (cl[i] - cl[i - 20]) / cl[i - 20];
    const fwd = (cl[i + H] - cl[i]) / cl[i];
    if (![trail20, fwd].every(Number.isFinite)) continue;
    rows.push({ y: fwd, x: [trail20, r14[i] / 100, pct], is: i < cut, etf: ETFS.has(sym), sym });
  }
}
const NAMES = ["trailing-20d ret", "RSI14", "SVR percentile"];
console.log(`FINRA SHORT-VOLUME — IS IT INCREMENTAL TO PRICE? (forward ${H}d, n=${rows.length.toLocaleString()} symbol-days)\n`);
console.log(`STEP 1 — price predictors alone:`); ols(rows.map((r) => r.y), rows.map((r) => r.x.slice(0, 2)), NAMES.slice(0, 2), "FULL");
console.log(`\nSTEP 2 — add short-volume:`); ols(rows.map((r) => r.y), rows.map((r) => r.x), NAMES, "FULL");
console.log(`\nSTEP 3 — THE DECISIVE SPLIT (sign stability):`);
ols(rows.filter((r) => r.is).map((r) => r.y), rows.filter((r) => r.is).map((r) => r.x), NAMES, "IN-SAMPLE");
ols(rows.filter((r) => !r.is).map((r) => r.y), rows.filter((r) => !r.is).map((r) => r.x), NAMES, "OUT-OF-SAMPLE");
console.log(`\nSTEP 4 — ETF vs SINGLE STOCK (flagged before results; real information should be STRONGER in single names):`);
for (const [lbl, sel] of [["ETFs", true], ["SINGLE STOCKS", false]] as [string, boolean][]) {
  const sub = rows.filter((r) => r.etf === sel);
  ols(sub.filter((r) => r.is).map((r) => r.y), sub.filter((r) => r.is).map((r) => r.x), NAMES, `${lbl} — IS`);
  ols(sub.filter((r) => !r.is).map((r) => r.y), sub.filter((r) => !r.is).map((r) => r.x), NAMES, `${lbl} — OOS`);
}
console.log(`\nVERDICT RULE (set before results, per D-156): SVR is a genuine NEW signal only if its coefficient keeps`);
console.log(`|t|>2 with the SAME SIGN in BOTH halves of STEP 3 while price predictors are in the model.`);
