#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// prediction-markets-ingest.ts — pulls RESOLVED binary contracts from the two public prediction-market venues
// (Polymarket Gamma + CLOB price history; Kalshi settled-market listing) into data/prediction-markets.json
// (gitignored). No new table. Sequential requests only, ~200ms apart. Read-only public endpoints.
//
// DATA-SHAPE FACTS ESTABLISHED BY PROBE (2026-09-02) — these are why the code looks the way it does:
//
//  POLYMARKET (gamma-api.polymarket.com/markets?closed=true)
//   - `outcomePrices` on a CLOSED market is the SETTLEMENT vector, not a pre-resolution price: ["1","0"] = YES,
//     ["0","1"] = NO. Some closed rows carry ["0","0"] (void/never-resolved) and MUST be dropped, not read as NO.
//   - so the OUTCOME comes from gamma and every PRE-RESOLUTION PRICE must come from the CLOB
//     /prices-history?market=<yesTokenId>, which returns a full daily series -> all horizons from one request.
//   - `order=volumeNum&ascending=false` works, so the sample can be taken volume-first (largest markets first).
//   - there is NO bid/ask for a resolved market (the book endpoint serves live markets only). The spread is
//     therefore UNOBSERVABLE here and is handled downstream as a SWEPT ASSUMPTION, never as a measurement.
//
//  KALSHI (api.elections.kalshi.com/trade-api/v2/markets?status=settled)
//   - `last_price_dollars` IS the last TRADED price before settlement (verified: 0.0240 on a market whose
//     `result` is "no"), so the listing alone gives (price, outcome, volume, open, close). Good.
//   - BUT the archive is not reachable: `max_close_ts` returns only ~93 legacy rows (2024-05..2025-03), all with
//     volume 0; `min_close_ts`+`max_close_ts` together return 0; `series_ticker=` returns 0; `status=finalized`
//     is rejected as an invalid filter. The ONLY working traversal is the default cursor walk, which is ordered
//     newest-first and covers ~15 MINUTES of wall-clock per 1,000 rows.
//   - consequence, stated here so it cannot be lost downstream: the reachable Kalshi population is the recent
//     auto-generated short-dated (minutes-long) crypto/index contracts. 30d/7d/1d horizons do not EXIST for it.
//     That is a COVERAGE fact about the endpoint, not a finding about Kalshi.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("prediction-markets-ingest", [
  { name: "PM_PAGES", def: "200", note: "Polymarket gamma pages @100 (gamma CAPS limit at 100/page)" },
  { name: "PM_HIST_N", def: "1500", note: "how many Polymarket markets get a CLOB price-history call" },
  { name: "PM_MIN_VOL", def: "1000", note: "min Polymarket $ volume to keep a market" },
  { name: "KS_PAGES", def: "60", note: "Kalshi cursor pages @1000 (the ONLY working traversal)" },
  { name: "SLEEP_MS", def: "200", note: "sequential inter-request sleep" },
  { name: "OUT", def: "data/prediction-markets.json", note: "output (gitignored)" },
]);
const PM_PAGES = Number(K.PM_PAGES), PM_HIST_N = Number(K.PM_HIST_N), PM_MIN_VOL = Number(K.PM_MIN_VOL);
const KS_PAGES = Number(K.KS_PAGES), SLEEP_MS = Number(K.SLEEP_MS), OUT = K.OUT;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 3): Promise<unknown> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "accept": "application/json" } });
      if (r.ok) return await r.json();
      await r.body?.cancel();
    } catch { /* retry */ }
    await sleep(SLEEP_MS * (i + 2));
  }
  return null;
}

export interface PmMarket {
  venue: "polymarket";
  id: string;
  eventId: string;
  question: string;
  outcome: 0 | 1;
  volume: number;
  endDate: string;
  hist: [number, number][]; // [unix_seconds, yes_price]
}
export interface KsMarket {
  venue: "kalshi";
  ticker: string;
  series: string;
  title: string;
  outcome: 0 | 1;
  lastPrice: number;
  volume: number;
  openTime: string;
  closeTime: string;
}

// ---------------------------------------------------------------- POLYMARKET
const pmRaw: {
  id: string; eventId: string; question: string; outcome: 0 | 1; volume: number; endDate: string; yesToken: string;
}[] = [];
let pmSeen = 0, pmVoid = 0, pmNonBinary = 0, pmThinVol = 0;
// NOTE (probe): gamma silently CAPS `limit` at 100 regardless of what is asked for. Stepping the offset by the
// REQUESTED page size rather than the RETURNED row count would have skipped 400 of every 500 markets while
// printing a plausible-looking page counter — a silent sampling hole, exactly the precondition class D-598 exists
// for. The offset is therefore advanced by rows.length, and the effective page size is asserted below.
let pmOffset = 0;
for (let page = 0; page < PM_PAGES; page++) {
  const url = `https://gamma-api.polymarket.com/markets?closed=true&limit=100&offset=${pmOffset}` +
    `&order=volumeNum&ascending=false`;
  const rows = await getJson(url) as Record<string, unknown>[] | null;
  if (!rows || rows.length === 0) break;
  pmOffset += rows.length;
  for (const m of rows) {
    pmSeen++;
    let outs: string[], prices: string[], toks: string[];
    try {
      outs = JSON.parse(String(m.outcomes ?? "[]"));
      prices = JSON.parse(String(m.outcomePrices ?? "[]"));
      toks = JSON.parse(String(m.clobTokenIds ?? "[]"));
    } catch { pmNonBinary++; continue; }
    if (outs.length !== 2 || prices.length !== 2 || toks.length !== 2) { pmNonBinary++; continue; }
    if (outs[0].trim().toLowerCase() !== "yes") { pmNonBinary++; continue; }
    const a = Number(prices[0]), b = Number(prices[1]);
    // POSITIVE-CONTROL-adjacent: a resolved binary settles to exactly one of (1,0)/(0,1). Anything else is a void
    // or an unresolved row; reading ["0","0"] as "resolved NO" would silently inject fake losers.
    if (!((a === 1 && b === 0) || (a === 0 && b === 1))) { pmVoid++; continue; }
    const vol = Number(m.volumeNum ?? 0);
    if (!(vol >= PM_MIN_VOL)) { pmThinVol++; continue; }
    const ev = (m.events as { id?: string }[] | undefined)?.[0]?.id ?? String(m.id);
    pmRaw.push({
      id: String(m.id), eventId: String(ev), question: String(m.question ?? ""), outcome: a === 1 ? 1 : 0,
      volume: vol, endDate: String(m.endDate ?? m.closedTime ?? ""), yesToken: toks[0],
    });
  }
  console.error(`  [poly] page ${page + 1}/${PM_PAGES}  offset->${pmOffset}  kept ${pmRaw.length} of ${pmSeen} seen`);
  await sleep(SLEEP_MS);
}
assertNonEmpty("polymarket resolved binaries", pmRaw, 200);

pmRaw.sort((x, y) => y.volume - x.volume);
const pmTargets = pmRaw.slice(0, PM_HIST_N);
const pm: PmMarket[] = [];
let noHist = 0;
for (let i = 0; i < pmTargets.length; i++) {
  const t = pmTargets[i];
  const h = await getJson(
    `https://clob.polymarket.com/prices-history?market=${t.yesToken}&interval=max&fidelity=1440`,
  ) as { history?: { t: number; p: number }[] } | null;
  const hist = (h?.history ?? []).filter((x) => Number.isFinite(x.t) && x.p > 0 && x.p < 1)
    .map((x) => [x.t, x.p] as [number, number]);
  if (hist.length < 2) noHist++;
  else pm.push({ venue: "polymarket", id: t.id, eventId: t.eventId, question: t.question, outcome: t.outcome, volume: t.volume, endDate: t.endDate, hist });
  if ((i + 1) % 100 === 0) console.error(`  [poly-hist] ${i + 1}/${pmTargets.length}  usable ${pm.length}  no-history ${noHist}`);
  await sleep(SLEEP_MS);
}
assertNonEmpty("polymarket markets with price history", pm, 200);

// ---------------------------------------------------------------- KALSHI
const ks: KsMarket[] = [];
let ksSeen = 0, cursor = "";
for (let page = 0; page < KS_PAGES; page++) {
  const url = `https://api.elections.kalshi.com/trade-api/v2/markets?status=settled&limit=1000` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
  const d = await getJson(url) as { markets?: Record<string, unknown>[]; cursor?: string } | null;
  const rows = d?.markets ?? [];
  if (rows.length === 0) break;
  for (const m of rows) {
    ksSeen++;
    if (String(m.market_type) !== "binary") continue;
    const res = String(m.result ?? "").toLowerCase();
    if (res !== "yes" && res !== "no") continue;
    const p = Number(m.last_price_dollars);
    const vol = Number(m.volume_fp ?? 0);
    // volume 0 means NOBODY TRADED: last_price is then 0.0000 by default, not a price. Including those would
    // manufacture thousands of fake 0.00-priced losers and fabricate a longshot result out of nothing.
    if (!(vol > 0) || !(p > 0 && p < 1)) continue;
    const ticker = String(m.ticker);
    ks.push({
      venue: "kalshi", ticker, series: ticker.split("-")[0], title: String(m.title ?? ""),
      outcome: res === "yes" ? 1 : 0, lastPrice: p, volume: vol,
      openTime: String(m.open_time ?? ""), closeTime: String(m.close_time ?? ""),
    });
  }
  console.error(`  [kalshi] page ${page + 1}/${KS_PAGES}  kept ${ks.length} of ${ksSeen} seen`);
  cursor = d?.cursor ?? "";
  if (!cursor) break;
  await sleep(SLEEP_MS);
}
assertNonEmpty("kalshi settled traded binaries", ks, 200);

await Deno.mkdir("data", { recursive: true });
await Deno.writeTextFile(OUT, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  caps: {
    pmPages: PM_PAGES, pmHistN: PM_HIST_N, pmMinVol: PM_MIN_VOL, ksPages: KS_PAGES,
    pmListingSeen: pmSeen, pmDroppedVoid: pmVoid, pmDroppedNonBinary: pmNonBinary, pmDroppedThinVol: pmThinVol,
    pmNoHistory: noHist, ksListingSeen: ksSeen,
  },
  polymarket: pm,
  kalshi: ks,
}));
console.error(`\nwrote ${OUT}: polymarket ${pm.length}, kalshi ${ks.length}`);
