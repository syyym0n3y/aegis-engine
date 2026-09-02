#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-splits.ts (split table) — the missing dimension that makes every market-cap in this database wrong.
//
// THE DEFECT THIS EXISTS TO FIX. `trd_bars_deep` closes are FULLY SPLIT-ADJUSTED (expressed in TODAY'S share
// units). `trd_fundamentals` concept `EntityCommonStockSharesOutstanding` is RAW AS FILED (expressed in the share
// units of the FILING DATE). `mc = px_adj * sh_raw` therefore mixes two share bases and is wrong by the product of
// every split ratio occurring AFTER the filing date. Verified on live rows (russell-recon.ts PART A):
//     GWAV 2021-05-28 adjusted close $163,350 x 493.7M raw shares = "$80.7T"
//     AAPL 2021-05-28 $121.36 x 16.788B = $2.04T  -> CORRECT, only because AAPL has not split since that filing
// The contamination is not random. Names that FORWARD-SPLIT later are past winners, so their PAST market caps are
// inflated and every past yield (bm, ep, cfo_yield, fcf_yield, buyback_yield, div_yield, shareholder_yield) is
// DEFLATED for exactly the names that went on to win — a look-ahead-shaped bias toward "value works".
//
// No split table existed in this database. This builds one from Yahoo's chart `events=splits` payload, which is the
// same source the adjusted closes already come from — so the ratios are consistent with the price series by
// construction rather than by hope.
//
// STORAGE: `trd_macro_series` rows, series = "split:<SYMBOL>", d = split date, v = numerator/denominator.
//   a 7:1 forward split -> v = 7 ; a 1-for-10 reverse split -> v = 0.1.
// A SENTINEL row (d = 1900-01-01, v = 1) records "this symbol was CHECKED and has no splits", so a re-run does not
// refetch thousands of symbols. v = 1 is never a real split ratio, and 1900-01-01 predates every bar we hold.
//
// POSITIVE-CONTROL RULE (D-641): a splits ingest that silently returns nothing looks exactly like a universe with
// no splits. Two controls that MUST return non-zero: AAPL's 2014-06-09 7:1 and 2020-08-31 4:1, and at least one
// GWAV ratio < 1 (the reverse split that produced the $80T artifact). RED if either fails.
//
// SEQUENTIAL by mandate — one Yahoo request at a time with a sleep between. No parallelism, no batching.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-splits", [
  { name: "SPLIT_SLEEP_MS", def: "150", note: "sleep between sequential Yahoo requests" },
  { name: "SPLIT_MAX", def: "0", note: "0 = every symbol; >0 caps the run (resumable, so a cap is safe)" },
  { name: "SPLIT_REFETCH", def: "0", note: "1 = ignore the resume set and refetch every symbol" },
]);
const SLEEP = Number(K.SPLIT_SLEEP_MS), MAXN = Number(K.SPLIT_MAX), REFETCH = K.SPLIT_REFETCH === "1";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "splits", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const UA = { "User-Agent": "Mozilla/5.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. the symbol list ----------
// SCOPE, stated rather than assumed. The correction applies to `mc = px_adj * sh_raw`, so the symbols that need a
// split history are exactly those carrying an `EntityCommonStockSharesOutstanding` fact — a ticker with no share
// count has no market cap to contaminate. That is 6,151 of the 7,259 distinct tickers in `trd_fundamentals`; the
// 1,108 remainder are share-count-less and produce `mc = null` in the factory both before and after this fix.
// (It is also the only enumeration this schema can afford: `trd_fundamentals.ticker` is UNINDEXED over 4.1M rows,
// so a keyset walk on it costs a sequential scan per step, while `trd_fund_eff (concept, effective_date)` makes
// this path an index range read.)
const symbols: string[] = [];
{
  const seen = new Set<string>();
  for (let off = 0;; off += 10000) {
    const r = await fetch(
      `${OWNED}/trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker&order=effective_date.asc&offset=${off}&limit=10000`,
      { headers: hdr },
    );
    if (!r.ok) { console.error(`!! cannot read trd_fundamentals (HTTP ${r.status}) — refusing to run on an unknown universe.`); Deno.exit(1); }
    const j = await r.json() as { ticker: string | null }[];
    if (!Array.isArray(j) || !j.length) break;
    for (const x of j) if (x.ticker) seen.add(x.ticker);
    if (j.length < 10000) break;
  }
  symbols.push(...[...seen].sort());
}
assertNonEmpty("distinct share-count tickers in trd_fundamentals", symbols, 1000);
console.log(`==> SPLIT INGEST — ${symbols.length.toLocaleString()} distinct tickers carrying a share count`);

// ---------- 2. the resume set ----------
const done = new Set<string>();
if (!REFETCH) {
  for (let off = 0;; off += 10000) {
    const r = await fetch(`${OWNED}/trd_macro_series?series=like.split:*&select=series&order=series.asc,d.asc&offset=${off}&limit=10000`, { headers: hdr });
    if (!r.ok) { console.error(`!! cannot read trd_macro_series (HTTP ${r.status}) — RED.`); Deno.exit(1); }
    const j = await r.json() as { series: string }[];
    if (!Array.isArray(j) || !j.length) break;
    for (const x of j) done.add(x.series.slice(6));
    if (j.length < 10000) break;
  }
}
const todo = symbols.filter((s) => !done.has(s));
console.log(`    already checked: ${done.size.toLocaleString()}   to fetch: ${todo.length.toLocaleString()}${MAXN > 0 ? ` (capped at ${MAXN})` : ""}`);

// ---------- 3. sequential fetch ----------
// Yahoo quotes class shares with a dash (BRK-B); a few of our tickers carry a dot. Query with the dash form, STORE
// under the database's own ticker so the join back is exact.
const yahooSym = (t: string) => t.replace(/\./g, "-");
type Row = { series: string; d: string; v: number };
let fetched = 0, withSplits = 0, splitRows = 0, failed = 0;
const failedSyms: string[] = [];
const work = MAXN > 0 ? todo.slice(0, MAXN) : todo;

for (let i = 0; i < work.length; i++) {
  const sym = work[i];
  if (i > 0) await sleep(SLEEP);
  let rows: Row[] | null = null;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?interval=1d&range=max&events=splits`,
      { headers: UA },
    );
    if (r.status === 404) {
      // Yahoo does not know this symbol (delisted/renamed). That is a KNOWN answer — mark it checked so a re-run
      // does not spend the request again — but it is NOT "no splits": record it as checked-unknown via the sentinel
      // and count it, so the coverage number below is honest about what it means.
      rows = [{ series: `split:${sym}`, d: "1900-01-01", v: 1 }];
      failed++; failedSyms.push(sym);
    } else if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    } else {
      const j = await r.json();
      const ev = j?.chart?.result?.[0]?.events?.splits;
      rows = [];
      if (ev && typeof ev === "object") {
        for (const key of Object.keys(ev)) {
          const s = ev[key] as { date?: number; numerator?: number; denominator?: number };
          const num = Number(s?.numerator), den = Number(s?.denominator);
          if (!Number.isFinite(num) || !Number.isFinite(den) || !(num > 0) || !(den > 0)) continue;
          const d = new Date(Number(s.date) * 1000).toISOString().slice(0, 10);
          rows.push({ series: `split:${sym}`, d, v: num / den });
        }
      }
      if (rows.length) withSplits++;
      else rows = [{ series: `split:${sym}`, d: "1900-01-01", v: 1 }];   // checked, no splits
    }
  } catch (e) {
    // A transport failure is NOT an answer. Leave the symbol unmarked so the next run retries it.
    console.log(`    ${sym}: fetch error (${e instanceof Error ? e.message : e}) — left unmarked for retry`);
    rows = null;
  }
  if (rows) {
    const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, {
      method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows),
    });
    if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 160)}`); Deno.exit(1); }
    splitRows += rows.filter((r) => r.d !== "1900-01-01").length;
    fetched++;
  }
  if ((i + 1) % 500 === 0) {
    console.log(`    ..${i + 1}/${work.length}  checked=${fetched}  with-splits=${withSplits}  split-rows=${splitRows}  yahoo-404=${failed}`);
  }
}
console.log(`    DONE fetching: ${fetched} symbols marked, ${withSplits} carry splits, ${splitRows} split rows written, ${failed} unknown to Yahoo`);

// ---------- 4. POSITIVE CONTROLS (D-641) — a broken query returns zero, and so does a universe with no splits ----------
const readSeries = async (sym: string) =>
  await fetch(`${OWNED}/trd_macro_series?series=eq.${encodeURIComponent("split:" + sym)}&select=d,v&order=d.asc`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []) as { d: string; v: number }[];

const aapl = await readSeries("AAPL");
const gwav = await readSeries("GWAV");
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const c1 = aapl.some((r) => r.d === "2014-06-09" && near(r.v, 7));
const c2 = aapl.some((r) => r.d === "2020-08-31" && near(r.v, 4));
const c3 = gwav.some((r) => r.v < 1);

const total = await fetch(`${OWNED}/trd_macro_series?series=like.split:*&select=series&limit=1`, { headers: { ...hdr, Prefer: "count=exact" } })
  .then((r) => +((r.headers.get("content-range") || "").split("/")[1] || 0));

console.log(`\n==> POSITIVE CONTROLS`);
console.log(`    AAPL splits held: ${aapl.filter((r) => r.d !== "1900-01-01").map((r) => `${r.d}=${r.v}`).join(", ") || "(none)"}`);
console.log(`    ${c1 ? "PASS" : "RED "} AAPL 2014-06-09 ratio 7`);
console.log(`    ${c2 ? "PASS" : "RED "} AAPL 2020-08-31 ratio 4`);
console.log(`    GWAV splits held: ${gwav.filter((r) => r.d !== "1900-01-01").map((r) => `${r.d}=${r.v}`).join(", ") || "(none)"}`);
console.log(`    ${c3 ? "PASS" : "RED "} GWAV carries at least one REVERSE split (ratio < 1)`);
console.log(`    total split: rows in trd_macro_series (incl. sentinels): ${total.toLocaleString()}`);
if (!(c1 && c2 && c3)) { console.error(`!! POSITIVE CONTROL FAILED — the ingest is not trustworthy. RED.`); Deno.exit(1); }
console.log(`    all controls PASS.`);
