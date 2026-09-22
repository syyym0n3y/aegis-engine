#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-coingecko-ref.ts (D-964) — the gap-register's one FREE + ALLOWLISTED + engine-actionable unmined dataset
// (row coingecko-blockchair). Pulls the CoinGecko reference universe (keyless public API, sequential, rate-limited)
// and computes the first measurement it uniquely enables: the CRYPTO COHORT OUTCOME DISTRIBUTION — how far the
// ACTIVE listed universe sits below its all-time high, by market-cap bucket. This is the honest base-rate context
// for the assay register's memecoin claims (rows 2/8: "median 1.5x" sniping).
// COVERAGE HONESTY, stated before the numbers: this is the ACTIVE-LISTED universe. Dead/delisted coins are absent,
// so every number below is SURVIVOR-BIASED OPTIMISTIC — the true cohort is strictly worse. That direction is the
// point: if even survivors sit mostly at deep drawdowns, the full-cohort lottery is worse than shown.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-coingecko-ref", [
  { name: "PAGES", def: "20", note: "markets pages (250/page) — 20 = top ~5000 by mcap" },
  { name: "SLEEP_MS", def: "6000", note: "spacing between calls (public keyless limit ~10-30/min; sequential per Hard Rule)" },
  { name: "OUT", def: "data/coingecko-ref.json" },
]);
const BASE = "https://api.coingecko.com/api/v3";
type Mkt = { id: string; symbol: string; market_cap: number | null; total_volume: number | null; current_price: number | null; ath_change_percentage: number | null; atl_change_percentage: number | null };
const rows: Mkt[] = []; const PAGES = +K.PAGES, SLEEP = +K.SLEEP_MS;
for (let p = 1; p <= PAGES; p++) {
  const r = await fetch(`${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false`);
  if (!r.ok) { console.error(`  page ${p}: HTTP ${r.status} — stopping here with ${rows.length} rows (rate limit respected, partial kept)`); break; }
  const j = await r.json() as Mkt[]; if (!Array.isArray(j) || !j.length) break;
  rows.push(...j); if (p % 5 === 0) console.log(`  page ${p}: ${rows.length} coins so far`);
  await new Promise((res) => setTimeout(res, SLEEP));
}
assertNonEmpty("coingecko markets rows", rows, 500);
// POSITIVE CONTROL (D-641): bitcoin must be present with a plausibly huge mcap, or the ingest is broken not empty.
const btc = rows.find((r) => r.id === "bitcoin");
if (!btc || !(btc.market_cap && btc.market_cap > 1e11)) { console.error("!! POSITIVE CONTROL FAILED: bitcoin absent or mcap implausible — refusing to write."); Deno.exit(1); }
await Deno.writeTextFile(new URL(`../${K.OUT}`, import.meta.url).pathname, JSON.stringify({ pulled: new Date().toISOString(), n: rows.length, rows }, null, 0));
console.log(`\n==> D-964 COINGECKO REFERENCE — ${rows.length} active coins written -> ${K.OUT} (BTC control: mcap $${(btc.market_cap! / 1e9).toFixed(0)}B OK)`);
// THE MEASUREMENT: distribution of drawdown-from-ATH across the active universe, by mcap bucket
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const buckets: [string, (m: number) => boolean][] = [
  ["mega  >$10B", (m) => m > 1e10], ["large $1-10B", (m) => m > 1e9 && m <= 1e10],
  ["mid $100M-1B", (m) => m > 1e8 && m <= 1e9], ["small $10-100M", (m) => m > 1e7 && m <= 1e8], ["micro <$10M", (m) => m > 0 && m <= 1e7],
];
console.log(`  DRAWDOWN FROM ATH (active universe — SURVIVOR-BIASED OPTIMISTIC; the dead are not here):`);
console.log(`    bucket           n     median    p75       p90     share<-90%  share<-99%`);
for (const [nm, f] of buckets) {
  const a = rows.filter((r) => r.market_cap && f(r.market_cap) && r.ath_change_percentage != null).map((r) => r.ath_change_percentage!);
  if (a.length < 20) { console.log(`    ${nm.padEnd(15)} ${String(a.length).padStart(4)}  (too thin)`); continue; }
  console.log(`    ${nm.padEnd(15)} ${String(a.length).padStart(4)}  ${q(a, 0.5).toFixed(0).padStart(6)}%  ${q(a, 0.25).toFixed(0).padStart(6)}%  ${q(a, 0.10).toFixed(0).padStart(6)}%  ${(100 * a.filter((x) => x <= -90).length / a.length).toFixed(0).padStart(9)}%  ${(100 * a.filter((x) => x <= -99).length / a.length).toFixed(0).padStart(9)}%`);
}
const all = rows.filter((r) => r.ath_change_percentage != null).map((r) => r.ath_change_percentage!);
console.log(`    ALL             ${String(all.length).padStart(4)}  ${q(all, 0.5).toFixed(0).padStart(6)}%  ${q(all, 0.25).toFixed(0).padStart(6)}%  ${q(all, 0.10).toFixed(0).padStart(6)}%  ${(100 * all.filter((x) => x <= -90).length / all.length).toFixed(0).padStart(9)}%  ${(100 * all.filter((x) => x <= -99).length / all.length).toFixed(0).padStart(9)}%`);
console.log(`  READ: every one of these coins is a SURVIVOR still listed and ranked. The full cohort (with the dead) is strictly worse in every cell.`);
