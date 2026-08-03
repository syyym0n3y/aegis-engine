// trd-session.ts — the INTRADAY session-structure layer the daily-bar backtest was
// blind to. PURE, point-in-time (every value is knowable at the bar's own close).
//
// WHY THIS EXISTS: day-trading edges live in TIME-OF-DAY structure — the opening
// auction, the overnight-gap resolution, the first-hour range expansion — which are
// observable on intraday bars WITHOUT the order book, so they are one of the few
// edge classes that is data-symmetric between retail and the desks. Daily bars
// cannot see any of it. This tags each intraday bar with its session, minutes since
// that session opened, whether it is inside the "opening range" window, and the
// day-of-week — the raw material for "same trade, same session, same weekday" specs.
//
// HONEST CAVEAT (enforced downstream by the gate): session/day-of-week effects are
// the MOST data-mined anomalies in retail. Testing 3 sessions × 5 weekdays × N
// markets over a few weeks of intraday history is a multiple-testing bomb with tiny
// N — exactly what DSR-deflation + PBO exist to shoot down. "It works every Tuesday"
// over 10 Tuesdays is n=10 noise. This layer FINDS candidate session structure; it
// does not bless it.

export interface IntradayBar {
  /** ISO-8601 UTC timestamp of the bar, e.g. "2026-07-31T13:30:00Z". */
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** FX/futures trade ~24h, so all three majors are observable. Windows are the
 * conventional liquidity sessions in UTC (approximate, DST-agnostic — the point is
 * relative session structure, not a to-the-minute open). A bar can belong to more
 * than one (London/NY overlap 12:00–16:00 UTC is the highest-liquidity window). */
export type Session = "asia" | "london" | "ny";

export const SESSION_WINDOWS: Record<Session, { openHourUTC: number; closeHourUTC: number }> = {
  asia: { openHourUTC: 0, closeHourUTC: 8 }, // Tokyo
  london: { openHourUTC: 7, closeHourUTC: 16 },
  ny: { openHourUTC: 13, closeHourUTC: 21 }, // 13:30 equities; use 13 for the futures/FX open bucket
};

function utcParts(ts: string): { hour: number; minute: number; dow: number; dateKey: string } {
  const d = new Date(ts);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dow: d.getUTCDay(), // 0=Sun … 6=Sat
    dateKey: ts.slice(0, 10),
  };
}

/** Every session whose window contains this bar's UTC time (may be 0, 1, or 2). */
export function sessionsOf(ts: string): Session[] {
  const { hour } = utcParts(ts);
  const out: Session[] = [];
  for (const s of Object.keys(SESSION_WINDOWS) as Session[]) {
    const w = SESSION_WINDOWS[s];
    if (hour >= w.openHourUTC && hour < w.closeHourUTC) out.push(s);
  }
  return out;
}

export interface SessionTag {
  ts: string;
  dateKey: string;
  dow: number; // 0=Sun..6=Sat (UTC)
  sessions: Session[];
  /** minutes since each active session's open (only for sessions this bar is in). */
  minutesSinceOpen: Partial<Record<Session, number>>;
  /** true if this bar is the FIRST observed bar of a session on its date (the open). */
  isSessionOpen: Partial<Record<Session, boolean>>;
  /** true if within `openingRangeMin` minutes of a session open (the OR window). */
  inOpeningRange: Partial<Record<Session, boolean>>;
}

/**
 * Tag a full ascending intraday series. `isSessionOpen` is the first bar seen inside
 * a session window on a given date (so it is robust to missing pre-open bars). All
 * fields derive only from the bar's own timestamp + earlier bars → point-in-time.
 */
export function tagSessions(bars: IntradayBar[], openingRangeMin = 30): SessionTag[] {
  const sorted = [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
  const firstSeen = new Set<string>(); // `${dateKey}:${session}` already opened
  const out: SessionTag[] = [];
  for (const b of sorted) {
    const { hour, minute, dow, dateKey } = utcParts(b.ts);
    const sessions = sessionsOf(b.ts);
    const minutesSinceOpen: Partial<Record<Session, number>> = {};
    const isSessionOpen: Partial<Record<Session, boolean>> = {};
    const inOpeningRange: Partial<Record<Session, boolean>> = {};
    for (const s of sessions) {
      const w = SESSION_WINDOWS[s];
      const mins = (hour - w.openHourUTC) * 60 + minute;
      minutesSinceOpen[s] = mins;
      const key = `${dateKey}:${s}`;
      const isOpen = !firstSeen.has(key);
      if (isOpen) firstSeen.add(key);
      isSessionOpen[s] = isOpen;
      inOpeningRange[s] = mins < openingRangeMin;
    }
    out.push({ ts: b.ts, dateKey, dow, sessions, minutesSinceOpen, isSessionOpen, inOpeningRange });
  }
  return out;
}

/** Convenience: the opening-range high/low for one session on one date, computed
 * ONLY from bars inside the OR window (knowable once the window closes). A breakout
 * strategy reads these AFTER `openingRangeMin` has elapsed — no look-ahead. */
export function openingRange(
  bars: IntradayBar[], session: Session, dateKey: string, openingRangeMin = 30,
): { high: number; low: number; barCount: number } | null {
  const w = SESSION_WINDOWS[session];
  let hi = -Infinity, lo = Infinity, n = 0;
  for (const b of bars) {
    if (b.ts.slice(0, 10) !== dateKey) continue;
    const d = new Date(b.ts);
    const mins = (d.getUTCHours() - w.openHourUTC) * 60 + d.getUTCMinutes();
    if (mins >= 0 && mins < openingRangeMin) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); n++; }
  }
  return n > 0 ? { high: hi, low: lo, barCount: n } : null;
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function dowName(dow: number): string { return DOW_NAMES[dow] ?? String(dow); }
