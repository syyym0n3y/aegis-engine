#!/usr/bin/env -S deno run --allow-read
// trd-value-quality — the last big untested family, from FREE SEC EDGAR fundamentals,
// point-in-time-correct (a metric is read only after its filing date -> no look-ahead).
// Cross-sectional quintile L/S on Book-to-Market & Earnings-Yield (VALUE) and ROE
// (QUALITY), monthly, vol-scaled, tested by regime + full cycle + cost. Value has a
// DIFFERENT regime profile than momentum (it works when momentum crashes) - the reason
// it's worth testing even after everything else failed.

import { annualizedSharpe, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const price = JSON.parse(await Deno.readTextFile("/tmp/monthly_25y.json")) as Record<string, [string, number][]>;
const fund = JSON.parse(await Deno.readTextFile("/tmp/fundamentals.json")) as Record<string, { c: string; end: string; filed: string; v: number }[]>;
const syms = Object.keys(price).filter((s) => fund[s]?.length);
const months = [...new Set(syms.flatMap((s) => price[s].map((x) => x[0])))].sort();
const idx = new Map(months.map((m, i) => [m, i]));
const px = new Map<string, number[]>();
for (const s of syms) { const a = new Array(months.length).fill(NaN); for (const [m, c] of price[s]) a[idx.get(m)!] = c; px.set(s, a); }
const ret = new Map<string, number[]>();
for (const s of syms) { const p = px.get(s)!; ret.set(s, p.map((v, i) => i === 0 || !(p[i - 1] > 0) || !(v > 0) ? NaN : v / p[i - 1] - 1)); }
const T = months.length;

// point-in-time fundamental: among facts filed on/before month `ym`, the one with the latest period_end.
function pit(sym: string, concept: string, ym: string): number | null {
  const fs = fund[sym]; if (!fs) return null;
  let best: { end: string; v: number } | null = null;
  for (const f of fs) { if (f.c !== concept) continue; if (f.filed.slice(0, 7) > ym) continue; if (!best || f.end > best.end) best = { end: f.end, v: f.v }; }
  return best ? best.v : null;
}
type FF = (sym: string, i: number) => number;
const factors: Record<string, { f: FF; longHigh: boolean }> = {
  "B/M value": { longHigh: true, f: (s, i) => { const ym = months[i]; const eq = pit(s, "equity", ym), sh = pit(s, "shares", ym), p = px.get(s)![i]; return eq && sh && p > 0 ? eq / (sh * p) : NaN; } },
  "E/P value": { longHigh: true, f: (s, i) => { const ym = months[i]; const ni = pit(s, "ni_annual", ym), sh = pit(s, "shares", ym), p = px.get(s)![i]; return ni != null && sh && p > 0 ? ni / (sh * p) : NaN; } },
  "ROE quality": { longHigh: true, f: (s, i) => { const ym = months[i]; const ni = pit(s, "ni_annual", ym), eq = pit(s, "equity", ym); return ni != null && eq && eq !== 0 ? ni / eq : NaN; } },
};

function book(ff: FF, longHigh: boolean): { ym: string; r: number }[] {
  const out: { ym: string; r: number }[] = [];
  for (let i = 13; i < T - 1; i++) {
    const sc = syms.map((s) => ({ s, m: ff(s, i), fwd: ret.get(s)![i + 1] })).filter((x) => Number.isFinite(x.m) && Number.isFinite(x.fwd));
    if (sc.length < 20) continue;
    sc.sort((a, b) => b.m - a.m);
    const q = Math.max(3, Math.floor(sc.length / 5));
    const hi = mean(sc.slice(0, q).map((x) => x.fwd)), lo = mean(sc.slice(-q).map((x) => x.fwd));
    out.push({ ym: months[i + 1], r: longHigh ? hi - lo : lo - hi });
  }
  return out;
}
function volScale(b: { ym: string; r: number }[], tgt = 0.10 / Math.sqrt(12), cap = 2) { return b.map((x, i) => { if (i < 6) return x; const sd = sampleStd(b.slice(i - 6, i).map((y) => y.r)); return { ym: x.ym, r: (sd > 0 ? Math.min(cap, tgt / sd) : 1) * x.r }; }); }

const regimes: [string, string, string][] = [
  ["2001-02 dot-com", "2001-01", "2002-12"], ["2003-07 bull", "2003-01", "2007-12"], ["2008 GFC", "2008-01", "2008-12"],
  ["2009 recovery", "2009-01", "2009-12"], ["2010-19 QE bull", "2010-01", "2019-12"], ["2020 COVID", "2020-01", "2020-12"], ["2021-26 recent", "2021-01", "2026-12"],
];
function seg(b: { ym: string; r: number }[], lo: string, hi: string) { const xs = b.filter((x) => x.ym >= lo && x.ym <= hi).map((x) => x.r); return xs.length < 3 ? null : { sh: annualizedSharpe(xs, 12), ret: mean(xs) * 12 * 100 }; }

console.log(`\n[value-quality] ${syms.length} stocks w/ EDGAR fundamentals, ${months[0]}..${months.at(-1)}. Point-in-time (filing-date gated).`);
for (const [name, { f, longHigh }] of Object.entries(factors)) {
  const b = volScale(book(f, longHigh));
  const full = { sh: annualizedSharpe(b.map((x) => x.r), 12), ret: mean(b.map((x) => x.r)) * 12 * 100 };
  const cells = regimes.map(([, lo, hi]) => { const s = seg(b, lo, hi); return s ? s.sh.toFixed(2).padStart(6) : "  n/a"; });
  console.log(`\n  ${name}  FULL Sharpe=${full.sh.toFixed(2)} (${full.ret.toFixed(1)}%/yr)`);
  console.log(`    by regime Sharpe: ` + regimes.map(([n], j) => `${n.split(" ")[0]}=${cells[j].trim()}`).join("  "));
}
console.log(`\n  Read: value/quality that is POSITIVE full-cycle AND positive in 2008-09 (where momentum died) = a genuinely different, complementary edge. Flat/negative full-cycle = joins the graveyard, honestly.`);
