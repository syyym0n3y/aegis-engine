#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-nt-filings.ts — Form NT 10-K / NT 10-Q / NT 20-F, the Rule 12b-25 "Notification of Late Filing".
//
// WHAT THIS IS. When a company cannot file its annual/quarterly report on time it must file a Form NT ("Notification
// of late filing", SEC Rule 12b-25). Late filing is a documented, legally-disclosed, retail-observable DISTRESS
// signal — it frequently precedes a restatement, a going-concern qualification, an auditor change or a delisting. It
// has never been tested in this programme. It is a SHORT / AVOID signal, measured honestly as such in late-filing.ts.
//
// WHY THE LOOK-AHEAD CONTRACT IS CLEAN HERE (like edgar-fts, unlike fundamentals). EDGAR full-text returns
// `file_date` — the day the NT became publicly readable. The effective date IS the observation date. There is NO
// publication lag to assume and none is assumed. Entry is nonetheless lag-1 (the session strictly after the filing)
// in the event study, because an NT filed after the close cannot be acted on at that close (D-498 SAME-BAR COROLLARY).
//
// COVERAGE HONESTY (THE COVERAGE LAW). EDGAR full-text covers 2001+, caps each window at 10,000 hits, and counts
// DOCUMENTS not filings (one NT can carry several document hits sharing one accession). Per-quarter NT counts run a
// few hundred to low thousands — comfortably inside the cap — but any window that saturates or cannot be fetched is
// RECORDED and REPORTED, never silently truncated. Dedup is on accession (adsh); a filing counted once.
//
// TICKER. EDGAR full-text embeds the ticker in display_names for LISTED filers ("NAME  (TICK)  (CIK 000...)"), which
// is the registrant's current listed symbol keyed on the filer CIK — the same source data.sec.gov/submissions
// serves. Non-listed filers legitimately carry none; they are stored with a null ticker and the filer CIK, and
// resolved later in late-filing.ts against our own cik->ticker map, so a missing ticker never silently drops an
// observation (the going-concern.ts discipline). period_ending is retained in raw for the (ticker, fiscal-period)
// dedup and repeat-filer detection the event study performs.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-nt-filings", [
  { name: "FORMS", def: "NT 10-K,NT 10-Q,NT 20-F", note: "comma-separated EDGAR NT root forms, fetched one at a time" },
  { name: "FROM_Y", def: "2015", note: "first calendar year" },
  { name: "TO_Y", def: "2026" },
  { name: "TAG", def: "nt-late", note: "filing_type suffix so the family stays separable" },
  { name: "SLEEP_MS", def: "220", note: "SEC asks <=10 req/s; this is well under" },
  { name: "DRYRUN", def: "", note: "1 = count only, write nothing" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";   // SEC requires an identifying User-Agent

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ntlate", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { qAll } = mkStrictRead(OWNED, hdr);   // D-757: the seed read of already-held rows must not fail silently to []

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hit {
  _source: {
    ciks: string[]; display_names: string[]; file_date: string; form: string;
    adsh: string; period_ending?: string; sics?: string[]; biz_states?: string[];
  };
}

const tickerOf = (names: string[]): string | null => {
  for (const n of names ?? []) {
    const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/);
    if (m) return m[1];
  }
  return null;
};

const FORMS = K.FORMS.split(",").map((s) => s.trim()).filter(Boolean);
const TAG = K.TAG;
const FROM_Y = Number(K.FROM_Y), TO_Y = Number(K.TO_Y), SLEEP = Number(K.SLEEP_MS);
const DRY = K.DRYRUN === "1";

// Skip what we already hold, so a re-run is a no-op rather than a duplicate storm. mkStrictRead throws on a transport
// failure rather than returning [] — a silent [] here would re-fetch the whole corpus (harmless, ignore-duplicates)
// but would also let a mid-restart truncated seed pass as "held nothing", so it is read strictly.
// source is CHECK-constrained to house|senate|edgar; the family lives in filing_type, not a new source value.
const seen = new Set<string>();
for (const r of await qAll(`trd_raw_filings?source=eq.edgar&filing_type=like.*${TAG}*&select=source_id&order=source_id`) as { source_id: string }[]) {
  seen.add(r.source_id);
}
console.log(`==> EDGAR NT LATE-FILING INGEST — forms ${FORMS.join(", ")}`);
console.log(`    ${FROM_Y}-${TO_Y} | already held: ${seen.size.toLocaleString()}`);

const QUARTERS: [string, string][] = [];
for (let y = FROM_Y; y <= TO_Y; y++) {
  QUARTERS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`],
    [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
}

let fetched = 0, written = 0, saturated = 0;
const failedWindows: string[] = [];
const perYear = new Map<number, number>();   // distinct accessions seen this run, by file-date year (positive control)
const batch: Record<string, unknown>[] = [];

const flush = async () => {
  if (DRY || !batch.length) { batch.length = 0; return; }
  // on_conflict=source,source_id + ignore-duplicates: cross-form or re-run overlap is a no-op, not a crash.
  const res = await fetch(`${OWNED}/trd_raw_filings?on_conflict=source,source_id`, {
    method: "POST",   // plumbing-ok: audited — status checked immediately below
    headers: { ...hdr, Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify(batch),
  });
  if (!res.ok && res.status !== 409) { console.error(`!! write failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); Deno.exit(1); }
  written += batch.length;
  batch.length = 0;
};

for (const FORM of FORMS) {
  console.log(`\n  --- ${FORM} ---`);
  for (const [start, end] of QUARTERS) {
    if (Date.parse(start) > Date.now()) continue;
    let total = -1, from = 0, got = 0;
    while (true) {
      // Empty q + forms= returns every filing of that root form in the window (verified: 357 NT 10-K in Q1 2020).
      const url = `https://efts.sec.gov/LATEST/search-index?q=`
        + `&forms=${encodeURIComponent(FORM)}&startdt=${start}&enddt=${end}&from=${from}`;
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
      // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP (THE COVERAGE LAW). Record and report it.
      if (!j) { failedWindows.push(`${FORM} ${start}..${end} (${lastErr})`); break; }
      const hits = j?.hits?.hits ?? [];
      if (total < 0) total = j?.hits?.total?.value ?? 0;
      if (!hits.length) break;
      for (const h of hits) {
        const s = h._source;
        fetched++;
        if (seen.has(s.adsh)) continue;   // dedup on accession — one filing, counted once, even across doc hits
        seen.add(s.adsh);
        perYear.set(Number(s.file_date.slice(0, 4)), (perYear.get(Number(s.file_date.slice(0, 4))) ?? 0) + 1);
        batch.push({
          source: "edgar",
          source_id: s.adsh,
          filing_type: `${s.form}|${TAG}`,
          ticker: tickerOf(s.display_names),
          disclosed_date: s.file_date,        // the date the NT became public — no lag assumed (knowable immediately)
          raw: { cik: s.ciks?.[0] ?? null, names: s.display_names, period_ending: s.period_ending ?? null, form: s.form, sics: s.sics ?? null, states: s.biz_states ?? null },
        });
      }
      got += hits.length;
      from += hits.length;
      if (batch.length >= 500) await flush();
      if (from >= 9900 && got < total) { saturated++; console.log(`    ${FORM} ${start}  WINDOW SATURATED at ${from} of ${total} — narrow the window`); break; }
      if (got >= total) break;
      await sleep(SLEEP);
    }
    console.log(`    ${start}..${end}  ${String(total).padStart(6)} doc-hits`);
    await sleep(SLEEP);
  }
}
await flush();

console.log(`\n    fetched ${fetched.toLocaleString()} doc-hit(s) | ${DRY ? "DRYRUN — nothing written" : `wrote ${written.toLocaleString()} new row(s)`}`);
if (saturated) console.log(`    ${saturated} window(s) SATURATED — coverage of those windows is PARTIAL, not complete.`);

// POSITIVE CONTROL (THE POSITIVE-CONTROL RULE): NT filings are common in small caps — every year in range must be
// non-zero, and the per-year count must land in the "few hundred to low thousands" band. A silent zero year would
// look like "no distress that year" when it is really a broken fetch. Only meaningful on a fresh (non-empty) run.
const yearsInRange: number[] = [];
for (let y = FROM_Y; y <= Math.min(TO_Y, new Date().getFullYear()); y++) yearsInRange.push(y);
if (!DRY && written > 0) {
  console.log(`\n    POSITIVE CONTROL — new NT accessions per file-date year (expect a few hundred to low thousands, non-zero):`);
  const zeroYears: number[] = [];
  for (const y of yearsInRange) {
    const n = perYear.get(y) ?? 0;
    console.log(`      ${y}: ${String(n).padStart(6)}${n === 0 ? "   *** ZERO — investigate" : ""}`);
    if (n === 0) zeroYears.push(y);
  }
  // A zero year is only alarming for a year we actually fetched fresh; on a re-run most rows are already held (deduped
  // out of perYear), so zero-per-year is expected and NOT a failure. Flag only when the run wrote broadly but a year
  // that should be dense (a full past year) came back empty.
  const denseZero = zeroYears.filter((y) => y < new Date().getFullYear());
  if (written > 500 && denseZero.length) {
    console.error(`!! POSITIVE CONTROL FAILED — ${denseZero.join(", ")} returned ZERO new NT filings on a fresh bulk run.`);
    console.error(`   A dense past year with no late filings is a broken fetch, not a market fact (THE POSITIVE-CONTROL RULE).`);
    Deno.exit(1);
  }
}

if (!DRY) assertNonEmpty("NT rows written or already held", [...seen], 100);

if (failedWindows.length) {
  console.log(`\n!! COVERAGE INCOMPLETE — ${failedWindows.length} window(s) could not be fetched after 4 attempts:`);
  for (const w of failedWindows) console.log(`     ${w}`);
  console.log(`   Any null result on this data is UNTESTED for those windows. Re-run — the ingest is idempotent.`);
  Deno.exit(2);
}
console.log(`\n    COVERAGE COMPLETE — every window in ${FROM_Y}-${TO_Y} returned a result. Total NT accessions held: ${seen.size.toLocaleString()}`);
