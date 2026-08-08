#!/usr/bin/env -S deno run --allow-read
// trd-trendfollow — TIME-SERIES momentum (managed-futures / CTA style), the untested
// family most likely to break the pattern. Each asset trades ITS OWN trend (long if
// trending up, short if down), vol-targeted, combined equal-risk across 20 diversified
// asset classes. Unlike cross-sectional momentum (which crashed in 2009), trend-
// following is convex/long-vol and is documented to produce "CRISIS ALPHA" — the real
// test is whether it makes money in 2008 & 2001 where everything else died.

import { annualizedSharpe, mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile("/tmp/monthly_etf.json")) as Record<string, [string, number][]>;
const assets = Object.keys(raw);
const months = [...new Set(assets.flatMap((s) => raw[s].map((x) => x[0])))].sort();
const idx = new Map(months.map((m, i) => [m, i]));
const px = new Map<string, number[]>();
for (const s of assets) { const a = new Array(months.length).fill(NaN); for (const [m, c] of raw[s]) a[idx.get(m)!] = c; px.set(s, a); }
const ret = new Map<string, number[]>();
for (const s of assets) { const p = px.get(s)!; ret.set(s, p.map((v, i) => i === 0 || !(p[i - 1] > 0) || !(v > 0) ? NaN : v / p[i - 1] - 1)); }
const T = months.length;

function trailRet(s: string, i: number, h: number): number { const p = px.get(s)!; return p[i] > 0 && p[i - h] > 0 ? p[i] / p[i - h] - 1 : NaN; }
function trailVol(s: string, i: number, h = 12): number { const r = ret.get(s)!, xs: number[] = []; for (let k = i - h + 1; k <= i; k++) if (Number.isFinite(r[k])) xs.push(r[k]); return xs.length >= 6 ? sampleStd(xs) : NaN; }

// portfolio monthly returns (gross + net of turnover cost), + realized leverage log
function trendBook(costBps: number): { ym: string; r: number }[] {
  const out: { ym: string; r: number }[] = [];
  const tgt = 0.10 / Math.sqrt(12); // 10%/yr per-asset vol target
  const prevPos = new Map<string, number>();
  for (let i = 13; i < T - 1; i++) {
    let sum = 0, k = 0, tov = 0;
    for (const s of assets) {
      const sigs = [1, 3, 12].map((h) => trailRet(s, i, h)).filter(Number.isFinite);
      if (sigs.length < 2) { continue; }
      const dir = mean(sigs.map((x) => Math.sign(x))); // blended trend direction in [-1,1]
      const vol = trailVol(s, i);
      const fwd = ret.get(s)![i + 1];
      if (!Number.isFinite(vol) || vol <= 0 || !Number.isFinite(fwd)) continue;
      const pos = Math.max(-2, Math.min(2, dir * (tgt / vol))); // vol-targeted, capped
      sum += pos * fwd; k++;
      tov += Math.abs(pos - (prevPos.get(s) ?? 0));
      prevPos.set(s, pos);
    }
    if (k === 0) continue;
    const gross = sum / k;
    const cost = (tov / k) * (costBps / 1e4);
    out.push({ ym: months[i + 1], r: gross - cost });
  }
  return out;
}

const regimes: [string, string, string][] = [
  ["2001-02 dot-com", "2001-01", "2002-12"],
  ["2003-07 bull", "2003-01", "2007-12"],
  ["2008 GFC", "2008-01", "2008-12"],
  ["2009 mom-crash yr", "2009-01", "2009-12"],
  ["2010-19 QE bull", "2010-01", "2019-12"],
  ["2020 COVID", "2020-01", "2020-12"],
  ["2021-26 recent", "2021-01", "2026-12"],
];
function seg(b: { ym: string; r: number }[], lo: string, hi: string) {
  const xs = b.filter((x) => x.ym >= lo && x.ym <= hi).map((x) => x.r);
  return xs.length < 3 ? null : { sharpe: annualizedSharpe(xs, 12), ret: mean(xs) * 12 * 100, worst: Math.min(...xs) * 100, n: xs.length };
}

const book = trendBook(10); // 10bps cost
console.log(`\n[trend-follow] ${assets.length} asset classes, ${months[0]}..${months.at(-1)}. Vol-targeted TS-momentum (1/3/12m blend), 10bps.`);
console.log(`  The crisis columns (2001-02, 2008) are the real test — does trend make money when everything else bleeds?\n`);
console.log(`  regime               Sharpe   ret%/yr   worstMo%   n`);
for (const [name, lo, hi] of regimes) { const s = seg(book, lo, hi); console.log(s ? `  ${name.padEnd(18)} ${s.sharpe.toFixed(2).padStart(7)} ${s.ret.toFixed(1).padStart(9)} ${s.worst.toFixed(0).padStart(9)} ${String(s.n).padStart(4)}` : `  ${name.padEnd(18)}  (insufficient)`); }
const all = book.map((x) => x.r);
// equity buy-hold benchmark over same window for context
const spy = ret.get("SPY")!; const spyR = book.map((x) => spy[idx.get(x.ym)!]).filter(Number.isFinite);
console.log(`\n  FULL ${book[0].ym}-${book.at(-1)!.ym}:  TREND Sharpe=${annualizedSharpe(all, 12).toFixed(2)} (${(mean(all) * 12 * 100).toFixed(1)}%/yr)  vs  SPY buy&hold Sharpe=${annualizedSharpe(spyR, 12).toFixed(2)}`);
console.log(`  Correlation to SPY: ${(() => { const n = Math.min(all.length, spyR.length); const a = all.slice(-n), b = spyR.slice(-n); const ma = mean(a), mb = mean(b); let cov = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return (cov / Math.sqrt(va * vb)).toFixed(2); })()}`);
console.log(`  Read: if 2008 Sharpe is strongly POSITIVE and SPY-correlation is ~0 or negative, trend has genuine crisis-alpha / diversification — a DIFFERENT kind of edge than we've found (or failed to find) so far.`);
