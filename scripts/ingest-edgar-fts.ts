#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-edgar-fts.ts (W4) — SEC EDGAR full-text search, the LAST engine-actionable coverage gap of substance.
//
// WHY THIS EXISTS. THE COVERAGE LAW was written because "accruals, cash-flow-to-price, gross profitability and NOA
// were never tested because their inputs were never fetched, and that absence was narrated as a market property."
// `trd_gap_register` records edgar-fulltext as unfetched and names what it blocks: every text-derived event signal —
// going-concern language, litigation disclosure, auditor changes. Until it is fetched, "no text edge" is a statement
// about our data, not about markets. This closes that.
//
// WHY THE LOOK-AHEAD CONTRACT IS CLEAN HERE, unusually. Most datasets need a publication-lag assumption bolted on
// (the 45-day STOCK Act lag; the 90-day fundamentals lag). EDGAR full-text returns `file_date` — the date the
// document was filed and therefore became publicly readable. The effective date IS the observation date. There is no
// lag to assume and none is assumed, which removes an entire class of the error D-616 spent a day attacking.
//
// SCOPE HONESTY: EDGAR full-text search covers 2001 onward, and its result window caps at 10,000 hits per query, so
// each (phrase, form, quarter) must stay under that. Quarterly windows on the going-concern phrase run ~1,500 hits,
// comfortably inside. If a window ever saturates, the script SAYS SO rather than silently truncating — a silent cap
// reads as "we covered everything" when it did not.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-edgar-fts", [
  { name: "PHRASE", def: "substantial doubt about its ability to continue as a going concern", note: "exact auditor language" },
  { name: "FORMS", def: "10-K", note: "comma-separated EDGAR root forms" },
  { name: "FROM_Y", def: "2015", note: "first calendar year" },
  { name: "TO_Y", def: "2026" },
  { name: "TAG", def: "going-concern", note: "filing_type suffix so families stay separable" },
  { name: "SLEEP_MS", def: "220", note: "SEC asks for <=10 req/s; this is well under" },
  { name: "DRYRUN", def: "", note: "1 = count only, write nothing" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";   // SEC requires an identifying User-Agent

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "efts", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hit {
  _source: {
    ciks: string[]; display_names: string[]; file_date: string; form: string;
    adsh: string; period_ending?: string; sics?: string[]; biz_states?: string[];
  };
}

// A ticker is only present in display_names for listed filers, as "NAME  (TICK)  (CIK 000...)". Non-listed filers
// legitimately have none; they are kept with a null ticker and resolved later against our own cik->ticker map, so a
// missing ticker never silently drops an observation.
const tickerOf = (names: string[]): string | null => {
  for (const n of names ?? []) {
    const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/);
    if (m) return m[1];
  }
  return null;
};

const PHRASE = K.PHRASE, FORMS = K.FORMS, TAG = K.TAG;
const FROM_Y = Number(K.FROM_Y), TO_Y = Number(K.TO_Y), SLEEP = Number(K.SLEEP_MS);
const DRY = K.DRYRUN === "1";

// Skip what we already hold, so a re-run is a no-op rather than a duplicate storm.
const seen = new Set<string>();
for (let off = 0;; off += 10000) {
  // source is CHECK-constrained to house|senate|edgar, so the family lives in filing_type rather than in a new
  // source value — a check constraint is a schema change, and schema changes are operator-gated here.
  const rows = await fetch(`${OWNED}/trd_raw_filings?source=eq.edgar&filing_type=like.*${TAG}*&select=source_id&offset=${off}&limit=10000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { source_id: string }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) seen.add(r.source_id);
  if (rows.length < 10000) break;
}
console.log(`==> EDGAR FULL-TEXT INGEST — "${PHRASE}"`);
console.log(`    forms ${FORMS} | ${FROM_Y}-${TO_Y} | already held: ${seen.size.toLocaleString()}`);

const QUARTERS: [string, string][] = [];
for (let y = FROM_Y; y <= TO_Y; y++) {
  QUARTERS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`],
    [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
}

let fetched = 0, written = 0, saturated = 0;
const failedWindows: string[] = [];
const batch: Record<string, unknown>[] = [];

const flush = async () => {
  if (DRY || !batch.length) { batch.length = 0; return; }
  const res = await fetch(`${OWNED}/trd_raw_filings`, {
    method: "POST",   // plumbing-ok: audited — status checked immediately below
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify(batch),
  });
  if (!res.ok) { console.error(`!! write failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); Deno.exit(1); }
  written += batch.length;
  batch.length = 0;
};

for (const [start, end] of QUARTERS) {
  if (Date.parse(start) > Date.now()) continue;
  let total = -1, from = 0, got = 0;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${PHRASE}"`)}`
      + `&forms=${encodeURIComponent(FORMS)}&startdt=${start}&enddt=${end}&from=${from}`;
    // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP. The first version of this loop `break`ed on any non-200,
    // which silently produced a dataset with two quarters missing out of four — and nothing downstream would have
    // known. That is the exact shape THE COVERAGE LAW exists to stop: absence of data narrated as absence of events.
    // Retry with backoff, and if a window still cannot be covered, record it as a FAILED window and report it.
    let j: { hits?: { total?: { value: number }; hits?: Hit[] } } | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 4 && !j; attempt++) {
      if (attempt) await sleep(SLEEP * (2 ** attempt) + 400);
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
        j = await r.json();
      } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    }
    if (!j) { failedWindows.push(`${start}..${end} (${lastErr})`); break; }
    const hits = j?.hits?.hits ?? [];
    if (total < 0) total = j?.hits?.total?.value ?? 0;
    if (!hits.length) break;
    for (const h of hits) {
      const s = h._source;
      fetched++;
      if (seen.has(s.adsh)) continue;
      seen.add(s.adsh);
      batch.push({
        source: "edgar",
        source_id: s.adsh,
        filing_type: `${s.form}|${TAG}`,
        ticker: tickerOf(s.display_names),
        disclosed_date: s.file_date,        // the date the text became public — no lag assumed
        raw: { cik: s.ciks?.[0] ?? null, names: s.display_names, period_ending: s.period_ending ?? null, sics: s.sics ?? null, states: s.biz_states ?? null },
      });
    }
    got += hits.length;
    from += hits.length;
    if (batch.length >= 500) await flush();
    // EDGAR caps the result window at 10,000. Saturation must be REPORTED, never silently truncated: a silent cap
    // reads as full coverage when it is not, which is precisely the failure THE COVERAGE LAW exists to prevent.
    if (from >= 9900 && got < total) { saturated++; console.log(`    ${start}  WINDOW SATURATED at ${from} of ${total} — narrow the window to cover the remainder`); break; }
    if (got >= total) break;
    await sleep(SLEEP);
  }
  console.log(`    ${start}..${end}  ${String(total).padStart(6)} hits`);
  await sleep(SLEEP);
}
await flush();

console.log(`\n    fetched ${fetched.toLocaleString()} hit(s) | ${DRY ? "DRYRUN — nothing written" : `wrote ${written.toLocaleString()} new row(s)`}`);
if (saturated) console.log(`    ${saturated} window(s) SATURATED — coverage of those windows is PARTIAL and must not be read as complete.`);
if (!DRY) assertNonEmpty("rows written or already held", [...seen], 100);

// Coverage verdict, stated explicitly rather than left for a reader to infer from the absence of complaints.
if (failedWindows.length) {
  console.log(`\n!! COVERAGE INCOMPLETE — ${failedWindows.length} window(s) could not be fetched after 4 attempts:`);
  for (const w of failedWindows) console.log(`     ${w}`);
  console.log(`   Any null result computed on this data is UNTESTED for those windows, not a market finding.`);
  console.log(`   Re-run to fill them; the ingest is idempotent and will only fetch what is missing.`);
  Deno.exit(2);
}
console.log(`    COVERAGE COMPLETE — every window in ${FROM_Y}-${TO_Y} returned a result.`);
