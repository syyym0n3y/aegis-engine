#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-ingest-edgar — fetch a day's SEC Form-4 filings, parse, and upsert into
// trd_raw_filings (idempotent on accession). Legal, free, no auth. Sequential
// + polite (<=10 req/s) per EDGAR's fair-access policy.
//
// Usage:
//   deno run --allow-net --allow-env scripts/trd-ingest-edgar.ts [YYYYMMDD] [limit]
//   DATABASE_URL=postgres://... (defaults to the local supabase Postgres)
//   EDGAR_UA="Your Name you@email"   (EDGAR requires a descriptive User-Agent)

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { parseDailyIndex, parseForm4, toFilingRow } from "../supabase/functions/_shared/trd-edgar.ts";

const date = Deno.args[0] ?? "20260605";
const limit = Number(Deno.args[1] ?? "25");
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const UA = Deno.env.get("EDGAR_UA") ?? "Aegis Research (ona@revitalise.io)";
const QTR = `QTR${Math.floor((Number(date.slice(4, 6)) - 1) / 3) + 1}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

console.log(`[edgar] daily index ${date} (${QTR})`);
const idxUrl = `https://www.sec.gov/Archives/edgar/daily-index/${date.slice(0, 4)}/${QTR}/form.${date}.idx`;
const rows = parseDailyIndex(await get(idxUrl)).slice(0, limit);
console.log(`[edgar] ${rows.length} Form-4 filings (capped at ${limit})`);

const sql = postgres(DB);
let inserted = 0, skipped = 0, buys = 0, errors = 0;
try {
  for (const idx of rows) {
    try {
      const txt = await get(`https://www.sec.gov/Archives/${idx.path}`);
      const row = toFilingRow(idx, parseForm4(txt));
      if ((row.raw as { openMarketBuys: number }).openMarketBuys > 0) buys++;
      const res = await sql`
        insert into trd_raw_filings (source, source_id, filing_type, ticker, person, trade_date, disclosed_date, amount_low, amount_high, raw)
        values (${row.source}, ${row.source_id}, ${row.filing_type}, ${row.ticker}, ${row.person}, ${row.trade_date}, ${row.disclosed_date}, ${row.amount_low}, ${row.amount_high}, ${sql.json(row.raw as Parameters<typeof sql.json>[0])})
        on conflict (source, source_id) do nothing`;
      res.count > 0 ? inserted++ : skipped++;
    } catch (e) {
      errors++;
      console.error(`[edgar] ${idx.accession}: ${(e as Error).message}`);
    }
    await sleep(120); // <=10 req/s
  }
} finally {
  await sql.end();
}
console.log(`[edgar] inserted=${inserted} skipped(dup)=${skipped} open-market-buy-filings=${buys} errors=${errors}`);
