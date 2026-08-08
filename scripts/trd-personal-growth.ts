#!/usr/bin/env -S deno run
// trd-personal-growth — the operator's question: at what risk-per-trade can a PERSONAL account grow a lot
// WITHOUT blowing up, on the mean-reversion edge (D-111)? Monte-Carlo compounding: 70% win, avg win 0.58R,
// loss 1R (=+0.11R expectancy), across a range of risk-per-trade and trade frequency. Reports median CAGR,
// P(20%+ drawdown), and P(50%+ drawdown = account-threatening). Finds the "grow fast, survive" band.

const P = 0.70, WIN_R = 0.58, LOSS_R = 1.0, YEARS = 5;
let seed = 20260804 >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function sim(riskFrac: number, tradesYr: number) {
  const n = Math.round(tradesYr * YEARS); const cagrs: number[] = []; let dd20 = 0, dd50 = 0;
  for (let s = 0; s < 6000; s++) {
    let eq = 1, peak = 1, maxDD = 0;
    for (let t = 0; t < n; t++) { eq *= 1 + (rnd() < P ? WIN_R : -LOSS_R) * riskFrac; if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; if (eq <= 0.02) break; }
    cagrs.push(Math.pow(Math.max(1e-6, eq), 1 / YEARS) - 1); if (maxDD >= 0.20) dd20++; if (maxDD >= 0.50) dd50++;
  }
  cagrs.sort((a, b) => a - b); const med = cagrs[cagrs.length >> 1];
  return { med, p10: cagrs[Math.floor(cagrs.length * 0.1)], dd20: dd20 / 6000, dd50: dd50 / 6000 };
}
const exp = P * WIN_R - (1 - P) * LOSS_R;
console.log(`Edge: ${P * 100}% win, ${WIN_R}:${LOSS_R} → +${exp.toFixed(3)}R/trade. Compounded ${YEARS}y Monte-Carlo.\n`);
for (const tpy of [100, 200]) {
  console.log(`══ ${tpy} trades/year (broadened universe, favourable-regime only) ══`);
  console.log(`  risk/trade   median CAGR   bad-case(10th) CAGR   P(20%+ DD)   P(50%+ DD = danger)`);
  for (const rf of [0.005, 0.01, 0.02, 0.03, 0.05, 0.08]) {
    const r = sim(rf, tpy);
    console.log(`   ${(rf * 100).toFixed(1)}%         ${(r.med * 100).toFixed(0).padStart(4)}%          ${(r.p10 * 100).toFixed(0).padStart(4)}%              ${(r.dd20 * 100).toFixed(0).padStart(3)}%          ${(r.dd50 * 100).toFixed(0).padStart(3)}%`);
  }
  console.log("");
}
console.log(`Read: the edge is thin per trade (+0.11R) so growth comes from FREQUENCY × compounding, not big bets.`);
console.log(`Above ~3-5% risk/trade the P(50% drawdown) climbs fast — that's the blow-up zone. The "grow a ton safely"`);
console.log(`band is the highest risk where P(50% DD) stays low. This is the honest ceiling of this edge on a personal account.`);
