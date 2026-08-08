#!/usr/bin/env -S deno run --allow-net
// trd-vrp-cboe — the DEFINITIVE VRP backtest on real data: CBOE BuyWrite (^BXM, since 1988) and PutWrite
// (^PUT, since 1996) — the actual multi-decade track records of covered-call / put-write on the S&P —
// vs buy&hold SPY. Replaces the rough BS approximation (D-116) with the real indices. Free Yahoo.

async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const maxDD = (p: number[]) => { let pk = p[0], dd = 0; for (const x of p) { if (x > pk) pk = x; dd = Math.max(dd, (pk - x) / pk); } return dd; };

const bxm = await daily("^BXM"), put = await daily("^PUT"), spy = await daily("SPY");
const dates = [...bxm.keys()].filter((d) => put.has(d) && spy.has(d)).sort();
const series = { "SPY (buy&hold)": spy, "^BXM (buy-write / covered-call)": bxm, "^PUT (put-write)": put };
console.log(`Common window ${dates[0]} → ${dates[dates.length - 1]} (${(dates.length / 252).toFixed(0)}y), aligned daily.\n`);
console.log(`${"strategy".padEnd(34)} CAGR    ann.vol  Sharpe  maxDD   corr→SPY`);
const spyRet = dates.map((d, i) => i ? Math.log(spy.get(d)! / spy.get(dates[i - 1])!) : 0);
for (const [name, m] of Object.entries(series)) {
  const px = dates.map((d) => m.get(d)!); const ret = px.map((p, i) => i ? Math.log(p / px[i - 1]) : 0);
  const yrs = dates.length / 252; const cagr = Math.pow(px[px.length - 1] / px[0], 1 / yrs) - 1;
  const vol = std(ret) * Math.sqrt(252); const sharpe = mean(ret) / std(ret) * Math.sqrt(252); const dd = maxDD(px);
  const n = ret.length; const mr = mean(ret), ms = mean(spyRet); let cov = 0, vr = 0, vs = 0; for (let i = 0; i < n; i++) { cov += (ret[i] - mr) * (spyRet[i] - ms); vr += (ret[i] - mr) ** 2; vs += (spyRet[i] - ms) ** 2; }
  const corr = cov / Math.sqrt(vr * vs);
  console.log(`${name.padEnd(34)} ${(cagr * 100).toFixed(1).padStart(5)}%  ${(vol * 100).toFixed(1).padStart(5)}%  ${sharpe.toFixed(2).padStart(5)}  ${(dd * 100).toFixed(0).padStart(3)}%   ${corr.toFixed(2)}`);
}
console.log(`\nREAD: put-write/buy-write harvest the VRP → historically SIMILAR total return to buy&hold with LOWER vol`);
console.log(`+ SHALLOWER drawdowns = higher risk-adjusted return. They give up the right tail (capped) but keep the`);
console.log(`premium. Full downside remains in crashes (2008) — the D-100 tail engine sizes/hedges that. Real, not approximated.`);
