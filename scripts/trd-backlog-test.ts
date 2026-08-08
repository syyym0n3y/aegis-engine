#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-backlog-test — test the reconstructed OrderBacklogChg (Baik & Ahn 2007) on free EDGAR + Yahoo data.
// It was the ONLY one of the 7 OSAP survivors with a long-only edge (long-only t=2.44, LS t=3.01, D-163).
//
// CAVEATS DECLARED BEFORE RESULTS (all inherited, none discovered after the fact):
//  1. RPO (ASC 606) is the modern ANALOGUE of Compustat `ob`, not the identical variable.
//  2. History starts 2018 (ASC 606) → only ~6 annual rebalances. Thin by construction.
//  3. Only ~780 firms report RPO — contract-revenue businesses (software/services). Self-selected universe,
//     NOT the full CRSP cross-section the paper used, and NOT microcap-heavy the way the original was.
//  4. Signal is known only after the 10-K is FILED. We lag entry by 4 months after fiscal year-end to avoid
//     look-ahead — a real constraint the original also faces.
// GATES: decile long-short AND long-only (the tradable version), forward 12m, equal-weight, plus a matched
// RANDOM control (same universe, same dates, random stock picks) per D-146.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
interface Row { cik: number; ticker: string; year: number; norm: number; normPrev: number; signal: number }
const rows: Row[] = JSON.parse(await Deno.readTextFile("data/edgar/backlog-panel.json"));
const tickers: string[] = JSON.parse(await Deno.readTextFile("data/edgar/backlog-tickers.json"));
let seed = 60607; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// ---- prices (monthly closes) ----
const CACHE = "data/edgar/prices.json";
let px: Record<string, Record<string, number>> = {};
try { px = JSON.parse(await Deno.readTextFile(CACHE)); } catch { /* */ }
let fetched = 0;
for (const t of tickers) {
  if (px[t]) continue;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1mo&period1=1514764800&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0];
    const m: Record<string, number> = {};
    if (res?.timestamp) { const ts = res.timestamp as number[]; const c = (res.indicators.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close) as number[]; for (let i = 0; i < ts.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) m[new Date(ts[i] * 1000).toISOString().slice(0, 7)] = c[i]; }
    px[t] = m; fetched++;
    if (fetched % 100 === 0) { console.log(`  prices: ${fetched} fetched`); await Deno.writeTextFile(CACHE, JSON.stringify(px)); }
  } catch { px[t] = {}; }
}
await Deno.writeTextFile(CACHE, JSON.stringify(px));
const withPx = tickers.filter((t) => Object.keys(px[t] ?? {}).length > 24);
console.log(`Prices: ${withPx.length}/${tickers.length} tickers with usable monthly history\n`);
// ---- form portfolios: entry 4 months after fiscal year end (filing lag), hold 12m ----
const fwd = (t: string, from: string, months = 12): number | null => {
  const m = px[t]; if (!m) return null;
  const d0 = new Date(from + "-01"); const d1 = new Date(d0); d1.setUTCMonth(d1.getUTCMonth() + months);
  const k0 = from, k1 = d1.toISOString().slice(0, 7);
  const p0 = m[k0], p1 = m[k1]; if (!(p0 > 0) || !(p1 > 0)) return null;
  return p1 / p0 - 1;
};
interface Obs { year: number; entry: string; ticker: string; signal: number; ret: number }
const obs: Obs[] = [];
for (const r of rows) {
  const entry = `${r.year + 1}-05`;                 // FY end Dec + 4 months filing lag → enter May
  const ret = fwd(r.ticker, entry, 12);
  if (ret == null || !Number.isFinite(r.signal)) continue;
  obs.push({ year: r.year, entry, ticker: r.ticker, signal: r.signal, ret });
}
console.log(`Testable observations (signal + 12m forward return): ${obs.length}`);
const byYear = new Map<number, Obs[]>(); for (const o of obs) (byYear.get(o.year) ?? byYear.set(o.year, []).get(o.year)!).push(o);
const tstat = (a: number[]) => { const v = a.filter(Number.isFinite); if (v.length < 3) return NaN; const s = sampleStd(v); return s > 0 ? mean(v) / (s / Math.sqrt(v.length)) : NaN; };
const lsYear: number[] = [], longYear: number[] = [], midYear: number[] = [], randYear: number[] = [];
console.log(`\n${"year".padEnd(6)} ${"n".padStart(5)} ${"top-decile".padStart(11)} ${"bot-decile".padStart(11)} ${"long-short".padStart(11)} ${"universe".padStart(10)} ${"long-only".padStart(10)}`);
for (const [y, arr] of [...byYear].sort()) {
  if (arr.length < 40) { console.log(`${String(y).padEnd(6)} ${String(arr.length).padStart(5)}  too few`); continue; }
  const s = [...arr].sort((a, b) => b.signal - a.signal);
  const k = Math.max(5, Math.floor(s.length / 10));
  const top = mean(s.slice(0, k).map((x) => x.ret)), bot = mean(s.slice(-k).map((x) => x.ret));
  const uni = mean(arr.map((x) => x.ret));
  const rndPick = [...arr].sort(() => rnd() - 0.5).slice(0, k);
  lsYear.push(top - bot); longYear.push(top - uni); midYear.push(uni); randYear.push(mean(rndPick.map((x) => x.ret)) - uni);
  console.log(`${String(y).padEnd(6)} ${String(arr.length).padStart(5)} ${(top * 100).toFixed(2).padStart(10)}% ${(bot * 100).toFixed(2).padStart(10)}% ${((top - bot) * 100).toFixed(2).padStart(10)}% ${(uni * 100).toFixed(2).padStart(9)}% ${((top - uni) * 100).toFixed(2).padStart(9)}%`);
}
console.log(`\n══ VERDICT (annual rebalances: ${lsYear.length}) ══`);
const rep = (a: number[], lbl: string) => console.log(`   ${lbl.padEnd(34)} mean ${(mean(a) * 100).toFixed(2).padStart(7)}%/yr   t=${tstat(a).toFixed(2).padStart(6)}   ${tstat(a) > 2 ? "✓" : "✗"}   [n=${a.length} years]`);
rep(lsYear, "LONG-SHORT (top − bottom decile)");
rep(longYear, "LONG-ONLY (top decile − universe)");
rep(randYear, "RANDOM control (random pick − universe)");
console.log(`\n   ORIGINAL (Baik & Ahn 2007, CRSP 1971-1999, EW decile): sign +1; OSAP OOS 2015+ LS t=3.01, long-only t=2.44`);
console.log(`\n   HONEST READ: with only ${lsYear.length} annual rebalances the t-stats here are LOW-POWER by construction —`);
console.log(`   this cannot confirm the effect, only fail to contradict it, or contradict it. RPO≠Compustat ob, and the`);
console.log(`   ~780-firm contract-revenue universe is not the paper's full cross-section. Treat as a FEASIBILITY probe.`);
