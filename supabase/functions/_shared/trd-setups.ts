// trd-setups.ts — deterministic, EXECUTABLE trade-setup detectors for the setups traders
// actually use: Fair-Value-Gap (FVG) fills and liquidity sweeps. Each emits a mechanical
// entry with a STRUCTURAL stop and an R-multiple target — everything the firewall/executor
// needs. PURE, point-in-time (only prior/closed bars are read).
//
// HONESTY (baked in, not optional): these are CANDIDATE setups, not proven edges. Our own
// testing (D-073..D-076) says this class does not survive honest validation for retail. So
// the product runs them on PAPER inside the risk firewall and reports the live VERIFY
// verdict — the trader finds out from their own data whether it works, not from a claim.

export interface Bar { ts: string; open: number; high: number; low: number; close: number; volume?: number }
export interface Setup {
  ts: string;
  kind: "fvg" | "sweep";
  side: "long" | "short";
  entry: number; // suggested entry price
  stop: number; // structural stop
  target: number; // R-multiple target
  rMultiple: number; // target distance / stop distance
  note: string;
}

function sorted(bars: Bar[]): Bar[] { return [...bars].sort((a, b) => a.ts.localeCompare(b.ts)); }

/**
 * FAIR VALUE GAP — a 3-bar imbalance where price moved so fast it left a gap:
 *   bullish FVG: low[i] > high[i-2]  (a gap the market often revisits, then continues up)
 *   bearish FVG: high[i] < low[i-2]
 * Entry = the gap edge (a limit back into the gap), stop = beyond the gap, target = rMult×risk.
 */
export function detectFVG(bars: Bar[], rMult = 2): Setup[] {
  const b = sorted(bars);
  const out: Setup[] = [];
  for (let i = 2; i < b.length; i++) {
    if (b[i].low > b[i - 2].high) { // bullish gap between bar i-2 high and bar i low
      const entry = b[i - 2].high, stop = b[i - 2].low, risk = entry - stop;
      if (risk > 0) out.push({ ts: b[i].ts, kind: "fvg", side: "long", entry, stop, target: entry + rMult * risk, rMultiple: rMult, note: "bullish FVG fill" });
    } else if (b[i].high < b[i - 2].low) { // bearish gap
      const entry = b[i - 2].low, stop = b[i - 2].high, risk = stop - entry;
      if (risk > 0) out.push({ ts: b[i].ts, kind: "fvg", side: "short", entry, stop, target: entry - rMult * risk, rMultiple: rMult, note: "bearish FVG fill" });
    }
  }
  return out;
}

/**
 * LIQUIDITY SWEEP (stop-run reversal) — price pushes BEYOND a prior swing extreme (running
 * the stops resting there) then closes back inside → the sweep is rejected and price often
 * reverses:
 *   bearish sweep: high[i] > max(high over prior `lookback`) AND close[i] < that level → short
 *   bullish sweep: low[i]  < min(low over prior `lookback`)  AND close[i] > that level → long
 * Entry = close of the sweep bar, stop = beyond the swept wick, target = rMult×risk.
 */
export function detectSweeps(bars: Bar[], lookback = 20, rMult = 2): Setup[] {
  const b = sorted(bars);
  const out: Setup[] = [];
  for (let i = lookback; i < b.length; i++) {
    let priorHigh = -Infinity, priorLow = Infinity;
    for (let j = i - lookback; j < i; j++) { if (b[j].high > priorHigh) priorHigh = b[j].high; if (b[j].low < priorLow) priorLow = b[j].low; }
    const cur = b[i];
    if (cur.high > priorHigh && cur.close < priorHigh) { // bearish sweep of highs
      const entry = cur.close, stop = cur.high, risk = stop - entry;
      if (risk > 0) out.push({ ts: cur.ts, kind: "sweep", side: "short", entry, stop, target: entry - rMult * risk, rMultiple: rMult, note: "swept prior highs, rejected" });
    } else if (cur.low < priorLow && cur.close > priorLow) { // bullish sweep of lows
      const entry = cur.close, stop = cur.low, risk = entry - stop;
      if (risk > 0) out.push({ ts: cur.ts, kind: "sweep", side: "long", entry, stop, target: entry + rMult * risk, rMultiple: rMult, note: "swept prior lows, reclaimed" });
    }
  }
  return out;
}

/** All setups, ascending by time — the candidate entry stream the executor consumes
 * (each already carries a stop + target, so the firewall can size + protect it). */
export function detectSetups(bars: Bar[], opts: { lookback?: number; rMult?: number } = {}): Setup[] {
  const r = opts.rMult ?? 2;
  return [...detectFVG(bars, r), ...detectSweeps(bars, opts.lookback ?? 20, r)].sort((a, b) => a.ts.localeCompare(b.ts));
}
