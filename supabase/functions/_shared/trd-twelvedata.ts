// trd-twelvedata.ts — parse Twelve Data /time_series daily bars. PURE.
// Free tier: email→API key (NO brokerage, NO KYC, NO tax/visa baggage — a pure
// data subscription). ~800 req/day, 8 req/min. Endpoint:
//   GET https://api.twelvedata.com/time_series?symbol=SRCE&interval=1day&outputsize=550&apikey=KEY
// Response: { "meta":{...}, "values":[ {"datetime":"2026-06-05","open","high","low","close","volume"} ], "status":"ok" }
// Values are STRINGS, newest-first. Shape per docs — verify on first real call.

import { PriceBar } from "./trd-alpaca.ts";

interface TdValue { datetime: string; open: string; high: string; low: string; close: string; volume?: string }

/** Parse a time_series response into ascending PriceBars. Returns [] on an API
 * error payload (e.g. bad key / rate limit) so the caller can skip cleanly. */
export function parseTwelveData(jsonText: string): PriceBar[] {
  const j = JSON.parse(jsonText) as { status?: string; values?: TdValue[]; message?: string };
  if (j.status === "error" || !Array.isArray(j.values)) return [];
  return j.values
    .map((v) => ({
      ts: v.datetime.length === 10 ? `${v.datetime}T00:00:00Z` : v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }))
    .filter((b) => Number.isFinite(b.close))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Surface an API error message (rate limit / bad key) for honest logging. */
export function twelveDataError(jsonText: string): string | null {
  try {
    const j = JSON.parse(jsonText) as { status?: string; message?: string };
    return j.status === "error" ? (j.message ?? "error") : null;
  } catch {
    return "unparseable response";
  }
}
