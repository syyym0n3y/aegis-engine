#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// cef-universe.ts — build a CLOSED-END FUND universe WITHOUT hand-picking (THE UNIVERSE LAW, D-535).
//
// WHY NOT A HAND LIST. Every cross-sectional result this programme has produced moved more with WHO IS IN THE
// UNIVERSE than with the signal. A CEF list typed from memory would be a list of the funds a language model has
// read about, which is exactly the selection mechanism that manufactures a discount premium (the famous discounted
// funds are the ones that get written about). So the pool comes from a FORM the regulator requires of every
// registered fund, and membership is decided by two mechanical filters, neither of which I choose per-name.
//
// STEP 1 — POOL. SEC EDGAR full-text search over N-CEN (the annual census every registered investment company
// files), 2019-2025. Two phrases are unioned: "closed-end" and "N-2" — N-2 is the registration form used ONLY by
// closed-end funds (open-end funds register on N-1A), so its appearance in a fund's N-CEN attachments is a
// structural closed-end marker rather than a keyword coincidence.
//   HONEST LIMIT, STATED NOT HIDDEN: EDGAR full-text indexes the ATTACHMENTS of an N-CEN, not the answers in its
//   primary XML. So the pool is "closed-end funds whose N-CEN exhibits mention closed-end or N-2", not "all
//   closed-end funds". That is a COVERAGE statement (D-645 rule 6), and the coverage figure is printed below.
//
// STEP 2 — CONFIRMATION. A ticker enters the universe only if Yahoo serves the synthetic NAV series X{TICKER}X
// with >= MIN_YEARS of history. Yahoo publishes X..X NAV series for closed-end funds specifically, so this is a
// second, independent closed-end test — and it is also the DATA-ADEQUACY test, since a discount cannot be computed
// without a NAV. Interval funds and open-end share classes that slip into the pool fail it mechanically.
//
// POSITIVE CONTROL (D-641): GAB and PDI are two of the most-traded US closed-end funds. If either is absent from
// the final universe the construction is broken, and the script SAYS SO rather than reporting a clean number.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("cef-universe", [
  { name: "CEFU_FROM_Y", def: "2019", note: "first N-CEN year (form began 2018-19)" },
  { name: "CEFU_TO_Y", def: "2025" },
  { name: "CEFU_PHRASES", def: "closed-end|N-2", note: "pipe-separated EFTS phrases, unioned" },
  { name: "CEFU_MIN_YEARS", def: "3", note: "minimum NAV history required" },
  { name: "CEFU_OUT", def: "data/cef-universe.json" },
  { name: "CEFU_CAND_CACHE", def: "data/cef-candidates.json", note: "EDGAR pool cache; present = skip the EDGAR sweep (idempotent re-run)" },
  { name: "CEFU_SLEEP_MS", def: "260", note: "SEC asks <=10 req/s; Yahoo courtesy pacing" },
]);
const FROM_Y = Number(K.CEFU_FROM_Y), TO_Y = Number(K.CEFU_TO_Y);
const MIN_YEARS = Number(K.CEFU_MIN_YEARS), SLEEP = Number(K.CEFU_SLEEP_MS);
const PHRASES = K.CEFU_PHRASES.split("|").filter(Boolean);

const SEC_UA = "Aegis Research ona@revitalise.io";
const YF_UA = "Mozilla/5.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- STEP 1: the EDGAR pool ----------------
interface Hit { _source: { ciks: string[]; display_names: string[]; file_date: string } }
const tickerOf = (names: string[]): string | null => {
  for (const n of names ?? []) { const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/); if (m) return m[1]; }
  return null;
};

let cachedCandidates: string[] | null = null;
try { const j = JSON.parse(await Deno.readTextFile(K.CEFU_CAND_CACHE)); if (Array.isArray(j?.candidates) && j.candidates.length) { cachedCandidates = j.candidates; console.log(`==> EDGAR pool loaded from ${K.CEFU_CAND_CACHE} (${j.candidates.length} candidates, built ${j.built}) — skipping the sweep. Delete that file to rebuild.`); } } catch { /* no cache: sweep */ }

const ciks = new Map<string, { ticker: string | null; name: string }>();
const failedWindows: string[] = [];
let hitsSeen = 0, saturated = 0;

const WINDOWS: [string, string][] = [];
for (let y = FROM_Y; y <= TO_Y; y++) {
  WINDOWS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
}

if (!cachedCandidates) console.log(`==> CEF UNIVERSE — step 1: EDGAR N-CEN full-text pool, ${FROM_Y}-${TO_Y}, phrases [${PHRASES.join(", ")}]`);
for (const phrase of (cachedCandidates ? [] : PHRASES)) {
  let phraseHits = 0;
  for (const [start, end] of WINDOWS) {
    if (Date.parse(start) > Date.now()) continue;
    let total = -1, from = 0, got = 0;
    while (true) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${phrase}"`)}&forms=N-CEN&startdt=${start}&enddt=${end}&from=${from}`;
      let j: { hits?: { total?: { value: number }; hits?: Hit[] } } | null = null;
      let lastErr = "";
      for (let a = 0; a < 4 && !j; a++) {
        if (a) await sleep(SLEEP * (2 ** a) + 400);
        try {
          const r = await fetch(url, { headers: { "User-Agent": SEC_UA, Accept: "application/json" } });
          if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
          j = await r.json();
        } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP (D-641 / ingest-edgar-fts precedent).
      if (!j) { failedWindows.push(`${phrase} ${start}..${end} (${lastErr})`); break; }
      const hits = j?.hits?.hits ?? [];
      if (total < 0) total = j?.hits?.total?.value ?? 0;
      if (!hits.length) break;
      for (const h of hits) {
        hitsSeen++; phraseHits++;
        const cik = h._source.ciks?.[0]; if (!cik) continue;
        const t = tickerOf(h._source.display_names);
        const prev = ciks.get(cik);
        if (!prev || (!prev.ticker && t)) ciks.set(cik, { ticker: t ?? prev?.ticker ?? null, name: h._source.display_names?.[0] ?? "" });
      }
      got += hits.length; from += hits.length;
      if (from >= 9900 && got < total) { saturated++; console.log(`    SATURATED ${phrase} ${start} at ${from}/${total} — coverage of that window is PARTIAL`); break; }
      if (got >= total) break;
      await sleep(SLEEP);
    }
    await sleep(SLEEP);
  }
  console.log(`    phrase "${phrase}": ${phraseHits.toLocaleString()} hits`);
}
if (!cachedCandidates) { console.log(`    pool: ${hitsSeen.toLocaleString()} N-CEN hits -> ${ciks.size.toLocaleString()} distinct filer CIKs`); assertNonEmpty("EDGAR N-CEN filer CIKs", [...ciks.keys()], 100); }

// ---------------- STEP 1b: resolve tickers for CIKs the display name did not carry ----------------
const unresolved = cachedCandidates ? [] : [...ciks.entries()].filter(([, v]) => !v.ticker).map(([c]) => c);
if (!cachedCandidates) console.log(`\n==> step 1b: resolving ${unresolved.length} CIK(s) with no ticker in display_names via data.sec.gov/submissions`);
let resolved = 0;
for (const cik of unresolved) {
  try {
    const j = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } }).then((r) => r.ok ? r.json() : null);
    const tks = (j?.tickers as string[]) || [];
    if (tks.length) { ciks.get(cik)!.ticker = tks[0]; resolved++; }
  } catch { /* a CIK that cannot be resolved keeps a null ticker and is reported, never silently dropped */ }
  await sleep(160);
}
if (!cachedCandidates) console.log(`    resolved ${resolved}; still tickerless ${unresolved.length - resolved} (fund with no listed share class, or a filing agent)`);

const candidates = cachedCandidates ?? [...new Set([...ciks.values()].map((v) => v.ticker).filter((t): t is string => !!t && /^[A-Z]{1,5}$/.test(t)))].sort();
if (!cachedCandidates) await Deno.writeTextFile(K.CEFU_CAND_CACHE, JSON.stringify({ built: new Date().toISOString().slice(0, 10), pool_ciks: ciks.size, hits: hitsSeen, candidates }));
console.log(`    ticker candidates (A-Z only, 1-5 chars): ${candidates.length}`);

// ---------------- STEP 2: Yahoo NAV confirmation ----------------
interface Series { dates: string[]; nav: number[] }
// NOTE, and it cost a false-negative run: `range=max` makes Yahoo return MONTHLY bars regardless of interval=1d
// (XGABX: 329 points over 27 years). The daily series requires period1/period2. The first version used range=max,
// the length filter then rejected every fund, and the POSITIVE CONTROL (GAB, PDI) is what caught it — a broken
// question and a real null look identical (D-641).
async function yahoo(sym: string): Promise<{ d: string[]; c: number[]; v: number[] } | null> {
  try {
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": YF_UA } }).then((r) => r.ok ? r.json() : null);
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp?.length) return null;
    const q = r.indicators.quote[0];
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const px = q.close?.[i];
      if (px == null || !Number.isFinite(px) || px <= 0) continue;
      d.push(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10)); c.push(px); v.push(Number(q.volume?.[i]) || 0);
    }
    return d.length ? { d, c, v } : null;
  } catch { return null; }
}

console.log(`\n==> step 2: Yahoo X{T}X NAV confirmation (>= ${MIN_YEARS}y) over ${candidates.length} candidates — sequential, ~${SLEEP}ms apart`);
const universe: { ticker: string; navFrom: string; navTo: string; navDays: number }[] = [];
let noNav = 0, shortNav = 0, i = 0;
for (const t of candidates) {
  i++;
  if (i % 50 === 0) console.log(`    ...${i}/${candidates.length} probed, ${universe.length} confirmed`);
  const nav = await yahoo(`X${t}X`);
  await sleep(SLEEP);
  if (!nav) { noNav++; continue; }
  const years = (Date.parse(nav.d[nav.d.length - 1]) - Date.parse(nav.d[0])) / 3.15576e10;
  if (years < MIN_YEARS || nav.d.length < MIN_YEARS * 150) { shortNav++; continue; }
  universe.push({ ticker: t, navFrom: nav.d[0], navTo: nav.d[nav.d.length - 1], navDays: nav.d.length });
}

const spans = universe.map((u) => u.navFrom).sort();
console.log(`\n==> UNIVERSE: ${universe.length} CEFs with NAV`);
console.log(`    candidates probed        ${candidates.length}`);
console.log(`    no X{T}X NAV on Yahoo    ${noNav}   (not a closed-end fund, or Yahoo carries no NAV series)`);
console.log(`    NAV shorter than ${MIN_YEARS}y     ${shortNav}`);
console.log(`    NAV span                 ${spans[0]} .. ${universe.map((u) => u.navTo).sort().slice(-1)[0]}`);
console.log(`    earliest-start quartile  ${spans[Math.floor(spans.length * 0.25)]}  median ${spans[Math.floor(spans.length * 0.5)]}`);

// POSITIVE CONTROL — a construction that returns a clean-looking list while missing the two most obvious members
// is a broken question, not a finding (THE POSITIVE-CONTROL RULE, D-641).
const CONTROLS = ["GAB", "PDI"];
const missing = CONTROLS.filter((c) => !universe.some((u) => u.ticker === c));
console.log(`\n    POSITIVE CONTROL ${CONTROLS.join(", ")}: ${missing.length ? `FAILED — missing ${missing.join(", ")}` : "PASS — both present"}`);

if (failedWindows.length) {
  console.log(`\n!! COVERAGE INCOMPLETE — ${failedWindows.length} EDGAR window(s) failed after 4 attempts:`);
  for (const w of failedWindows) console.log(`     ${w}`);
}

await Deno.writeTextFile(K.CEFU_OUT, JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  method: `EDGAR N-CEN full-text (${FROM_Y}-${TO_Y}, phrases ${PHRASES.join("|")}) -> CIK -> ticker -> Yahoo X{T}X NAV >= ${MIN_YEARS}y`,
  pool_ciks: cachedCandidates ? null : ciks.size, candidates: candidates.length, candidate_tickers: candidates, no_nav: noNav, short_nav: shortNav,
  positive_control: { tickers: CONTROLS, missing },
  failed_windows: failedWindows,
  universe,
}, null, 1));
console.log(`\n    wrote ${K.CEFU_OUT} (${universe.length} funds)`);
if (missing.length) Deno.exit(2);
