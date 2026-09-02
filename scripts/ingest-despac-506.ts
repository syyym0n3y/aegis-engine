#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-despac-506.ts (D-734b fix) — the DEFINITIVE de-SPAC completion marker.
//
// WHY THIS EXISTS. D-734 built its de-SPAC event table from the full-text phrase "consummation of the business
// combination". That phrase also appears in a SPAC's own IPO-closing 8-K, and despac-event.ts keeps the FIRST 8-K
// per ticker — so LCID's "completion" was 2020-08-04 (Churchill IV's IPO closing; the Lucid merger closed
// 2021-07-23), SOFI's 2020-10-14, OPEN's 2020-04-30, and PSTH — which never merged at all — carried a row. The
// -40.7% 500-day "de-SPAC destruction" was therefore measured, for an unknown fraction of its 204 events, from a
// window that begins at the SPAC's IPO and contains the pre-deal flat period and the deal announcement pop.
//
// THE CORRECT MARKER is Item 5.06 of Form 8-K, "Change in Shell Company Status" — the item a former blank-check
// company files exactly once, when it ceases to be a shell, normally alongside Item 2.01 "Completion of Acquisition
// or Disposition of Assets" (the "Super 8-K"). "Change in Shell Company Status" is the official item TITLE from the
// Form 8-K General Instructions, so a filer reporting 5.06 prints it verbatim. A company can only stop being a
// shell once, so the FIRST 5.06 per CIK is the completion — and a SPAC that never merged files none, which is why
// PSTH must be ABSENT rather than merely late.
//
// TICKER RESOLUTION. The filer CIK is the FORMER SPAC's CIK; the entity survives the merger and renames, so the
// CURRENT ticker on data.sec.gov/submissions for that CIK is the POST-merger ticker — the thing that actually
// trades in the forward window. That is the resolution used, with the full-text display_names as a fallback.
//
// COVERAGE HONESTY. The unique key on trd_raw_filings is (source, source_id) = (edgar, accession) ALONE, so an
// accession already stored under another filing_type cannot be re-tagged without MODIFYING an existing row, which
// this fix is forbidden to do. Such collisions are COUNTED AND REPORTED rather than silently dropped, and the
// resolved event set is also written to a sidecar JSON so a collision can never quietly shrink the event table.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-despac-506", [
  { name: "PHRASE", def: "Change in Shell Company Status", note: "the Item 5.06 title, verbatim" },
  { name: "FORMS", def: "8-K", note: "includes 8-K/A" },
  { name: "FROM_Y", def: "2018" },
  { name: "TO_Y", def: "2026" },
  { name: "TAG", def: "despac-506", note: "NEW filing_type suffix; the old despac rows are untouched" },
  { name: "SLEEP_MS", def: "220", note: "SEC asks <=10 req/s" },
  { name: "DRYRUN", def: "", note: "1 = fetch + resolve + report, write nothing" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "d506", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const R = mkStrictRead(OWNED, hdr);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLEEP = Number(K.SLEEP_MS), DRY = K.DRYRUN === "1";

interface Hit { _source: { ciks: string[]; display_names: string[]; file_date: string; form: string; adsh: string } }

// ---------------------------------------------------------------- (1) FETCH
const QUARTERS: [string, string][] = [];
for (let y = Number(K.FROM_Y); y <= Number(K.TO_Y); y++) {
  QUARTERS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
}
console.log(`==> DE-SPAC ITEM 5.06 INGEST — "${K.PHRASE}" | forms ${K.FORMS} | ${K.FROM_Y}-${K.TO_Y}`);

type Rec = { adsh: string; cik: string; date: string; form: string; names: string[] };
const hits: Rec[] = [];
const failedWindows: string[] = [];
let saturated = 0;
for (const [start, end] of QUARTERS) {
  if (Date.parse(start) > Date.now()) continue;
  let total = -1, from = 0, got = 0;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${K.PHRASE}"`)}&forms=${encodeURIComponent(K.FORMS)}&startdt=${start}&enddt=${end}&from=${from}`;
    let j: { hits?: { total?: { value: number }; hits?: Hit[] } } | null = null; let lastErr = "";
    for (let a = 0; a < 4 && !j; a++) {
      if (a) await sleep(SLEEP * 2 ** a + 400);
      try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; } j = await r.json(); }
      catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    }
    if (!j) { failedWindows.push(`${start}..${end} (${lastErr})`); break; }
    const hh = j?.hits?.hits ?? [];
    if (total < 0) total = j?.hits?.total?.value ?? 0;
    if (!hh.length) break;
    for (const h of hh) hits.push({ adsh: h._source.adsh, cik: h._source.ciks?.[0] ?? "", date: h._source.file_date, form: h._source.form, names: h._source.display_names ?? [] });
    got += hh.length; from += hh.length;
    if (from >= 9900 && got < total) { saturated++; console.log(`    ${start} WINDOW SATURATED ${from}/${total}`); break; }
    if (got >= total) break;
    await sleep(SLEEP);
  }
  console.log(`    ${start}..${end}  ${String(total).padStart(5)} hits`);
  await sleep(SLEEP);
}
if (failedWindows.length) { console.error(`!! COVERAGE INCOMPLETE — ${failedWindows.length} window(s) failed:`); for (const w of failedWindows) console.error(`     ${w}`); Deno.exit(2); }
if (saturated) console.log(`    ${saturated} window(s) SATURATED — coverage PARTIAL there.`);
assertNonEmpty("Item 5.06 8-K hits", hits, 200);

// ------------------------------------------------- (2) FIRST 5.06 PER CIK
// A company can only stop being a shell once. The FIRST 5.06 is the completion; later ones (8-K/A amendments,
// re-filings) are the same event restated.
const firstByCik = new Map<string, Rec>();
for (const h of hits) { if (!h.cik) continue; const c = firstByCik.get(h.cik); if (!c || h.date < c.date) firstByCik.set(h.cik, h); }
console.log(`\n    ${hits.length} hit(s) -> ${firstByCik.size} distinct CIK(s) (first 5.06 each)`);

// ------------------------------- (3) AUTHORITATIVE DATE + TICKER, FROM data.sec.gov/submissions
// THE FULL-TEXT PHRASE IS A DISCOVERY TOOL, NOT THE AUTHORITY. data.sec.gov/submissions carries a STRUCTURED
// `items` field on every 8-K, so the first filing whose items contain "5.06" is the change-in-shell-status event as
// the SEC itself indexes it — no phrase-matching risk at all. This is the POSITIVE-CONTROL RULE applied to the
// marker: the text search proposes a CIK, the structured index disposes of the date. It also repairs a real miss —
// DKNG's Super 8-K (items 1.01,2.01,...,5.06,9.01, accession 0001104659-20-052633) is dated 2020-04-29, while the
// 2020-04-24 8-K nearby carries items 7.01/9.01 only and is a Reg-FD release, not a completion.
//
// TICKER, in a declared order of authority, because the single "current ticker of the filer CIK" rule has a real
// failure mode: a de-SPAC that LATER reorganises into a new holdco leaves the original CIK with no current ticker
// (DraftKings CIK 1772757 is now "DraftKings Holdings Inc." with tickers [], while DKNG trades under CIK 1883685).
//   (a) submissions tickers[0] for the filer CIK — correct for the large majority;
//   (b) the ticker embedded in the full-text index's display_names for that CIK;
//   (c) an EXACT normalised match of the filer's own name or FORMER names against trd_cik_ticker, EDGAR's current
//       ticker map — this is what recovers DKNG, via the former name "DraftKings Inc.".
// Every event records which tier resolved it, so a reader can discount tier (c) if they wish.
const CACHE = new URL("../data/despac-506-subs.json", import.meta.url).pathname;
interface Sub { ticker: string | null; names: string[]; d506: string | null; adsh506: string | null }
let cache: Record<string, Sub> = {};
try { cache = JSON.parse(await Deno.readTextFile(CACHE)); } catch { /* first run */ }

const norm = (n: string) => n.toLowerCase().replace(/\\/g, " ").replace(/[^a-z0-9 ]+/g, " ")
  .replace(/\b(inc|corp|corporation|company|co|ltd|limited|holdings?|group|plc|llc|lp|sa|nv|ag|the|de|new)\b/g, " ")
  .replace(/\s+/g, " ").trim();

// EDGAR's current ticker map, read from our own mirror (strict read: a failed read is an exception, never []).
const ctRows = await R.qAll("trd_cik_ticker?select=cik,ticker,name&order=cik") as { cik: string; ticker: string; name: string }[];
const byName = new Map<string, string>();
for (const r of ctRows) { const k = norm(r.name ?? ""); if (k && !byName.has(k)) byName.set(k, r.ticker); }
console.log(`    trd_cik_ticker: ${ctRows.length} current registrants, ${byName.size} distinct normalised names`);

let subN = 0;
for (const [cik, rec] of firstByCik) {
  if (cik in cache) continue;
  const pad = cik.padStart(10, "0");
  let ticker: string | null = null, names: string[] = [], d506: string | null = null, adsh506: string | null = null;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${pad}.json`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j?.tickers) && j.tickers.length) ticker = String(j.tickers[0]).toUpperCase();
      names = [j?.name, ...(j?.formerNames ?? []).map((f: { name: string }) => f.name)].filter(Boolean);
      // The structured item index. `recent` holds the most recent ~1,000 filings; older pages live in filings.files
      // and are fetched only when the recent page does not already contain a 5.06 AND is full — otherwise a
      // completion older than the page would be silently missed, which is the COVERAGE LAW failure in miniature.
      const scan = (f: { form: string[]; items: string[]; filingDate: string[]; accessionNumber: string[] }) => {
        for (let i = f.form.length - 1; i >= 0; i--) {
          if (!/^8-K/.test(f.form[i] ?? "")) continue;
          if (!/(^|,)5\.06(,|$)/.test((f.items[i] ?? "").replace(/\s/g, ""))) continue;
          if (!d506 || f.filingDate[i] < d506) { d506 = f.filingDate[i]; adsh506 = f.accessionNumber[i]; }
        }
      };
      const rec0 = j?.filings?.recent;
      if (rec0?.form) scan(rec0);
      const older = (j?.filings?.files ?? []) as { name: string }[];
      if (older.length) {
        for (const o of older) {
          await sleep(SLEEP);
          const rr = await fetch(`https://data.sec.gov/submissions/${o.name}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
          if (rr.ok) scan(await rr.json());
        }
      }
    }
  } catch { /* fall through to the full-text fallbacks below */ }
  cache[cik] = { ticker, names, d506, adsh506 };
  subN++;
  if (subN % 100 === 0) { await Deno.writeTextFile(CACHE, JSON.stringify(cache)); console.log(`    submissions: ${subN}/${firstByCik.size}`); }
  await sleep(SLEEP);
}
await Deno.writeTextFile(CACHE, JSON.stringify(cache));

const fromNames = (names: string[]): string | null => { for (const n of names ?? []) { const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/); if (m) return m[1]; } return null; };
const tier = { a: 0, b: 0, c: 0, none: 0 };
const resolveTicker = (cik: string, rec: Rec): { t: string | null; tier: string } => {
  const c = cache[cik];
  if (c?.ticker) { tier.a++; return { t: c.ticker, tier: "a:submissions" }; }
  const b = fromNames(rec.names); if (b) { tier.b++; return { t: b, tier: "b:display_names" }; }
  for (const n of c?.names ?? []) { const hit = byName.get(norm(n)); if (hit) { tier.c++; return { t: hit, tier: "c:former-name" }; } }
  tier.none++; return { t: null, tier: "unresolved" };
};

// The 5.06 date: the structured index wins; the full-text file_date is the fallback where submissions had no items.
let itemsDated = 0, ftsDated = 0, moved = 0;
const events = [...firstByCik.entries()].map(([cik, rec]) => {
  const c = cache[cik];
  const { t, tier: tr } = resolveTicker(cik, rec);
  const d = c?.d506 ?? rec.date;
  if (c?.d506) { itemsDated++; if (c.d506 !== rec.date) moved++; } else ftsDated++;
  return { cik, adsh: c?.adsh506 ?? rec.adsh, ticker: t, date: d, form: rec.form, tier: tr, ftsDate: rec.date };
});
console.log(`    dates: ${itemsDated} from the structured 8-K item index, ${ftsDated} from the full-text file_date (${moved} corrected by the item index)`);
console.log(`    tickers: a:submissions ${tier.a} | b:display_names ${tier.b} | c:former-name ${tier.c} | unresolved ${tier.none}  (${firstByCik.size - tier.none}/${firstByCik.size} resolved)`);

// ------------------------------------------------------------- (4) WRITE
const rows = events.map((e) => ({
  source: "edgar", source_id: e.adsh, filing_type: `8-K|${K.TAG}`, ticker: e.ticker,
  disclosed_date: e.date, raw: { cik: e.cik, item: "5.06", marker: K.PHRASE, ticker_tier: e.tier, fts_date: e.ftsDate },
}));
// Collisions must be COUNTED, not discovered as a silent shortfall later (POSITIVE-CONTROL RULE).
const held = new Set<string>();
for (let i = 0; i < rows.length; i += 200) {
  const ids = rows.slice(i, i + 200).map((r) => r.source_id).join(",");
  const got = await R.q(`trd_raw_filings?source=eq.edgar&source_id=in.(${ids})&select=source_id,filing_type`) as { source_id: string; filing_type: string }[];
  for (const g of got) held.add(g.source_id);
}
const collisions = rows.filter((r) => held.has(r.source_id));
console.log(`    ${collisions.length} accession(s) ALREADY STORED under another filing_type — (source,source_id) is the unique key,`);
console.log(`      so they cannot be re-tagged without MODIFYING an existing row, which this fix is forbidden to do.`);
console.log(`      They are carried in the sidecar, and despac-event.ts reads the sidecar as well as the table so a`);
console.log(`      collision can never quietly shrink the event set.`);

const SIDE = new URL("../data/despac-506-events.json", import.meta.url).pathname;
await Deno.writeTextFile(SIDE, JSON.stringify({
  built: new Date().toISOString(), phrase: K.PHRASE, forms: K.FORMS, span: `${K.FROM_Y}-${K.TO_Y}`,
  hits: hits.length, ciks: firstByCik.size, collisions: collisions.length, events,
}));

let written = 0;
if (!DRY) {
  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300);
    const res = await fetch(`${OWNED}/trd_raw_filings?on_conflict=source,source_id`, {
      method: "POST",   // plumbing-ok: audited — status checked immediately below
      headers: { ...hdr, Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(batch),
    });
    if (!res.ok && res.status !== 409) { console.error(`!! write failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); Deno.exit(1); }
    written += batch.length;
  }
}
console.log(`    ${DRY ? "DRYRUN — nothing written" : `upserted ${written} row(s) (${collisions.length} ignored as duplicates)`}; sidecar: data/despac-506-events.json`);

// ------------------------------------------------------- (5) POSITIVE CONTROLS
// A negative result and a broken question both look like zero (POSITIVE-CONTROL RULE). These four completions are
// independently known; PSTH is the negative control — it liquidated without ever completing a combination, so a
// row for it means the marker is still catching something other than a completion.
const byTicker = new Map<string, string>();
for (const e of events) if (e.ticker) { const c = byTicker.get(e.ticker); if (!c || e.date < c) byTicker.set(e.ticker, e.date); }
// DKNG's expected date is 2020-04-29, NOT the 2020-04-24 originally proposed, and the correction is evidenced
// rather than assumed: data.sec.gov/submissions for CIK 1772757 shows 2020-04-29 8-K accession
// 0001104659-20-052633 carrying items "1.01,2.01,3.02,4.01,5.01,5.02,5.06,9.01" — the Super 8-K — while the
// 2020-04-24 8-K (0001104659-20-050439) carries items "7.01,9.01", a Reg-FD release with no 2.01 and no 5.06.
// The merger CLOSED 2020-04-23; the Super 8-K landed six days later, inside the four-business-day window. Moving a
// control to fit a result is exactly the failure this file exists to fix, so the evidence is stated in full.
const CONTROLS: [string, string, number][] = [["LCID", "2021-07-26", 3], ["SOFI", "2021-06-01", 3], ["OPEN", "2020-12-21", 3], ["DKNG", "2020-04-29", 3]];
let red = 0;
console.log(`\n    POSITIVE CONTROLS`);
for (const [tk, want, tol] of CONTROLS) {
  const got = byTicker.get(tk);
  const dd = got ? Math.round((Date.parse(got) - Date.parse(want)) / 86400000) : NaN;
  const ok = got !== undefined && Math.abs(dd) <= tol;
  if (!ok) red++;
  console.log(`      ${ok ? "PASS" : "RED "} ${tk.padEnd(5)} want ${want} +-${tol}d  got ${got ?? "ABSENT"}${got ? ` (${dd >= 0 ? "+" : ""}${dd}d)` : ""}`);
}
const psth = byTicker.get("PSTH");
if (psth) { red++; console.log(`      RED  PSTH  must be ABSENT (never completed a combination) — present at ${psth}`); }
else console.log(`      PASS PSTH  ABSENT, as required (it liquidated without ever completing a combination)`);
if (red) { console.error(`\n!! ${red} CONTROL(S) RED — the event table is not the event it claims to be. This is exactly the D-734b defect; refusing to certify.`); Deno.exit(1); }
console.log(`\n    ALL CONTROLS PASS — the 5.06 marker dates the completion, not the SPAC's own IPO.`);
