// trd-price-features.ts — derive POINT-IN-TIME price features (momentum, MA state)
// from OHLCV. PURE. Each feature's effective_date is the bar date, and its value
// uses ONLY closes up to and including that bar — so a backtest reading it at the
// decision bar has no look-ahead. Trailing 12-month return (mom_252) is the
// canonical time-series-momentum signal (Moskowitz-Ooi-Pedersen).

export interface Bar { ts: string; close: number }
export interface PriceFeatureRow { symbol: string; feature_key: string; effective_date: string; value: number }

/** Trailing total return over `lookback` trading days, stamped at each bar it is
 * knowable. value[t] = close[t]/close[t-lookback] - 1. */
export function trailingReturnFeatures(symbol: string, bars: Bar[], lookback: number, key: string): PriceFeatureRow[] {
  const sorted = [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
  const out: PriceFeatureRow[] = [];
  for (let i = lookback; i < sorted.length; i++) {
    const c0 = sorted[i - lookback].close, c1 = sorted[i].close;
    if (c0 > 0 && Number.isFinite(c0) && Number.isFinite(c1)) {
      out.push({ symbol, feature_key: key, effective_date: sorted[i].ts.slice(0, 10), value: c1 / c0 - 1 });
    }
  }
  return out;
}

/** Simple-moving-average cross state: +1 if close > SMA(window), else -1, stamped
 * at each bar it's knowable. A classic trend filter. */
export function smaCrossFeatures(symbol: string, bars: Bar[], window: number, key: string): PriceFeatureRow[] {
  const sorted = [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
  const out: PriceFeatureRow[] = [];
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i].close;
    if (i >= window) sum -= sorted[i - window].close;
    if (i >= window - 1) {
      const sma = sum / window;
      out.push({ symbol, feature_key: key, effective_date: sorted[i].ts.slice(0, 10), value: sorted[i].close > sma ? 1 : -1 });
    }
  }
  return out;
}
