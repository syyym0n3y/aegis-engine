#!/usr/bin/env -S deno run --allow-net
// trd-cycle-study — tests the "tops/bottoms recur at fixed intervals (1064d, 364d)" claim on REAL
// full-history daily data, crypto + cross-market, with a Monte-Carlo null so "a cycle" must beat
// chance after scanning many periods. Reports the dominant cycles it actually finds, the verdict on
// 364 & 1064 specifically, and — loudly — the extrema count n (a cycle from n=5 is a story).

import { type Bar, consecutiveIntervals, findExtrema, monteCarloThreshold, rayleigh, scanPeriods } from "../supabase/functions/_shared/trd-cycles.ts";

async function daily(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  return out;
}

const CLAIMS = [364, 1064];
const MINP = 60, MAXP = 1500, STEP = 1, HALF = 45; // 90-day window ⇒ "major" swings

function localMaxima(scan: { period: number; R: number }[], thresh: number) {
  const peaks: { period: number; R: number }[] = [];
  for (let i = 1; i < scan.length - 1; i++) if (scan[i].R > scan[i - 1].R && scan[i].R >= scan[i + 1].R && scan[i].R > thresh) peaks.push(scan[i]);
  peaks.sort((a, b) => b.R - a.R);
  // dedupe near-duplicate periods (within 8d)
  const out: { period: number; R: number }[] = [];
  for (const p of peaks) if (!out.some((q) => Math.abs(q.period - p.period) < 8)) out.push(p);
  return out.slice(0, 8);
}

const MARKETS: [string, string][] = [["BTC", "BTC-USD"], ["ETH", "ETH-USD"], ["LTC", "LTC-USD"], ["S&P500", "^GSPC"], ["Gold", "GC=F"]];

for (const [name, sym] of MARKETS) {
  const bars = await daily(sym);
  if (bars.length < 400) { console.log(`\n${name}: ${bars.length} bars — skip`); continue; }
  const spanDays = Math.round((Date.parse(bars[bars.length - 1].ts) - Date.parse(bars[0].ts)) / 86400000);
  const ex = findExtrema(bars, HALF);
  const highs = ex.filter((e) => e.kind === "high"), lows = ex.filter((e) => e.kind === "low");
  const allDays = ex.map((e) => e.day), hiDays = highs.map((e) => e.day), loDays = lows.map((e) => e.day);
  const mc = monteCarloThreshold(ex.length, spanDays, MINP, MAXP, STEP, 400);
  console.log(`\n══ ${name} — ${bars.length} daily bars, ${(spanDays / 365).toFixed(1)}y (${bars[0].ts.slice(0, 10)}→${bars[bars.length - 1].ts.slice(0, 10)}) ══`);
  console.log(`  major extrema (±${HALF}d window): ${highs.length} highs, ${lows.length} lows  ← n. MC-null significance bar: R>${mc.p95.toFixed(2)} (95%), ${mc.p99.toFixed(2)} (99%)`);

  const scan = scanPeriods(allDays, MINP, MAXP, STEP);
  const peaks = localMaxima(scan, mc.p95);
  console.log(`  dominant cycles found (R above the 95% null): ${peaks.length ? peaks.map((p) => `${p.period}d(R=${p.R.toFixed(2)})`).join(", ") : "NONE beat the null"}`);

  for (const P of CLAIMS) {
    const rAll = rayleigh(allDays, P), rHi = rayleigh(hiDays, P), rLo = rayleigh(loDays, P);
    const sig = rAll.R > mc.p95 ? (rAll.R > mc.p99 ? "SIGNIFICANT@99%" : "significant@95%") : "not significant";
    console.log(`   ${P}d: R(all)=${rAll.R.toFixed(2)} p≈${rAll.p.toFixed(3)} | highs R=${rHi.R.toFixed(2)} lows R=${rLo.R.toFixed(2)} → ${sig}`);
  }
  const hiIv = consecutiveIntervals(ex, "high"), loIv = consecutiveIntervals(ex, "low");
  const med = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN;
  console.log(`  raw consecutive intervals — highs: [${hiIv.join(", ")}] median ${med(hiIv)}d | lows median ${med(loIv)}d`);

  // GRAND-CYCLE pass: a ~250-day window isolates only the biggest macro tops/bottoms (the ATH and
  // the cycle low of each multi-year cycle — the ones the 1064/1425 claim is really about).
  const grand = findExtrema(bars, 250).sort((a, b) => a.day - b.day);
  if (grand.length >= 2) {
    console.log(`  GRAND extrema (±250d): ${grand.map((e) => `${e.ts.slice(0, 10)}${e.kind === "high" ? "▲" : "▼"}`).join("  ")}`);
    const gh = grand.filter((e) => e.kind === "high").map((e) => e.day), gl = grand.filter((e) => e.kind === "low").map((e) => e.day);
    const gaps = (a: number[]) => a.slice(1).map((d, i) => d - a[i]);
    const b2t: number[] = []; for (const l of gl) { const nxt = gh.filter((h) => h > l).sort((x, y) => x - y)[0]; if (nxt) b2t.push(nxt - l); }
    const near = (v: number, target: number) => Math.abs(v - target) <= 60;
    console.log(`   top→top: [${gaps(gh).join(", ")}]  bottom→bottom: [${gaps(gl).join(", ")}]  bottom→top: [${b2t.join(", ")}]`);
    const all = [...gaps(gh), ...gaps(gl), ...b2t];
    console.log(`   vs claim → near 1064d: ${all.filter((v) => near(v, 1064)).join(",") || "none"} | near 364d: ${all.filter((v) => near(v, 364)).join(",") || "none"} | (BTC halving ≈1458d matches: ${all.filter((v) => near(v, 1458)).join(",") || "none"})`);
  }
}

console.log(`\n─────────────────────────────────────────────────────────────────────────────────`);
console.log(`How to read: a claimed interval is real ONLY if its R beats the market's own Monte-Carlo`);
console.log(`null (which already accounts for scanning many periods). Divisors of a true cycle also`);
console.log(`peak, so 364d partly echoes any ~728/1092 cycle. And n is tiny — with <8 major highs you`);
console.log(`cannot statistically establish a multi-year cycle; treat any "hit" as a lead for a`);
console.log(`pre-registered forward test (like btc-sweep-rr3), never as a tradeable certainty.`);
