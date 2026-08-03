#!/usr/bin/env -S deno run --allow-read
// trd-momentum-net — the DECISIVE gate: does cross-sectional momentum survive real
// costs? Tracks ACTUAL monthly turnover (not a hand-wave), charges spread+commission
// on turnover and a short-borrow drag, across several momentum CONSTRUCTIONS (to
// prove 12-1 isn't cherry-picked) and cost levels, with vol-scaling + a locked
// holdout. A gross edge that dies at 10bps is not an edge.

import { annualizedSharpe, maxDrawdown, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile(Deno.env.get("MONTHLY_FILE") ?? "/tmp/monthly.json")) as Record<string, [string, number][]>;
const syms = Object.keys(raw);
const months = [...new Set(syms.flatMap((s) => raw[s].map((x) => x[0])))].sort();
const idx = new Map(months.map((m, i) => [m, i]));
const px = new Map<string, number[]>();
for (const s of syms) { const a = new Array(months.length).fill(NaN); for (const [m, c] of raw[s]) a[idx.get(m)!] = c; px.set(s, a); }
const ret = new Map<string, number[]>();
for (const s of syms) { const p = px.get(s)!; ret.set(s, p.map((v, i) => i === 0 || !(p[i - 1] > 0) || !(v > 0) ? NaN : v / p[i - 1] - 1)); }
const T = months.length;

function windowRets(s: string, from: number, to: number): number[] {
  const r = ret.get(s)!, out: number[] = [];
  for (let i = Math.max(1, from); i <= to; i++) if (Number.isFinite(r[i])) out.push(r[i]);
  return out;
}
type Scorer = (s: string, i: number, h: number) => number;
const scorers: Record<string, Scorer> = {
  "mom_h_1": (s, i, h) => { const w = windowRets(s, i - h, i - 1); return w.length >= h * 0.7 ? w.reduce((a, b) => a * (1 + b), 1) - 1 : NaN; },
  "mom_h_0": (s, i, h) => { const w = windowRets(s, i - h, i); return w.length >= h * 0.7 ? w.reduce((a, b) => a * (1 + b), 1) - 1 : NaN; },
  "riskadj": (s, i, h) => { const w = windowRets(s, i - h, i - 1); if (w.length < h * 0.7) return NaN; const sd = sampleStd(w); return sd > 0 ? (w.reduce((a, b) => a * (1 + b), 1) - 1) / sd : NaN; },
  "hi52": (s, i, h) => { const p = px.get(s)!; if (!(p[i] > 0)) return NaN; let hi = -Infinity; for (let k = Math.max(0, i - h); k <= i; k++) if (p[k] > 0) hi = Math.max(hi, p[k]); return hi > 0 ? p[i] / hi : NaN; },
};

// returns {gross[], net[]} monthly, tracking real turnover
function book(scorer: Scorer, h: number, costBps: number, borrowAnnual: number): { gross: number[]; net: number[] } {
  const gross: number[] = [], net: number[] = [];
  let prevW = new Map<string, number>();
  const borrowM = borrowAnnual / 12;
  for (let i = h + 1; i < T - 1; i++) {
    const scored = syms.map((s) => ({ s, m: scorer(s, i, h), fwd: ret.get(s)![i + 1] })).filter((x) => Number.isFinite(x.m) && Number.isFinite(x.fwd));
    if (scored.length < 20) { gross.push(0); net.push(0); continue; }
    scored.sort((a, b) => b.m - a.m);
    const q = Math.max(3, Math.floor(scored.length / 5));
    const w = new Map<string, number>();
    scored.slice(0, q).forEach((x) => w.set(x.s, 1 / q));
    scored.slice(-q).forEach((x) => w.set(x.s, (w.get(x.s) ?? 0) - 1 / q));
    // gross forward return of this month's weights
    let g = 0; for (const [s, wt] of w) g += wt * ret.get(s)![i + 1];
    // turnover vs prev weights (one-sided sum of abs changes)
    const keys = new Set([...w.keys(), ...prevW.keys()]); let tov = 0, shortExposure = 0;
    for (const s of keys) tov += Math.abs((w.get(s) ?? 0) - (prevW.get(s) ?? 0));
    for (const [, wt] of w) if (wt < 0) shortExposure += -wt;
    const cost = tov * (costBps / 1e4) + shortExposure * borrowM;
    gross.push(g); net.push(g - cost); prevW = w;
  }
  return { gross, net };
}

function segStats(r: number[], lo: number, hi: number) { const s = r.slice(lo, hi); return { sharpe: annualizedSharpe(s, 12), ret: mean(s) * 12 * 100, dd: maxDrawdown(s) * 100 }; }
function volScale(r: number[], tgtAnnual = 0.10, cap = 2): number[] { const tgt = tgtAnnual / Math.sqrt(12); return r.map((_, i) => { if (i < 6) return r[i]; const sd = sampleStd(r.slice(i - 6, i)); return (sd > 0 ? Math.min(cap, tgt / sd) : 1) * r[i]; }); }

console.log(`\n[momentum-net] ${syms.length} stocks, ${T} months. Quintile L/S. Cost = turnover×bps + short-borrow(2%/yr).`);
console.log(`  HOLDOUT = last 25% (locked). Testing 4 constructions × cost levels. Net vol-scaled is the deployable number.\n`);
const H = 12, borrow = 0.02;
for (const [name, sc] of Object.entries(scorers)) {
  const b0 = book(sc, H, 0, 0);
  const L = b0.gross.length, s2 = Math.floor(L * 0.75);
  const line: string[] = [`  ${name.replace("_h_", `_${H}_`).padEnd(10)}`];
  for (const bps of [0, 5, 10, 20]) {
    const bk = book(sc, H, bps, bps > 0 ? borrow : 0);
    const vs = volScale(bk.net);
    const ho = segStats(vs, s2, vs.length);
    line.push(`${bps}bps: Sh=${ho.sharpe.toFixed(2)} (${ho.ret.toFixed(1)}%/${ho.dd.toFixed(0)}%DD)`);
  }
  console.log(line.join("  |  "));
}
// ---- LONG-ONLY tilt: long top quintile vs equal-weight-universe benchmark (no shorts) ----
function longOnly(scorer: Scorer, h: number, costBps: number): number[] {
  const active: number[] = []; let prevW = new Map<string, number>();
  for (let i = h + 1; i < T - 1; i++) {
    const scored = syms.map((s) => ({ s, m: scorer(s, i, h), fwd: ret.get(s)![i + 1] })).filter((x) => Number.isFinite(x.m) && Number.isFinite(x.fwd));
    if (scored.length < 20) { active.push(0); continue; }
    scored.sort((a, b) => b.m - a.m);
    const q = Math.max(3, Math.floor(scored.length / 5));
    const w = new Map<string, number>(); scored.slice(0, q).forEach((x) => w.set(x.s, 1 / q));
    let lo = 0; for (const [s, wt] of w) lo += wt * ret.get(s)![i + 1];
    const bench = mean(scored.map((x) => x.fwd)); // equal-weight universe
    const keys = new Set([...w.keys(), ...prevW.keys()]); let tov = 0; for (const s of keys) tov += Math.abs((w.get(s) ?? 0) - (prevW.get(s) ?? 0));
    active.push((lo - bench) - tov * (costBps / 1e4)); prevW = w; // active return, net of long-side turnover
  }
  return active;
}
console.log(`\n  LONG-ONLY tilt (top quintile vs equal-weight universe, no shorts, 10bps), HOLDOUT:`);
for (const [name, sc] of Object.entries(scorers)) {
  const a = volScale(longOnly(sc, H, 10)); const s2 = Math.floor(a.length * 0.75); const ho = segStats(a, s2, a.length);
  console.log(`   ${name.replace("_h_", `_${H}_`).padEnd(10)} active Sharpe=${ho.sharpe.toFixed(2)}  ${ho.ret.toFixed(1)}%/yr vs benchmark  DD=${ho.dd.toFixed(0)}%`);
}
console.log(`\n  Read: the "10bps" column is the truth. Compare survivor-only vs de-biased: a big drop = survivorship was the edge.`);
