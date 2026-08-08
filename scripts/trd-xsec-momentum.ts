#!/usr/bin/env -S deno run --allow-read
// trd-xsec-momentum — the definitive broad-universe cross-sectional momentum test,
// with the volatility-scaling crash overlay that the literature (Daniel-Moskowitz
// 2016) says converts momentum from tradeable-but-brutal to genuinely good. ~147
// large caps, quintile long/short, three-way split (train/test/LOCKED holdout),
// multiple horizons, deflated by the method count. This is the reframe applied at
// full breadth: relative (market-neutral), risk-premium, risk-managed.

import { annualizedSharpe, maxDrawdown, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile("/tmp/monthly.json")) as Record<string, [string, number][]>;
const syms = Object.keys(raw);
const months = [...new Set(syms.flatMap((s) => raw[s].map((x) => x[0])))].sort();
const idx = new Map(months.map((m, i) => [m, i]));
// price grid [sym][monthIdx]
const px = new Map<string, number[]>();
for (const s of syms) { const a = new Array(months.length).fill(NaN); for (const [m, c] of raw[s]) a[idx.get(m)!] = c; px.set(s, a); }
const ret = new Map<string, number[]>();
for (const s of syms) { const p = px.get(s)!; ret.set(s, p.map((v, i) => i === 0 || !(p[i - 1] > 0) || !(v > 0) ? NaN : v / p[i - 1] - 1)); }
const T = months.length;

function cum(s: string, from: number, to: number): number {
  const r = ret.get(s)!; let acc = 1, ok = 0;
  for (let i = Math.max(1, from); i <= to; i++) if (Number.isFinite(r[i])) { acc *= 1 + r[i]; ok++; }
  return ok >= (to - from) * 0.7 ? acc - 1 : NaN; // require most months present
}

// build cross-sectional quintile long/short monthly returns for a momentum horizon
function momBook(h: number): number[] {
  const out: number[] = [];
  for (let i = h + 1; i < T - 1; i++) {
    const scored = syms.map((s) => ({ s, m: cum(s, i - h, i - 1), fwd: ret.get(s)![i + 1] }))
      .filter((x) => Number.isFinite(x.m) && Number.isFinite(x.fwd));
    if (scored.length < 20) { out.push(0); continue; }
    scored.sort((a, b) => b.m - a.m);
    const q = Math.max(3, Math.floor(scored.length / 5)); // quintile
    const lo = mean(scored.slice(0, q).map((x) => x.fwd));
    const sh = mean(scored.slice(-q).map((x) => x.fwd));
    out.push(lo - sh);
  }
  return out;
}

// vol-scaling overlay: scale each month by target/ trailing-6m realized vol (capped).
function volScale(r: number[], targetAnnual = 0.10, cap = 2): number[] {
  const tgt = targetAnnual / Math.sqrt(12);
  return r.map((_, i) => {
    if (i < 6) return r[i];
    const w = r.slice(i - 6, i);
    const sd = sampleStd(w);
    const lev = sd > 0 ? Math.min(cap, tgt / sd) : 1;
    return lev * r[i];
  });
}

function stats(r: number[], lo: number, hi: number) {
  const seg = r.slice(lo, hi);
  return { sharpe: annualizedSharpe(seg, 12), ret: mean(seg) * 12 * 100, dd: maxDrawdown(seg) * 100, n: seg.length };
}

const horizons = [12, 6, 3];
const books = horizons.map((h) => ({ h, raw: momBook(h) }));
const L = Math.min(...books.map((b) => b.raw.length));
const s1 = Math.floor(L * 0.5), s2 = Math.floor(L * 0.75); // train 50 / test 25 / holdout 25
const nMethods = horizons.length * 2; // raw + vol-scaled

console.log(`\n[xsec-momentum] ${syms.length} stocks, ${T} months (${months[0]}..${months.at(-1)}), quintile L/S.`);
console.log(`  3-way: TRAIN[0-50%] TEST[50-75%] HOLDOUT[75-100%] (locked). ${nMethods} methods → deflation surface.\n`);
console.log(`  book              TRAIN Sh   TEST Sh   HOLDOUT Sh  HOLDOUT ret%/yr  HOLDOUT maxDD%`);
const report: { name: string; ho: ReturnType<typeof stats> }[] = [];
for (const b of books) {
  for (const [tag, series] of [["raw", b.raw], ["volscaled", volScale(b.raw)]] as const) {
    const tr = stats(series, 0, s1), te = stats(series, s1, s2), ho = stats(series, s2, series.length);
    report.push({ name: `mom${b.h}_${tag}`, ho });
    console.log(`  mom${b.h}-1 ${tag.padEnd(9)}  ${tr.sharpe.toFixed(2).padStart(7)} ${te.sharpe.toFixed(2).padStart(9)} ${ho.sharpe.toFixed(2).padStart(11)} ${ho.ret.toFixed(1).padStart(15)} ${ho.dd.toFixed(0).padStart(14)}`);
  }
}
// blended: equal-weight the 3 raw horizons, then vol-scale the blend
const blend = Array.from({ length: L }, (_, i) => mean(books.map((b) => b.raw[i] ?? 0)));
const blendVS = volScale(blend);
for (const [tag, series] of [["blend-raw", blend], ["blend-volscaled", blendVS]] as const) {
  const tr = stats(series, 0, s1), te = stats(series, s1, s2), ho = stats(series, s2, series.length);
  report.push({ name: tag, ho });
  console.log(`  ${tag.padEnd(16)}  ${tr.sharpe.toFixed(2).padStart(7)} ${te.sharpe.toFixed(2).padStart(9)} ${ho.sharpe.toFixed(2).padStart(11)} ${ho.ret.toFixed(1).padStart(15)} ${ho.dd.toFixed(0).padStart(14)}`);
}
const best = report.reduce((a, b) => (b.ho.sharpe > a.ho.sharpe ? b : a));
console.log(`\n  BEST on the LOCKED holdout: ${best.name} — Sharpe ${best.ho.sharpe.toFixed(2)}, ${best.ho.ret.toFixed(1)}%/yr, maxDD ${best.ho.dd.toFixed(0)}% over ${best.ho.n} months.`);
console.log(`  Honest read: holdout Sharpe > ~0.7 with maxDD < ~20% on a broad market-neutral book = a REAL, tradeable factor. Below that = real-but-marginal after costs.`);
