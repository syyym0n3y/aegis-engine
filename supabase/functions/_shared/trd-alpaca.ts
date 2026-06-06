// trd-alpaca.ts — parse Alpaca Market Data v2 daily bars. PURE.
// Free paper plan uses the IEX feed. Endpoint (auth'd with APCA keys):
//   GET https://data.alpaca.markets/v2/stocks/{symbol}/bars?timeframe=1Day&feed=iex&start=...&limit=...
// Response: { "bars": [ {"t":"2026-06-05T04:00:00Z","o","h","l","c","v","n","vw"} ], "symbol", "next_page_token" }
// Shape per Alpaca docs — verify on the first authenticated call (no creds yet).

export interface PriceBar {
  ts: string; // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number }

/** Parse a single-symbol bars response into ascending PriceBars. */
export function parseAlpacaBars(jsonText: string): PriceBar[] {
  const j = JSON.parse(jsonText) as { bars?: AlpacaBar[] };
  const bars = Array.isArray(j.bars) ? j.bars : [];
  return bars
    .map((b) => ({ ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
    .filter((b) => Number.isFinite(b.close))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
