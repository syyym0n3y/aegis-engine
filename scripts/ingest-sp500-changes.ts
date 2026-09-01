#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-sp500-changes.ts — S&P 500 membership CHANGES (additions/deletions) from Wikipedia, free + keyless.
//
// SHAPE NOTE (deliberate): this does NOT write to trd_macro_series. That table is (series, d, v) — a scalar time
// series. An index change is a (date, added_ticker, removed_ticker, reason) TUPLE and does not fit; forcing it in
// would either lose the tickers or invent an encoding. A new table needs operator sign-off, so the output is a
// versioned JSON file at data/sp500-changes.json.
//
// SOURCE DISCIPLINE. The requested page (List_of_S%26P_500_companies) NO LONGER CARRIES the changes table —
// Wikipedia split it out to "Historical components of the S&P 500". The script tries the requested page FIRST,
// detects the absence, falls back, and RECORDS which source it actually parsed in the JSON. A silent fallback would
// be exactly the failure THE POSITIVE-CONTROL RULE exists to catch, so the source is stated, not assumed.
//
// POSITIVE CONTROL (D-641): a parse that returns zero rows and a parse that returns garbage both "succeed". So the
// run FAILS RED unless a known-true change is present in the output: TSLA added 2020-12-21.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-sp500-changes", [
  { name: "SP500_OUT", def: "data/sp500-changes.json", note: "output path" },
  { name: "SP500_UA", def: "aegis-research/1.0 (contact: ona@revitalise.io)", note: "User-Agent (Wikipedia requires one)" },
]);

const PRIMARY = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const FALLBACK = "https://en.wikipedia.org/wiki/Historical_components_of_the_S%26P_500";

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": K.SP500_UA, "Accept": "text/html" } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return await r.text();
}

const strip = (s: string) =>
  s.replace(/<sup[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
function isoDate(raw: string): string | null {
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  const i = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return i ? i[0] : null;
}

/** Return every <table>...</table> block whose header names an Added/Removed changes table. */
function changesTables(html: string): string[] {
  const out: string[] = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  for (const m of html.matchAll(re)) {
    const t = m[0];
    const head = t.slice(0, 2000);
    if (/>\s*Added\s*</i.test(head) && />\s*Removed\s*</i.test(head) && /Date/i.test(head)) out.push(t);
  }
  return out;
}

interface Change { date: string; added: string | null; removed: string | null; reason: string }

function parseTable(tbl: string): Change[] {
  const rows: Change[] = [];
  for (const rm of tbl.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const tr = rm[0];
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
    if (cells.length < 5) continue; // header rows and malformed rows
    const date = isoDate(cells[0]);
    if (!date) continue;
    const tk = (s: string) => (/^[A-Z][A-Z.\-]{0,6}$/.test(s) ? s : null);
    rows.push({ date, added: tk(cells[1]), removed: tk(cells[3]), reason: cells[5] ?? "" });
  }
  return rows;
}

// ---- fetch, with the source recorded rather than assumed ----
let source = PRIMARY;
let html = await get(PRIMARY);
let tables = changesTables(html);
if (!tables.length) {
  console.log(`    NOTE: no Added/Removed table on ${PRIMARY} (Wikipedia moved it). Falling back.`);
  source = FALLBACK;
  html = await get(FALLBACK);
  tables = changesTables(html);
}
if (!tables.length) {
  console.error("RED: no changes table found on either page — parse target moved again. Not writing output.");
  Deno.exit(1);
}

const seen = new Set<string>();
const changes: Change[] = [];
for (const t of tables) {
  for (const c of parseTable(t)) {
    const key = `${c.date}|${c.added ?? ""}|${c.removed ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(c);
  }
}
changes.sort((a, b) => a.date.localeCompare(b.date));

// ---- POSITIVE CONTROL: a known-true row must be present, or the parse is broken, not the market ----
const CONTROLS = [{ date: "2020-12-21", added: "TSLA" }];
const missing = CONTROLS.filter((c) => !changes.some((r) => r.date === c.date && r.added === c.added));
if (missing.length) {
  console.error(`RED: positive control FAILED — expected ${missing.map((m) => `${m.added} added ${m.date}`).join(", ")} not in ${changes.length} parsed rows.`);
  console.error("     A zero/garbage parse is indistinguishable from a real absence; refusing to write.");
  Deno.exit(1);
}

const adds = changes.filter((c) => c.added).length, rems = changes.filter((c) => c.removed).length;
const payload = {
  source,
  requested_url: PRIMARY,
  fetched_at: new Date().toISOString(),
  n_rows: changes.length,
  n_additions: adds,
  n_removals: rems,
  date_span: [changes[0].date, changes[changes.length - 1].date],
  positive_control: CONTROLS,
  changes,
};
await Deno.mkdir("data", { recursive: true });
await Deno.writeTextFile(K.SP500_OUT, JSON.stringify(payload, null, 2));

console.log(`\n==> S&P 500 MEMBERSHIP CHANGES ingested`);
console.log(`    source parsed   ${source}`);
console.log(`    requested page  ${PRIMARY} ${source === PRIMARY ? "(used)" : "(NO changes table — table has moved)"}`);
console.log(`    tables matched  ${tables.length}`);
console.log(`    rows parsed     ${changes.length}   (${adds} with an ADDED ticker, ${rems} with a REMOVED ticker)`);
console.log(`    date span       ${payload.date_span[0]} .. ${payload.date_span[1]}`);
console.log(`    POSITIVE CONTROL PASS: TSLA added 2020-12-21 present.`);
console.log(`    written         ${K.SP500_OUT}`);
console.log(`    CAVEAT: this is Wikipedia's "selected" changes list, not the S&P index-committee record. It is`);
console.log(`    known-incomplete for early years and is a COVERAGE statement, not a complete universe.\n`);
