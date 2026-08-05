#!/usr/bin/env -S deno run --allow-net
// trd-vrp — measure the Volatility Risk Premium (the real edge under covered-calls / put-writing / the
// "wheel"). VRP = implied vol (VIX) − the realised vol that actually shows up over the next month. If VRP
// is persistently positive, option SELLERS (covered calls, cash-secured puts) get paid for bearing risk —
// a structural premium, not a front-run chart pattern. Also approximates a covered-call vs buy&hold on SPY.
// Free Yahoo daily (SPY + ^VIX).

async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 9000 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const spy = await daily("SPY"); const vixM = await daily("^VIX");
const dates = [...spy.keys()].filter((d) => vixM.has(d)).sort();
const px = dates.map((d) => spy.get(d)!); const vix = dates.map((d) => vixM.get(d)!);
const ret = px.map((p, i) => i ? Math.log(p / px[i - 1]) : 0);
const N = dates.length;

// VRP: for each day, implied (VIX) vs realised annualised vol over the NEXT 21 trading days
const vrps: { d: string; implied: number; realized: number; vrp: number; vix: number }[] = [];
for (let i = 21; i < N - 21; i++) {
  const fwd = ret.slice(i + 1, i + 22); if (fwd.length < 21) continue;
  const realized = std(fwd) * Math.sqrt(252) * 100;
  vrps.push({ d: dates[i], implied: vix[i], realized, vrp: vix[i] - realized, vix: vix[i] });
}
const v = vrps.map((x) => x.vrp);
console.log(`Volatility Risk Premium — SPY vs ^VIX, ${vrps.length} days (${vrps[0].d} → ${vrps[vrps.length - 1].d})\n`);
console.log(`  mean VRP (implied − realised):   ${mean(v) >= 0 ? "+" : ""}${mean(v).toFixed(2)} vol points`);
console.log(`  median VRP:                      ${[...v].sort((a, b) => a - b)[v.length >> 1].toFixed(2)}`);
console.log(`  % of months VRP was POSITIVE:    ${(v.filter((x) => x > 0).length / v.length * 100).toFixed(0)}%   (seller wins when positive)`);
console.log(`  mean implied ${mean(vrps.map((x) => x.implied)).toFixed(1)}  vs  mean realised ${mean(vrps.map((x) => x.realized)).toFixed(1)}\n`);
// VRP by VIX regime — the premium is richest AND riskiest in stress
for (const [lbl, lo, hi] of [["calm VIX<15", 0, 15], ["normal 15-25", 15, 25], ["stress >25", 25, 999]] as [string, number, number][]) {
  const sub = vrps.filter((x) => x.vix >= lo && x.vix < hi).map((x) => x.vrp);
  if (sub.length) console.log(`  VRP in ${lbl.padEnd(14)}: mean ${mean(sub) >= 0 ? "+" : ""}${mean(sub).toFixed(2)}  (%pos ${(sub.filter((x) => x > 0).length / sub.length * 100).toFixed(0)}%, n=${sub.length})`);
}

// ---- rough covered-call vs buy&hold: each month own SPY, sell a ~2%-OTM 1-mo call ----
// ATM premium ≈ 0.4·S·σ·√T (Black-Scholes approx); 2%-OTM ≈ ~55% of ATM. Monthly step = 21 trading days.
let ccEq = 1, bhEq = 1; const ccR: number[] = [], bhR: number[] = [];
for (let i = 0; i + 21 < N; i += 21) {
  const s0 = px[i], s1 = px[i + 21]; const rM = s1 / s0 - 1; const sigMo = (vix[i] / 100) * Math.sqrt(21 / 252);
  const premAtm = 0.4 * sigMo; const prem = premAtm * 0.55; // ~2% OTM
  const capped = Math.min(rM, 0.02);                 // upside capped at the 2% OTM strike
  const cc = capped + prem;                           // covered-call monthly return
  ccEq *= 1 + cc; bhEq *= 1 + rM; ccR.push(cc); bhR.push(rM);
}
const yrs = (N / 252);
const cagr = (eq: number) => Math.pow(eq, 1 / yrs) - 1;
const sharpe = (a: number[]) => mean(a) / std(a) * Math.sqrt(12);
console.log(`\n── Covered-call (2%-OTM, monthly) vs buy&hold SPY, ${yrs.toFixed(0)}y (rough BS approx) ──`);
console.log(`  buy&hold:     CAGR ${(cagr(bhEq) * 100).toFixed(1)}%   monthly Sharpe*√12 ${sharpe(bhR).toFixed(2)}`);
console.log(`  covered-call: CAGR ${(cagr(ccEq) * 100).toFixed(1)}%   monthly Sharpe*√12 ${sharpe(ccR).toFixed(2)}   (income smooths, caps the right tail)`);
console.log(`\nRead: positive VRP = selling vol is structurally +EV (you're paid to insure). Covered calls harvest it but`);
console.log(`CAP UPSIDE and keep full DOWNSIDE — risk-adjusted often ~ buy&hold, total return lower in bulls. Tail: VRP`);
console.log(`crashes (2008/2020) hit sellers hard → the tail engine (D-100) is exactly what sizes/hedges this. Not front-run.`);
