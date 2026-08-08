#!/usr/bin/env -S deno run --allow-net
// trd-crypto-vol — extend the horizontal forward-vol framework to CRYPTO: does Deribit DVOL (crypto implied
// vol, free) add forward-vol value over trailing RV, like GVZ/OVX/VXN did for TradFi? Gate |t|>2. If yes,
// add BTC/ETH to the per-asset vol table so the crypto executor sizes by implied vol too.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
function invMat(A: number[][]): number[][] { const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map((r) => r.slice(n)); }
function ols(y: number[], X: number[][]) { const n = y.length, k = X[0].length; const Xd = X.map((r) => [1, ...r]); const XtX: number[][] = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)); const Xty = new Array(k + 1).fill(0); for (let i = 0; i < n; i++) for (let a = 0; a <= k; a++) { Xty[a] += Xd[i][a] * y[i]; for (let b = 0; b <= k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b]; } const inv = invMat(XtX); const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0)); let ssr = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let a = 0; a <= k; a++) yh += beta[a] * Xd[i][a]; ssr += (y[i] - yh) ** 2; } const s2 = ssr / (n - k - 1); const t = [] as number[]; for (let j = 1; j <= k; j++) t.push(beta[j] / Math.sqrt(s2 * inv[j][j])); return { beta, t }; }

async function dvol(cur: string): Promise<Map<string, number>> {
  const m = new Map<string, number>(); let start = Date.parse("2021-01-01");
  const end = Date.parse("2026-08-04");
  for (let g = 0; g < 8; g++) { const r = await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&start_timestamp=${start}&end_timestamp=${end}&resolution=43200`); const j = await r.json(); const d = j?.result?.data ?? []; if (!d.length) break; for (const row of d) m.set(new Date(row[0]).toISOString().slice(0, 10), row[4] / 100); const lastTs = d[d.length - 1][0]; if (lastTs <= start) break; start = lastTs + 1; if (d.length < 500) break; }
  return m;
}
async function binanceDaily(sym: string): Promise<Map<string, number>> {
  const m = new Map<string, number>(); let endTime = Date.now();
  for (let p = 0; p < 6; p++) { const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break; for (const c of k) m.set(new Date(c[0]).toISOString().slice(0, 10), +c[4]); endTime = k[0][0] - 1; if (k.length < 1000) break; }
  return m;
}
console.log(`CRYPTO forward-vol screen — does Deribit DVOL add over trailing RV? (|t|>2 = keep)\n`);
const table: Record<string, any> = {};
for (const [name, sym, cur] of [["BTC", "BTCUSDT", "BTC"], ["ETH", "ETHUSDT", "ETH"]] as [string, string, string][]) {
  const pxM = await binanceDaily(sym); const ivM = await dvol(cur);
  const dates = [...pxM.keys()].filter((d) => ivM.has(d)).sort();
  const px = dates.map((d) => pxM.get(d)!); const iv = dates.map((d) => ivM.get(d)!);
  if (px.length < 400) { console.log(`${name}: insufficient (${px.length})`); continue; }
  const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
  const trailRV = (i: number) => { let s = 0; for (let k = i - 20; k <= i; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 21) * Math.sqrt(365); };
  const fwdRV = (i: number) => { let s = 0; for (let k = i + 1; k <= i + 5; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 5) * Math.sqrt(365); };
  const y: number[] = [], X: number[][] = [];
  for (let i = 21; i < px.length - 5; i++) { const f = fwdRV(i), rv = trailRV(i); if (Number.isFinite(f) && Number.isFinite(rv)) { y.push(f); X.push([rv, iv[i]]); } }
  const { beta, t } = ols(y, X); const med = mean(y); const keep = Math.abs(t[1]) > 2;
  console.log(`${name}  ${sym}/DVOL  n=${y.length}  trailingRV t=${t[0].toFixed(1).padStart(6)}  DVOL t=${t[1].toFixed(1).padStart(6)}  ${keep ? "✓ KEEP" : "✗ drop"}   [fwdVol=${beta[0].toFixed(3)}+${beta[1].toFixed(3)}·RV+${beta[2].toFixed(3)}·DVOL, med ${med.toFixed(3)}]`);
  if (keep) table[sym] = { ivSymbol: "DVOL", b0: +beta[0].toFixed(4), bRV: +beta[1].toFixed(4), bIV: +beta[2].toFixed(4), ref: +med.toFixed(4) };
}
console.log(`\nCrypto vol-model table:`); console.log(JSON.stringify(table, null, 0));
