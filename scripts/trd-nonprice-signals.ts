#!/usr/bin/env -S deno run --allow-net
// trd-nonprice-signals — everything tested so far was price-derived. This tests NON-PRICE signals for
// DIRECTIONAL predictive power, horizontally (7 signal families) and vertically (4 horizons), each gated.
// SIGNALS (all free, all non-price-of-the-traded-instrument):
//   1. ^SKEW    — CBOE options-implied TAIL/crash pricing (what option buyers pay for downside)
//   2. ^VVIX    — vol-of-vol (options on VIX; stress in the hedging complex)
//   3. VIX9D/VIX — very-short-term term structure (imminent event pricing)
//   4. VIX/VIX3M — term structure (validated for VOL in D-134; here tested for DIRECTION)
//   5. BREADTH  — % of the 45-instrument book above its own 200MA (cross-sectional, not SPY's own price)
//   6. CREDIT   — HYG/LQD relative strength (credit risk appetite)
//   7. CURVE    — ^TNX − ^IRX (yield-curve slope)
// LITERATURE CONTEXT (stated before results, not after): Goyal & Welch (2008) showed 15 macro predictors
// "predicted poorly both in-sample and out-of-sample for 30 years" — so the macro family (5,6,7) has a
// documented history of FAILING. The options-implied family (1,2,3,4) is less picked-over. Expect most to fail.
// Each signal → percentile vs trailing 252d → forward SPY return at extremes, IS/OOS, + multivariate OLS.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const HZ = [1, 5, 20];
async function series(sym: string): Promise<Map<string, number>> { const m = new Map<string, number>(); try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return m; const t = res.timestamp as number[]; const c = (res.indicators.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close) as number[]; for (let i = 0; i < t.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c[i]); } catch { /* */ } return m; }
const BOOK = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","TLT","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F","EEM","EFA","FXI","IEF","DBC","TSLA","EWZ"];
console.log(`NON-PRICE SIGNAL BATTERY — loading...`);
const spy = await series("SPY"), skew = await series("^SKEW"), vvix = await series("^VVIX"), vix = await series("^VIX"), vix9 = await series("^VIX9D"), vix3m = await series("^VIX3M"), tnx = await series("^TNX"), irx = await series("^IRX"), hyg = await series("HYG"), lqd = await series("LQD");
// breadth: % of book above own 200MA, computed cross-sectionally
const bookSeries: Map<string, number>[] = []; for (const s of BOOK) { const m = await series(s); if (m.size > 500) bookSeries.push(m); }
const dates = [...spy.keys()].sort();
const breadth = new Map<string, number>();
for (const m of bookSeries) { const ds = [...m.keys()].sort(); const vals = ds.map((d) => m.get(d)!); for (let i = 200; i < ds.length; i++) { let s = 0; for (let k = i - 200; k < i; k++) s += vals[k]; const above = vals[i] > s / 200 ? 1 : 0; breadth.set(ds[i], (breadth.get(ds[i]) ?? 0) + above); } }
const breadthN = new Map<string, number>(); for (const m of bookSeries) { const ds = [...m.keys()]; for (const d of ds) breadthN.set(d, (breadthN.get(d) ?? 0) + 1); }
const breadthPct = new Map<string, number>(); for (const [d, v] of breadth) { const n = breadthN.get(d) ?? 1; if (n >= 30) breadthPct.set(d, v / n); }
console.log(`  SPY ${spy.size}d | SKEW ${skew.size} | VVIX ${vvix.size} | VIX9D ${vix9.size} | breadth ${breadthPct.size} | book ${bookSeries.length} instruments\n`);
const SIGNALS: Record<string, (d: string) => number | null> = {
  "SKEW (tail pricing)": (d) => skew.get(d) ?? null,
  "VVIX (vol-of-vol)": (d) => vvix.get(d) ?? null,
  "VIX9D/VIX (imminent)": (d) => { const a = vix9.get(d), b = vix.get(d); return (a && b) ? a / b : null; },
  "VIX/VIX3M (term)": (d) => { const a = vix.get(d), b = vix3m.get(d); return (a && b) ? a / b : null; },
  "BREADTH (%>200MA)": (d) => breadthPct.get(d) ?? null,
  "CREDIT (HYG/LQD)": (d) => { const a = hyg.get(d), b = lqd.get(d); return (a && b) ? a / b : null; },
  "CURVE (TNX-IRX)": (d) => { const a = tnx.get(d), b = irx.get(d); return (a != null && b != null) ? a - b : null; },
};
const sd = dates.filter((d) => spy.has(d));
const px = sd.map((d) => spy.get(d)!);
const cut = Math.floor(sd.length * 0.6);

console.log(`${"signal".padEnd(24)} ${"h".padStart(3)} ${"top10% ret".padStart(11)} ${"bot10% ret".padStart(11)} ${"spread".padStart(8)} ${"t".padStart(7)} ${"OOS spread".padStart(11)} ${"OOS t".padStart(7)}  verdict`);
for (const [name, fn] of Object.entries(SIGNALS)) {
  for (const h of HZ) {
    const hi: { r: number; is: boolean }[] = [], lo: { r: number; is: boolean }[] = [];
    for (let i = 260; i < sd.length - h - 1; i++) {
      const cur = fn(sd[i]); if (cur == null) continue;
      const win: number[] = []; for (let k = i - 252; k < i; k++) { const v = fn(sd[k]); if (v != null) win.push(v); }
      if (win.length < 150) continue;
      const s2 = [...win].sort((a, b) => a - b); let rk = 0; while (rk < s2.length && s2[rk] < cur) rk++; const pct = rk / s2.length;
      const fwd = (px[i + h] - px[i]) / px[i];
      if (pct >= 0.9) hi.push({ r: fwd, is: i < cut }); else if (pct <= 0.1) lo.push({ r: fwd, is: i < cut });
    }
    if (hi.length < 60 || lo.length < 60) { console.log(`${name.padEnd(24)} ${String(h).padStart(3)}  thin`); continue; }
    const mh = mean(hi.map((x) => x.r)), ml = mean(lo.map((x) => x.r));
    const se = Math.sqrt(sampleStd(hi.map((x) => x.r)) ** 2 / hi.length + sampleStd(lo.map((x) => x.r)) ** 2 / lo.length);
    const t = (mh - ml) / se;
    const hiO = hi.filter((x) => !x.is), loO = lo.filter((x) => !x.is);
    let tO = NaN, spO = NaN;
    if (hiO.length > 30 && loO.length > 30) { const a = mean(hiO.map((x) => x.r)), b = mean(loO.map((x) => x.r)); spO = a - b; tO = (a - b) / Math.sqrt(sampleStd(hiO.map((x) => x.r)) ** 2 / hiO.length + sampleStd(loO.map((x) => x.r)) ** 2 / loO.length); }
    const holds = Math.abs(t) > 2 && Math.abs(tO) > 2 && Math.sign(t) === Math.sign(tO);
    console.log(`${name.padEnd(24)} ${String(h).padStart(3)} ${(mh * 100).toFixed(2).padStart(10)}% ${(ml * 100).toFixed(2).padStart(10)}% ${((mh - ml) * 100).toFixed(2).padStart(7)}% ${t.toFixed(2).padStart(7)} ${(spO * 100).toFixed(2).padStart(10)}% ${tO.toFixed(2).padStart(7)}  ${holds ? "✓✓ HOLDS IS+OOS same sign" : Math.abs(t) > 2 ? "✗ IS only (flips/fades OOS)" : "✗"}`);
  }
}
console.log(`\nREAD: "spread" = mean forward return after a top-decile reading MINUS after a bottom-decile reading.`);
console.log(`A signal only counts if |t|>2 in BOTH halves AND the sign is the same — the D-155 disambiguation that`);
console.log(`caught the calm-VIX artifact. Goyal-Welch predicts the macro family (breadth/credit/curve) fails.`);
