// trd-session-strategy.ts — the LAYERED day-trader core: a session-anchored
// opening-range-breakout (ORB) backtester with the RISK OVERLAY baked in, scored
// per (session × weekday) so each segment is an honest trial.
//
// FINDER layer: for each trading date+session, compute the opening range (OR) over
// the first `openingRangeMin`. After the OR window, the FIRST break of OR-high (long)
// or OR-low (short) is the entry.
// RISK layer (not optional — it IS the strategy's spine): the stop is the OPPOSITE OR
// extreme (structure-defined, not arbitrary), the target is `targetR` × that risk,
// one trade per session, forced flat at session close. Position size = a fixed
// fraction of equity risked, so per-trade equity return = riskFraction × R_realized.
//
// HONEST GATE HOOK: segmenting by weekday multiplies hypotheses. Every (session,
// weekday, direction) combination is a trial; report trades per segment next to its
// stats so a 9-Tuesday "edge" is visibly n=9. Pure + offline + deterministic.

import { IntradayBar, openingRange, Session, SESSION_WINDOWS } from "./trd-session.ts";
import { maxDrawdown, sharpe } from "./trd-stats.ts";

export type Direction = "breakout" | "fade";

export interface ORBParams {
  session: Session;
  openingRangeMin: number; // OR window length in minutes
  targetR: number; // take-profit at targetR × risk (R multiple)
  riskFraction: number; // equity fraction risked per trade (the sizing overlay)
  direction: Direction; // breakout = trade WITH the break; fade = against it
  weekday?: number; // optional: only take trades on this UTC weekday (0=Sun..6=Sat)
}

export interface Trade {
  dateKey: string;
  session: Session;
  dow: number;
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  exit: number;
  rMultiple: number; // realized reward in units of initial risk
  reason: "target" | "stop" | "session_close";
}

function dayOf(ts: string): string { return ts.slice(0, 10); }
function minsInto(ts: string, session: Session): number {
  const d = new Date(ts), w = SESSION_WINDOWS[session];
  return (d.getUTCHours() - w.openHourUTC) * 60 + d.getUTCMinutes();
}
function inSession(ts: string, session: Session): boolean {
  const h = new Date(ts).getUTCHours(), w = SESSION_WINDOWS[session];
  return h >= w.openHourUTC && h < w.closeHourUTC;
}

/** Group ascending bars by trading date, then simulate one ORB trade per date for
 * the given session. Returns the realized trades (dates with no valid OR or no
 * break produce no trade). */
export function backtestORB(bars: IntradayBar[], p: ORBParams): Trade[] {
  const sorted = [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
  const dates = [...new Set(sorted.filter((b) => inSession(b.ts, p.session)).map((b) => dayOf(b.ts)))];
  const trades: Trade[] = [];

  for (const dateKey of dates) {
    const dow = new Date(dateKey + "T00:00:00Z").getUTCDay();
    if (p.weekday !== undefined && dow !== p.weekday) continue;
    const or = openingRange(sorted, p.session, dateKey, p.openingRangeMin);
    if (!or || !(or.high > or.low)) continue;

    // bars strictly AFTER the OR window, still inside the session, that date
    const after = sorted.filter((b) =>
      dayOf(b.ts) === dateKey && inSession(b.ts, p.session) && minsInto(b.ts, p.session) >= p.openingRangeMin
    );
    if (after.length === 0) continue;

    // find the first OR break
    let entryBar = -1, breakHigh = false;
    for (let i = 0; i < after.length; i++) {
      if (after[i].high > or.high) { entryBar = i; breakHigh = true; break; }
      if (after[i].low < or.low) { entryBar = i; breakHigh = false; break; }
    }
    if (entryBar === -1) continue;

    // breakout trades WITH the break; fade trades AGAINST it
    const longSide = p.direction === "breakout" ? breakHigh : !breakHigh;
    const side: "long" | "short" = longSide ? "long" : "short";
    const entry = breakHigh ? or.high : or.low; // entry at the broken level
    const risk = or.high - or.low; // structure-defined risk = OR width
    const stop = side === "long" ? entry - risk : entry + risk;
    const target = side === "long" ? entry + p.targetR * risk : entry - p.targetR * risk;

    // walk forward from the entry bar to resolve stop / target / session close
    let exit = after[after.length - 1].close, reason: Trade["reason"] = "session_close";
    for (let i = entryBar; i < after.length; i++) {
      const b = after[i];
      if (side === "long") {
        if (b.low <= stop) { exit = stop; reason = "stop"; break; }
        if (b.high >= target) { exit = target; reason = "target"; break; }
      } else {
        if (b.high >= stop) { exit = stop; reason = "stop"; break; }
        if (b.low <= target) { exit = target; reason = "target"; break; }
      }
    }
    const rMultiple = risk > 0 ? (side === "long" ? (exit - entry) : (entry - exit)) / risk : 0;
    trades.push({ dateKey, session: p.session, dow, side, entry, stop, target, exit, rMultiple, reason });
  }
  return trades;
}

export interface ORBStats {
  segment: string; // e.g. "ny|Tue|breakout"
  nTrades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  sharpePerTrade: number;
  maxDrawdownR: number;
  /** per-trade equity returns = riskFraction × R (what the account actually feels). */
  perTradeReturns: number[];
}

/** Reduce trades to honest per-segment stats. sharpePerTrade + N are the pair the
 * gate consumes; a high avgR on nTrades=9 is visibly small-sample. */
export function summariseORB(trades: Trade[], p: ORBParams, segmentLabel: string): ORBStats {
  const rs = trades.map((t) => t.rMultiple);
  const perTradeReturns = rs.map((r) => p.riskFraction * r);
  const wins = rs.filter((r) => r > 0).length;
  return {
    segment: segmentLabel,
    nTrades: rs.length,
    winRate: rs.length ? wins / rs.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    totalR: rs.reduce((a, b) => a + b, 0),
    sharpePerTrade: rs.length >= 2 ? sharpe(rs) : 0,
    maxDrawdownR: maxDrawdown(perTradeReturns),
    perTradeReturns,
  };
}

/** Sweep session × weekday × direction. Returns one ORBStats per segment AND the
 * total trial count (for DSR deflation) — the multiple-testing surface made explicit
 * so a data-mined "Tuesday London" edge is deflated by the whole grid it was picked
 * from, never judged in isolation. */
export function sweepSessions(
  bars: IntradayBar[],
  grid: { sessions: Session[]; weekdays: number[]; directions: Direction[]; openingRangeMin: number; targetR: number; riskFraction: number },
): { stats: ORBStats[]; nTrials: number } {
  const stats: ORBStats[] = [];
  for (const session of grid.sessions) {
    for (const weekday of grid.weekdays) {
      for (const direction of grid.directions) {
        const p: ORBParams = { session, weekday, direction, openingRangeMin: grid.openingRangeMin, targetR: grid.targetR, riskFraction: grid.riskFraction };
        const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        stats.push(summariseORB(backtestORB(bars, p), p, `${session}|${dowNames[weekday]}|${direction}`));
      }
    }
  }
  return { stats, nTrials: stats.length };
}
