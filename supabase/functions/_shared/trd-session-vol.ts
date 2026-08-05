// trd-session-vol.ts — session/timeframe awareness for sizing (pure, tested). Measured on 15y Dukascopy
// 1-min S&P500 (D-141, 5.7M bars): realized vol differs sharply BY SESSION, and the daily GEX regime carries
// INTO every session (~2× low-γ vs high-γ in Asia, London AND NY) — so the daily forward-vol de-risk is valid
// for intraday sizing too. Realized vol is stable across 1m/5m/15m/60m candles (≈√-scaling, no microstructure
// blow-up), so a scalper and a swing trader size against the same regime, just a different horizon baseline.

// Annualized realized vol by session, 15y baseline (%). NY (cash session) ≈ 3× Asia.
export const SESSION_VOL_PCT: Record<string, number> = { Asia: 3.0, London: 4.6, NY: 9.4 };
export const MEDIAN_DAILY_FWD_VOL_PCT = 13.4; // the daily forward-vol forecast's calm reference (D-134)

/** Given the current daily forward-vol forecast (e.g. from the GEX/VIX model), the expected intraday realized
 * vol for each session ≈ its 15y baseline × the current regime multiplier (currentDailyVol / median). The
 * regime scales all sessions ~proportionally (D-141), so one daily signal informs every intraday trader. */
export function sessionExpectedVol(currentDailyFwdVolPct: number, median = MEDIAN_DAILY_FWD_VOL_PCT): { session: string; baselinePct: number; expectedPct: number }[] {
  const mult = (Number.isFinite(currentDailyFwdVolPct) && median > 0) ? currentDailyFwdVolPct / median : 1;
  return Object.entries(SESSION_VOL_PCT).map(([session, base]) => ({ session, baselinePct: base, expectedPct: +(base * mult).toFixed(1) }));
}
