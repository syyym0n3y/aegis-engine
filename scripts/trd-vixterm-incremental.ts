#!/usr/bin/env -S deno run --allow-net
// trd-vixterm-incremental — three non-price signals passed the both-halves test (VIX9D/VIX, VIX/VIX3M,
// HYG/LQD credit, all at 20d). Before claiming anything, rule out the obvious confound:
// **VIX backwardation happens AFTER selloffs — so "buy stressed term structure" may just be DIP-BUYING**,
// i.e. a restatement of the signal we already have (D-152), not a new one.
// TEST: multivariate OLS  fwd20dRet ~ trailing20dRet + RSI14 + vixTerm + credit
// If vixTerm/credit keep |t|>2 while controlling for the price-based predictors, they are INCREMENTAL and
// genuinely new. If they collapse, they were dip-buying wearing an options-market costume.
// Also: IS/OOS split on the multivariate fit, because a full-sample regression is where I got burned before.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
function invMat(A: number[][]): number[][] { const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map((r) => r.slice(n)); }
function ols(y: number[], X: number[][], names: string[], label: string) {
  const n = y.length, k = X[0].length; const Xd = X.map((r) => [1, ...r]);
  const XtX: number[][] = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)); const Xty = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a <= k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b <= k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; }
  const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  let ssr = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a <= k; a++) yh += beta[a] * Xd[i][a]; ssr += (y[i] - yh) ** 2; }
  const s2 = ssr / (n - k - 1);
  console.log(`  ${label} (n=${n})`);
  for (let j = 1; j <= k; j++) { const se = Math.sqrt(s2 * inv[j][j]); const t = beta[j] / se; const perStd = beta[j] * sampleStd(X.map((r) => r[j - 1])) * 100; console.log(`     ${names[j - 1].padEnd(22)} t=${t.toFixed(2).padStart(6)}   per +1σ: ${perStd >= 0 ? "+" : ""}${perStd.toFixed(2)}% fwd-20d   ${Math.abs(t) > 2 ? "✓ significant" : "✗"}`); }
}
async function series(sym: string): Promise<Map<string, number>> { const m = new Map<string, number>(); try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return m; const t = res.timestamp as number[]; const c = (res.indicators.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close) as number[]; for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]); } catch { /* */ } return m; }
const spy = await series("SPY"), vix = await series("^VIX"), vix9 = await series("^VIX9D"), vix3m = await series("^VIX3M"), hyg = await series("HYG"), lqd = await series("LQD");
const dates = [...spy.keys()].sort().filter((d) => vix.has(d) && vix3m.has(d) && hyg.has(d) && lqd.has(d));
const px = dates.map((d) => spy.get(d)!);
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const r14 = rsi(px, 14);
const H = 20;
interface Row { y: number; x: number[]; is: boolean }
const rows: Row[] = [];
const cut = Math.floor(dates.length * 0.6);
for (let i = 260; i < dates.length - H - 1; i++) {
  const d = dates[i];
  const trail20 = (px[i] - px[i - 20]) / px[i - 20];
  const vt = vix.get(d)! / vix3m.get(d)!;
  const vt9 = (vix9.get(d) ?? NaN) / vix.get(d)!;
  const cr = hyg.get(d)! / lqd.get(d)!;
  const cr20 = cr / (hyg.get(dates[i - 20])! / lqd.get(dates[i - 20])!) - 1;
  if (![trail20, vt, cr20].every(Number.isFinite)) continue;
  const fwd = (px[i + H] - px[i]) / px[i];
  rows.push({ y: fwd, x: [trail20, r14[i] / 100, vt, cr20, Number.isFinite(vt9) ? vt9 : 1], is: i < cut });
}
const NAMES = ["trailing-20d ret", "RSI14", "VIX/VIX3M", "credit chg (HYG/LQD)", "VIX9D/VIX"];
console.log(`VIX-TERM / CREDIT — ARE THEY INCREMENTAL, OR JUST DIP-BUYING? (forward ${H}d SPY return)\n`);
console.log(`STEP 1 — price predictors ALONE (the confound):`);
ols(rows.map((r) => r.y), rows.map((r) => r.x.slice(0, 2)), NAMES.slice(0, 2), "FULL SAMPLE");
console.log(`\nSTEP 2 — FULL model: do the non-price signals survive alongside the price predictors?`);
ols(rows.map((r) => r.y), rows.map((r) => r.x), NAMES, "FULL SAMPLE");
console.log(`\nSTEP 3 — the honest split (this is where the calm-VIX artifact died):`);
const isR = rows.filter((r) => r.is), oosR = rows.filter((r) => !r.is);
ols(isR.map((r) => r.y), isR.map((r) => r.x), NAMES, "IN-SAMPLE");
ols(oosR.map((r) => r.y), oosR.map((r) => r.x), NAMES, "OUT-OF-SAMPLE");
console.log(`\nVERDICT RULE: a non-price signal is genuinely NEW only if it keeps |t|>2 with the SAME SIGN in BOTH`);
console.log(`halves of STEP 3 while trailing-return and RSI are in the model. Otherwise it is dip-buying re-labelled.`);
