#!/usr/bin/env -S deno run --allow-net
// trd-correlation-leadlag — the operator's question: do instruments determine each other's performance?
// Two distinct things, tested separately because they mean different things for a trader:
//   (A) CONTEMPORANEOUS CORRELATION — how much everything moves together. This does NOT give signals; it
//       governs RISK: N correlated positions are not N bets. Output = correlation matrix summary + the
//       "effective number of bets" for a book, which is what position sizing must respect.
//   (B) LEAD-LAG PREDICTABILITY — does instrument A's move TODAY predict instrument B's move TOMORROW?
//       THIS would be a genuine signal. Tested pairwise across the book with proper significance, and the
//       count of "significant" pairs is compared against what pure chance produces at the same threshold.
// Free Yahoo daily, full history. Per ANALYSIS_CONTRACT: numbers, N, chance baseline.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const BOOK = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
async function daily(sym: string): Promise<Map<string, number>> { const m = new Map<string, number>(); try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return m; const t = res.timestamp as number[]; const c = (res.indicators.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close) as number[]; for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]); } catch { /* */ } return m; }
const px = new Map<string, Map<string, number>>();
for (const s of BOOK) { const m = await daily(s); if (m.size > 500) px.set(s, m); }
const syms = [...px.keys()];
// common date grid (last 15y for a stable panel)
const cutoff = "2011-01-01";
const allDates = [...new Set(syms.flatMap((s) => [...px.get(s)!.keys()]))].filter((d) => d >= cutoff).sort();
const dates = allDates.filter((d) => syms.every((s) => px.get(s)!.has(d)));
console.log(`CORRELATION & LEAD-LAG — ${syms.length} instruments, ${dates.length} common trading days (${dates[0]} → ${dates[dates.length - 1]})\n`);
const rets: Record<string, number[]> = {};
for (const s of syms) { const m = px.get(s)!; const a: number[] = []; for (let i = 1; i < dates.length; i++) a.push(m.get(dates[i])! / m.get(dates[i - 1])! - 1); rets[s] = a; }
const N = dates.length - 1;
function corr(a: number[], b: number[]): number { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; n += x * y; da += x * x; db += y * y; } return (da > 0 && db > 0) ? n / Math.sqrt(da * db) : 0; }
// ── (A) contemporaneous correlation ──
const pairs: { a: string; b: string; r: number }[] = [];
for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) pairs.push({ a: syms[i], b: syms[j], r: corr(rets[syms[i]], rets[syms[j]]) });
const rs = pairs.map((p) => p.r); const avgR = mean(rs);
console.log(`(A) CONTEMPORANEOUS CORRELATION — governs RISK, not entries`);
console.log(`    average pairwise correlation: ${avgR.toFixed(3)}   (median ${[...rs].sort((x, y) => x - y)[Math.floor(rs.length / 2)].toFixed(3)})`);
console.log(`    most correlated : ${[...pairs].sort((a, b) => b.r - a.r).slice(0, 5).map((p) => `${p.a}/${p.b} ${p.r.toFixed(2)}`).join(", ")}`);
console.log(`    least/negative  : ${[...pairs].sort((a, b) => a.r - b.r).slice(0, 5).map((p) => `${p.a}/${p.b} ${p.r.toFixed(2)}`).join(", ")}`);
// effective number of bets for an equal-weight book = 1 / (sum of weights' correlation quadratic form)
const n = syms.length; let q = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const c = i === j ? 1 : corr(rets[syms[i]], rets[syms[j]]); q += c / (n * n); }
const effBets = 1 / q;
console.log(`    → EFFECTIVE NUMBER OF BETS in an equal-weight ${n}-instrument book: ${effBets.toFixed(1)}`);
console.log(`      i.e. holding all ${n} is really ~${effBets.toFixed(1)} independent bets. THIS is why concurrent signals must be`);
console.log(`      sized against a shared risk budget — ${n} "diversified" longs in a selloff is ~${effBets.toFixed(1)} bets, not ${n}.`);
// stressed correlation: does it rise when the market falls? (the risk that matters)
const spy = rets["SPY"]; const downIdx: number[] = []; const upIdx: number[] = [];
for (let i = 0; i < N; i++) (spy[i] < -0.01 ? downIdx : upIdx).push(i);
function corrOn(a: number[], b: number[], idx: number[]) { const A = idx.map((i) => a[i]), B = idx.map((i) => b[i]); return corr(A, B); }
let cDown = 0, cUp = 0, k = 0;
for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) { cDown += corrOn(rets[syms[i]], rets[syms[j]], downIdx); cUp += corrOn(rets[syms[i]], rets[syms[j]], upIdx); k++; }
console.log(`    CORRELATION IN SELLOFFS (SPY < −1%): ${(cDown / k).toFixed(3)} vs calm/up days ${(cUp / k).toFixed(3)}  → ${(cDown / k) > (cUp / k) ? "correlations RISE when it matters most (diversification fails in a crash)" : "stable"}`);
// ── (B) lead-lag predictability ──
console.log(`\n(B) LEAD-LAG — does A's move TODAY predict B's move TOMORROW? (this WOULD be a tradable signal)`);
let sig = 0, tested = 0; const best: { a: string; b: string; t: number; r: number }[] = [];
for (const A of syms) for (const Bs of syms) {
  if (A === Bs) continue;
  const a = rets[A].slice(0, N - 1), b = rets[Bs].slice(1);
  const r = corr(a, b); const t = r * Math.sqrt((a.length - 2) / Math.max(1e-12, 1 - r * r));
  tested++; if (Math.abs(t) > 2) sig++;
  best.push({ a: A, b: Bs, t, r });
}
best.sort((x, y) => Math.abs(y.t) - Math.abs(x.t));
console.log(`    pairs tested: ${tested}   |t|>2: ${sig} (${(sig / tested * 100).toFixed(1)}%)   chance at |t|>2: ~5.0%`);
console.log(`    ${sig / tested > 0.10 ? "→ MORE than chance: some genuine lead-lag structure exists" : "→ ≈ CHANCE: no exploitable lead-lag at daily frequency (as efficient-market theory predicts)"}`);
console.log(`    strongest pairs (lag-1 correlation, |t| ranked):`);
for (const p of best.slice(0, 8)) console.log(`      ${p.a} → ${p.b}: r=${p.r.toFixed(3)} t=${p.t.toFixed(2)}  (r²=${(p.r * p.r * 100).toFixed(2)}% of next-day variance explained)`);
console.log(`\n    NOTE: r² is the honest read — even a "significant" lead-lag explaining <1% of next-day variance is`);
console.log(`    not tradable after costs. Correlation governs RISK SIZING (A); it is not an entry signal (B).`);
