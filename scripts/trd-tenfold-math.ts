#!/usr/bin/env -S deno run --allow-read
// trd-tenfold-math — "trade with $100 and make it tenfold." This computes exactly what that requires, by
// Monte-Carlo on the REAL measured outcome distribution rather than a growth fantasy.
//
// THE MEASURED DISTRIBUTION (D-154, ~11k trades): with a 2×ATR stop and a 3R target,
//   29% of trades hit +3R, 71% stop at −1R  →  expectancy +0.16R per trade before cost.
// The ONLY free variable a trader controls is f = fraction of equity risked per trade. Everything about
// whether $100 → $1,000 is possible is decided by f, and f also decides the probability of ruin.
//
// We simulate the full path: 10,000 accounts per setting, trade by trade, compounding, until the account
// either reaches 10× or falls below a broker-realistic floor. We report P(10x), P(ruin), median trades to
// target, and worst drawdown — the honest trade-off, not a headline.
const WIN_P = 0.29, WIN_R = 3, LOSS_R = 1;
const COST_R = 0.056;                    // measured round-trip cost in R (Corwin-Schultz, liquid US equity)
const RUIN_FLOOR = 0.20;                 // below 20% of start you are done: too small to size, psychologically over
let seed = 20260806; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface Res { f: number; pTen: number; pRuin: number; medTrades: number; medDD: number; medEnd: number }
function simulate(f: number, maxTrades = 20000, paths = 10000): Res {
  let ten = 0, ruin = 0; const tradesToTen: number[] = []; const dds: number[] = []; const ends: number[] = [];
  for (let p = 0; p < paths; p++) {
    let eq = 1, peak = 1, maxDD = 0, t = 0, done = false;
    for (; t < maxTrades; t++) {
      const r = (rnd() < WIN_P ? WIN_R : -LOSS_R) - COST_R;
      eq *= (1 + f * r);
      if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd;
      if (eq >= 10) { ten++; tradesToTen.push(t + 1); done = true; break; }
      if (eq <= RUIN_FLOOR) { ruin++; done = true; break; }
    }
    if (!done) ends.push(eq); else ends.push(eq);
    dds.push(maxDD);
  }
  const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { f, pTen: ten / paths * 100, pRuin: ruin / paths * 100, medTrades: med(tradesToTen), medDD: med(dds) * 100, medEnd: med(ends) };
}
console.log(`WHAT DOES 10× ACTUALLY TAKE?  Measured distribution: ${WIN_P * 100}% win at +${WIN_R}R, ${(1 - WIN_P) * 100}% lose −${LOSS_R}R, cost ${COST_R}R/trade`);
console.log(`Expectancy = ${(WIN_P * WIN_R - (1 - WIN_P) * LOSS_R - COST_R).toFixed(3)}R per trade. 10,000 simulated accounts per row.\n`);
console.log(`${"risk/trade".padStart(11)} ${"P(10x)".padStart(8)} ${"P(ruin)".padStart(8)} ${"trades to 10x".padStart(14)} ${"median maxDD".padStart(13)} ${"verdict"}`);
const rows: Res[] = [];
for (const f of [0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.25, 0.33, 0.50]) {
  const r = simulate(f); rows.push(r);
  const verdict = r.pRuin > 50 ? "RUIN more likely than 10x" : r.pTen > r.pRuin ? (r.pTen > 60 ? "favourable" : "coin-flip-ish") : "ruin outweighs reward";
  console.log(`${(r.f * 100).toFixed(1).padStart(10)}% ${r.pTen.toFixed(1).padStart(7)}% ${r.pRuin.toFixed(1).padStart(7)}% ${(Number.isFinite(r.medTrades) ? String(Math.round(r.medTrades)) : "—").padStart(14)} ${r.medDD.toFixed(0).padStart(12)}% ${verdict}`);
}
// the growth-optimal (Kelly) fraction for this distribution
let bestF = 0, bestG = -1;
for (let f = 0.005; f <= 0.6; f += 0.005) {
  const g = WIN_P * Math.log(1 + f * (WIN_R - COST_R)) + (1 - WIN_P) * Math.log(1 - f * (LOSS_R + COST_R));
  if (Number.isFinite(g) && g > bestG) { bestG = g; bestF = f; }
}
console.log(`\n══ THE MATHEMATICAL CEILING ══`);
console.log(`   Growth-optimal (full Kelly) risk per trade: ${(bestF * 100).toFixed(1)}%  → log-growth ${bestG.toFixed(5)} per trade`);
console.log(`   Trades to 10× at full Kelly: ~${Math.round(Math.log(10) / bestG)}   |  at HALF Kelly (${(bestF / 2 * 100).toFixed(1)}%): ~${Math.round(Math.log(10) / (WIN_P * Math.log(1 + bestF / 2 * (WIN_R - COST_R)) + (1 - WIN_P) * Math.log(1 - bestF / 2 * (LOSS_R + COST_R))))}`);
console.log(`   At the SAFE 0.5% risk this engine ships: ~${Math.round(Math.log(10) / (WIN_P * Math.log(1 + 0.005 * (WIN_R - COST_R)) + (1 - WIN_P) * Math.log(1 - 0.005 * (LOSS_R + COST_R))))} trades`);
console.log(`\n══ WHAT THIS MEANS FOR A $100 ACCOUNT ══`);
const t25 = rows.find((r) => r.f === 0.25)!, t05 = rows.find((r) => r.f === 0.005)!;
console.log(`   Risking 0.5%/trade: P(10x)=${t05.pTen.toFixed(1)}%, P(ruin)=${t05.pRuin.toFixed(1)}% — safe, but needs ~${Math.round(Math.log(10) / (WIN_P * Math.log(1 + 0.005 * (WIN_R - COST_R)) + (1 - WIN_P) * Math.log(1 - 0.005 * (LOSS_R + COST_R))))} trades.`);
console.log(`   Risking 25%/trade:  P(10x)=${t25.pTen.toFixed(1)}%, P(ruin)=${t25.pRuin.toFixed(1)}% — fast, and mostly fatal.`);
console.log(`\n   The trade-off is NOT a matter of skill or platform. It is arithmetic: at a ${(WIN_P * WIN_R - (1 - WIN_P) * LOSS_R - COST_R).toFixed(2)}R edge,`);
console.log(`   speed to 10× and survival are the SAME dial turned in opposite directions. Anyone promising both is lying.`);
console.log(`   The only honest lever that moves BOTH: a bigger EDGE (higher win rate or better R:R) — or more trades per year.`);
