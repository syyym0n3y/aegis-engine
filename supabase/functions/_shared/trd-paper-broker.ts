// trd-paper-broker.ts — the PAPER BROKER BRIDGE. A realistic paper-execution state machine:
// takes firewall-approved orders, fills with SLIPPAGE + COMMISSION (so results aren't a
// fantasy), manages open positions with hard SL/TP, marks equity, and maintains exactly the
// AccountState the firewall reads (day P&L, consecutive losses, drawdown, correlated exposure).
// A real MT5/Alpaca-paper connector is a thin adapter over this core. PURE, deterministic.

import { AccountState } from "./trd-firewall.ts";

export interface OpenOrder { setupKey: string; symbol: string; side: "long" | "short"; entry: number; stop: number; target: number; corrGroup?: string; }
export interface Position extends OpenOrder { id: number; fillEntry: number; units: number; riskFrac: number; openTs: string; }
export interface ClosedTrade { setupKey: string; symbol: string; side: "long" | "short"; r: number; pnl: number; reason: "target" | "stop"; openTs: string; closeTs: string; }
export interface PaperAccount {
  startEquity: number; equity: number; peakEquity: number;
  positions: Position[];
  perSetupR: Record<string, number[]>; // live R-history per setup → feeds the allocator
  closed: ClosedTrade[]; equityCurve: number[];
  dayPnL: number; tradesToday: number; consecutiveLosses: number; lastLossBarIdx: number; currentDay: string;
  barIdx: number; nextId: number;
}
export interface BrokerCfg { commissionBps: number; slippageBps: number; barsPerYear: number }
export const DEFAULT_BROKER: BrokerCfg = { commissionBps: 5, slippageBps: 3, barsPerYear: 35040 }; // ~15m crypto

export function newAccount(startEquity: number): PaperAccount {
  return { startEquity, equity: startEquity, peakEquity: startEquity, positions: [], perSetupR: {}, closed: [], equityCurve: [startEquity], dayPnL: 0, tradesToday: 0, consecutiveLosses: 0, lastLossBarIdx: -99999, currentDay: "", barIdx: 0, nextId: 1 };
}

/** Open a firewall-APPROVED order: size so (fillEntry→stop) risks approvedRiskFrac×equity;
 * pay entry slippage (against you) + commission. Returns false if the risk distance is 0. */
export function openPosition(acct: PaperAccount, o: OpenOrder, approvedRiskFrac: number, ts: string, cfg = DEFAULT_BROKER): boolean {
  if (approvedRiskFrac <= 0) return false;
  const dir = o.side === "long" ? 1 : -1;
  const fillEntry = o.entry * (1 + dir * cfg.slippageBps / 1e4); // slippage pays worse on entry
  const riskPerUnit = Math.abs(fillEntry - o.stop);
  if (!(riskPerUnit > 0)) return false;
  const units = (approvedRiskFrac * acct.equity) / riskPerUnit;
  acct.equity -= units * fillEntry * (cfg.commissionBps / 1e4); // entry commission
  acct.positions.push({ ...o, id: acct.nextId++, fillEntry, units, riskFrac: approvedRiskFrac, openTs: ts });
  acct.tradesToday++;
  return true;
}

/** Advance one bar for `symbol`: resolve stops/targets intrabar (stop assumed first if both —
 * conservative), realize P&L with exit slippage/commission, update all firewall-relevant state. */
export function onBar(acct: PaperAccount, symbol: string, bar: { ts: string; high: number; low: number; close: number }, cfg = DEFAULT_BROKER): void {
  acct.barIdx++;
  const day = bar.ts.slice(0, 10);
  if (day !== acct.currentDay) { acct.currentDay = day; acct.dayPnL = 0; acct.tradesToday = 0; }
  const still: Position[] = [];
  for (const p of acct.positions) {
    if (p.symbol !== symbol) { still.push(p); continue; }
    const long = p.side === "long";
    let exit: number | null = null, reason: "target" | "stop" | null = null;
    if (long) { if (bar.low <= p.stop) { exit = p.stop; reason = "stop"; } else if (bar.high >= p.target) { exit = p.target; reason = "target"; } }
    else { if (bar.high >= p.stop) { exit = p.stop; reason = "stop"; } else if (bar.low <= p.target) { exit = p.target; reason = "target"; } }
    if (exit === null || reason === null) { still.push(p); continue; }
    // exit slippage: stops slip AGAINST you; targets are limit fills (no adverse slip)
    const dir = long ? 1 : -1;
    const slip = reason === "stop" ? exit * (dir * cfg.slippageBps / 1e4) * -1 : 0; // stop fills worse
    const fillExit = exit + slip;
    const gross = p.units * (fillExit - p.fillEntry) * dir;
    const comm = p.units * Math.abs(fillExit) * (cfg.commissionBps / 1e4);
    const pnl = gross - comm;
    const rDenom = p.units * Math.abs(p.fillEntry - p.stop);
    const r = rDenom > 0 ? pnl / rDenom : 0;
    acct.equity += pnl; acct.dayPnL += pnl / Math.max(1e-9, acct.equity);
    if (acct.equity > acct.peakEquity) acct.peakEquity = acct.equity;
    if (pnl < 0) { acct.consecutiveLosses++; acct.lastLossBarIdx = acct.barIdx; } else acct.consecutiveLosses = 0;
    (acct.perSetupR[p.setupKey] ??= []).push(r);
    acct.closed.push({ setupKey: p.setupKey, symbol: p.symbol, side: p.side, r, pnl, reason, openTs: p.openTs, closeTs: bar.ts });
    acct.equityCurve.push(acct.equity);
  }
  acct.positions = still;
}

/** The exact AccountState the firewall consumes, derived from the live paper account. */
export function toFirewallState(acct: PaperAccount, nowUtcHour: number, minutesPerBar = 15): AccountState {
  const openCorr: Record<string, number> = {};
  for (const p of acct.positions) { const g = p.corrGroup ?? p.symbol; openCorr[g] = (openCorr[g] ?? 0) + p.riskFrac; }
  return {
    equity: acct.equity, peakEquity: acct.peakEquity, dayPnLFrac: acct.dayPnL,
    tradesToday: acct.tradesToday, consecutiveLosses: acct.consecutiveLosses,
    openCorrelatedRiskFrac: openCorr, openPositions: acct.positions.length,
    minutesSinceLastLoss: (acct.barIdx - acct.lastLossBarIdx) * minutesPerBar, nowUtcHour,
  };
}
