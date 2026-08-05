#!/usr/bin/env -S deno run --allow-net
// trd-horizontal-vol — the HORIZONTAL pass: replicate the forward-vol sizing framework across asset classes,
// each gated the same way (does the asset's own implied-vol index add incremental forward-vol value over
// trailing RV? |t|>2 to earn a slot). Free Yahoo implied-vol indices: bonds ^MOVE, gold ^GVZ, oil ^OVX,
// Nasdaq ^VXN, Dow ^VXD. Prints per-asset OLS (t-stats + fitted coefficients + median) → the per-asset
// vol-model table for the sizing primitive. Per ANALYSIS_CONTRACT: numbers, N, honest keep/drop.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

function invMat(A: number[][]): number[][] {
  const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((r) => r.slice(n));
}
function ols(y: number[], X: number[][]) { // returns {beta:[b0,b1,b2], t:[t1,t2]}
  const n = y.length, k = X[0].length; const Xd = X.map((r) => [1, ...r]);
  const XtX: number[][] = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)); const Xty = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a <= k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b <= k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; }
  const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  let ssr = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a <= k; a++) yh += beta[a] * Xd[i][a]; ssr += (y[i] - yh) ** 2; }
  const s2 = ssr / (n - k - 1); const t = [] as number[]; for (let j = 1; j <= k; j++) t.push(beta[j] / Math.sqrt(s2 * inv[j][j]));
  return { beta, t };
}
async function yahoo(sym: string): Promise<Map<string, number>> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>(); if (!res?.timestamp) return m;
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as number[];
  for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i])) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]);
  return m;
}
const ASSETS: [string, string, string][] = [
  ["Bonds", "TLT", "^MOVE"], ["Gold", "GLD", "^GVZ"], ["Oil", "USO", "^OVX"], ["Nasdaq", "QQQ", "^VXN"], ["S&P(ctrl)", "SPY", "^VIX"],
];
console.log(`HORIZONTAL forward-vol screen — does each asset's implied-vol index add over trailing RV? (|t|>2 = keep)\n`);
const table: Record<string, { b0: number; bRV: number; bIV: number; ref: number }> = {};
for (const [name, asset, ivSym] of ASSETS) {
  const pxM = await yahoo(asset); const ivM = await yahoo(ivSym);
  const dates = [...pxM.keys()].filter((d) => ivM.has(d)).sort();
  const px = dates.map((d) => pxM.get(d)!); const iv = dates.map((d) => ivM.get(d)! / 100);
  if (px.length < 400) { console.log(`${name.padEnd(10)} — insufficient (${px.length})`); continue; }
  const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
  const trailRV = (i: number) => { let s = 0; for (let k = i - 20; k <= i; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 21) * Math.sqrt(252); };
  const fwdRV = (i: number) => { let s = 0; for (let k = i + 1; k <= i + 5; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 5) * Math.sqrt(252); };
  const y: number[] = [], X: number[][] = [];
  for (let i = 21; i < px.length - 5; i++) { const f = fwdRV(i), rv = trailRV(i); if (Number.isFinite(f) && Number.isFinite(rv)) { y.push(f); X.push([rv, iv[i]]); } }
  const { beta, t } = ols(y, X); const med = mean(y);
  const keep = Math.abs(t[1]) > 2;
  console.log(`${name.padEnd(10)} ${asset}/${ivSym.padEnd(6)} n=${y.length}  trailingRV t=${t[0].toFixed(1).padStart(6)}  IV t=${t[1].toFixed(1).padStart(6)}  ${keep ? "✓ KEEP" : "✗ drop"}   [fwdVol=${beta[0].toFixed(3)}+${beta[1].toFixed(3)}·RV+${beta[2].toFixed(3)}·IV, med ${med.toFixed(3)}]`);
  if (keep) table[asset] = { b0: +beta[0].toFixed(4), bRV: +beta[1].toFixed(4), bIV: +beta[2].toFixed(4), ref: +med.toFixed(4) };
}
console.log(`\nPer-asset vol-model table (for the sizing primitive):`);
console.log(JSON.stringify(table, null, 0));
console.log(`\nEach KEEP = an asset whose free implied-vol index measurably improves forward-vol sizing — the framework generalises horizontally.`);
