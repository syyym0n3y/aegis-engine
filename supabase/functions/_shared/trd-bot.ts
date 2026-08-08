// trd-bot.ts — the systematic BOT BRAIN. Its edge is NOT prediction (no signal survives
// honest testing) — it is the four things that ARE real and that almost no retail bot does:
//   1. ADAPTIVE ALLOCATION — measure each setup LIVE, concentrate capital on what's working,
//      cut the dead. The bot gets better by honest measurement, not by a better crystal ball.
//   2. OPTIMAL SIZING — vol-scaled fractional-Kelly, scaled to a portfolio vol target.
//   3. DIVERSIFICATION — inverse-vol / correlation-aware weighting of uncorrelated setups.
//   4. DISCIPLINE — every order routed through the risk firewall; 0% behavioural leakage.
// It runs ANY candidate setup pool (FVG, sweeps, momentum, the trader's own EA signals).
// PURE, deterministic. It PROPOSES firewall-checked orders; a paper bridge executes.

import { evaluateOrder, FirewallDecision, ProposedOrder, RiskPolicy } from "./trd-firewall.ts";

export interface SetupState {
  key: string; // e.g. "fvg:EURUSD:15m"
  corrGroup?: string; // for correlation-aware allocation
  rHistory: number[]; // realized R-multiples of this setup's closed trades (live)
}
export interface BotConfig {
  portfolioTargetVolAnnual: number; // e.g. 0.12
  maxRiskPerTradeFrac: number; // hard clamp per order (before firewall)
  minTradesToTrust: number; // below this, the setup is size-throttled (unproven)
  tradesPerYear: number; // for annualizing
  kellyFraction: number; // fraction of full Kelly to use (0.5 = half-Kelly)
}
export const DEFAULT_BOT: BotConfig = { portfolioTargetVolAnnual: 0.12, maxRiskPerTradeFrac: 0.01, minTradesToTrust: 30, tradesPerYear: 500, kellyFraction: 0.5 };

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); }

export interface SetupMetrics {
  key: string; trades: number; expectancyR: number; winRate: number; volR: number;
  /** live confidence 0..1 = how much of the min-sample we have */
  confidence: number;
  /** allocation weight 0..1 across the pool (0 = benched: losing or unproven-losing) */
  weight: number;
}

/**
 * ALLOCATE — the adaptive core. Weight ∝ (positive live expectancy) × (confidence) ÷ (its
 * volatility) — concentrate on the setups that are actually working, throttle the unproven,
 * bench the losers (weight 0). Normalized across the pool. This is how the bot "gets better."
 */
export function allocate(setups: SetupState[], cfg: BotConfig = DEFAULT_BOT): SetupMetrics[] {
  const raw = setups.map((s) => {
    const trades = s.rHistory.length;
    const exp = mean(s.rHistory); // expectancy in R
    const vol = std(s.rHistory) || 1;
    const wins = s.rHistory.filter((r) => r > 0).length;
    const confidence = Math.min(1, trades / cfg.minTradesToTrust);
    // only positive-expectancy setups get capital; scale by confidence, tilt by inverse-vol
    const rawWeight = exp > 0 ? (exp * confidence) / vol : 0;
    return { key: s.key, trades, expectancyR: exp, winRate: trades ? wins / trades : 0, volR: vol, confidence, rawWeight };
  });
  const total = raw.reduce((a, b) => a + b.rawWeight, 0);
  return raw.map((r) => ({ key: r.key, trades: r.trades, expectancyR: r.expectancyR, winRate: r.winRate, volR: r.volR, confidence: r.confidence, weight: total > 0 ? r.rawWeight / total : 0 }));
}

/**
 * SIZE — for one setup about to fire, turn its allocation weight + edge into a risk-per-trade
 * fraction: fractional-Kelly on the setup's own edge, scaled by its portfolio weight and by the
 * account-vs-target vol ratio, clamped, then handed to the FIREWALL for the final say.
 */
export function proposeOrder(
  setup: { key: string; side: "long" | "short"; symbol: string; corrGroup?: string; hasStopLoss: boolean; hasTakeProfit: boolean; leverage?: number },
  metrics: SetupMetrics,
  accountRealizedVolAnnual: number,
  cfg: BotConfig = DEFAULT_BOT,
): ProposedOrder {
  // Kelly on this setup's edge (R-based): f* ≈ expectancy / variance; use fractional-Kelly.
  const kelly = metrics.volR > 0 ? metrics.expectancyR / (metrics.volR * metrics.volR) : 0;
  const baseFrac = Math.max(0, kelly) * cfg.kellyFraction;
  // scale to portfolio vol target (cut size when the account is running hot)
  const volScale = accountRealizedVolAnnual > 0 ? Math.min(1.5, cfg.portfolioTargetVolAnnual / accountRealizedVolAnnual) : 1;
  const riskFrac = Math.min(cfg.maxRiskPerTradeFrac, baseFrac * metrics.weight * volScale * metrics.confidence);
  return { symbol: setup.symbol, side: setup.side, riskFrac, hasStopLoss: setup.hasStopLoss, hasTakeProfit: setup.hasTakeProfit, correlationGroup: setup.corrGroup, leverage: setup.leverage };
}

export interface BotDecision { setup: string; order: ProposedOrder; firewall: FirewallDecision; }

/** Full step: allocate over the pool, size this setup's order, and gate it through the
 * firewall — the bot never bypasses risk. Returns the final, risk-approved order (or block). */
export function botStep(
  firing: { key: string; side: "long" | "short"; symbol: string; corrGroup?: string; hasStopLoss: boolean; hasTakeProfit: boolean; leverage?: number },
  pool: SetupState[],
  accountRealizedVolAnnual: number,
  // deno-lint-ignore no-explicit-any
  accountState: any,
  cfg: BotConfig = DEFAULT_BOT,
  policy?: RiskPolicy,
): BotDecision {
  const metrics = allocate(pool, cfg);
  const m = metrics.find((x) => x.key === firing.key) ?? { key: firing.key, trades: 0, expectancyR: 0, winRate: 0, volR: 1, confidence: 0, weight: 0 };
  const order = proposeOrder(firing, m, accountRealizedVolAnnual, cfg);
  const firewall = evaluateOrder(order, accountState, policy);
  return { setup: firing.key, order, firewall };
}
