#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-ingest-prices — fetch daily bars from Alpaca (free paper plan, IEX feed)
// for every ticker in trd_raw_filings (+ SPY as the market factor) and upsert
// into trd_price_bars (idempotent; as_of = bar ts for Stage-1 simplicity).
//
// Needs free Alpaca PAPER keys (no money):
//   APCA_API_KEY_ID=... APCA_API_SECRET_KEY=... deno run --allow-net --allow-env scripts/trd-ingest-prices.ts

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { parseAlpacaBars } from "../supabase/functions/_shared/trd-alpaca.ts";

const KEY = Deno.env.get("APCA_API_KEY_ID");
const SECRET = Deno.env.get("APCA_API_SECRET_KEY");
if (!KEY || !SECRET) {
  console.error("✗ No Alpaca creds. Create a FREE paper account at https://alpaca.markets (no money),");
  console.error("  then: APCA_API_KEY_ID=... APCA_API_SECRET_KEY=... ./scripts/trd-ingest-prices.ts");
  Deno.exit(2);
}
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const start = new Date(Date.now() - 550 * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = postgres(DB);

try {
  const rows = await sql`select distinct ticker from trd_raw_filings where source='edgar' and ticker is not null` as unknown as Array<{ ticker: string }>;
  const symbols = [...new Set([...rows.map((r) => r.ticker), "SPY"])];
  console.log(`[prices] ${symbols.length} symbols from ${start}`);
  let bars = 0, errors = 0;
  for (const sym of symbols) {
    try {
      const res = await fetch(
        `https://data.alpaca.markets/v2/stocks/${sym}/bars?timeframe=1Day&feed=iex&start=${start}&limit=1000`,
        { headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET } },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const parsed = parseAlpacaBars(await res.text());
      for (const b of parsed) {
        const r = await sql`
          insert into trd_price_bars (symbol, timeframe, ts, as_of, open, high, low, close, volume, source)
          values (${sym}, '1Day', ${b.ts}, ${b.ts}, ${b.open}, ${b.high}, ${b.low}, ${b.close}, ${b.volume}, 'alpaca')
          on conflict (symbol, timeframe, ts, as_of) do nothing`;
        bars += r.count;
      }
    } catch (e) {
      errors++;
      console.error(`[prices] ${sym}: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  console.log(`[prices] inserted ${bars} bars (errors=${errors})`);
} finally {
  await sql.end();
}
