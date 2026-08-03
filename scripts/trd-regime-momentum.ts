#!/usr/bin/env -S deno run --allow-read
// trd-regime-momentum — the winter test. Run raw vs RISK-ADJUSTED momentum (quintile
// L/S, vol-scaled) on 77 stocks back to 2001, and score performance BY REGIME —
// especially the crises the strategy has never seen in our 2011+ data: the GFC (2008)
// and the notorious 2009 MOMENTUM CRASH (losers rocketed off the bottom, the single
// worst environment for momentum in history). If risk-adjusted momentum survives
// 2008-09, that's real regime evidence. If it dies there, we learned the truth cheaply.

import { annualizedSharpe, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile("/tmp/monthly_25y.json")) as Record<string, [string, number][]>;
const syms = Object.keys(raw);
const months = [...new Set(syms.flatMap((s) => raw[s].map((x) => x[0])))].sort();
const idx = new Map(months.map((m, i) => [m, i]));
const px = new Map<string, number[]>();
for (const s of syms) { const a = new Array(months.length).fill(NaN); for (const [m, c] of raw[s]) a[idx.get(m)!] = c; px.set(s, a); }
const ret = new Map<string, number[]>();
for (const s of syms) { const p = px.get(s)!; ret.set(s, p.map((v, i) => i === 0 || !(p[i - 1] > 0) || !(v > 0) ? NaN : v / p[i - 1] - 1)); }
const T = months.length, H = 12;

function win(s: string, from: number, to: number): number[] { const r = ret.get(s)!, o: number[] = []; for (let i = Math.max(1, from); i <= to; i++) if (Number.isFinite(r[i])) o.push(r[i]); return o; }
const scoreRaw = (s: string, i: number) => { const w = win(s, i - H, i - 1); return w.length >= H * 0.7 ? w.reduce((a, b) => a * (1 + b), 1) - 1 : NaN; };
const scoreRiskAdj = (s: string, i: number) => { const w = win(s, i - H, i - 1); if (w.length < H * 0.7) return NaN; const sd = sampleStd(w); return sd > 0 ? (w.reduce((a, b) => a * (1 + b), 1) - 1) / sd : NaN; };

function book(score: (s: string, i: number) => number): { ym: string; r: number }[] {
  const out: { ym: string; r: number }[] = [];
  for (let i = H + 1; i < T - 1; i++) {
    const sc = syms.map((s) => ({ s, m: score(s, i), fwd: ret.get(s)![i + 1] })).filter((x) => Number.isFinite(x.m) && Number.isFinite(x.fwd));
    if (sc.length < 20) continue;
    sc.sort((a, b) => b.m - a.m);
    const q = Math.max(3, Math.floor(sc.length / 5));
    out.push({ ym: months[i + 1], r: mean(sc.slice(0, q).map((x) => x.fwd)) - mean(sc.slice(-q).map((x) => x.fwd)) });
  }
  return out;
}
function volScale(b: { ym: string; r: number }[], tgt = 0.10 / Math.sqrt(12), cap = 2): { ym: string; r: number }[] {
  return b.map((x, i) => { if (i < 6) return x; const sd = sampleStd(b.slice(i - 6, i).map((y) => y.r)); return { ym: x.ym, r: (sd > 0 ? Math.min(cap, tgt / sd) : 1) * x.r }; });
}

const regimes: [string, string, string][] = [
  ["2001-02 dot-com tail", "2001-01", "2002-12"],
  ["2003-07 recovery bull", "2003-01", "2007-12"],
  ["2008 GFC", "2008-01", "2008-12"],
  ["2009 MOMENTUM CRASH", "2009-01", "2009-12"],
  ["2010-19 QE bull", "2010-01", "2019-12"],
  ["2020 COVID", "2020-01", "2020-12"],
  ["2021-26 recent", "2021-01", "2026-12"],
];
function seg(b: { ym: string; r: number }[], lo: string, hi: string) {
  const xs = b.filter((x) => x.ym >= lo && x.ym <= hi).map((x) => x.r);
  if (xs.length < 3) return null;
  const worst = Math.min(...xs);
  return { sharpe: annualizedSharpe(xs, 12), ret: mean(xs) * 12 * 100, worst: worst * 100, n: xs.length };
}

const rawB = book(scoreRaw), raB = volScale(book(scoreRiskAdj));
console.log(`\n[regime-momentum] ${syms.length} stocks, ${months[0]}..${months.at(-1)}. Quintile L/S. RAW vs RISK-ADJ(vol-scaled).`);
console.log(`  The 2008 + 2009 columns are the real test — regimes NOT in our 2011+ data.\n`);
console.log(`  regime                    RAW: Sharpe  ret%/yr worstMo%   |  RISK-ADJ: Sharpe  ret%/yr worstMo%`);
for (const [name, lo, hi] of regimes) {
  const r = seg(rawB, lo, hi), a = seg(raB, lo, hi);
  if (!r || !a) { console.log(`  ${name.padEnd(24)}  (insufficient data)`); continue; }
  console.log(`  ${name.padEnd(24)}  ${r.sharpe.toFixed(2).padStart(6)} ${r.ret.toFixed(1).padStart(8)} ${r.worst.toFixed(0).padStart(8)}   |  ${a.sharpe.toFixed(2).padStart(8)} ${a.ret.toFixed(1).padStart(8)} ${a.worst.toFixed(0).padStart(8)}`);
}
const full = (b: { ym: string; r: number }[]) => ({ sharpe: annualizedSharpe(b.map((x) => x.r), 12), ret: mean(b.map((x) => x.r)) * 12 * 100 });
const fr = full(rawB), fa = full(raB);
console.log(`\n  FULL 2001-2026:  RAW Sharpe=${fr.sharpe.toFixed(2)} (${fr.ret.toFixed(1)}%/yr)  |  RISK-ADJ Sharpe=${fa.sharpe.toFixed(2)} (${fa.ret.toFixed(1)}%/yr)`);
console.log(`  Verdict hinges on 2008-09: if RISK-ADJ stays shallow there while RAW blows up, the risk-scaling is doing real work across a regime it never trained on.`);
