#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// odd-lot-fetch.ts — extract the economics of each odd-lot tender offer from its PRIMARY EDGAR DOCUMENT.
//
// WHY. The FTS ingest (ingest-edgar-fts.ts, TAG=odd-lot) gives us WHICH filings mention "odd lot"; it does not give
// us the three numbers that decide whether the mechanism pays: the tender PRICE, whether odd-lot holders are actually
// granted PRIORITY (no proration), and the EXPIRATION. Those live only in the document text, so they are fetched.
//
// COVERAGE HONESTY (THE COVERAGE LAW). Every filing that fails to yield a price, a priority determination or a
// ticker is COUNTED and its reason recorded, so a downstream n is a measured subset, never a silent one.
// Requests are strictly SEQUENTIAL with a sleep, and carry the SEC-required identifying User-Agent.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("odd-lot-fetch", [
  { name: "TAG", def: "odd-lot", note: "filing_type suffix written by the ingester" },
  { name: "SLEEP_MS", def: "160", note: "SEC courtesy rate limit (<=10 req/s allowed)" },
  { name: "LIMIT", def: "0", note: "0 = ALL filings; else cap (sampling)" },
  { name: "OUT", def: "data/odd-lot-tenders.json" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "olf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLEEP = Number(K.SLEEP_MS);

async function pageAll(path: string) {
  if (!/order=/.test(path)) throw new Error(`pageAll requires order=: ${path}`);
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) {   // plumbing-ok: audited — order= asserted above
    const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr });
    if (!r.ok) break; const j = await r.json();
    if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break;
  }
  return out;
}

const rows = await pageAll(`trd_raw_filings?source=eq.edgar&filing_type=like.*${K.TAG}*&select=source_id,filing_type,ticker,disclosed_date,raw&order=disclosed_date`);
assertNonEmpty("odd-lot filings in trd_raw_filings", rows, 50);
const all = rows.map((r) => ({
  adsh: r.source_id as string,
  form: String(r.filing_type).split("|")[0],
  ticker: (r.ticker as string | null),
  date: r.disclosed_date as string,
  cik: String((r.raw as { cik?: string })?.cik ?? "").replace(/\D/g, ""),
  name: ((r.raw as { names?: string[] })?.names ?? [])[0] ?? "",
}));
const work = Number(K.LIMIT) > 0 ? all.slice(0, Number(K.LIMIT)) : all;
console.log(`==> ODD-LOT TENDER EXTRACTION — ${work.length} filing(s) of ${all.length} held`);

// ---- text helpers -------------------------------------------------------------------------------------------
const strip = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#\d+;/g, " ")
  .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** ODD-LOT PRIORITY = the mechanism itself: <100-share holders accepted IN FULL, exempt from proration. */
function oddLotPriority(t: string): boolean {
  const lc = t.toLowerCase();
  if (!/odd\s*lot/.test(lc)) return false;
  // Look at every window around an "odd lot" mention for the priority/no-proration language.
  for (const m of lc.matchAll(/odd\s*lot/g)) {
    const w = lc.slice(Math.max(0, m.index! - 500), m.index! + 900);
    if (/(without\s+proration|not\s+(be\s+)?(subject\s+to|prorated)|free\s+of\s+proration|prior\s+to\s+proration|preferenti|prioriti|priority|purchase[d]?\s+in\s+full|accepted\s+in\s+full|before\s+proration)/.test(w)) return true;
  }
  return false;
}

/** Dutch-auction range, else a fixed price. Returns dollars. */
function priceOf(t: string): { lo: number | null; hi: number | null; kind: string } {
  const num = "\\$\\s?([0-9]{1,4}(?:,[0-9]{3})*(?:\\.[0-9]{1,4})?)";
  const n = (s: string) => Number(s.replace(/,/g, ""));
  // Dutch auction: "not greater than $X nor less than $Y", "at a price ... between $Y and $X"
  let m = t.match(new RegExp(`not\\s+(?:greater|more)\\s+than\\s+${num}\\s+nor\\s+less\\s+than\\s+${num}`, "i"));
  if (m) return { lo: n(m[2]), hi: n(m[1]), kind: "dutch" };
  m = t.match(new RegExp(`not\\s+less\\s+than\\s+${num}\\s+nor\\s+(?:greater|more)\\s+than\\s+${num}`, "i"));
  if (m) return { lo: n(m[1]), hi: n(m[2]), kind: "dutch" };
  m = t.match(new RegExp(`price\\s+(?:range\\s+)?(?:of\\s+)?(?:between\\s+)?${num}\\s+(?:to|and|-|through)\\s+${num}\\s+per\\s+share`, "i"));
  if (m && n(m[2]) > n(m[1])) return { lo: n(m[1]), hi: n(m[2]), kind: "dutch" };
  // Fixed price
  for (const re of [
    `(?:purchase|offer|tender)\\s+price\\s+of\\s+${num}\\s*(?:,?\\s*net\\s*)?per\\s+share`,
    `at\\s+a\\s+(?:purchase\\s+)?price\\s+of\\s+${num}\\s*(?:,?\\s*net\\s*)?per\\s+share`,
    `${num}\\s+net\\s+per\\s+share\\s+in\\s+cash`,
    `${num}\\s+per\\s+share,?\\s+net\\s+to\\s+the\\s+(?:seller|holder|tendering)`,
    `for\\s+${num}\\s+per\\s+share\\s+in\\s+cash`,
    `${num}\\s+in\\s+cash\\s+per\\s+share`,
  ]) { const q = t.match(new RegExp(re, "i")); if (q) { const v = n(q[1]); if (v > 0 && v < 5000) return { lo: v, hi: v, kind: "fixed" }; } }
  return { lo: null, hi: null, kind: "none" };
}

/** Expiration date: "expire at 5:00 p.m. ... on <Month D, YYYY>" or an "Expiration Date" nearby date. */
function expiryOf(t: string): string | null {
  const dre = "(January|February|March|April|May|June|July|August|September|October|November|December)\\s+([0-9]{1,2}),\\s*([0-9]{4})";
  for (const re of [
    `(?:expire|expires|expiration)[^.]{0,220}?${dre}`,
    `until[^.]{0,120}?on\\s+${dre}[^.]{0,80}?unless\\s+(?:the\\s+)?(?:offer|tender)\\s+is\\s+extended`,
  ]) {
    const m = t.match(new RegExp(re, "i"));
    if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`; }
  }
  return null;
}

// ---- fetch loop ---------------------------------------------------------------------------------------------
interface Out {
  adsh: string; form: string; date: string; cik: string; name: string; ticker: string | null;
  oddLotPriority: boolean | null; priceLo: number | null; priceHi: number | null; priceKind: string;
  expiry: string | null; docUrl: string | null; note: string;
}
// RESUMABLE (D-598 spirit): a long sequential SEC crawl that dies half-way must not throw away what it fetched,
// and a re-run must not re-fetch it. Load whatever the output file already holds and skip those accessions.
let out: Out[] = [];
try { out = JSON.parse(Deno.readTextFileSync(K.OUT)) as Out[]; } catch { out = []; }
const done = new Set(out.map((r) => r.adsh));
if (done.size) console.log(`    RESUMING — ${done.size} record(s) already extracted, skipping those`);
const flushOut = () => Deno.writeTextFileSync(K.OUT, JSON.stringify(out, null, 1));
const tickerCache = new Map<string, string | null>();
let noDoc = 0, noPrice = 0, noPri = 0, noTicker = 0;

for (let i = 0; i < work.length; i++) {
  const f = work[i];
  if (done.has(f.adsh)) continue;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.adsh.replace(/-/g, "")}`;
  const rec: Out = { ...f, oddLotPriority: null, priceLo: null, priceHi: null, priceKind: "none", expiry: null, docUrl: null, note: "" };
  // 1. index.json -> primary document (largest .htm/.txt that is not an exhibit graphic)
  let docName: string | null = null;
  try {
    const j = await fetch(`${base}/index.json`, { headers: { "User-Agent": UA, Accept: "application/json" } }).then((r) => r.ok ? r.json() : null);
    const items = (j?.directory?.item ?? []) as { name: string; size: string }[];
    const cands = items.filter((x) => /\.(htm|html|txt)$/i.test(x.name) && !/^0\d{9,}-index/.test(x.name) && !/index\.htm/i.test(x.name));
    cands.sort((a, b) => Number(b.size) - Number(a.size));
    docName = cands[0]?.name ?? null;
  } catch { /* handled by the null below */ }
  await sleep(SLEEP);
  if (!docName) { rec.note = "no primary document in index.json"; noDoc++; out.push(rec); if (out.length % 25 === 0) flushOut(); continue; }
  rec.docUrl = `${base}/${docName}`;
  let text = "";
  try {
    const r = await fetch(rec.docUrl, { headers: { "User-Agent": UA } });
    if (r.ok) text = strip(await r.text()); else rec.note = `HTTP ${r.status}`;
  } catch (e) { rec.note = e instanceof Error ? e.message : String(e); }
  await sleep(SLEEP);
  if (!text) { noDoc++; out.push(rec); if (out.length % 25 === 0) flushOut(); continue; }

  rec.oddLotPriority = oddLotPriority(text);
  if (!rec.oddLotPriority) noPri++;
  const p = priceOf(text); rec.priceLo = p.lo; rec.priceHi = p.hi; rec.priceKind = p.kind;
  if (p.lo === null) noPrice++;
  rec.expiry = expiryOf(text);

  // 2. ticker: FTS display_names first, else submissions API by CIK (resolve-spinoff-tickers.ts convention)
  if (!rec.ticker) {
    if (!tickerCache.has(f.cik)) {
      let tk: string | null = null;
      try {
        const j = await fetch(`https://data.sec.gov/submissions/CIK${f.cik.padStart(10, "0")}.json`, { headers: { "User-Agent": UA } }).then((r) => r.ok ? r.json() : null);
        tk = (j?.tickers as string[])?.[0] ?? null;
      } catch { tk = null; }
      tickerCache.set(f.cik, tk);
      await sleep(SLEEP);
    }
    rec.ticker = tickerCache.get(f.cik) ?? null;
  }
  if (!rec.ticker) noTicker++;
  out.push(rec);
  if (out.length % 25 === 0) flushOut();
  if ((i + 1) % 50 === 0) console.log(`    ${i + 1}/${work.length} | no-doc ${noDoc} | no-price ${noPrice} | no-priority-language ${noPri} | no-ticker ${noTicker}`);
}

flushOut();
console.log(`\n==> wrote ${out.length} record(s) to ${K.OUT}`);
// Coverage is recomputed from the FULL accumulated file, not from this run's counters — a resumed run's counters
// only cover what IT fetched, and reporting those as the dataset's coverage is exactly the kind of partial-truth
// THE COVERAGE LAW exists to stop.
const cNoDoc = out.filter((r) => r.oddLotPriority === null).length;
const cNoPri = out.filter((r) => r.oddLotPriority === false).length;
const cNoPrice = out.filter((r) => r.oddLotPriority !== null && r.priceLo === null).length;
const cNoTicker = out.filter((r) => !r.ticker).length;
console.log(`    COVERAGE (whole file): no primary doc ${cNoDoc} | price unparsed ${cNoPrice} | no odd-lot-priority language ${cNoPri} | no ticker ${cNoTicker}`);
console.log(`    this run only: no-doc ${noDoc} | no-price ${noPrice} | no-priority ${noPri} | no-ticker ${noTicker}`);
