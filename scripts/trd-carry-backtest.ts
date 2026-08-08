#!/usr/bin/env -S deno run --allow-net
// trd-carry-backtest — the honest "make money with reasonable R:R" candidate: DELTA-NEUTRAL crypto
// funding carry. Own spot, short the perpetual → you collect funding every 8h (leveraged longs overpay
// to be long, so funding is structurally positive). Price risk ≈ 0 (delta-neutral), so this is a real
// YIELD, not a directional bet — the opposite of itzjblair's 23× lottery. Free Binance funding history.
// Reports annualized yield, Sharpe, worst drawdown, and % of periods where funding flipped negative.

// A delta-neutral carry book is set up ONCE and held — you don't pay spread every 8h. Realistic ongoing
// cost is tiny (occasional delta rebalance + roll). Report GROSS carry as the headline, then net a small,
// honest ongoing cost (~2.2%/yr) so the number isn't rosy.
const COST_PER_PERIOD = 0.00002; // ~2.2%/yr amortized on the neutral book (not per-trade spread)

async function funding(sym: string): Promise<{ t: number; r: number }[]> {
  const out: { t: number; r: number }[] = []; let endTime = Date.now();
  for (let p = 0; p < 8; p++) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    for (const x of k) out.push({ t: x.fundingTime, r: +x.fundingRate });
    endTime = k[0].fundingTime - 1; if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const u = out.filter((x) => !seen.has(x.t) && seen.add(x.t));
  return u.sort((a, b) => a.t - b.t);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const PERY = 3 * 365; // funding periods per year (every 8h)
for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
  const f = await funding(sym);
  if (f.length < 100) { console.log(`${sym}: too little funding history (${f.length})`); continue; }
  // short-perp carry per period = +fundingRate − cost (delta-neutral: spot leg cancels price P&L)
  const grossYield = mean(f.map((x) => x.r)) * PERY;                 // pure funding carry, no cost
  const carry = f.map((x) => x.r - COST_PER_PERIOD);                  // net of a small ongoing cost
  const annYield = mean(carry) * PERY;
  const sharpe = std(carry) > 0 ? mean(carry) / std(carry) * Math.sqrt(PERY) : 0;
  // equity curve + worst drawdown of the neutral book
  let eq = 1, peak = 1, maxDD = 0; for (const c of carry) { eq *= (1 + c); if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
  const negPct = f.filter((x) => x.r < 0).length / f.length * 100;
  const first = new Date(f[0].t).toISOString().slice(0, 10), last = new Date(f[f.length - 1].t).toISOString().slice(0, 10);
  console.log(`\n════ ${sym} — delta-neutral funding carry (${f.length} periods, ${first}→${last}) ════`);
  console.log(`  GROSS annualized carry:            ${(grossYield * 100).toFixed(1)}%`);
  console.log(`  net of ~2.2%/yr ongoing cost:      ${(annYield * 100).toFixed(1)}%`);
  console.log(`  Sharpe (of the neutral carry):     ${sharpe.toFixed(2)}`);
  console.log(`  worst drawdown of the book:        ${(maxDD * 100).toFixed(2)}%`);
  console.log(`  periods funding was NEGATIVE:      ${negPct.toFixed(0)}%   (you pay instead of receive)`);
  console.log(`  → at 3× leverage this is ~${(annYield * 300).toFixed(0)}% /yr with ~${(maxDD * 300).toFixed(0)}% worst DD (if funding regime holds).`);
}
console.log(`\nHONEST caveats: real risk is (1) funding regime flipping negative for a stretch, (2) basis/liquidation on the`);
console.log(`short leg if under-collateralized, (3) exchange/counterparty risk. NONE is price direction — that's the point.`);
console.log(`This is a REAL premium (leveraged longs overpay), not a chart pattern → not front-run to zero. Reasonable R:R.`);
