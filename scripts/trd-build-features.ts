#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-build-features — derive the point-in-time insider feature store from
// trd_raw_filings into trd_features. Idempotent (ON CONFLICT DO NOTHING on the
// (feature_key, symbol, effective_date) unique key).
//
//   deno run --allow-net --allow-env scripts/trd-build-features.ts [windowDays]

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { computeInsiderFeatures, FilingForFeature } from "../supabase/functions/_shared/trd-features-edgar.ts";

const windowDays = Number(Deno.args[0] ?? "30");
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB);

try {
  const rows = await sql`
    select ticker, person, disclosed_date::text as disclosed_date, amount_low, raw
    from trd_raw_filings where source = 'edgar' and ticker is not null`;
  const filings: FilingForFeature[] = rows.map((r: Record<string, unknown>) => ({
    ticker: r.ticker as string,
    person: r.person as string | null,
    disclosed_date: r.disclosed_date as string,
    openMarketBuy: (((r.raw as { openMarketBuys?: number })?.openMarketBuys) ?? 0) > 0,
    openMarketBuyShares: Number(r.amount_low ?? 0),
  }));
  const feats = computeInsiderFeatures(filings, windowDays);
  let inserted = 0, skipped = 0;
  for (const f of feats) {
    const res = await sql`
      insert into trd_features (feature_key, symbol, effective_date, value, requires_oos_proof)
      values (${f.feature_key}, ${f.symbol}, ${f.effective_date}, ${f.value}, ${f.requires_oos_proof})
      on conflict (feature_key, symbol, effective_date) do nothing`;
    res.count > 0 ? inserted++ : skipped++;
  }
  console.log(`[features] from ${filings.length} filings → ${feats.length} feature rows (inserted=${inserted} skipped(dup)=${skipped})`);
} finally {
  await sql.end();
}
