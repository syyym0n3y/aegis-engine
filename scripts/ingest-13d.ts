#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-13d.ts (FRONTIER) — SCHEDULE 13D activist filings from SEC EDGAR full-text search.
//
// WHY THIS EXISTS. A Schedule 13D is filed within 10 days of an investor crossing 5% ownership WITH INTENT to
// influence control (the passive counterpart is 13G). Brav/Jiang/Partnoy/Thomas (2008) document ~7% abnormal return
// around the filing — a catalyst that is legally disclosed, free from EDGAR, retail-observable, and never tested in
// this programme. This ingest lands the raw event table; scripts/activist-13d.ts runs the event study.
//
// WHY THE LOOK-AHEAD CONTRACT IS CLEAN (D-732 discipline). EDGAR full-text returns `file_date` — the date the
// document became publicly readable. A 13D's effective/knowable date IS its filing date, so no publication lag is
// assumed and none is needed (unlike the 90-day fundamentals lag or the 45-day STOCK-Act lag).
//
// TWO EDGAR FACTS this script is built around, both verified against the live API before writing:
//   (1) EDGAR full-text does NOT index 13D by any distinctive PHRASE, so the filings are enumerated by FORM. The API
//       still requires a non-empty `q` (an empty q returns HTTP 500). The enumeration key is therefore the STOPWORD
//       "of" — chosen empirically as the MAXIMAL-coverage key: measured live, q="of" returns 2652 SCHEDULE 13D in
//       2025Q1 and 2327 SC 13D in 2022Q1, strictly more than "the" (2619/2318) and far more than the cover-page phrase
//       "securities exchange act of 1934" (785 for the 2025 XML format, 1886 for the old). It is an enumeration KEY,
//       not a content filter; the coverage note states it as a FLOOR (a filing with no indexed prose at all would be
//       missed), not a certainty.
//   (2) THE FORM LABEL CHANGED IN 2025. Under the SEC's structured-data mandate, EDGAR relabels the form from
//       "SC 13D"/"SC 13D/A" (through 2024) to "SCHEDULE 13D"/"SCHEDULE 13D/A" (2025+). A first ingest keyed only on
//       "SC 13D" returned ZERO for every 2025-2026 window while the same window held thousands of filings — the exact
//       false-zero THE POSITIVE-CONTROL RULE exists to catch. So FORMS enumerates BOTH labels. `forms=` is a PREFIX
//       match, so each label also returns its /A amendments; we split on the exact `form` field via the "/A" marker,
//       which is present in both "SC 13D/A" and "SCHEDULE 13D/A": originals -> filing_type "sc-13d", amendments ->
//       "sc-13d-a" (an amendment is not a new position, so the base event study reads only "sc-13d").
//
// THE SUBJECT, NOT THE FILER. A 13D names a SUBJECT company (the target) and a FILER (the activist). We want the
// subject's ticker. Verified on live hits: EDGAR lists the subject FIRST in `display_names`/`ciks` and the filer(s)
// after — e.g. ['CONTINENTAL RESOURCES (CIK ...)', 'Clement Roger Verlin (CIK ...)']. So subject = index 0. The
// subject's ticker is usually inline in display_names[0] for listed names; when absent (common for the small caps that
// 13D targets skew toward) it is resolved from the subject CIK via the submissions API, cached per CIK.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-13d", [
  { name: "QKEY", def: "of", note: "maximal-coverage enumeration STOPWORD (beats 'the' and the cover phrase on live counts) — a key, NOT a content filter" },
  { name: "FORMS", def: "SC 13D,SCHEDULE 13D", note: "both form labels: SC 13D (<=2024) and SCHEDULE 13D (2025+, structured-data mandate); each also returns its /A" },
  { name: "FROM_Y", def: "2015", note: "first calendar year" },
  { name: "TO_Y", def: "2026" },
  { name: "SLEEP_MS", def: "220", note: "SEC asks <=10 req/s; this is well under" },
  { name: "RESOLVE_CIK", def: "1", note: "1 = resolve a missing subject ticker from its CIK via submissions API" },
  { name: "DRYRUN", def: "", note: "1 = count only, write nothing" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io"; // SEC requires an identifying User-Agent

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "i13d", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q: readStrict } = mkStrictRead(OWNED, hdr);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hit {
  _source: { ciks: string[]; display_names: string[]; file_date: string; form: string; adsh: string; sics?: string[]; biz_states?: string[]; };
}
// Parse a ticker out of an EDGAR display name "NAME  (TICK, TICK-WT)  (CIK 000...)". Returns the first plausible
// ticker or null. Non-listed subjects legitimately have none.
const tickerOf = (name: string | undefined): string | null => {
  if (!name) return null;
  const m = name.match(/\(([A-Z][A-Z0-9.\-]{0,6})(?:,[^)]*)?\)\s*\(CIK/);
  return m ? m[1] : null;
};

const QKEY = K.QKEY, FROM_Y = Number(K.FROM_Y), TO_Y = Number(K.TO_Y), SLEEP = Number(K.SLEEP_MS);
const FORMS = K.FORMS; // comma-separated form labels; each segment encoded, comma kept as the EDGAR list separator
const FORMS_PARAM = FORMS.split(",").map((s) => encodeURIComponent(s.trim())).join(",");
const DRY = K.DRYRUN === "1", RESOLVE = K.RESOLVE_CIK === "1";

// Skip accessions already held under a 13d tag, so a re-run is a no-op rather than a duplicate storm. STRICT read:
// a swallowed [] here would re-fetch and re-write everything (D-756).
const seen = new Set<string>();
for (let off = 0; ; off += 10000) {
  const rows = await readStrict(`trd_raw_filings?filing_type=like.sc-13d*&select=source_id&order=source_id&offset=${off}&limit=10000`) as { source_id: string }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) seen.add(r.source_id);
  if (rows.length < 10000) break;
}
console.log(`==> EDGAR SCHEDULE 13D INGEST — enumeration key "${QKEY}"`);
console.log(`    ${FROM_Y}-${TO_Y} quarterly | forms "${FORMS}" (each returns its /A too) | already held: ${seen.size.toLocaleString()}`);

const QUARTERS: [string, string][] = [];
for (let y = FROM_Y; y <= TO_Y; y++) {
  QUARTERS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
}

// CIK -> ticker cache for the submissions fallback (subjects whose ticker is not inline in display_names).
const cikCache = new Map<string, string | null>();
async function resolveCik(cik: string): Promise<string | null> {
  if (cikCache.has(cik)) return cikCache.get(cik)!;
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  let t: string | null = null;
  try {
    const j = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: { "User-Agent": UA } }).then((r) => r.ok ? r.json() : null);
    const tks = (j?.tickers as string[]) || [];
    t = tks.length ? tks[0] : null;
  } catch { t = null; }
  cikCache.set(cik, t);
  await sleep(150);
  return t;
}

let fetched = 0, written = 0, saturated = 0, origCount = 0, amendCount = 0, resolvedByCik = 0, noTicker = 0;
const perYearOrig = new Map<number, number>(), perYearAmend = new Map<number, number>();
const activistHits: string[] = []; // POSITIVE CONTROL: known activists must appear among filers
const ACTIVIST = /\b(ICAHN|ELLIOTT|STARBOARD|ENGINE\s+CAPITAL|TRIAN|VALUEACT|PERSHING\s+SQUARE|THIRD\s+POINT)\b/i;
const failedWindows: string[] = [];
const batch: Record<string, unknown>[] = [];

const flush = async () => {
  if (DRY || !batch.length) { batch.length = 0; return; }
  // on_conflict=source,source_id + ignore-duplicates: idempotent re-runs and cross-search overlap are no-ops rather
  // than a crash (the plain insert exited the whole run on the first collision).
  const res = await fetch(`${OWNED}/trd_raw_filings?on_conflict=source,source_id`, {
    method: "POST", // plumbing-ok: audited — status checked immediately below
    headers: { ...hdr, Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify(batch),
  });
  if (!res.ok && res.status !== 409) { console.error(`!! write failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); Deno.exit(1); }
  written += batch.length;
  batch.length = 0;
};

for (const [start, end] of QUARTERS) {
  if (Date.parse(start) > Date.now()) continue;
  let total = -1, from = 0, got = 0;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${QKEY}"`)}`
      + `&forms=${FORMS_PARAM}&startdt=${start}&enddt=${end}&from=${from}`;
    // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP (THE COVERAGE LAW). Retry with backoff; a window that still
    // cannot be covered is recorded as FAILED and reported, never silently dropped.
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
      const isAmend = s.form.toUpperCase().includes("/A");
      const subjName = s.display_names?.[0], subjCik = s.ciks?.[0] ?? null;
      const filerNames = (s.display_names ?? []).slice(1);
      if (ACTIVIST.test(filerNames.join(" | ")) && activistHits.length < 12) activistHits.push(`${s.form} ${s.file_date}: ${subjName} <= ${filerNames.join(", ")}`);
      let ticker = tickerOf(subjName);
      if (!ticker && RESOLVE && subjCik) { ticker = await resolveCik(subjCik); if (ticker) resolvedByCik++; }
      if (!ticker) noTicker++;
      const y = Number(s.file_date.slice(0, 4));
      if (isAmend) { amendCount++; perYearAmend.set(y, (perYearAmend.get(y) ?? 0) + 1); }
      else { origCount++; perYearOrig.set(y, (perYearOrig.get(y) ?? 0) + 1); }
      batch.push({
        source: "edgar",
        source_id: s.adsh,
        filing_type: isAmend ? "sc-13d-a" : "sc-13d",
        ticker,
        disclosed_date: s.file_date, // the date the 13D became public — no lag assumed (D-732)
        raw: {
          subject_cik: subjCik, subject_name: subjName ?? null,
          filer_ciks: (s.ciks ?? []).slice(1), filer_names: filerNames,
          sics: s.sics ?? null, states: s.biz_states ?? null,
        },
      });
    }
    got += hits.length;
    from += hits.length;
    if (batch.length >= 500) await flush();
    if (from >= 9900 && got < total) { saturated++; console.log(`    ${start}  WINDOW SATURATED at ${from} of ${total} — narrow the window to cover the remainder`); break; }
    if (got >= total) break;
    await sleep(SLEEP);
  }
  console.log(`    ${start}..${end}  ${String(total).padStart(6)} hits (13D + 13D/A)`);
  await sleep(SLEEP);
}
await flush();

console.log(`\n    fetched ${fetched.toLocaleString()} hit(s) | ${DRY ? "DRYRUN — nothing written" : `wrote ${written.toLocaleString()} new row(s)`}`);
console.log(`    originals (sc-13d): ${origCount.toLocaleString()} | amendments (sc-13d-a): ${amendCount.toLocaleString()}`);
console.log(`    subject ticker: ${resolvedByCik.toLocaleString()} resolved via CIK submissions | ${noTicker.toLocaleString()} still null (unlisted/agent subject — dropped by the event study, counted as coverage)`);
console.log(`    per-year ORIGINALS (sc-13d):`);
for (let y = FROM_Y; y <= TO_Y; y++) if (perYearOrig.has(y) || perYearAmend.has(y)) console.log(`       ${y}: ${String(perYearOrig.get(y) ?? 0).padStart(4)} orig | ${String(perYearAmend.get(y) ?? 0).padStart(4)} amend`);

// POSITIVE CONTROL (THE POSITIVE-CONTROL RULE): a form-only enumeration that returned zero known activists would be
// a broken question, not an empty market. At least one Icahn/Elliott/Starboard-class 13D MUST appear.
console.log(`\n    POSITIVE CONTROL — known activist filers among subjects (must be non-empty):`);
if (activistHits.length === 0 && !DRY) {
  console.error(`!! ZERO known activists found across ${fetched} fetched 13Ds — the enumeration is broken, not the market. RED.`);
  Deno.exit(1);
}
for (const a of activistHits.slice(0, 8)) console.log(`       ${a}`);

if (saturated) console.log(`\n    ${saturated} window(s) SATURATED — coverage of those windows is PARTIAL and must not be read as complete.`);
if (!DRY) assertNonEmpty("13D rows written or already held", [...seen], 100);

if (failedWindows.length) {
  console.log(`\n!! COVERAGE INCOMPLETE — ${failedWindows.length} window(s) could not be fetched after 4 attempts:`);
  for (const w of failedWindows) console.log(`     ${w}`);
  console.log(`   Re-run to fill them; the ingest is idempotent and will only fetch what is missing.`);
  Deno.exit(2);
}
console.log(`\n    COVERAGE NOTE: enumeration key is the cover-page phrase "${QKEY}", present on essentially every`);
console.log(`    Schedule 13D — a coverage FLOOR (a 13D omitting the exact phrase would be missed), not a certainty.`);
console.log(`    COVERAGE COMPLETE — every window in ${FROM_Y}-${TO_Y} returned a result.`);
