// trd-scale.ts — capital scaling: what a trader can actually do at ANY deposit, from the minimum viable to
// institutional size (pure, tested). The operator's framing is correct and this makes it precise:
//   as equity rises, what scales is (a) the NUMBER of concurrent positions and (b) LOT SIZE — but BOTH are
//   capped, and below a certain deposit the edge is eaten by fixed costs before it can compound.
//
// THE THREE BINDING CONSTRAINTS (each measured, not assumed):
//   1. COST FLOOR (small accounts).  Expectancy is +0.16R per trade (29% win rate × 3R target − 71% × 1R,
//      D-154). Round-trip cost expressed in R = cost$ / risk$. If cost-in-R ≥ 0.16R the edge is GONE.
//      This yields a hard MINIMUM VIABLE DEPOSIT per instrument — arithmetic, not opinion.
//   2. CORRELATION CEILING (mid accounts). Heat budget 6% ÷ risk-per-trade gives a raw position count, but a
//      45-instrument book is only ~2.6 EFFECTIVE bets (D-154) — adding correlated names adds risk, not breadth.
//   3. LIQUIDITY CEILING (large accounts). Position notional above ~1% of average daily volume starts moving
//      the market against you; that caps lot size regardless of how much capital you have.
export const EXPECTANCY_R = 0.16;      // measured: 0.29×3 − 0.71 (D-154 TP/SL grid)
export const WIN_RATE = 0.29, RR = 3;
export const MAX_HEAT = 0.06, BASE_RISK = 0.005, HOUSE_RISK = 0.02, MAX_RISK_PER_TRADE = 0.02;
export const EFFECTIVE_BETS = 2.6;     // measured across a 45-instrument book (D-154)
export const ADV_CAP = 0.01;           // max position as a share of average daily volume

export interface ScaleInput {
  price: number; stopPct: number; advShares: number;
  minLot: number;              // 1 share, 0.0001 for fractional/crypto, contract size for futures
  costPerTradeUsd: number;     // round-trip fixed cost (commission)
  spreadPct: number;           // round-trip spread as % of notional
  equity: number; deposit: number;
}
export interface Tier {
  equity: number; riskPerTrade: number; riskPct: number;
  lot: number; notional: number; positions: number;
  costInR: number; edgeAfterCostR: number; viable: boolean;
  bindingConstraint: string; expectedAnnualPct: number | null;
}
/** cost of one round trip, in R units (fraction of the amount risked) */
export function costInR(riskUsd: number, notional: number, costUsd: number, spreadPct: number): number {
  if (!(riskUsd > 0)) return Infinity;
  return (costUsd + notional * spreadPct / 100) / riskUsd;
}
/** Risk budget under the house-money rule, capped per-trade. */
export function riskBudget(equity: number, deposit: number, deRisk = 1): number {
  const banked = Math.max(0, equity - deposit);
  return Math.min((deposit * BASE_RISK + banked * HOUSE_RISK) * deRisk, equity * MAX_RISK_PER_TRADE);
}
export function evaluate(inp: ScaleInput, tradesPerYearPerPosition = 25): Tier {
  const risk = riskBudget(inp.equity, inp.deposit);
  const stopDist = inp.price * inp.stopPct / 100;
  const rawLot = stopDist > 0 ? risk / stopDist : 0;
  // round DOWN to a tradable lot
  const lot = inp.minLot > 0 ? Math.floor(rawLot / inp.minLot) * inp.minLot : rawLot;
  const notional = lot * inp.price;
  const actualRisk = lot * stopDist;
  const cR = costInR(actualRisk, notional, inp.costPerTradeUsd, inp.spreadPct);
  const edgeAfter = EXPECTANCY_R - cR;
  // concurrent positions: heat budget ÷ risk, but capped by effective breadth
  const rawPositions = risk > 0 ? Math.floor(inp.equity * MAX_HEAT / risk) : 0;
  const positions = Math.max(0, Math.min(rawPositions, Math.round(EFFECTIVE_BETS * 4))); // ~10 named positions ≈ 2.6 real bets
  // liquidity ceiling
  const advNotional = inp.advShares * inp.price;
  const liqCapLot = advNotional > 0 ? (advNotional * ADV_CAP) / inp.price : Infinity;
  let binding = "risk budget";
  if (lot < inp.minLot || lot <= 0) binding = "MINIMUM LOT — deposit too small to take this trade at all";
  else if (edgeAfter <= 0) binding = "COST FLOOR — fixed costs exceed the measured edge";
  else if (lot > liqCapLot) binding = "LIQUIDITY — position exceeds 1% of average daily volume";
  else if (rawPositions > positions) binding = "CORRELATION — heat allows more positions than there is real breadth";
  const viable = lot >= inp.minLot && lot > 0 && edgeAfter > 0;
  // expected annual %: positions × trades/yr × expectancy(after cost) × risk%, all of equity
  const expAnnual = viable ? positions * tradesPerYearPerPosition * edgeAfter * (actualRisk / inp.equity) * 100 : null;
  return {
    equity: inp.equity, riskPerTrade: +actualRisk.toFixed(2), riskPct: +(actualRisk / inp.equity * 100).toFixed(3),
    lot: +lot.toFixed(6), notional: +notional.toFixed(2), positions,
    costInR: Number.isFinite(cR) ? +cR.toFixed(3) : 999, edgeAfterCostR: Number.isFinite(edgeAfter) ? +edgeAfter.toFixed(3) : -999, viable,
    bindingConstraint: binding, expectedAnnualPct: expAnnual != null ? +expAnnual.toFixed(2) : null,
  };
}
/** Smallest deposit at which this instrument is tradable AND the edge survives costs. */
export function minViableDeposit(inp: Omit<ScaleInput, "equity" | "deposit">, hi = 1_000_000): number | null {
  let lo = 10;
  if (evaluate({ ...inp, equity: hi, deposit: hi }).viable === false) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate({ ...inp, equity: mid, deposit: mid }).viable) hi = mid; else lo = mid;
  }
  return Math.ceil(hi);
}
