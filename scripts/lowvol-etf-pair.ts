// lowvol-etf-pair.ts (D-952) — recover part of the IVOL edge at ETF/small-capital scale with a RETAIL-TRADEABLE
// low-vol long-short: LONG SPLV (S&P500 Low Volatility) / SHORT SPHB (S&P500 High Beta). Both are liquid ETFs; SPHB is
// cheap to borrow (~0.3-0.5%/yr), so this is a dollar-neutral low-vol/BAB factor a small account can actually hold —
// unlike the name-level IVOL sleeve (3000 names). D-555 said an ETF wrapper captures ~20% of a long-short; a genuine
// long-SHORT pair (not a long-only USMV tilt) should capture MORE. Fetches full history keyless (Yahoo), builds the
// daily spread net of the SPHB borrow, measures standalone, dumps for the blend. Honest: this is the low-vol/beta
// factor (total-vol), a COUSIN of idiosyncratic-vol IVOL, not identical.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("lowvol-etf-pair", [
  { name: "LONG", def: "SPLV" }, { name: "SHORT", def: "SPHB" }, { name: "BORROW", def: "0.005", note: "annual borrow on the short ETF (~0.3-0.5%/yr for SPHB)" },
  { name: "DUMP", def: "0", note: "1 = write d952-lowvoletf-daily.json for the blend" },
]);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
async function yahoo(sym: string): Promise<Map<string, number>> {
  // period1/period2 (not range=max, which Yahoo silently downgrades to MONTHLY) -> true daily over the full history
  const p1 = Math.floor(Date.parse("2011-05-01T00:00:00Z") / 1000), p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`;
  let js: { chart: { result: { timestamp: number[]; indicators: { quote: { close: number[] }[] } }[] } } | null = null;
  for (let t = 0; t < 6 && !js; t++) { try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); if (r.ok) { js = await r.json(); break; } } catch { /* retry */ } await new Promise((res) => setTimeout(res, 1500)); }
  if (!js) throw new Error(`Yahoo fetch failed for ${sym}`);
  const res = js.chart.result[0]; const ts = res.timestamp, c = res.indicators.quote[0].close; const m = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) if (c[i] != null && c[i] > 0) m.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), c[i]);
  return m;
}
const L = await yahoo(K.LONG); await new Promise((r) => setTimeout(r, 1500)); const H = await yahoo(K.SHORT);
const days = [...L.keys()].filter((d) => H.has(d)).sort();
const borrowD = +K.BORROW / 252;
const series: { d: string; ret: number }[] = [];
for (let i = 1; i < days.length; i++) { const d = days[i], p = days[i - 1];
  const rL = Math.log(L.get(d)! / L.get(p)!), rH = Math.log(H.get(d)! / H.get(p)!);
  series.push({ d, ret: rL - rH - borrowD });                   // long low-vol, short high-beta, net of short borrow
}
const rets = series.map((x) => x.ret);
const mu = mean(rets) * 252, vol = sd(rets) * Math.sqrt(252), sr = mu / (vol || 1), t = tstat(rets);
console.log(`\n==> D-952 LOW-VOL ETF PAIR — long ${K.LONG} / short ${K.SHORT}, ${series.length} days, ${series[0]?.d}..${series[series.length - 1]?.d}`);
console.log(`  standalone: ${(100 * mu).toFixed(1)}%/yr, vol ${(100 * vol).toFixed(1)}%, Sharpe ${sr.toFixed(2)}, t ${t.toFixed(2)} (net of ${(+K.BORROW * 100).toFixed(1)}%/yr borrow)`);
// era split (the low-vol anomaly is regime-sensitive)
const m = Math.floor(rets.length / 2); const e = rets.slice(0, m), l = rets.slice(m);
const srp = (a: number[]) => mean(a) * 252 / (sd(a) * Math.sqrt(252) || 1);
console.log(`  era-split Sharpe: early ${srp(e).toFixed(2)} (t ${tstat(e).toFixed(2)}) / late ${srp(l).toFixed(2)} (t ${tstat(l).toFixed(2)})`);
console.log(`  RETAIL-TRADEABLE: both liquid ETFs, SPHB short is cheap/available — a small account CAN hold this (unlike the 3000-name IVOL sleeve).`);
// BETA-NEUTRAL variant: the naive pair is a short-beta bet. Isolate SPLV's low-vol ALPHA = long SPLV / short beta*SPY.
await new Promise((r) => setTimeout(r, 1500)); const SPY = await yahoo("SPY");
const cd = days.filter((d) => SPY.has(d));
const rSplv: number[] = [], rSpy: number[] = [];
for (let i = 1; i < cd.length; i++) { const d = cd[i], p = cd[i - 1]; if (!L.has(d) || !L.has(p)) continue; rSplv.push(Math.log(L.get(d)! / L.get(p)!)); rSpy.push(Math.log(SPY.get(d)! / SPY.get(p)!)); }
const mS = mean(rSpy), mL = mean(rSplv); let cov = 0, vv = 0; for (let i = 0; i < rSpy.length; i++) { cov += (rSpy[i] - mS) * (rSplv[i] - mL); vv += (rSpy[i] - mS) ** 2; }
const beta = vv > 0 ? cov / vv : 1; const alpha = rSplv.map((r, i) => r - beta * rSpy[i] - +K.BORROW / 252 * beta);  // long SPLV, short beta*SPY, borrow on the SPY short
const aMu = mean(alpha) * 252, aVol = sd(alpha) * Math.sqrt(252), aSr = aMu / (aVol || 1), aT = tstat(alpha);
console.log(`  BETA-NEUTRAL (long ${K.LONG} / short ${beta.toFixed(2)}*SPY, SPLV beta ${beta.toFixed(2)}): ${(100 * aMu).toFixed(1)}%/yr, Sharpe ${aSr.toFixed(2)}, t ${aT.toFixed(2)} — the ISOLATED low-vol ETF alpha`);
if (K.DUMP === "1") { await Deno.writeTextFile(new URL("../data/d952-lowvoletf-daily.json", import.meta.url), JSON.stringify(series)); console.log(`  dumped ${series.length} daily returns -> data/d952-lowvoletf-daily.json`); }
