// trd-firewall.ts — the RISK FIREWALL: sits between ANY bot/EA (or a manual trader) and
// the broker and decides, per proposed order, ALLOW / RESIZE / BLOCK — enforcing the
// "when you can trade and when you can't" rules + mandatory stop + correct size. It does
// NOT generate signals; it wraps the trader's own system with risk discipline. This is
// the vertical-integration product: keep the strategy they know, make it survivable.
// PURE, deterministic, no order routing here (a broker bridge calls this, paper-first).

export interface ProposedOrder {
  symbol: string;
  side: "long" | "short";
  /** intended risk as a fraction of equity (from the bot's size × stop distance). */
  riskFrac: number;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  correlationGroup?: string; // e.g. "USD", "index", "gold" — for correlated-exposure cap
  leverage?: number;
}

export interface AccountState {
  equity: number;
  peakEquity: number;
  dayPnLFrac: number; // today's P&L as a fraction of equity (negative = down)
  tradesToday: number;
  consecutiveLosses: number;
  openCorrelatedRiskFrac: Record<string, number>; // group -> summed open risk
  openPositions: number;
  minutesSinceLastLoss: number;
  nowUtcHour: number; // 0..23, for no-trade windows
}

export interface RiskPolicy {
  maxRiskPerTradeFrac: number; // e.g. 0.01 (1%)
  maxDailyLossFrac: number; // e.g. 0.03 — kill-switch for the day
  maxDrawdownFrac: number; // e.g. 0.20 — halt if account below this from peak
  maxConcurrentPositions: number;
  maxCorrelatedRiskFrac: number; // cap summed risk per correlation group
  maxTradesPerDay: number;
  cooldownAfterLosses: number; // pause after N consecutive losses
  cooldownMinutes: number;
  requireStopLoss: boolean;
  maxLeverage: number;
  noTradeHoursUtc: number[]; // hours to block (news/thin-liquidity windows)
}

export const DEFAULT_POLICY: RiskPolicy = {
  maxRiskPerTradeFrac: 0.01, maxDailyLossFrac: 0.03, maxDrawdownFrac: 0.20,
  maxConcurrentPositions: 3, maxCorrelatedRiskFrac: 0.02, maxTradesPerDay: 5,
  cooldownAfterLosses: 3, cooldownMinutes: 60, requireStopLoss: true, maxLeverage: 10,
  noTradeHoursUtc: [],
};

export interface FirewallDecision {
  decision: "ALLOW" | "RESIZE" | "BLOCK";
  approvedRiskFrac: number; // 0 if blocked
  reasons: string[]; // every rule that fired (esp. the blocking one)
  /** the single trader-facing message */
  message: string;
}

/** Evaluate a proposed order against the account state + policy. Blocks trump resizes;
 * the first hard block wins the verdict, but all reasons are reported for transparency. */
export function evaluateOrder(o: ProposedOrder, s: AccountState, p: RiskPolicy = DEFAULT_POLICY): FirewallDecision {
  const reasons: string[] = [];
  const block = (msg: string): FirewallDecision => { reasons.unshift(msg); return { decision: "BLOCK", approvedRiskFrac: 0, reasons, message: msg }; };

  // --- hard blocks: "you cannot trade right now" ---
  if (s.dayPnLFrac <= -p.maxDailyLossFrac) return block(`Daily loss limit hit (${(s.dayPnLFrac * 100).toFixed(1)}% ≤ -${(p.maxDailyLossFrac * 100).toFixed(0)}%). You're done for the day — come back tomorrow.`);
  const dd = s.peakEquity > 0 ? (s.peakEquity - s.equity) / s.peakEquity : 0;
  if (dd >= p.maxDrawdownFrac) return block(`Account is ${(dd * 100).toFixed(0)}% below its peak (limit ${(p.maxDrawdownFrac * 100).toFixed(0)}%). Trading halted until you review, not revenge-trade.`);
  if (s.consecutiveLosses >= p.cooldownAfterLosses && s.minutesSinceLastLoss < p.cooldownMinutes) return block(`${s.consecutiveLosses} losses in a row — ${p.cooldownMinutes}-minute cooldown (anti-tilt). ${Math.ceil(p.cooldownMinutes - s.minutesSinceLastLoss)} min left.`);
  if (s.tradesToday >= p.maxTradesPerDay) return block(`Max ${p.maxTradesPerDay} trades/day reached. Overtrading is how edges get eaten by costs.`);
  if (p.noTradeHoursUtc.includes(s.nowUtcHour)) return block(`No-trade window (${s.nowUtcHour}:00 UTC) — thin liquidity / scheduled risk. Wait for it to pass.`);
  if (p.requireStopLoss && !o.hasStopLoss) return block(`No stop-loss attached. A trade without a stop is an unbounded loss — blocked.`);
  if (s.openPositions >= p.maxConcurrentPositions) return block(`Already at max ${p.maxConcurrentPositions} open positions. Concentration risk — close one first.`);

  // --- soft: resize down to policy ---
  let approved = o.riskFrac;
  if (approved > p.maxRiskPerTradeFrac) { reasons.push(`Risk ${(o.riskFrac * 100).toFixed(1)}% > cap ${(p.maxRiskPerTradeFrac * 100).toFixed(1)}% — resized down.`); approved = p.maxRiskPerTradeFrac; }
  if (o.correlationGroup) {
    const already = s.openCorrelatedRiskFrac[o.correlationGroup] ?? 0;
    const room = Math.max(0, p.maxCorrelatedRiskFrac - already);
    if (already + approved > p.maxCorrelatedRiskFrac) {
      if (room <= 0) return block(`Already at the correlated-exposure cap for "${o.correlationGroup}" (${(p.maxCorrelatedRiskFrac * 100).toFixed(0)}%). These are the same bet — no more.`);
      reasons.push(`Correlated cap for "${o.correlationGroup}" — resized to ${(room * 100).toFixed(1)}%.`); approved = room;
    }
  }
  if (o.leverage && o.leverage > p.maxLeverage) return block(`Leverage ${o.leverage}× exceeds cap ${p.maxLeverage}× — one gap and you're liquidated. Blocked.`);
  if (!o.hasTakeProfit) reasons.push(`No take-profit set — allowed, but define your exit or a winner can round-trip to a loss.`);

  const resized = approved < o.riskFrac;
  return {
    decision: resized ? "RESIZE" : "ALLOW",
    approvedRiskFrac: approved,
    reasons,
    message: resized ? `Approved at ${(approved * 100).toFixed(2)}% risk (resized from ${(o.riskFrac * 100).toFixed(2)}%). ${reasons[0] ?? ""}` : `Approved at ${(approved * 100).toFixed(2)}% risk — within policy.`,
  };
}
