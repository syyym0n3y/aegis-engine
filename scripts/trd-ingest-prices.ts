#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-ingest-prices — fetch daily bars for every ticker in trd_raw_filings (+ SPY
// market factor) into trd_price_bars (idempotent; as_of = bar ts). Provider-aware:
//   • Twelve Data (DEFAULT) — free data-API key, NO brokerage/KYC/visa baggage:
//       https://twelvedata.com/ → free key → TWELVEDATA_API_KEY=...
//   • Alpaca paper — APCA_API_KEY_ID / APCA_API_SECRET_KEY (needs an account)
//
//   TWELVEDATA_API_KEY=xxx deno run --allow-net --allow-env scripts/trd-ingest-prices.ts

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { parseTwelveData, twelveDataError } from "../supabase/functions/_shared/trd-twelvedata.ts";
import { parseAlpacaBars, PriceBar } from "../supabase/functions/_shared/trd-alpaca.ts";

const TD = Deno.env.get("TWELVEDATA_API_KEY");
const APCA = Deno.env.get("APCA_API_KEY_ID");
const APCA_SECRET = Deno.env.get("APCA_API_SECRET_KEY");
const provider = TD ? "twelvedata" : APCA && APCA_SECRET ? "alpaca" : null;
if (!provider) {
  console.error("✗ No price-data credentials. Cleanest (no brokerage, no KYC, no visa/tax baggage):");
  console.error("  1. Free key at https://twelvedata.com  →  2. TWELVEDATA_API_KEY=... ./scripts/trd-ingest-prices.ts");
  Deno.exit(2);
}
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUTPUTSIZE = Deno.env.get("OUTPUTSIZE") ?? "550"; // TD max ~5000 (years)
const start = new Date(Date.now() - Number(OUTPUTSIZE) * 1.5 * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBars(sym: string): Promise<PriceBar[]> {
  if (provider === "twelvedata") {
    const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${OUTPUTSIZE}&apikey=${TD}`);
    const text = await res.text();
    const err = twelveDataError(text);
    if (err) throw new Error(err);
    return parseTwelveData(text);
  }
  const res = await fetch(
    `https://data.alpaca.markets/v2/stocks/${sym}/bars?timeframe=1Day&feed=iex&start=${start}&limit=1000`,
    { headers: { "APCA-API-KEY-ID": APCA!, "APCA-API-SECRET-KEY": APCA_SECRET! } },
  );
  if (!res.ok) throw new Error(`${res.status}`);
  return parseAlpacaBars(await res.text());
}

const sql = postgres(DB);
try {
  // SYMBOLS env overrides (explicit universe for strategy testing). Otherwise scope
  // to tickers carrying an insider open-market BUY signal (+ SPY), small request count.
  const override = Deno.env.get("SYMBOLS");
  let symbols: string[];
  if (override) {
    symbols = [...new Set([...override.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean), "SPY"])];
  } else {
    const minBuyers = Number(Deno.args[0] ?? "1");
    let rows = await sql`select distinct symbol as ticker from trd_features
      where feature_key='insider_open_market_buyers_30d' and value >= ${minBuyers}` as unknown as Array<{ ticker: string }>;
    if (rows.length === 0) {
      rows = await sql`select distinct ticker from trd_raw_filings where source='edgar' and ticker is not null` as unknown as Array<{ ticker: string }>;
    }
    symbols = [...new Set([...rows.map((r) => r.ticker), "SPY"])];
  }
  console.log(`[prices] provider=${provider}  ${symbols.length} symbols`);
  let bars = 0, errors = 0;
  for (const sym of symbols) {
    try {
      const parsed = await fetchBars(sym);
      for (const b of parsed) {
        const r = await sql`
          insert into trd_price_bars (symbol, timeframe, ts, as_of, open, high, low, close, volume, source)
          values (${sym}, '1Day', ${b.ts}, ${b.ts}, ${b.open}, ${b.high}, ${b.low}, ${b.close}, ${b.volume}, ${provider})
          on conflict (symbol, timeframe, ts, as_of) do nothing`;
        bars += r.count;
      }
      console.log(`[prices]   ${sym}: ${parsed.length} bars`);
    } catch (e) {
      errors++;
      console.error(`[prices]   ${sym}: ${(e as Error).message}`);
    }
    await sleep(provider === "twelvedata" ? 8000 : 150); // TD free = 8 req/min
  }
  console.log(`[prices] inserted ${bars} new bars (errors=${errors})`);
} finally {
  await sql.end();
}
