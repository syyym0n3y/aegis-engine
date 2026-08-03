// trd-uplift.ts — proves the tool's UPSIDE by replaying a trader's OWN trades two ways:
//   ACTUAL  — exactly as they traded (their sizing + behaviour, baked into the P&L).
//   MANAGED — same trade sequence (identical entries), but with the risk overlay ENFORCED:
//             fixed-fractional (half-Kelly) sizing, a hard per-trade stop, and a
//             drawdown kill-switch that halts trading when the account is bleeding —
//             i.e. it removes the trader-behaviour risk (tilt, revenge, size-creep).
// The tool changes NOTHING about what/when they entered. It only changes how much and
// when they were forced to stop. The gap between the two curves IS the tool's value.
// Honest by construction: if the edge is negative, MANAGED just bleeds slower; if it is
// real, MANAGED survives and compounds where ACTUAL blew up.

import { NormalizedAccount } from "./trd-normalize.ts";

export interface PathStats {
  finalMult: number; // ending equity as a multiple of start
  maxDDpct: number;
  ruined: boolean; // ever lost >= 50%
  ruinAtTrade: number | null;
  tradesTaken: number; // MANAGED may skip trades (kill-switch)
}
export interface UpliftResult {
  actual: PathStats;
  managed: PathStats;
  targetRiskFrac: number;
  savedDrawdownPts: number; // maxDD reduction
  capitalMultiplier: number; // managed final / actual final
  ruinAvoided: boolean;
  tradesSkipped: number; // discipline: trades the kill-switch stopped you taking
  note: string;
}

function pathStats(returns: number[]): PathStats {
  let eq = 1, peak = 1, maxDD = 0, ruinAt: number | null = null;
  for (let i = 0; i < returns.length; i++) {
    eq *= 1 + returns[i];
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    if (ruinAt === null && eq <= 0.5) ruinAt = i + 1;
    if (eq <= 0.01) break;
  }
  return { finalMult: eq, maxDDpct: maxDD * 100, ruined: ruinAt !== null, ruinAtTrade: ruinAt, tradesTaken: returns.length };
}

/**
 * @param opts.stopR       hard per-trade stop, in R (default 1.2 — no loss worse than 1.2×avg).
 * @param opts.killDDpct   halt trading once drawdown from peak hits this (default 18%),
 *                         resume only after recovering halfway back — the anti-tilt switch.
 */
export function simulateUplift(
  acct: NormalizedAccount,
  opts: { targetRiskFrac?: number; stopR?: number; killDDpct?: number } = {},
): UpliftResult {
  const losses = acct.trades.filter((t) => t.pnl < 0);
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b.pnl, 0) / losses.length) : 0;
  // express each trade as an R-multiple (avg loss = 1R); no avg loss ⇒ nothing to manage
  const R = avgLoss > 0 ? acct.trades.map((t) => t.pnl / avgLoss) : acct.trades.map(() => 0);

  // sizing: half-Kelly from the account's own edge, capped to a sane 2% floor..25% ceiling
  const p = acct.winRate, b = acct.winLossRatio === Infinity ? 5 : acct.winLossRatio;
  const kelly = b > 0 ? (p * b - (1 - p)) / b : -1;
  const targetRiskFrac = opts.targetRiskFrac ?? Math.min(0.25, Math.max(0, kelly / 2));
  const stopR = opts.stopR ?? 1.2;
  const killDD = (opts.killDDpct ?? 18) / 100;

  // ACTUAL: their real per-trade returns
  const actual = pathStats(acct.returns);

  // MANAGED: identical entries; enforce stop + fixed-fractional size + kill-switch
  const managedR: number[] = [];
  let eq = 1, peak = 1, halted = false, skipped = 0;
  for (let i = 0; i < R.length; i++) {
    // kill-switch: once deep in drawdown, stop; resume only after recovering halfway
    const dd = (peak - eq) / peak;
    if (!halted && dd >= killDD) halted = true;
    if (halted && eq >= peak * (1 - killDD / 2)) halted = false;
    if (halted) { skipped++; managedR.push(0); continue; }
    const cappedR = Math.max(-stopR, R[i]); // hard stop: no loss worse than stopR
    const ret = cappedR * targetRiskFrac; // fixed-fractional sizing
    managedR.push(ret);
    eq *= 1 + ret;
    if (eq > peak) peak = eq;
  }
  const managed = pathStats(managedR);

  const capMult = actual.finalMult > 0 ? managed.finalMult / actual.finalMult : Infinity;
  const ruinAvoided = actual.ruined && !managed.ruined;
  const note = targetRiskFrac <= 0
    ? `Your edge is not positive (half-Kelly ≤ 0), so the disciplined answer is to NOT trade this. Risk-managed sits flat at 1.00× while your sizing took you to ${actual.finalMult.toFixed(2)}×. The tool's whole job here is to stop you — and that refusal IS the upside.`
    : actual.ruined && !managed.ruined
    ? `Your sizing hit the ruin line at trade ${actual.ruinAtTrade}. The SAME trades, risk-managed, never breached it — the tool changed no entries, only how much you bet and when you were forced to stop.`
    : managed.finalMult > actual.finalMult
    ? `Same entries, risk-managed: ${managed.finalMult.toFixed(2)}× vs your ${actual.finalMult.toFixed(2)}×, and max drawdown cut from ${actual.maxDDpct.toFixed(0)}% to ${managed.maxDDpct.toFixed(0)}%. The gap is what your own sizing/behaviour cost you.`
    : `Even risk-managed the edge is marginal (${managed.finalMult.toFixed(2)}× vs ${actual.finalMult.toFixed(2)}×, drawdown ${actual.maxDDpct.toFixed(0)}%→${managed.maxDDpct.toFixed(0)}%). No sizing manufactures edge — the honest verdict.`;

  return { actual, managed, targetRiskFrac, savedDrawdownPts: actual.maxDDpct - managed.maxDDpct, capitalMultiplier: capMult, ruinAvoided, tradesSkipped: skipped, note };
}
