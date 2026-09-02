#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// cef-tender.ts — DESCRIPTIVE ONLY. The SECOND mechanism under the frontier row "paid for patience in a mispriced
// wrapper": CLOSED-END-FUND TENDER-OFFER CAPTURE.
//
// THE CLAIM BEING TESTED. A CEF trading at a -10% discount that offers to repurchase 15% of its shares at 98% of NAV
// hands a holder ~9% on the tendered slice, by CONTRACT rather than by forecast. Two things decide whether that is
// money: (a) is the discount at filing WIDER than the tender's own haircut (100% - x% of NAV), and (b) how much of
// your position is actually accepted — proration, unless odd-lot priority applies and you hold under 100 shares.
//
// LAWS THAT BIND, and how they are honoured here:
//  - EXECUTION LAW / SAME-BAR COROLLARY: the filing-date discount is read on the first bar STRICTLY AFTER the filing.
//  - INSTRUMENT LAW: the instrument measured IS the placeable one — the listed common of the fund, at its own close,
//    against the fund's own published NAV on the same date. No proxy, no research-space construction.
//  - COVERAGE LAW: the source is a full-text sweep that required the phrase "odd lot". CEF tenders that never used
//    that phrase are NOT in the frame at all, and that hole is stated in the funnel rather than narrated away. Every
//    drop is counted with its reason.
//  - BENCHMARK LAW: the capture is a contractual spread against a purchase price, not a cross-sectional return, so
//    the comparator reported is the fund's OWN path after expiration (does the discount snap shut and stay?).
//  - POSITIVE-CONTROL RULE: a fetch that silently returns nothing and a market with no CEF tenders both produce an
//    empty table. The run FAILS unless >= MIN_NAVPCT filings parse a NAV percentage AND a named large-sponsor
//    control (Swiss Helvetia / BlackRock / Virtus-Zweig / Eaton Vance) is present.
//  - MECHANISM LAW: DESCRIPTIVE ONLY. No pre-registration, no trd_lineage row, no promotion, no DECISIONS entry.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("cef-tender", [
  { name: "TENDER_SRC", def: "data/odd-lot-tenders.json", note: "the SC TO-I/TO-T sweep built by odd-lot-tender's ingest" },
  { name: "CEFT_OUT", def: "data/cef-tenders.json", note: "output AND fetch cache; a re-run refetches nothing already parsed" },
  { name: "CEFT_BARS", def: "data/cef-bars.json", note: "daily price+NAV per CEF" },
  { name: "CEFT_PANEL", def: "data/cef-panel.json", note: "monthly discount panel (D-750 universe)" },
  { name: "CEFT_UNI", def: "data/cef-universe.json" },
  { name: "CEFT_SLEEP_MS", def: "320", note: "SEC courtesy pacing; strictly sequential" },
  { name: "CEFT_REFETCH", def: "", note: "1 = ignore the cache and refetch every primary document" },
  { name: "CEFT_SHARES", def: "99", note: "odd-lot holding: fewer than 100 shares" },
  { name: "CEFT_MAX_LAG_D", def: "10", note: "entry bar must be within this many days of the filing, else UNTESTED" },
  { name: "CEFT_POST_D", def: "21", note: "trading days after expiration for the realised-path read" },
  { name: "MIN_NAVPCT", def: "40", note: "POSITIVE CONTROL: filings that must parse a NAV percentage" },
  { name: "UA", def: "Aegis Research ona@revitalise.io", note: "SEC requires a contactable User-Agent" },
]);
const SLEEP = Number(K.CEFT_SLEEP_MS), SH = Number(K.CEFT_SHARES);
const MAXLAG = Number(K.CEFT_MAX_LAG_D), POSTD = Number(K.CEFT_POST_D), MINNAV = Number(K.MIN_NAVPCT);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET") || "";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ceft", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayGap = (a: string, b: string) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5;

interface Rec {
  adsh: string; form: string; date: string; cik: string; name: string; ticker: string | null;
  oddLotPriority: boolean | null; priceLo: number | null; priceHi: number | null; priceKind: string;
  expiry: string | null; docUrl: string | null; note: string;
}
const recs = JSON.parse(Deno.readTextFileSync(K.TENDER_SRC)) as Rec[];
assertNonEmpty("SC TO filings held", recs, 100);
const uni = JSON.parse(Deno.readTextFileSync(K.CEFT_UNI)) as { built: string; universe: { ticker: string }[] };
const UNI = new Set(uni.universe.map((u) => u.ticker));

console.log(`==> CEF TENDER-OFFER CAPTURE — DESCRIPTIVE ONLY (no lineage row, no prereg, no promotion)\n`);

// ================= step 1: which filings are plausibly CLOSED-END-FUND tenders =================
// Two independent nets, deliberately: the ticker net is precise but bounded by our 302-fund universe (which is
// alive-today funds only, so every fund that has since liquidated is invisible to it); the NAME net catches those.
// A candidate is then CONFIRMED only by its own filing text, never by its name.
const originals = recs.filter((r) => !/\/A$/.test(r.form));
const amendments = recs.filter((r) => /\/A$/.test(r.form));
const NAMEISH = /\b(fund|trust|closed[-\s]?end|municipal|investment company)\b/i;
const cands = originals.filter((r) => (r.ticker && UNI.has(r.ticker)) || NAMEISH.test(r.name));
console.log(`    FUNNEL (COVERAGE LAW — every drop counted with its reason):`);
console.log(`      ${String(recs.length).padStart(5)}  SC TO-I / TO-T filings held (full-text sweep REQUIRING the phrase "odd lot", 2012-2026)`);
console.log(`      ${String(amendments.length).padStart(5)}  amendments (used only for termination/withdrawal detection)`);
console.log(`      ${String(originals.length).padStart(5)}  ORIGINAL offers`);
console.log(`      ${String(cands.length).padStart(5)}  candidates: ticker in the CEF universe OR issuer name fund/trust-shaped`);
console.log(`      NOTE (COVERAGE LAW, stated not narrated): the source sweep required the literal phrase "odd lot".`);
console.log(`      A CEF tender that never used it is NOT IN THE FRAME AT ALL. Every count below is a LOWER BOUND on`);
console.log(`      the population of CEF tenders, and no absence here is evidence about the market.`);

// A LEAD FROM THE BRIEF, CHECKED RATHER THAN INHERITED (Contract rule 2). The task states that the 94 filings the
// odd-lot study dropped for "no parseable price" were closed-end funds tendering at NAV. They are not.
const dropped94 = originals.filter((r) => r.oddLotPriority && r.priceLo === null);
const d94fund = dropped94.filter((r) => NAMEISH.test(r.name) || (r.ticker && UNI.has(r.ticker))).length;
console.log(`\n    LEAD CHECKED, NOT INHERITED: the ${dropped94.length} filings odd-lot-tender.ts dropped for "no parseable price"`);
console.log(`    are described upstream as closed-end funds tendering at NAV. Only ${d94fund} of ${dropped94.length} have a fund-shaped issuer`);
console.log(`    (the rest are Celestica, GameStop, CIT, Johnson Controls, Encana...). The CEF tenders were dropped one`);
console.log(`    step EARLIER — at the odd-lot-PRIORITY filter — not at the price filter. Corrected here.`);

// ================= step 2: fetch + parse the primary documents (cached) =================
interface Parsed {
  adsh: string; cik: string; ticker: string | null; name: string; date: string; form: string; docUrl: string | null;
  ok: boolean;                 // document fetched
  isCef: boolean;              // text confirms an investment-company self-tender priced off NAV
  navPct: number | null;       // tender price as % of NAV
  sharePct: number | null;     // % of outstanding shares sought
  oddLot: boolean;             // odd-lot priority / no-proration language
  expiry: string | null;       // parsed expiration
  terminated: boolean;         // an amendment for the same CIK inside the window says terminated/withdrawn
}
let cache: Record<string, Parsed> = {};
try {
  const prev = JSON.parse(Deno.readTextFileSync(K.CEFT_OUT)) as { parsed?: Parsed[] };
  if (K.CEFT_REFETCH !== "1") for (const p of prev.parsed ?? []) cache[p.adsh] = p;
} catch { /* first run */ }
console.log(`\n==> primary documents: ${Object.keys(cache).length} already parsed in the cache, ${cands.filter((c) => !cache[c.adsh]).length} to fetch (sequential, ${SLEEP}ms apart)`);

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function strip(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ").replace(/&amp;/gi, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ");
}
function parseDoc(txt: string): Omit<Parsed, "adsh" | "cik" | "ticker" | "name" | "date" | "form" | "docUrl" | "ok" | "terminated"> {
  const t = txt;
  // NAV percentage. Ordered from most explicit to least; the first hit wins and the patterns are all anchored on
  // "net asset value" so a stray "98%" elsewhere in a 120k-character document cannot be mistaken for a price.
  let navPct: number | null = null;
  const navPats = [
    /(\d{1,3}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Fund'?s?|Trust'?s?|its)?\s*(?:net asset value|NAV)/i,
    /(?:price|purchase price|equal to)\s+of\s+(\d{1,3}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:net asset value|NAV)/i,
    /(?:net asset value|NAV)[^.]{0,80}?(?:less|minus)\s+(?:a\s+)?(\d{1,2}(?:\.\d+)?)\s*%/i,
  ];
  for (let i = 0; i < navPats.length; i++) {
    const m = t.match(navPats[i]);
    if (m) { const v = Number(m[1]); if (i === 2) { if (v > 0 && v <= 10) navPct = 100 - v; } else if (v >= 80 && v <= 100) navPct = v; if (navPct != null) break; }
  }
  // "at net asset value" with no percentage = 100% of NAV.
  if (navPct === null && /\bat\s+(?:the\s+)?net asset value\s+per\s+share/i.test(t)) navPct = 100;

  // % of outstanding shares sought. Anchored on "outstanding" AND on offer language, because a document also
  // discusses ownership thresholds (5% holders, 2% of a class) that are not the size of the offer.
  // DEFECT FOUND AND FIXED BY INSPECTING THE PARSE, NOT THE TOTAL. The first version of this took the first
  // "N% of outstanding shares" in the document, and on Swiss Helvetia that is a Section-2 boilerplate condition —
  // "increases the number of shares being sought ... exceeds 2% of its outstanding shares" — not the size of the
  // offer. It put 2% into 5 events and 2.5% into 16, i.e. it made PRORATION look ~5x more punishing than it is,
  // which is the direction that would have flattered the write-up's scepticism. Every match is now rejected if its
  // left context is a CHANGE-of-size clause, and matches are scanned in cover-page-first order.
  let sharePct: number | null = null;
  const NEG = /(exceed|increase|decrease|in excess of|reduce|amend)/i;
  const shPats = [
    /(?:repurchase|purchase|tender for|acquire)\s+(?:up to\s+)?(?:approximately\s+)?(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Fund'?s?|Trust'?s?|its)?\s*(?:issued and\s+)?outstanding\s+(?:common\s+)?(?:shares|stock)/i,
    /representing\s+(?:approximately\s+)?(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Fund'?s?|Trust'?s?|its)?\s*(?:issued and\s+)?outstanding\s+(?:common\s+)?(?:shares|stock)/i,
    /up to\s+(?:approximately\s+)?(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Fund'?s?|Trust'?s?|its)?\s*(?:issued and\s+)?outstanding\s+(?:common\s+)?(?:shares|stock)/i,
    /(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Fund'?s?|Trust'?s?|its)\s+(?:issued and\s+)?outstanding\s+(?:common\s+)?(?:shares|stock)/i,
  ];
  outer: for (const p of shPats) {
    const re = new RegExp(p.source, "gi");
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (NEG.test(t.slice(Math.max(0, m.index - 140), m.index))) continue;   // a change-of-size condition, not the offer
      const v = Number(m[1]);
      if (v > 0 && v <= 100) { sharePct = v; break outer; }
    }
  }

  const oddLot = /odd[-\s]?lot/i.test(t) && /(odd[-\s]?lot[^.]{0,200}(without proration|not.{0,20}prorat|in full|priority))|(prorat[^.]{0,120}odd[-\s]?lot)/i.test(t);

  // Expiration: "expire at 5:00 p.m. ... on <Month D, YYYY>". Take the FIRST such date after "expir".
  let expiry: string | null = null;
  const em = t.match(new RegExp(`expir\\w*[^.]{0,200}?(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i"));
  if (em) {
    const mo = MONTHS.indexOf(em[1].toLowerCase()) + 1;
    expiry = `${em[3]}-${String(mo).padStart(2, "0")}-${String(Number(em[2])).padStart(2, "0")}`;
  }
  // An investment-company self-tender priced off NAV. Requires BOTH the NAV pricing and 1940-Act/fund language, so a
  // REIT quoting "net asset value" in a fairness discussion is not swept in.
  const isCef = navPct !== null && /(Investment Company Act of 1940|closed[-\s]?end (?:management )?investment company|the Fund'?s? net asset value|the Trust'?s? net asset value)/i.test(t);
  return { isCef, navPct, sharePct, oddLot, expiry };
}

let fetched = 0, failed = 0;
for (const r of cands) {
  if (cache[r.adsh]) continue;
  if (!r.docUrl) { cache[r.adsh] = { adsh: r.adsh, cik: r.cik, ticker: r.ticker, name: r.name, date: r.date, form: r.form, docUrl: null, ok: false, isCef: false, navPct: null, sharePct: null, oddLot: false, expiry: null, terminated: false }; continue; }
  let txt = "";
  for (let attempt = 0; attempt < 3 && !txt; attempt++) {
    try {
      const res = await fetch(r.docUrl, { headers: { "User-Agent": K.UA } });
      if (res.ok) txt = strip(await res.text()); else await res.body?.cancel();
    } catch { /* retry */ }
    if (!txt) await sleep(SLEEP * 4);
  }
  await sleep(SLEEP);
  if (!txt) { failed++; cache[r.adsh] = { adsh: r.adsh, cik: r.cik, ticker: r.ticker, name: r.name, date: r.date, form: r.form, docUrl: r.docUrl, ok: false, isCef: false, navPct: null, sharePct: null, oddLot: false, expiry: null, terminated: false }; continue; }
  fetched++;
  cache[r.adsh] = { adsh: r.adsh, cik: r.cik, ticker: r.ticker, name: r.name, date: r.date, form: r.form, docUrl: r.docUrl, ok: true, terminated: false, ...parseDoc(txt) };
  if (fetched % 40 === 0) console.log(`    ...${fetched} fetched, ${failed} unfetchable`);
}
console.log(`    fetched ${fetched} this run, ${failed} unfetchable`);

const parsed = cands.map((c) => cache[c.adsh]).filter(Boolean);
const cefs = parsed.filter((p) => p.isCef && p.navPct !== null);
console.log(`\n      -${String(parsed.filter((p) => !p.ok).length).padStart(4)}  primary document not fetchable`);
console.log(`      -${String(parsed.filter((p) => p.ok && p.navPct === null).length).padStart(4)}  fetched but no NAV-percentage price (operating companies, REITs, cash/Dutch tenders)`);
console.log(`      -${String(parsed.filter((p) => p.ok && p.navPct !== null && !p.isCef).length).padStart(4)}  NAV price parsed but no 1940-Act / closed-end-fund language`);
console.log(`      ${String(cefs.length).padStart(5)}  CONFIRMED CEF TENDERS priced as a % of NAV`);

// ---- termination / withdrawal, from the amendments of the same CIK inside the offer window ----
// Only the amendments of CIKs we actually care about are fetched, and only their first 3 are read.
const cefCiks = new Set(cefs.map((c) => c.cik));
const amCand = amendments.filter((a) => cefCiks.has(a.cik) && a.docUrl);
let amFetched = 0;
const termByKey = new Map<string, boolean>();
for (const a of amCand) {
  const ck = `AM|${a.adsh}`;
  if (cache[ck]) { if (cache[ck].terminated) termByKey.set(`${a.cik}|${a.date}`, true); continue; }
  let txt = "";
  try { const res = await fetch(a.docUrl!, { headers: { "User-Agent": K.UA } }); if (res.ok) txt = strip(await res.text()); else await res.body?.cancel(); } catch { /* */ }
  await sleep(SLEEP); amFetched++;
  const term = /(?:offer|tender offer)[^.]{0,120}(has been|is hereby)?\s*(terminat|withdraw|cancel)/i.test(txt) && !/withdrawal rights/i.test(txt.slice(0, 400));
  cache[ck] = { adsh: ck, cik: a.cik, ticker: a.ticker, name: a.name, date: a.date, form: a.form, docUrl: a.docUrl, ok: !!txt, isCef: false, navPct: null, sharePct: null, oddLot: false, expiry: null, terminated: term };
  if (term) termByKey.set(`${a.cik}|${a.date}`, true);
}
console.log(`      ${amCand.length} amendments of CEF-tender issuers scanned for termination/withdrawal (${amFetched} fetched this run)`);

// ================= POSITIVE CONTROL (D-641) — a broken fetch and an empty market look identical =================
const CONTROL_NAMES = [/swiss helvetia/i, /blackrock/i, /virtus|zweig/i, /eaton vance/i, /nuveen/i];
const ctlHits = CONTROL_NAMES.filter((re) => cefs.some((c) => re.test(c.name)));
console.log(`\n    POSITIVE CONTROL (D-641 — a null and a broken question both look like zero):`);
console.log(`      ${cefs.length >= MINNAV ? "PASS" : "FAIL"} CEF tenders parsed with a NAV percentage: ${cefs.length} (floor ${MINNAV})`);
console.log(`      ${ctlHits.length >= 2 ? "PASS" : "FAIL"} known large-sponsor periodic tenders present: ${ctlHits.length} of ${CONTROL_NAMES.length} sponsor families matched`);
const navSpread = new Set(cefs.map((c) => c.navPct)).size;
console.log(`      ${navSpread >= 2 ? "PASS" : "FAIL"} NAV percentages non-degenerate: ${navSpread} distinct values ${JSON.stringify([...new Set(cefs.map((c) => c.navPct))].sort((a, b) => a! - b!))}`);
const ctlFail = (cefs.length >= MINNAV ? 0 : 1) + (ctlHits.length >= 2 ? 0 : 1) + (navSpread >= 2 ? 0 : 1);

await Deno.writeTextFile(K.CEFT_OUT, JSON.stringify({
  built: new Date().toISOString(),
  source: `${K.TENDER_SRC} (SC TO-I/TO-T, phrase "odd lot") + EDGAR primary documents`,
  candidates: cands.length, confirmed_cef: cefs.length,
  parsed: Object.values(cache),
}, null, 1));
console.log(`      wrote ${K.CEFT_OUT}: ${Object.values(cache).length} parsed documents, ${cefs.length} confirmed CEF tenders`);
if (ctlFail) { console.error(`\n!! ${ctlFail} POSITIVE CONTROL FAILURE(S) — everything below would be UNTESTED, not a finding.`); Deno.exit(2); }

// ================= step 3: the measurement, per tender =================
type YF = { d: string[]; c: number[]; a: number[]; v: number[] };
const bars = JSON.parse(Deno.readTextFileSync(K.CEFT_BARS)) as Record<string, { px: YF; nav: YF }>;
console.log(`\n==> price+NAV bars loaded for ${Object.keys(bars).length} funds`);

interface Ev {
  ticker: string; name: string; date: string; entry: string; px0: number; nav0: number; disc0: number;
  navPct: number; sharePct: number | null; oddLot: boolean; tenderPx: number;
  capPct: number;            // capture per tendered share, % of the price paid
  proPct: number | null;     // proration-adjusted capture for a holder tendering everything
  oddLotUsd: number | null;  // $ on 99 shares, full fill, where priority applies
  expiry: string; winD: number; annPct: number;
  navExp: number | null; pxExp: number | null; discExp: number | null;
  pxPost: number | null; discPost: number | null; navDrawPct: number | null;
  dv: number; terminated: boolean;
}
const evs: Ev[] = [];
let dNoBars = 0, dNoEntry = 0, dNoNav = 0;
for (const c of cefs) {
  const t = c.ticker;
  if (!t || !bars[t]) { dNoBars++; continue; }
  const P = bars[t].px, N = bars[t].nav;
  const navByD = new Map<string, number>(); for (let i = 0; i < N.d.length; i++) navByD.set(N.d[i], N.c[i]);
  const i0 = P.d.findIndex((d) => d > c.date);                       // EXECUTION LAW: strictly after the filing
  if (i0 < 0 || dayGap(c.date, P.d[i0]) > MAXLAG) { dNoEntry++; continue; }
  const px0 = P.c[i0], nav0 = navByD.get(P.d[i0]);
  if (!nav0 || !(nav0 > 0) || !(px0 > 0)) { dNoNav++; continue; }
  const disc0 = (px0 / nav0 - 1) * 100;
  const tenderPx = (c.navPct! / 100) * nav0;
  const capPct = (tenderPx / px0 - 1) * 100;
  const expiry = c.expiry && c.expiry > c.date && c.expiry < addDays(c.date, 200) ? c.expiry : addDays(c.date, 30);
  const winD = Math.max(1, dayGap(P.d[i0], expiry));
  let iE = P.d.findIndex((d) => d >= expiry); if (iE < 0) iE = -1;
  const iP = iE >= 0 && iE + POSTD < P.d.length ? iE + POSTD : -1;
  const navExp = iE >= 0 ? navByD.get(P.d[iE]) ?? null : null;
  const navPost = iP >= 0 ? navByD.get(P.d[iP]) ?? null : null;
  let dv = 0, n = 0; for (let k = Math.max(0, i0 - 20); k <= i0; k++) { dv += P.c[k] * P.v[k]; n++; }
  evs.push({
    ticker: t, name: c.name, date: c.date, entry: P.d[i0], px0, nav0, disc0,
    navPct: c.navPct!, sharePct: c.sharePct, oddLot: c.oddLot, tenderPx, capPct,
    proPct: c.sharePct != null ? capPct * c.sharePct / 100 : null,
    oddLotUsd: c.oddLot ? SH * (tenderPx - px0) : null,
    expiry, winD, annPct: capPct * 365 / winD,
    navExp, pxExp: iE >= 0 ? P.c[iE] : null, discExp: iE >= 0 && navExp ? (P.c[iE] / navExp - 1) * 100 : null,
    pxPost: iP >= 0 ? P.c[iP] : null, discPost: iP >= 0 && navPost ? (P.c[iP] / navPost - 1) * 100 : null,
    navDrawPct: navExp ? (navExp / nav0 - 1) * 100 : null,
    dv: dv / Math.max(1, n),
    terminated: termByKey.has(`${c.cik}|${c.date}`) || [...termByKey.keys()].some((k) => k.startsWith(c.cik + "|") && k.slice(c.cik.length + 1) > c.date && k.slice(c.cik.length + 1) <= addDays(c.date, 120)),
  });
}
console.log(`      -${String(dNoBars).padStart(4)}  fund not in the CEF bar cache (liquidated / never in the 302-fund universe) — UNTESTED, not null`);
console.log(`      -${String(dNoEntry).padStart(4)}  no price bar within ${MAXLAG}d of the filing — the event PREDATES our history`);
console.log(`      -${String(dNoNav).padStart(4)}  no published NAV on the entry date`);
console.log(`      ${String(evs.length).padStart(5)}  MEASURED TENDER EVENTS`);
assertNonEmpty("measured CEF tender events", evs, 5);
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "cef-tender", runId: `ceft|${evs.length}|${cefs.length}`, spent: 3 });

evs.sort((a, b) => a.date < b.date ? -1 : 1);
const yrs = Math.max(1e-9, dayGap(evs[0].date, evs[evs.length - 1].date) / 365.25);
const caps = evs.map((e) => e.capPct);
const posN = evs.filter((e) => e.capPct > 0).length;

console.log(`\n    THE TERMS (what the contract actually offers):`);
const navCounts = new Map<number, number>(); for (const e of evs) navCounts.set(e.navPct, (navCounts.get(e.navPct) ?? 0) + 1);
console.log(`      tender price as % of NAV: ${[...navCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}% (n=${v})`).join(", ")}`);
const shp = evs.filter((e) => e.sharePct != null).map((e) => e.sharePct!);
console.log(`      % of shares sought: parsed on ${shp.length}/${evs.length}; median ${shp.length ? med(shp).toFixed(1) : "n/a"}%, mean ${shp.length ? mean(shp).toFixed(1) : "n/a"}%`);
console.log(`      odd-lot priority granted: ${evs.filter((e) => e.oddLot).length} of ${evs.length}`);
console.log(`      median offer window: ${med(evs.map((e) => e.winD)).toFixed(0)} calendar days (filing -> expiration)`);

console.log(`\n    THE CAPTURE (per tendered share, against the close of the first bar AFTER the filing — lag-1):`);
console.log(`      median discount at filing ..................... ${med(evs.map((e) => e.disc0)).toFixed(2)}%`);
console.log(`      median tender haircut (100 - x% of NAV) ....... ${med(evs.map((e) => 100 - e.navPct)).toFixed(2)}%`);
console.log(`      median capture ................................ ${med(caps).toFixed(2)}%`);
console.log(`      mean capture .................................. ${mean(caps).toFixed(2)}%  (t ${tstat(caps).toFixed(2)}, sd ${sd(caps).toFixed(2)})`);
console.log(`      tenders where discount EXCEEDED the haircut ... ${posN} of ${evs.length} (${(100 * posN / evs.length).toFixed(1)}%)`);
console.log(`      annualised over the offer window (median) ..... ${med(evs.map((e) => e.annPct)).toFixed(1)}%/yr  [capture x 365/window; NOT a compoundable rate, see CEILING]`);

const pro = evs.filter((e) => e.proPct != null);
console.log(`\n    PRORATION — the number that decides, and the one the pitch omits:`);
if (pro.length) {
  console.log(`      holder tendering ALL shares, accepted pro-rata at the % sought:`);
  console.log(`        median position-level capture ............... ${med(pro.map((e) => e.proPct!)).toFixed(3)}%   (vs ${med(pro.map((e) => e.capPct)).toFixed(2)}% on the tendered slice)`);
  console.log(`        mean ........................................ ${mean(pro.map((e) => e.proPct!)).toFixed(3)}%   (t ${tstat(pro.map((e) => e.proPct!)).toFixed(2)})`);
  console.log(`      ODD-LOT CASE (holder of ${SH} shares, accepted IN FULL where priority is granted, n=${evs.filter((e) => e.oddLotUsd != null).length}):`);
  const ol = evs.filter((e) => e.oddLotUsd != null);
  if (ol.length) {
    console.log(`        median $ per event .......................... $${med(ol.map((e) => e.oddLotUsd!)).toFixed(2)} on $${med(ol.map((e) => SH * e.px0)).toFixed(0)} of capital`);
    console.log(`        mean   $ per event .......................... $${mean(ol.map((e) => e.oddLotUsd!)).toFixed(2)}`);
    console.log(`        total $ if EVERY odd-lot event were taken ... $${ol.reduce((a, e) => a + e.oddLotUsd!, 0).toFixed(0)} over ${yrs.toFixed(1)} years`);
  } else console.log(`        none — odd-lot priority was not granted in any MEASURED event (UNTESTED, not zero)`);
} else console.log(`      UNTESTED — no % of shares sought parsed on any measured event`);

// ---- realised path: does the discount snap shut and STAY? (BENCHMARK LAW: the fund's own path is the comparator)
const wp = evs.filter((e) => e.discExp != null), wq = evs.filter((e) => e.discPost != null);
console.log(`\n    REALISED PATH — does the discount snap shut, and does it STAY shut?`);
console.log(`      median discount at FILING ......................... ${med(evs.map((e) => e.disc0)).toFixed(2)}%   (n=${evs.length})`);
console.log(`      median discount at EXPIRATION .................... ${wp.length ? med(wp.map((e) => e.discExp!)).toFixed(2) : "n/a"}%   (n=${wp.length})`);
console.log(`      median discount ${POSTD} trading days AFTER expiration ... ${wq.length ? med(wq.map((e) => e.discPost!)).toFixed(2) : "n/a"}%   (n=${wq.length})`);
if (wp.length) {
  const narrow = wp.map((e) => e.discExp! - e.disc0);
  console.log(`      change filing -> expiration: mean ${mean(narrow).toFixed(2)}pp (t ${tstat(narrow).toFixed(2)}), narrowed in ${wp.filter((e) => e.discExp! > e.disc0).length}/${wp.length} events`);
}
if (wq.length) {
  const keep = wq.map((e) => e.discPost! - e.disc0);
  console.log(`      change filing -> +${POSTD}d:       mean ${mean(keep).toFixed(2)}pp (t ${tstat(keep).toFixed(2)}), still narrower in ${wq.filter((e) => e.discPost! > e.disc0).length}/${wq.length} events`);
  const reopen = wq.filter((e) => e.discExp != null && e.discPost! < e.discExp!).length;
  console.log(`      REOPENED between expiration and +${POSTD}d: ${reopen} of ${wq.filter((e) => e.discExp != null).length}`);
}

// ---- downside ----
const nd = evs.filter((e) => e.navDrawPct != null);
const navKilled = nd.filter((e) => e.navDrawPct! < -Math.max(0, e.capPct)).length;
console.log(`\n    DOWNSIDE (the capture is a contract; the NAV underneath it is not):`);
console.log(`      funds whose NAV FELL by more than the capture over the offer window: ${navKilled} of ${nd.length} (${(100 * navKilled / Math.max(1, nd.length)).toFixed(0)}%)`);
console.log(`        median NAV move over the window ${med(nd.map((e) => e.navDrawPct!)).toFixed(2)}% vs median capture ${med(caps).toFixed(2)}%`);
console.log(`      tenders with a TERMINATION/WITHDRAWAL amendment inside 120d: ${evs.filter((e) => e.terminated).length} of ${evs.length}`);
console.log(`      NOT MEASURED: whether the holder's shares were actually accepted (proration percentages are`);
console.log(`      published in the final SC TO-I/A, which is not parsed here). Acceptance is MODELLED at the % sought,`);
console.log(`      which is an UPPER bound whenever the offer is oversubscribed — and a wide-discount tender usually is.`);

// ---- capacity ----
console.log(`\n    CAPACITY (LIQUIDITY LAW — the size the vehicle can absorb, not the size of the edge):`);
console.log(`      median fund 21d mean $ volume at filing ......... $${(med(evs.map((e) => e.dv)) / 1e3).toFixed(0)}k/day`);
console.log(`      quartiles ...................................... $${([...evs.map((e) => e.dv)].sort((a, b) => a - b)[Math.floor(evs.length * .25)] / 1e3).toFixed(0)}k .. $${([...evs.map((e) => e.dv)].sort((a, b) => a - b)[Math.floor(evs.length * .75)] / 1e3).toFixed(0)}k`);
console.log(`      measured events per year ....................... ${(evs.length / yrs).toFixed(1)}  (window ${evs[0].date} .. ${evs[evs.length - 1].date}, ${yrs.toFixed(1)}y)`);
console.log(`      confirmed CEF tenders per year (incl. unmeasurable) ${(cefs.length / yrs).toFixed(1)}`);

// ---- per era ----
console.log(`\n    PER ERA (never conclude from a pool):`);
for (const [lab, sel] of [["2012-2018", (e: Ev) => e.date < "2019-01-01"], ["2019-2026", (e: Ev) => e.date >= "2019-01-01"]] as [string, (e: Ev) => boolean][]) {
  const g = evs.filter(sel); if (!g.length) { console.log(`      ${lab}: n=0 — UNTESTED`); continue; }
  console.log(`      ${lab}: n=${String(g.length).padStart(3)} | median discount at filing ${med(g.map((e) => e.disc0)).toFixed(2)}% | median capture ${med(g.map((e) => e.capPct)).toFixed(2)}% | capture>0 ${g.filter((e) => e.capPct > 0).length}/${g.length}`);
}

// ================= step 4: "hold the widest tercile and let tenders come to you" =================
// DESCRIPTIVE. The question is not whether this is an edge (D-750 already measured the tercile's excess); it is what
// FRACTION of that tercile's fund-months are followed by a tender within 12 months, and whether those fund-months
// earned more. The tender set used here is EVERY confirmed CEF tender, not only the measurable ones, because the
// question is about incidence, not about capture.
interface PRow { t: string; m: string; apx: number; disc: number; dv: number }
const panel = (JSON.parse(Deno.readTextFileSync(K.CEFT_PANEL)) as { rows: PRow[] }).rows;
assertNonEmpty("CEF monthly panel rows", panel, 1000);
const tendersByT = new Map<string, string[]>();
for (const c of cefs) if (c.ticker) (tendersByT.get(c.ticker) ?? tendersByT.set(c.ticker, []).get(c.ticker)!).push(c.date);
const byT = new Map<string, PRow[]>();
for (const r of panel) (byT.get(r.t) ?? byT.set(r.t, []).get(r.t)!).push(r);
for (const a of byT.values()) a.sort((x, y) => x.m < y.m ? -1 : 1);
const perMonth = new Map<string, PRow[]>();
for (const r of panel) (perMonth.get(r.m) ?? perMonth.set(r.m, []).get(r.m)!).push(r);
const months = [...perMonth.keys()].sort();
// forward 12-month total return per fund-month, from the panel's adjusted close
const fwd12 = new Map<string, number>();
for (const [t, a] of byT) for (let i = 0; i + 12 < a.length; i++) if (a[i].apx > 0 && a[i + 12].apx > 0) fwd12.set(`${t}|${a[i].m}`, a[i + 12].apx / a[i].apx - 1);

let wideN = 0, wideTender = 0, allN = 0, allTender = 0;
const wT: number[] = [], wNo: number[] = [];
for (const m of months) {
  const a = perMonth.get(m)!; if (a.length < 9) continue;
  const s = [...a].sort((x, y) => x.disc - y.disc);
  const k = Math.floor(s.length / 3);
  const wide = new Set(s.slice(0, k).map((o) => o.t));
  for (const o of a) {
    const has = (tendersByT.get(o.t) ?? []).some((d) => d > m + "-31" && d <= addDays(m + "-28", 365));
    allN++; if (has) allTender++;
    if (!wide.has(o.t)) continue;
    wideN++; if (has) wideTender++;
    const f = fwd12.get(`${o.t}|${o.m}`); if (f === undefined) continue;
    (has ? wT : wNo).push(f);
  }
}
console.log(`\n    STRATEGY READING — "hold the widest-discount tercile and let tenders come to you" (DESCRIPTIVE):`);
console.log(`      widest-tercile fund-months ..................... ${wideN.toLocaleString()}`);
console.log(`      ... with a confirmed CEF tender within 12m ..... ${wideTender.toLocaleString()} (${(100 * wideTender / Math.max(1, wideN)).toFixed(2)}%)`);
console.log(`      whole-universe fund-months .................... ${allN.toLocaleString()}, tender within 12m ${allTender.toLocaleString()} (${(100 * allTender / Math.max(1, allN)).toFixed(2)}%)`);
console.log(`      => a widest-tercile month is ${(allTender ? (wideTender / Math.max(1, wideN)) / (allTender / allN) : 0).toFixed(2)}x as likely to be followed by a tender as an average month`);
if (wT.length >= 20 && wNo.length >= 20) {
  const d = mean(wT) - mean(wNo);
  console.log(`      forward-12m total return of widest-tercile months WITH a tender ..... ${(100 * mean(wT)).toFixed(2)}%  (n=${wT.length})`);
  console.log(`      ...................................................... WITHOUT ........ ${(100 * mean(wNo)).toFixed(2)}%  (n=${wNo.length})`);
  console.log(`      incremental ${(100 * d).toFixed(2)}pp  (Welch t ${(d / Math.sqrt(sd(wT) ** 2 / wT.length + sd(wNo) ** 2 / wNo.length)).toFixed(2)})`);
  console.log(`      OVERLAPPING 12m windows -> the t is INFLATED by autocorrelation and is quoted as a descriptive`);
  console.log(`      contrast only. It is NOT a significance test and no verdict rests on it.`);
} else console.log(`      forward-return contrast UNTESTED — only ${wT.length} with-tender / ${wNo.length} without-tender fund-months`);

console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)} | spent ${spend.spent}`);

// ================= VERDICT =================
const medCap = med(caps), medPro = pro.length ? med(pro.map((e) => e.proPct!)) : NaN;
console.log(`\n    VERDICT 1 — THE MECHANISM IS REAL AND ITS TERMS ARE NOT WHAT THE PITCH SAYS. ${cefs.length} confirmed CEF`);
console.log(`    tenders priced off NAV, ${evs.length} measurable against our own price+NAV history. The modal price is`);
console.log(`    ${[...navCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]}% of NAV, i.e. a haircut of ${100 - [...navCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]}pp that the discount must first exceed.`);
console.log(`\n    VERDICT 2 — THE CAPTURE ON THE TENDERED SLICE IS ${medCap.toFixed(2)}% (median), positive in ${posN}/${evs.length} events.`);
console.log(`    That is the number the mechanism story quotes. It is the wrong number for a holder.`);
console.log(`\n    VERDICT 3 — PRORATION IS THE WHOLE STORY. A holder tendering everything is accepted on ~${shp.length ? med(shp).toFixed(0) : "?"}% of it, so`);
console.log(`    the POSITION-level capture is ${isFinite(medPro) ? medPro.toFixed(3) + "%" : "UNTESTED"} (median) — before any cost of holding the fund for the`);
console.log(`    window. The odd-lot carve-out that would give a full fill was granted in ${evs.filter((e) => e.oddLot).length} of ${evs.length} measured events.`);
console.log(`\n    VERDICT 4 — DESCRIPTIVE ONLY (MECHANISM LAW). No pre-registration existed before these numbers, so no`);
console.log(`    causal claim is admissible: nothing here says the tender CAUSES the convergence rather than a fund`);
console.log(`    board announcing one when the discount is already about to close. No trd_lineage row, no DECISIONS`);
console.log(`    entry, no promotion. The population is a LOWER BOUND (the sweep required the phrase "odd lot") and`);
console.log(`    acceptance is MODELLED at the % sought, an upper bound on an oversubscribed offer.`);
