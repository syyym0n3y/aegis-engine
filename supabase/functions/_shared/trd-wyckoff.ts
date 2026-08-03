// trd-wyckoff.ts — model the Wyckoff method as POINT-IN-TIME features from OHLCV.
// PURE. Every feature's effective_date is the bar date and its value uses ONLY
// bars up to and including that bar, so a backtest reading it at the decision bar
// has zero look-ahead (mirrors trd-price-features.ts).
//
// Wyckoff is a supply/demand / effort-vs-result framework. We do NOT claim it is
// an edge — it is a *context + confidence* model whose outputs are AND-gated into a
// StrategySpec and then subjected to the same default-REJECT gate as everything
// else. The evolutionary search (trd-evolve.ts) treats every Wyckoff
// parameterization as a TRIAL so the Deflated Sharpe deflates by the true search
// size — an evolved Wyckoff variant cannot manufacture a fake edge.
//
// HONESTY ON THE CONFIDENCE LEVERS: true CVD needs trade-level bid/ask tick data
// and true Open Interest needs a futures OI feed — NEITHER is present in daily
// OHLCV. `wyCvdProxy` below is the Accumulation/Distribution line (close-location ×
// volume), the best *bar-only proxy* for cumulative volume delta. It is labeled a
// proxy on purpose. Do not read it as CVD until a tick feed is wired.

export interface WyckoffBar {
  ts: string;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WyckoffFeatureRow {
  symbol: string;
  feature_key: string;
  effective_date: string;
  value: number;
}

function sortBars(bars: WyckoffBar[]): WyckoffBar[] {
  return [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Close-location value of a single bar ∈ [-1, 1]: +1 = close at high (demand won),
 * -1 = close at low (supply won). Doji/zero-range → 0. */
export function closeLocationValue(b: WyckoffBar): number {
  const range = b.high - b.low;
  if (!(range > 0) || !Number.isFinite(range)) return 0;
  return ((b.close - b.low) - (b.high - b.close)) / range;
}

/**
 * The four canonical Wyckoff events, each as a point-in-time 0/1 feature stamped
 * at the bar it becomes knowable. The "trading range" is the prior `lookback` bars
 * (STRICTLY before the current bar — no self-reference, no look-ahead):
 *   rangeHigh = max(high) over [i-lookback, i-1], rangeLow = min(low) likewise.
 *
 * - wy_spring   (bullish): bar dips BELOW support then closes back INSIDE the range
 *                with an upper-half close → a shakeout of weak longs / absorption.
 * - wy_upthrust (bearish): bar pokes ABOVE resistance then closes back INSIDE with a
 *                lower-half close → a bull trap / distribution.
 * - wy_sos      (bullish "sign of strength"): decisive close ABOVE resistance on a
 *                wide range with ABOVE-average volume (effort confirms result).
 * - wy_sow      (bearish "sign of weakness"): decisive close BELOW support on a wide
 *                range with above-average volume.
 *
 * Emits one row per (event, bar) where the event fires (value always 1) PLUS a
 * dense signed `wy_phase` row every bar: +1 accumulation-leaning (spring/SOS),
 * -1 distribution-leaning (upthrust/SOW), 0 neutral — so a strategy can also read a
 * continuous state, not only discrete events.
 */
export function wyckoffEventFeatures(
  symbol: string,
  bars: WyckoffBar[],
  lookback = 20,
): WyckoffFeatureRow[] {
  const b = sortBars(bars);
  const out: WyckoffFeatureRow[] = [];
  // trailing average volume (excludes current bar) for the effort test
  for (let i = lookback; i < b.length; i++) {
    const win = b.slice(i - lookback, i); // strictly prior bars
    let rangeHigh = -Infinity, rangeLow = Infinity, volSum = 0;
    for (const w of win) {
      if (w.high > rangeHigh) rangeHigh = w.high;
      if (w.low < rangeLow) rangeLow = w.low;
      volSum += w.volume;
    }
    const avgVol = volSum / win.length;
    const cur = b[i];
    const clv = closeLocationValue(cur);
    const barRange = cur.high - cur.low;
    // "wide range" = current bar span exceeds the average prior span
    let priorSpan = 0;
    for (const w of win) priorSpan += (w.high - w.low);
    const avgSpan = priorSpan / win.length;
    const wide = barRange > avgSpan;
    const heavy = cur.volume > avgVol;
    const date = cur.ts.slice(0, 10);

    const spring = cur.low < rangeLow && cur.close > rangeLow && clv > 0.25;
    const upthrust = cur.high > rangeHigh && cur.close < rangeHigh && clv < -0.25;
    const sos = cur.close > rangeHigh && wide && heavy;
    const sow = cur.close < rangeLow && wide && heavy;

    if (spring) out.push({ symbol, feature_key: "wy_spring", effective_date: date, value: 1 });
    if (upthrust) out.push({ symbol, feature_key: "wy_upthrust", effective_date: date, value: 1 });
    if (sos) out.push({ symbol, feature_key: "wy_sos", effective_date: date, value: 1 });
    if (sow) out.push({ symbol, feature_key: "wy_sow", effective_date: date, value: 1 });

    const phase = (spring || sos) ? 1 : (upthrust || sow) ? -1 : 0;
    out.push({ symbol, feature_key: "wy_phase", effective_date: date, value: phase });
  }
  return out;
}

/**
 * CONFIDENCE LEVER 1 — effort-vs-result (`wy_evr`), point-in-time.
 * Effort = volume / trailing-avg-volume. Result = |close-to-close move| / trailing
 * ATR-ish span. Feature value = result / effort:
 *   LOW value  = high effort, little price result → ABSORPTION / divergence (a
 *                confidence WARNING — the move may be being faded by size).
 *   HIGH value = result achieved on modest effort → efficient move (confidence UP).
 * This is the bar-derivable analogue of a CVD divergence read.
 */
export function effortVsResultFeatures(
  symbol: string,
  bars: WyckoffBar[],
  lookback = 20,
): WyckoffFeatureRow[] {
  const b = sortBars(bars);
  const out: WyckoffFeatureRow[] = [];
  for (let i = lookback; i < b.length; i++) {
    const win = b.slice(i - lookback, i);
    let volSum = 0, spanSum = 0;
    for (const w of win) { volSum += w.volume; spanSum += (w.high - w.low); }
    const avgVol = volSum / win.length;
    const avgSpan = spanSum / win.length;
    const cur = b[i], prev = b[i - 1];
    const effort = avgVol > 0 ? cur.volume / avgVol : 0;
    const result = avgSpan > 0 ? Math.abs(cur.close - prev.close) / avgSpan : 0;
    // guard divide-by-zero: no effort → undefined ratio → emit 0 (neutral)
    const evr = effort > 0 ? result / effort : 0;
    out.push({ symbol, feature_key: "wy_evr", effective_date: cur.ts.slice(0, 10), value: evr });
  }
  return out;
}

/**
 * CONFIDENCE LEVER 2 — proxy cumulative volume delta (`wy_cvd_proxy`), point-in-time.
 * The Accumulation/Distribution line: cumulative Σ (closeLocationValue × volume).
 * This is the ONLY cumulative-delta signal derivable from bars; it is a PROXY for
 * true CVD (which needs tick-level bid/ask). The tradeable read is DIVERGENCE vs
 * price, so we also emit its `lookback`-bar change (`wy_cvd_proxy_slope`) — a rising
 * slope while price falls (or vice-versa) is the divergence the discretionary
 * Wyckoff/order-flow school watches. Value is unbounded (cumulative); use the slope
 * for thresholds.
 */
export function cvdProxyFeatures(
  symbol: string,
  bars: WyckoffBar[],
  slopeLookback = 10,
): WyckoffFeatureRow[] {
  const b = sortBars(bars);
  const out: WyckoffFeatureRow[] = [];
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < b.length; i++) {
    acc += closeLocationValue(b[i]) * b[i].volume;
    cum.push(acc);
    const date = b[i].ts.slice(0, 10);
    out.push({ symbol, feature_key: "wy_cvd_proxy", effective_date: date, value: acc });
    if (i >= slopeLookback) {
      out.push({
        symbol,
        feature_key: "wy_cvd_proxy_slope",
        effective_date: date,
        value: cum[i] - cum[i - slopeLookback],
      });
    }
  }
  return out;
}

/** Convenience: all Wyckoff + confidence-lever features for one symbol. */
export function allWyckoffFeatures(
  symbol: string,
  bars: WyckoffBar[],
  opts: { lookback?: number; slopeLookback?: number } = {},
): WyckoffFeatureRow[] {
  const lookback = opts.lookback ?? 20;
  const slopeLookback = opts.slopeLookback ?? 10;
  return [
    ...wyckoffEventFeatures(symbol, bars, lookback),
    ...effortVsResultFeatures(symbol, bars, lookback),
    ...cvdProxyFeatures(symbol, bars, slopeLookback),
  ];
}
