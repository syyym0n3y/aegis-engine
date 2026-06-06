// trd-features-edgar.ts — derive POINT-IN-TIME features from insider filings.
// PURE + offline. Each feature carries the disclosed_date as its effective_date,
// so a backtest can only read what was legally knowable. The headline signal is
// the open-market-buy cluster (distinct insiders buying code 'P' in a window).

export interface FilingForFeature {
  ticker: string | null;
  person: string | null;
  disclosed_date: string; // YYYY-MM-DD (legally knowable)
  openMarketBuy: boolean;
  openMarketBuyShares: number;
}

export interface FeatureRow {
  feature_key: string;
  symbol: string;
  effective_date: string;
  value: number;
  requires_oos_proof: boolean;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** For every (ticker, disclosed_date) observed, compute trailing-window aggregates
 * using ONLY filings disclosed on/before that date (point-in-time correct):
 *   - insider_open_market_buyers_<w>d : # DISTINCT insiders who bought open-market
 *   - insider_filings_<w>d            : total insider filings (activity context)
 * The buyer-cluster feature is the real signal; it must still clear the gate. */
export function computeInsiderFeatures(filings: FilingForFeature[], windowDays = 30): FeatureRow[] {
  const valid = filings.filter((f) => f.ticker);
  const out: FeatureRow[] = [];
  // unique (ticker, date) decision points
  const byTicker = new Map<string, FilingForFeature[]>();
  for (const f of valid) {
    const k = f.ticker as string;
    (byTicker.get(k) ?? byTicker.set(k, []).get(k)!).push(f);
  }
  for (const [ticker, fs] of byTicker) {
    const dates = [...new Set(fs.map((f) => f.disclosed_date))].sort();
    for (const d of dates) {
      const window = fs.filter((f) => {
        const age = daysBetween(f.disclosed_date, d);
        return age >= 0 && age <= windowDays; // disclosed on/before d, within window
      });
      const buyers = new Set(window.filter((f) => f.openMarketBuy).map((f) => f.person ?? "?"));
      out.push({ feature_key: `insider_open_market_buyers_${windowDays}d`, symbol: ticker, effective_date: d, value: buyers.size, requires_oos_proof: false });
      out.push({ feature_key: `insider_filings_${windowDays}d`, symbol: ticker, effective_date: d, value: window.length, requires_oos_proof: false });
    }
  }
  return out;
}
