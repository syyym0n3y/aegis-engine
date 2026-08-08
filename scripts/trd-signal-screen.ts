#!/usr/bin/env -S deno run --allow-net
// trd-signal-screen — the "measurably smarter" engine: for each FREE candidate signal, does it add predictive
// value AFTER controlling for what we already use? Same gate that promoted GEX (D-132, t=−14.1). A signal
// earns a slot ONLY if its incremental OLS t-stat is significant (|t|>2). No look-ahead: every predictor is
// knowable at time i; targets are forward. Free data: SqueezeMetrics (price/dix/gex) + Yahoo (^VIX,^VIX3M).
//  VERTICAL (more depth on the equity index): forward-VOL ~ trailingRV + GEX + VIXterm  (a better sizing model)
//                                             forward-RET ~ trailingRet + DIX           (a return tilt)
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

// ---- tiny OLS with t-stats (intercept + k predictors) ----
function invMat(A: number[][]): number[][] {
  const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((r) => r.slice(n));
}
function ols(y: number[], X: number[][], names: string[]) {
  const n = y.length, k = X[0].length; const Xd = X.map((r) => [1, ...r]);
  const XtX: number[][] = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  const Xty = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) { for (let a = 0; a <= k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b <= k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; } }
  const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  let ssr = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a <= k; a++) yh += beta[a] * Xd[i][a]; ssr += (y[i] - yh) ** 2; }
  const s2 = ssr / (n - k - 1);
  return names.map((nm, j) => { const se = Math.sqrt(s2 * inv[j + 1][j + 1]); return { name: nm, beta: beta[j + 1], t: beta[j + 1] / se, perStd: beta[j + 1] * sampleStd(X.map((r) => r[j])) }; });
}
async function yahoo(sym: string): Promise<Map<string, number>> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>(); if (!res?.timestamp) return m;
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as number[];
  for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i])) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]);
  return m;
}
// ---- assemble aligned dataset ----
const sq = (await (await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } })).text()).trim().split("\n").slice(1).map((l) => l.split(","));
const vix = await yahoo("^VIX"), vix3m = await yahoo("^VIX3M");
interface Row { d: string; px: number; dix: number; gex: number; vix: number; vix3m: number; }
const rows: Row[] = [];
for (const p of sq) { const d = p[0], vx = vix.get(d), v3 = vix3m.get(d); if (vx && v3) rows.push({ d, px: +p[1], dix: +p[2], gex: +p[3], vix: vx, vix3m: v3 }); }
rows.sort((a, b) => a.d < b.d ? -1 : 1);
const px = rows.map((r) => r.px); const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
console.log(`Aligned ${rows.length} days (${rows[0].d}→${rows[rows.length - 1].d}) — SqueezeMetrics ∩ VIX ∩ VIX3M.\n`);
const trailRV = (i: number) => { let s = 0; for (let k = i - 20; k <= i; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 21) * Math.sqrt(252); };
const fwdRV = (i: number) => { let s = 0; for (let k = i + 1; k <= i + 5; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 5) * Math.sqrt(252); };
const gexPct = (i: number) => { const w = rows.slice(i - 252, i).map((r) => r.gex).sort((a, b) => a - b); let r = 0; while (r < w.length && w[r] < rows[i].gex) r++; return r / w.length; };

// TEST A — forward VOL: does VIX-term-structure add over trailingRV + GEX?
{ const y: number[] = [], X: number[][] = [];
  for (let i = 252; i < rows.length - 5; i++) { const term = rows[i].vix / rows[i].vix3m; y.push(fwdRV(i)); X.push([trailRV(i), gexPct(i), term]); }
  console.log(`(A) forward 5d realized-vol ~ trailingRV + GEXpctile + VIXterm(VIX/VIX3M)   [n=${y.length}]`);
  const fit = ols(y, X, ["trailingRV", "GEXpctile", "VIXterm"]);
  for (const r of fit) console.log(`    ${r.name.padEnd(12)} t=${r.t.toFixed(2).padStart(7)}  beta=${r.beta.toExponential(3)}   ${Math.abs(r.t) > 2 ? "SIGNIFICANT — adds value" : "not significant"}`);
  // full model coefficients (intercept + betas) for the unified forecast primitive:
  const Xd = X.map((r) => [1, ...r]); const k = 4; const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0)); const Xty = new Array(k).fill(0);
  for (let i = 0; i < y.length; i++) for (let a = 0; a < k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; }
  const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  console.log(`    MODEL: fwdVol = ${beta[0].toFixed(4)} + ${beta[1].toFixed(4)}·trailingRV + ${beta[2].toFixed(4)}·gexPct + ${beta[3].toFixed(4)}·vixTerm`);
  console.log(`    median forward vol (deRisk ref) = ${(mean(y)).toFixed(4)}`);
}
// TEST B — forward RET: does DIX add over 10d momentum?
{ const y: number[] = [], X: number[][] = [];
  for (let i = 21; i < rows.length - 10; i++) { const mom = (px[i] - px[i - 10]) / px[i - 10]; const fret = (px[i + 10] - px[i]) / px[i]; y.push(fret); X.push([mom, rows[i].dix]); }
  console.log(`\n(B) forward 10d return ~ trailing-10d-return + DIX   [n=${y.length}]`);
  for (const r of ols(y, X, ["momentum10", "DIX"])) console.log(`    ${r.name.padEnd(12)} t=${r.t.toFixed(2).padStart(7)}   per+1σ ${(r.perStd * 100).toFixed(2)}%   ${Math.abs(r.t) > 2 ? "SIGNIFICANT — adds value" : "not significant"}`);
}
console.log(`\nKEEP only |t|>2 signals. Same discipline that promoted GEX; everything else stays out of the engine.`);
