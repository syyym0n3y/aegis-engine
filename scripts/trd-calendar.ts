#!/usr/bin/env -S deno run --allow-net
// trd-calendar — the CALENDAR/STRUCTURAL-FLOW + EVENT lenses (R-003 #12, #7). Tests documented
// calendar anomalies on real daily data with a shuffle null: turn-of-month, day-of-week, OPEX week,
// and the famous pre-FOMC drift (Lucca–Moench: equities drift up in the 24h before FOMC). Free.

async function daily(sym: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as (number | null)[];
  const out: { d: Date; iso: string; ret: number }[] = []; let prev: number | null = null;
  for (let i = 0; i < t.length; i++) { const px = c[i]; if (px == null || !Number.isFinite(px)) continue; const d = new Date(t[i] * 1000); if (prev != null) out.push({ d, iso: d.toISOString().slice(0, 10), ret: px / prev - 1 }); prev = px; }
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// permutation test: is the mean of the SUBSET (in-days) higher than random subsets of the same size?
function permP(all: number[], flags: boolean[]) {
  const inMean = mean(all.filter((_, i) => flags[i])); const k = flags.filter(Boolean).length;
  const rnd = mulberry32(42); let beat = 0; const N = 2000;
  for (let it = 0; it < N; it++) { const idx = new Set<number>(); while (idx.size < k) idx.add(Math.floor(rnd() * all.length)); const m = mean([...idx].map((i) => all[i])); if (m >= inMean) beat++; }
  return { inMean, k, p: beat / N };
}
// FOMC announcement dates (2nd day) 2021–2026 — the drift is the 24h BEFORE these.
const FOMC = ["2021-01-27","2021-03-17","2021-04-28","2021-06-16","2021-07-28","2021-09-22","2021-11-03","2021-12-15","2022-01-26","2022-03-16","2022-05-04","2022-06-15","2022-07-27","2022-09-21","2022-11-02","2022-12-14","2023-02-01","2023-03-22","2023-05-03","2023-06-14","2023-07-26","2023-09-20","2023-11-01","2023-12-13","2024-01-31","2024-03-20","2024-05-01","2024-06-12","2024-07-31","2024-09-18","2024-11-07","2024-12-18","2025-01-29","2025-03-19","2025-05-07","2025-06-18","2025-07-30","2025-09-17","2025-10-29","2025-12-10","2026-01-28","2026-03-18","2026-04-29","2026-06-17","2026-07-29"];

const bars = await daily("^GSPC");
const rets = bars.map((b) => b.ret);
console.log(`\n[calendar] S&P ^GSPC, ${bars.length} daily returns (${bars[0].iso}→${bars[bars.length - 1].iso})`);
const base = mean(rets);
console.log(`  baseline daily mean ${(base * 100).toFixed(3)}%`);

// 1. turn-of-month: last trading day of month + first 3 of next
const tomFlags = bars.map((b, i) => { const day = b.d.getUTCDate(); const nextDiffMonth = i + 1 >= bars.length || bars[i + 1].d.getUTCMonth() !== b.d.getUTCMonth(); return day <= 3 || nextDiffMonth; });
const tom = permP(rets, tomFlags);
console.log(`\n  TURN-OF-MONTH: mean ${(tom.inMean * 100).toFixed(3)}% (n=${tom.k}) vs baseline → perm p=${tom.p.toFixed(3)} ${tom.inMean > base && tom.p < 0.05 ? "*** REAL" : ""}`);

// 2. day-of-week
for (let dow = 1; dow <= 5; dow++) { const f = bars.map((b) => b.d.getUTCDay() === dow); const r = permP(rets, f); const nm = ["", "Mon", "Tue", "Wed", "Thu", "Fri"][dow]; console.log(`  ${nm}: mean ${(r.inMean * 100).toFixed(3)}% (n=${r.k}) perm p=${r.p.toFixed(3)} ${r.inMean > base && r.p < 0.05 ? "*** REAL" : ""}`); }

// 3. OPEX week (week containing the 3rd Friday)
const opexFlags = bars.map((b) => { const dt = b.d; const first = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)); const firstFriOffset = (5 - first.getUTCDay() + 7) % 7; const thirdFri = 1 + firstFriOffset + 14; const day = dt.getUTCDate(); return day >= thirdFri - 4 && day <= thirdFri; });
const opex = permP(rets, opexFlags);
console.log(`\n  OPEX WEEK: mean ${(opex.inMean * 100).toFixed(3)}% (n=${opex.k}) perm p=${opex.p.toFixed(3)} ${opex.p < 0.05 ? "*** REAL" : ""}`);

// 4. pre-FOMC drift: the trading day BEFORE each FOMC announcement
const fomcSet = new Set(FOMC);
const preFlags = bars.map((b, i) => i + 1 < bars.length && fomcSet.has(bars[i + 1].iso));
const pre = permP(rets, preFlags);
console.log(`\n  PRE-FOMC DRIFT (day before announcement): mean ${(pre.inMean * 100).toFixed(3)}% (n=${pre.k}) vs baseline ${(base * 100).toFixed(3)}% → perm p=${pre.p.toFixed(3)} ${pre.inMean > base && pre.p < 0.05 ? "*** REAL (documented anomaly confirmed)" : ""}`);
const preRets = rets.filter((_, i) => preFlags[i]);
console.log(`     annualized edge if only-long-pre-FOMC: ~${(pre.inMean * 8 * 100).toFixed(1)}%/yr over ${pre.k} events, hit-rate ${(preRets.filter((x) => x > 0).length / preRets.length * 100).toFixed(0)}%`);
