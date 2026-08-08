#!/usr/bin/env -S deno run --allow-read
// trd-zoo-sweep — the big, HONEST strategy search. Thousands of strategy defs ×
// every market, with the three anti-charlatan guards:
//   1. THREE-way split: IS(50%) search → OOS-val(25%) forward filter → HOLDOUT(25%)
//      which NOTHING in the search ever touches (the true out-of-sample price test).
//   2. Deflated Sharpe on the holdout, deflated by the TOTAL trial count (defs×markets).
//   3. PBO/CSCV over the survivor matrix — is the *selection* itself overfit?
// Near-certain outcome: with N in the thousands, the deflation bar is enormous and
// nothing survives clean. IF something does AND PBO<0.5, it is a genuine candidate.
// Junk is expected and fine; the guards exist so junk can't masquerade as an edge.

import { deflatedSharpe, kurtosis, pboCSCV, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";

interface Bar { ts: string; open: number; high: number; low: number; close: number }
const raw = JSON.parse(await Deno.readTextFile(Deno.env.get("BARS_FILE")!)) as Record<string, Bar[]>;

// ---------- indicators (vectorized, causal) ----------
const sma = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const ema = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); const k = 2 / (n + 1); let e = x[0]; for (let i = 0; i < x.length; i++) { e = i === 0 ? x[0] : x[i] * k + e * (1 - k); if (i >= n) o[i] = e; } return o; };
const rsi = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < x.length; i++) { const d = x[i] - x[i - 1]; const up = Math.max(0, d), dn = Math.max(0, -d); if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = 100 - 100 / (1 + g / (l || 1e-9)); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = 100 - 100 / (1 + g / (l || 1e-9)); } } return o; };
const rollMax = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); for (let i = n; i < x.length; i++) { let m = -Infinity; for (let j = i - n; j < i; j++) m = Math.max(m, x[j]); o[i] = m; } return o; };
const rollMin = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); for (let i = n; i < x.length; i++) { let m = Infinity; for (let j = i - n; j < i; j++) m = Math.min(m, x[j]); o[i] = m; } return o; };
const rollStd = (x: number[], n: number) => { const o = Array(x.length).fill(NaN); for (let i = n - 1; i < x.length; i++) { let s = 0, s2 = 0; for (let j = i - n + 1; j <= i; j++) { s += x[j]; s2 += x[j] * x[j]; } const m = s / n; o[i] = Math.sqrt(Math.max(0, s2 / n - m * m)); } return o; };

// ---------- strategy zoo: each returns a position array (0/1 long-only or -1/1) ----------
type Def = { id: string; pos: (c: number[], h: number[], l: number[]) => number[] };
const defs: Def[] = [];
const FAST = [3, 5, 8, 10, 13, 15, 20, 25, 30];
const SLOW = [20, 30, 40, 50, 75, 100, 125, 150, 200];
for (const f of FAST) for (const s of SLOW) if (f < s) {
  for (const side of [1, 2]) { // 1=long/flat, 2=long/short
    defs.push({ id: `sma_${f}_${s}_${side}`, pos: (c) => { const a = sma(c, f), b = sma(c, s); return c.map((_, i) => isNaN(a[i]) || isNaN(b[i]) ? 0 : a[i] > b[i] ? 1 : (side === 2 ? -1 : 0)); } });
    defs.push({ id: `ema_${f}_${s}_${side}`, pos: (c) => { const a = ema(c, f), b = ema(c, s); return c.map((_, i) => isNaN(a[i]) || isNaN(b[i]) ? 0 : a[i] > b[i] ? 1 : (side === 2 ? -1 : 0)); } });
  }
}
for (const p of [5, 7, 9, 11, 14, 21]) for (const os of [10, 15, 20, 25, 30, 35]) for (const ob of [55, 60, 65, 70]) {
  defs.push({ id: `rsirev_${p}_${os}_${ob}`, pos: (c) => { const r = rsi(c, p); let s = 0; return c.map((_, i) => { if (isNaN(r[i])) return 0; if (r[i] < os) s = 1; else if (r[i] > ob) s = 0; return s; }); } });
}
for (const p of [7, 10, 14, 21]) for (const th of [40, 45, 50, 55, 60]) {
  defs.push({ id: `rsitr_${p}_${th}`, pos: (c) => { const r = rsi(c, p); return c.map((_, i) => isNaN(r[i]) ? 0 : r[i] > th ? 1 : 0); } });
}
for (const p of [10, 15, 20, 25, 30]) for (const k of [1, 1.5, 2, 2.5, 3]) for (const side of [1, 2]) {
  defs.push({ id: `boll_${p}_${k}_${side}`, pos: (c) => { const m = sma(c, p), sd = rollStd(c, p); let s = 0; return c.map((_, i) => { if (isNaN(m[i]) || isNaN(sd[i])) return 0; if (c[i] < m[i] - k * sd[i]) s = 1; else if (c[i] > m[i]) s = side === 2 ? -1 : 0; return s; }); } });
}
for (const lb of [5, 10, 15, 20, 30, 40, 55, 80, 100, 120]) for (const side of [1, 2]) {
  defs.push({ id: `donch_${lb}_${side}`, pos: (c, h, l) => { const hi = rollMax(h, lb), lo = rollMin(l, lb); let s = 0; return c.map((_, i) => { if (isNaN(hi[i]) || isNaN(lo[i])) return 0; if (c[i] > hi[i]) s = 1; else if (c[i] < lo[i]) s = side === 2 ? -1 : 0; return s; }); } });
}
for (const lb of [10, 20, 30, 40, 60, 90, 120, 150, 200, 250]) for (const side of [1, 2]) {
  defs.push({ id: `mom_${lb}_${side}`, pos: (c) => c.map((_, i) => i < lb ? 0 : c[i] > c[i - lb] ? 1 : (side === 2 ? -1 : 0)) });
}
for (const ma of [10, 20, 50, 100, 150, 200]) for (const side of [1, 2]) {
  defs.push({ id: `pxma_${ma}_${side}`, pos: (c) => { const a = sma(c, ma); return c.map((_, i) => isNaN(a[i]) ? 0 : c[i] > a[i] ? 1 : (side === 2 ? -1 : 0)); } });
}

// ---------- run every def × every market through the 3-way split ----------
const markets = Object.keys(raw);
type Cand = { key: string; isS: number; valS: number; hoRets: number[] };
const isSharpes: number[] = [];
const cands: Cand[] = [];
let trials = 0;

for (const m of markets) {
  const bars = [...raw[m]].sort((a, b) => a.ts.localeCompare(b.ts));
  if (bars.length < 500) continue;
  const c = bars.map((b) => b.close), h = bars.map((b) => b.high), l = bars.map((b) => b.low);
  const ret = c.map((v, i) => i === 0 || c[i - 1] <= 0 ? 0 : v / c[i - 1] - 1);
  const n = ret.length, s1 = Math.floor(n * 0.5), s2 = Math.floor(n * 0.75);
  for (const d of defs) {
    const pos = d.pos(c, h, l);
    const sr: number[] = new Array(n);
    for (let i = 1; i < n; i++) sr[i] = (pos[i - 1] || 0) * ret[i]; // decided at prior close
    const isR = sr.slice(1, s1), valR = sr.slice(s1, s2), hoR = sr.slice(s2);
    const isS = sharpe(isR);
    trials++; isSharpes.push(isS);
    // forward filter: strong in-sample AND still positive in the (unseen) validation slice
    if (isS > 0.06 && sharpe(valR) > 0.03) cands.push({ key: `${m}:${d.id}`, isS, valS: sharpe(valR), hoRets: hoR });
  }
}

// ---------- honest scoring on the LOCKED holdout ----------
const varTrial = (() => { const m = isSharpes.reduce((a, b) => a + b, 0) / isSharpes.length; return isSharpes.reduce((a, b) => a + (b - m) ** 2, 0) / (isSharpes.length - 1); })();
const scored = cands.map((c) => {
  const hoS = sharpe(c.hoRets);
  const dsr = c.hoRets.length >= 8 ? deflatedSharpe(hoS, c.hoRets.length, skewness(c.hoRets), kurtosis(c.hoRets), trials, varTrial) : 0;
  return { key: c.key, isS: c.isS, valS: c.valS, hoS, dsr, rets: c.hoRets };
}).sort((a, b) => b.dsr - a.dsr);

// PBO over the survivor holdout matrix (truncate to shared length)
let pbo = NaN;
const surv = scored.filter((s) => s.rets.length >= 20).slice(0, 200);
if (surv.length >= 2) { const L = Math.min(...surv.map((s) => s.rets.length)); const M: number[][] = []; for (let t = 0; t < L; t++) M.push(surv.map((s) => s.rets[s.rets.length - L + t])); pbo = pboCSCV(M).pbo; }

console.log(`\n[zoo-sweep] ${defs.length} strategy defs × ${markets.length} markets = ${trials} trials (the deflation surface)`);
console.log(`  split: IS 50% (search) → VAL 25% (forward filter) → HOLDOUT 25% (never touched by search)`);
console.log(`  ${cands.length} passed the IS+VAL forward filter → scored on the LOCKED holdout, deflated by ${trials} trials:\n`);
console.log(`  top 12 by holdout Deflated-Sharpe:`);
for (const s of scored.slice(0, 12)) console.log(`   ${s.key.padEnd(22)} IS=${s.isS.toFixed(2)} VAL=${s.valS.toFixed(2)} HOLDOUT=${s.hoS.toFixed(2)}  →  DSR=${s.dsr.toFixed(3)} ${s.dsr >= 0.95 ? "  <== CLEARS" : ""}`);
const winners = scored.filter((s) => s.dsr >= 0.95);
console.log(`\n  PBO (is the SELECTION itself overfit?) = ${Number.isFinite(pbo) ? pbo.toFixed(2) : "n/a"} ${pbo >= 0.5 ? "→ OVERFIT: the search process is unreliable; discard all 'winners'" : pbo < 0.5 ? "→ selection not obviously overfit" : ""}`);
console.log(`\n  VERDICT: ${winners.length} of ${trials} cleared holdout DSR>=0.95${winners.length && pbo < 0.5 ? " AND PBO<0.5 → GENUINE candidate(s), convert to EA + micro-test" : winners.length ? " but PBO flags overfit → REJECT" : ". Nothing survived the true-N deflation — the honest, expected result at this scale."}`);
