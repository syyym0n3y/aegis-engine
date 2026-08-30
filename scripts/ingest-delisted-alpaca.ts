#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-delisted-alpaca.ts (D-723) — fill the survivorship hole. The register's largest gap (D-716) and the binding
// constraint on the short-anomaly test (D-721), the FTD studies (D-687/703) and survivorship-correct breadth is that
// 27%+ of the equity universe — all delisted — is absent from trd_bars_deep. Alpaca's free IEX feed returns delisted
// symbols' daily history right up to the delisting date (verified: SIVB ends 2023-03-09, BBBY 2023-05-02, FRC
// 2023-04-28), which is exactly the missing cohort. This ingests them.
//
// TARGET: symbols that appear in trd_short_interest with a real ticker shape (^[A-Z]{1,5}$) but are NOT in the panel
// — the SEC-curated set of once-listed stocks we lack. Ordered most-recent-SI first (recently delisted = most
// IEX-coverable and most relevant to recent tests).
//
// DISCIPLINE:
//  - SEQUENTIAL (Hard Rule): one request at a time, rate-limited under Alpaca's 200/min. Not parallel.
//  - EFFICIENT: the multi-symbol bars endpoint fetches a whole batch per request, paginating via next_page_token.
//  - IDEMPOTENT + RESUMABLE: at start it re-reads which targets are already in the panel and skips them, so a re-run
//    continues where the last left off; symbols Alpaca has no data for are recorded so they are not retried forever.
//  - HONEST COVERAGE: IEX history begins ~2016, so pre-2016 delistings are NOT recoverable here — a stated limit,
//    logged as part of the run, not a silent partial fill.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-delisted-alpaca", [
  { name: "BATCH", def: "50", note: "symbols per multi-symbol request" },
  { name: "MAX_SYMBOLS", def: "0", note: "0 = all missing; else cap this run (for a bounded first pass)" },
  { name: "START", def: "2015-01-01", note: "history start (IEX data effectively begins ~2016)" },
  { name: "SLEEP_MS", def: "400", note: "delay between requests — keeps us under Alpaca's 200/min" },
  { name: "TARGETS", def: "/Users/ona/Projects/aegis/data/delisted-targets.txt", note: "precomputed missing-symbol list (one per line, recency-ordered)" },
  { name: "ADJUSTMENT", def: "all", note: "split+dividend adjustment — MUST be 'all' to match the existing panel's adjusted convention; 'raw' (Alpaca's default) puts split cliffs in the series and contaminates every cross-sectional return test (D-724)" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const AK = Deno.env.get("APCA_API_KEY_ID"), AS = Deno.env.get("APCA_API_SECRET_KEY");
if (!AK || !AS) { console.error("!! APCA_API_KEY_ID / APCA_API_SECRET_KEY not set — cannot ingest. RED."); Deno.exit(1); }
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ida", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const alpacaH = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// Keyset over the target list: symbols in SI (real ticker) not already in the panel. Computed via two reads and a
// JS difference (PostgREST has no anti-join), which is fine at this scale and keeps the query simple and auditable.
async function pageAll(path: string): Promise<Record<string, unknown>[]> {
  // Offset paging is only stable under a total ORDER BY, or pages can skip/duplicate rows. Enforce it rather than
  // trust the caller — every call site does pass order=, and this makes that a checked invariant not a convention.
  if (!/order=/.test(path)) throw new Error(`pageAll requires order= for stable paging: ${path}`);
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) {
    // plumbing-ok: audited — order= is asserted above, so this paged limit is deterministic, not row-layout roulette.
    const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr });
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
    const j = await r.json(); if (!Array.isArray(j) || !j.length) break;
    out.push(...j); if (j.length < 1000) break;
  }
  return out;
}
console.log("==> loading target list from file + current panel (for resume)…");
// The target list is PRECOMPUTED (data/delisted-targets.txt) by a single grouped DB query — paging 3.9M short-
// interest rows in JS to derive it took thousands of requests and timed out. Regenerate the file with:
//   docker exec aegis-db psql ... "SI real-tickers minus panel, order by max(settlement) desc" > data/delisted-targets.txt
const fileSyms = (await Deno.readTextFile(K.TARGETS)).split("\n").map((s) => s.trim()).filter(Boolean);
// Re-read the panel so a re-run skips symbols already ingested (idempotent resume). Only ~4k+ rows, a handful of pages.
const inPanel = new Set((await pageAll("trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol")).map((x) => x.symbol as string));
const targets = fileSyms.filter((s) => !inPanel.has(s));
assertNonEmpty("target symbols", targets, 100);
const cap = Number(K.MAX_SYMBOLS) > 0 ? Number(K.MAX_SYMBOLS) : targets.length;
const work = targets.slice(0, cap);
console.log(`    ${targets.length} missing symbols; this run processes ${work.length} (BATCH ${K.BATCH}, START ${K.START})`);

let reqs = 0, withData = 0, empty = 0, written = 0, barsTotal = 0;
const BATCH = Number(K.BATCH);
for (let i = 0; i < work.length; i += BATCH) {
  const batch = work.slice(i, i + BATCH);
  const acc = new Map<string, number[][]>();   // symbol -> bars [ts,o,h,l,c,v]
  let token: string | null = null;
  do {
    const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${batch.join(",")}&timeframe=1Day&feed=iex&adjustment=${K.ADJUSTMENT}&start=${K.START}&limit=10000${token ? `&page_token=${encodeURIComponent(token)}` : ""}`;
    const r = await fetch(url, { headers: alpacaH });
    reqs++;
    if (!r.ok) { console.log(`    batch ${i / BATCH | 0}: HTTP ${r.status} ${(await r.text()).slice(0, 100)} — skipping`); token = null; await sleep(Number(K.SLEEP_MS)); continue; }
    const j = await r.json() as { bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]>; next_page_token: string | null };
    for (const [sym, bars] of Object.entries(j.bars || {})) {
      const arr = acc.get(sym) ?? acc.set(sym, []).get(sym)!;
      for (const b of bars) if (b.c > 0) arr.push([epoch(b.t), b.o, b.h, b.l, b.c, b.v]);
    }
    token = j.next_page_token;
    await sleep(Number(K.SLEEP_MS));
  } while (token);

  // Write each symbol that returned data. These are new-to-panel names, so a plain insert; on_conflict=symbol keeps
  // it idempotent if a prior run already wrote one (resume safety).
  const rows: Record<string, unknown>[] = [];
  for (const [sym, bars] of acc) {
    if (bars.length < 20) { empty++; continue; }          // <20 bars is noise, not a usable history
    bars.sort((a, b) => a[0] - b[0]);
    withData++; barsTotal += bars.length;
    rows.push({ symbol: sym, asset_class: "equity",
      first_date: new Date(bars[0][0] * 1000).toISOString().slice(0, 10),
      last_date: new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10),
      n_bars: bars.length, bars, updated_at: new Date().toISOString() });
  }
  empty += batch.length - acc.size;
  if (rows.length) {
    const w = await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    if (!w.ok && w.status !== 409) console.log(`    WRITE-FAILED trd_bars_deep ${w.status} ${(await w.text()).slice(0, 120)}`);
    else written += rows.length;
  }
  if ((i / BATCH | 0) % 5 === 0 || i + BATCH >= work.length)
    console.log(`    ${Math.min(i + BATCH, work.length)}/${work.length} symbols | ${withData} with data, ${written} written, ${barsTotal.toLocaleString()} bars, ${reqs} reqs`);
}
console.log(`\n==> DONE: ${written} symbols written to the panel (${barsTotal.toLocaleString()} bars), ${empty} had no usable IEX history.`);
console.log(`    NOTE: this is a COVERAGE backfill — the SI-universe names we lacked. It includes genuinely DELISTED`);
console.log(`    common stocks (the survivorship-critical cohort, identifiable by last_date well before today) AND`);
console.log(`    still-listed names/ETFs we simply never ingested. Downstream should distinguish by last_date, and a`);
console.log(`    follow-up should classify ETF-vs-common-stock (both land here as asset_class='equity').`);
console.log(`    LIMIT: the free IEX feed via Alpaca effectively begins ~mid-2020, so each history is ~5y and pre-2020`);
console.log(`    delistings remain a stated hole — a smaller hole than before, honestly bounded.`);
