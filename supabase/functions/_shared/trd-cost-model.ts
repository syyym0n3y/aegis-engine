// trd-cost-model.ts — mandatory, PESSIMISTIC-BY-DEFAULT trade costs.
//
// DOCTRINE (adversarial-pass fix): paper fills are optimistic and the cost
// model is fitted from a thin tape. So the PRIOR is deliberately conservative:
// a marginal strategy must clear costs that are higher than we expect, not
// lower. Costs are only loosened once REAL micro-live fills (trd_manual_trades)
// measure the true slippage and we fold it back. Until then, assume the worst
// plausible retail execution.

export interface CostParams {
  /** broker commission per share (e.g. $0.005) */
  commissionPerShare: number;
  /** broker per-order minimum commission */
  commissionMin: number;
  /** HALF the bid/ask spread, in basis points — paid on entry AND exit */
  halfSpreadBps: number;
  /** market-impact / queue slippage, in bps — paid on entry AND exit */
  slippageBps: number;
  /** annualized borrow cost for shorts, in bps */
  borrowBpsPerYear: number;
}

/** Pessimistic retail prior. Tighten ONLY with measured micro-live fills. */
export const PESSIMISTIC_DEFAULTS: CostParams = {
  commissionPerShare: 0.005,
  commissionMin: 1.0,
  halfSpreadBps: 5, // 0.05% half-spread → 0.10% round-trip just on spread
  slippageBps: 5, // additional 0.10% round-trip slippage
  borrowBpsPerYear: 50,
};

export interface CostBreakdown {
  commission: number;
  spread: number;
  slippage: number;
  borrow: number;
  total: number;
  /** total cost as a fraction of notional, in basis points */
  totalBps: number;
}

export interface TradeSpec {
  price: number;
  shares: number;
  holdingDays: number;
  isShort?: boolean;
  params?: CostParams;
}

/** Round-trip (entry + exit) cost of a single position. Always >= 0. */
export function roundTripCost(spec: TradeSpec): CostBreakdown {
  const params = spec.params ?? PESSIMISTIC_DEFAULTS;
  const notional = Math.abs(spec.price * spec.shares);
  if (notional <= 0) {
    return { commission: 0, spread: 0, slippage: 0, borrow: 0, total: 0, totalBps: 0 };
  }
  // entry + exit → ×2 on the per-side components
  const commission = 2 * Math.max(params.commissionMin, params.commissionPerShare * Math.abs(spec.shares));
  const spread = 2 * notional * (params.halfSpreadBps / 1e4);
  const slippage = 2 * notional * (params.slippageBps / 1e4);
  const borrow = spec.isShort
    ? notional * (params.borrowBpsPerYear / 1e4) * (Math.max(0, spec.holdingDays) / 365)
    : 0;
  const total = commission + spread + slippage + borrow;
  return { commission, spread, slippage, borrow, total, totalBps: (total / notional) * 1e4 };
}

/** Net P&L after costs. grossPnl is the raw price move × shares. */
export function netPnl(grossPnl: number, spec: TradeSpec): number {
  return grossPnl - roundTripCost(spec).total;
}

/** Apply per-trade round-trip cost as a return drag to a sequence of trade
 * returns, given an average notional per trade. Used to haircut paper results
 * so "paper-profitable" is never read as "has edge". */
export function haircutReturns(tradeReturns: number[], avgCostBps: number): number[] {
  const drag = avgCostBps / 1e4;
  return tradeReturns.map((r) => r - drag);
}
