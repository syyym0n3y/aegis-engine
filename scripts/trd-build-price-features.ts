#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-build-price-features — derive point-in-time price features (trailing-return
// momentum) from trd_price_bars into trd_features. Idempotent.
//   deno run --allow-net --allow-env scripts/trd-build-price-features.ts [lookback]

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { Bar, trailingReturnFeatures } from "../supabase/functions/_shared/trd-price-features.ts";

const lookback = Number(Deno.args[0] ?? "252");
const key = `mom_${lookback}`;
const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB);

try {
  const rows = await sql`select symbol, ts::text as ts, close::float8 as close
    from trd_price_bars where timeframe='1Day' order by symbol, ts` as unknown as Array<{ symbol: string; ts: string; close: number }>;
  const bySym = new Map<string, Bar[]>();
  for (const r of rows) (bySym.get(r.symbol) ?? bySym.set(r.symbol, []).get(r.symbol)!).push({ ts: r.ts, close: r.close });

  let inserted = 0, syms = 0;
  for (const [symbol, bars] of bySym) {
    if (bars.length <= lookback) continue;
    syms++;
    const batch = trailingReturnFeatures(symbol, bars, lookback, key)
      .map((f) => ({ feature_key: f.feature_key, symbol: f.symbol, effective_date: f.effective_date, value: f.value, requires_oos_proof: false }));
    if (batch.length === 0) continue;
    const res = await sql`insert into trd_features ${sql(batch, "feature_key", "symbol", "effective_date", "value", "requires_oos_proof")}
      on conflict (feature_key, symbol, effective_date) do nothing`;
    inserted += res.count;
  }
  console.log(`[price-features] ${key}: ${syms} symbols → ${inserted} feature rows inserted`);
} finally {
  await sql.end();
}
