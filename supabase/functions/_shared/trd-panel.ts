// trd-panel.ts — assemble a backtest Panel from DB-shaped price + feature series.
// PURE. The universe is aligned on the INTERSECTION of trading days (so every
// symbol has a bar each decision date), returns are close-to-close, and insider
// features ride along as point-in-time records (effectiveDate = disclosed_date).

import { Panel, SymbolData } from "./trd-strategy.ts";
import { PitRecord } from "./trd-point-in-time.ts";

export interface PriceSeries {
  symbol: string;
  bars: { ts: string; close: number }[]; // ascending
}

export interface FeatureSeries {
  symbol: string;
  key: string;
  records: PitRecord[]; // {effectiveDate, value}
}

function dateOf(ts: string): string {
  return ts.slice(0, 10);
}

/** Sorted intersection of every series' trading days. */
function commonDates(prices: PriceSeries[]): string[] {
  if (prices.length === 0) return [];
  let common = new Set(prices[0].bars.map((b) => dateOf(b.ts)));
  for (const p of prices.slice(1)) {
    const s = new Set(p.bars.map((b) => dateOf(b.ts)));
    common = new Set([...common].filter((d) => s.has(d)));
  }
  return [...common].sort();
}

/** close-to-close returns on the given date grid (returns[0] = 0). */
export function alignedReturns(p: PriceSeries, dates: string[]): number[] {
  const closeByDate = new Map(p.bars.map((b) => [dateOf(b.ts), b.close]));
  const closes = dates.map((d) => closeByDate.get(d));
  return closes.map((c, i) => {
    if (i === 0 || c === undefined || closes[i - 1] === undefined || closes[i - 1] === 0) return 0;
    return (c - (closes[i - 1] as number)) / (closes[i - 1] as number);
  });
}

/** Build the universe Panel. Features are matched to symbols by `symbol`+`key`. */
export function buildPanel(prices: PriceSeries[], features: FeatureSeries[]): Panel {
  const dates = commonDates(prices);
  const symbols: SymbolData[] = prices.map((p) => {
    const featsForSym: Record<string, PitRecord[]> = {};
    for (const f of features.filter((f) => f.symbol === p.symbol)) featsForSym[f.key] = f.records;
    return { symbol: p.symbol, dates, returns: alignedReturns(p, dates), features: featsForSym };
  });
  return { dates, symbols };
}
