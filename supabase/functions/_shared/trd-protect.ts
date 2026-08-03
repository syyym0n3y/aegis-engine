// trd-protect.ts — LAYER 2 (PROTECT): the risk X-ray. Makes the invisible risk a
// trader is ALREADY taking visible: probability of ruin, liquidation distance, the
// vol-targeted / Kelly-safe position size, and the true all-in cost. This is the one
// component the whole session validated as durably +EV — risk reduction, not
// prediction. PURE, deterministic (seeded Monte-Carlo). No advice, only arithmetic on
// the trader's own numbers (stays clear of the investment-advice line).

export interface RiskInput {
  equity: number; // account equity
  riskPerTradeFrac: number; // fraction of equity risked per trade (entry→stop)
  winRate: number; // historical hit rate 0..1
  winLossRatio: number; // avg win / avg loss (R multiple)
  leverage?: number; // for liquidation math (1 = unlevered)
  costPerTradeBps?: number; // round-trip cost estimate in bps of notional
  tradesPerYear?: number;
}

export interface RiskReport {
  expectancyR: number; // expected R per trade (the sign that decides everything)
  kellyFraction: number; // growth-optimal risk fraction (cap at half-Kelly in practice)
  overbetRatio: number; // riskPerTrade / (half-Kelly) — >1 means overbetting toward ruin
  probRuin: number; // P(lose 50% of equity) over 1y of trading, Monte-Carlo
  probBigDrawdown: number; // P(hit -30%) over 1y
  liquidationMovePct: number | null; // adverse % move that wipes the position (leverage)
  annualCostDragPct: number; // cost as %/yr of equity given turnover
  verdict: "SURVIVABLE" | "FRAGILE" | "RUIN-LIKELY";
  plainEnglish: string;
}

// seeded PRNG so the Monte-Carlo is reproducible (no Math.random)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function riskXray(inp: RiskInput, seed = 12345): RiskReport {
  const p = Math.max(0, Math.min(1, inp.winRate));
  const b = Math.max(0, inp.winLossRatio);
  const f = Math.max(0, inp.riskPerTradeFrac);
  const expectancyR = p * b - (1 - p); // expected R per trade
  const kelly = b > 0 ? (p * b - (1 - p)) / b : -1; // fraction of equity to risk
  const halfKelly = Math.max(0, kelly / 2);
  const overbet = halfKelly > 0 ? f / halfKelly : Infinity;
  const nPerYear = inp.tradesPerYear ?? 250;

  // Monte-Carlo: simulate 1y of trading, fixed-fractional, measure ruin/DD probs
  const rnd = mulberry32(seed);
  const SIMS = 4000;
  let ruin = 0, bigDD = 0;
  for (let s = 0; s < SIMS; s++) {
    let eq = 1, peak = 1, hitRuin = false, hitDD = false;
    for (let t = 0; t < nPerYear; t++) {
      const win = rnd() < p;
      const pnl = win ? f * b : -f; // R-scaled fractional outcome
      eq *= (1 + pnl);
      if (eq > peak) peak = eq;
      if (eq <= 0.5) hitRuin = true;
      if (eq <= peak * 0.7) hitDD = true;
      if (eq <= 0.01) break;
    }
    if (hitRuin) ruin++;
    if (hitDD) bigDD++;
  }
  const probRuin = ruin / SIMS, probBigDrawdown = bigDD / SIMS;
  const liq = inp.leverage && inp.leverage > 1 ? 100 / inp.leverage : null; // ~% adverse move to wipeout
  const annualCostDragPct = ((inp.costPerTradeBps ?? 0) / 1e4) * nPerYear * 100 * f; // rough: cost × trades × exposure

  // verdict judges RUIN (a 50% loss you can't recover from), not drawdowns (a 30% DD
  // is normal even for a good, sanely-sized book). Overbetting past half-Kelly is the
  // fragility marker; negative edge or high ruin odds is the kill.
  const verdict: RiskReport["verdict"] = expectancyR <= 0 || probRuin > 0.2 ? "RUIN-LIKELY" : overbet > 1.5 || probRuin > 0.05 ? "FRAGILE" : "SURVIVABLE";
  const plainEnglish = expectancyR <= 0
    ? `Your expectancy is ${expectancyR.toFixed(2)}R per trade — NEGATIVE. No position size saves a negative edge; you are paying to play. Ruin is a matter of time.`
    : overbet > 1
    ? `Your edge is real-ish (${expectancyR.toFixed(2)}R) but you are OVERBETTING ${overbet.toFixed(1)}× past half-Kelly. Simulated 1-year probability of losing half your account: ${(probRuin * 100).toFixed(0)}%. Cut risk-per-trade to ${(halfKelly * 100).toFixed(1)}% and the same edge compounds instead of blowing up.`
    : `Sized sanely: ${(probRuin * 100).toFixed(0)}% chance of a 50% loss, ${(probBigDrawdown * 100).toFixed(0)}% chance of a 30% drawdown this year. ${liq ? `At ${inp.leverage}× leverage a ${liq!.toFixed(0)}% adverse move liquidates you. ` : ""}This is survivable — the edge can compound.`;

  return { expectancyR, kellyFraction: kelly, overbetRatio: overbet, probRuin, probBigDrawdown, liquidationMovePct: liq, annualCostDragPct, verdict, plainEnglish };
}
