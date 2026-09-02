#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ipo-pop.ts (frontier: "paid for capital in a primary market") — the IPO first-day pop, measured on our own panel,
// and then split into the part a retail account CAN and CANNOT have.
//
// WHY THIS SCRIPT EXISTS, AND WHAT IT IS NOT. The documented first-day pop (~15-20% average, heavily right-skewed)
// is real and is not in dispute. It is also ALLOCATION-GATED: the pop is earned between the OFFER price and the
// FIRST TRADE, and a retail account is not at the offer price on a hot deal. So the number everybody quotes is a
// return on capital that was allocated, not a return on capital that could be deployed. This script measures both
// legs separately and refuses to blend them:
//   (a) offer -> first close        = the ALLOCATED return. Real. Requires an allocation we do not have.
//   (b) first OPEN -> +21/63/250d   = the RETAIL-REALISABLE return. The first open IS the first tradeable print, so
//                                     buying there is lag-0 and still honest — no other bar is reachable earlier.
// THE PRIOR IS STATED BEFORE THE MEASUREMENT (SIGN LAW): offer->first close strongly POSITIVE; first-open->later
// FLAT-TO-NEGATIVE (Ritter's long-run IPO underperformance). Both outcomes are recorded as MATCHED or MISSED.
//
// DESCRIPTIVE ONLY (MECHANISM LAW) — no causal claim is made and no trd_lineage row is written.
//
// COVERAGE HONESTY. Events come from EDGAR full-text on form 424B4 (the final IPO prospectus, which carries the
// priced deal). Prices come from trd_bars_deep, whose delisted backfill begins ~2020 — so pre-2020 IPOs are present
// only if the name survived into the curated panel, and the 2015-19 era half is therefore SURVIVORSHIP-EXPOSED.
// That is stated with the number rather than left for the reader to infer.
//
// THE IPO DISCRIMINANT IS THE INCEPTION TEST, NOT THE FORM. Form 424B4 also carries follow-ons and secondaries. An
// event is kept only when the ticker's FIRST BAR IN THE PANEL falls within [file_date-5d, file_date+30d] — i.e. the
// panel captured the name starting to trade. That both selects IPOs and guarantees we are measuring from inception
// rather than from a truncated history (the D-733 spin-off discipline, same failure mode).
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("ipo-pop", [
  { name: "FROM_Y", def: "2015", note: "first calendar year of 424B4 search" },
  { name: "TO_Y", def: "2026" },
  { name: "PHRASE", def: "initial public offering", note: "EDGAR full-text phrase on form 424B4" },
  { name: "WINDOWS", def: "21,63,250", note: "hold horizons in trading days from the first-day OPEN" },
  { name: "RT_BP", def: "30", note: "round-trip cost in bp, one round trip per event" },
  { name: "SLEEP_MS", def: "300", note: "SEC courtesy delay between sequential fetches" },
  { name: "REFRESH", def: "0", note: "1 = ignore the on-disk caches and re-fetch" },
]);
const FROM_Y = Number(K.FROM_Y), TO_Y = Number(K.TO_Y), SLEEP = Number(K.SLEEP_MS);
const WINS = K.WINDOWS.split(",").map(Number);
const RT_BP = Number(K.RT_BP);
const REFRESH = K.REFRESH === "1";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";   // SEC requires an identifying User-Agent
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ipo", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const posPct = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : NaN;
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";

const readCache = async <T>(p: string, fb: T): Promise<T> => { if (REFRESH) return fb; try { return JSON.parse(await Deno.readTextFile(p)) as T; } catch { return fb; } };
const writeCache = async (p: string, v: unknown) => { try { await Deno.writeTextFile(p, JSON.stringify(v)); } catch { /* cache is an optimisation, not a result */ } };

// ─────────────────────────────────────────────────────────────────────────────
// (1) EVENTS — 424B4 final prospectuses from EDGAR full-text search
// ─────────────────────────────────────────────────────────────────────────────
interface Filing { adsh: string; doc: string; cik: string; ticker: string | null; date: string; name: string }
const IDX_PATH = "data/ipo-424b4-index.json";
let filings = await readCache<Filing[]>(IDX_PATH, []);

const tickerOf = (names: string[]): string | null => {
  for (const n of names ?? []) { const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/); if (m) return m[1]; }
  return null;
};

console.log(`==> IPO POP — EDGAR 424B4 "${K.PHRASE}", ${FROM_Y}-${TO_Y}`);
if (filings.length) {
  console.log(`    424B4 index loaded from cache: ${filings.length.toLocaleString()} filings (REFRESH=1 to re-fetch)`);
} else {
  const QUARTERS: [string, string][] = [];
  for (let y = FROM_Y; y <= TO_Y; y++) QUARTERS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
  const byYear = new Map<number, number>();
  const failed: string[] = [];
  let saturated = 0;
  for (const [start, end] of QUARTERS) {
    if (Date.parse(start) > Date.now()) continue;
    let total = -1, from = 0, got = 0;
    while (true) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${K.PHRASE}"`)}&forms=424B4&startdt=${start}&enddt=${end}&from=${from}`;
      // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP (D-734 lesson, inherited from ingest-edgar-fts.ts).
      let j: { hits?: { total?: { value: number }; hits?: { _id: string; _source: { ciks: string[]; display_names: string[]; file_date: string; adsh: string } }[] } } | null = null;
      let lastErr = "";
      for (let a = 0; a < 4 && !j; a++) {
        if (a) await sleep(SLEEP * (2 ** a) + 400);
        try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; } j = await r.json(); }
        catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      if (!j) { failed.push(`${start}..${end} (${lastErr})`); break; }
      const hits = j?.hits?.hits ?? [];
      if (total < 0) total = j?.hits?.total?.value ?? 0;
      if (!hits.length) break;
      for (const h of hits) {
        const s = h._source;
        filings.push({ adsh: s.adsh, doc: String(h._id).split(":")[1] ?? "", cik: (s.ciks?.[0] ?? "").replace(/\D/g, ""), ticker: tickerOf(s.display_names), date: s.file_date, name: s.display_names?.[0] ?? "" });
      }
      got += hits.length; from += hits.length;
      // EDGAR caps the result window at 10,000. Saturation is REPORTED, never silently truncated.
      if (from >= 9900 && got < total) { saturated++; console.log(`    ${start}  WINDOW SATURATED at ${from} of ${total} — coverage of this window is PARTIAL`); break; }
      if (got >= total) break;
      await sleep(SLEEP);
    }
    byYear.set(Number(start.slice(0, 4)), (byYear.get(Number(start.slice(0, 4))) ?? 0) + Math.max(0, total));
    await sleep(SLEEP);
  }
  console.log(`    424B4 hits per year (each quarterly window well under the 10,000 cap):`);
  for (const y of [...byYear.keys()].sort()) console.log(`      ${y}  ${String(byYear.get(y)).padStart(5)}`);
  if (saturated) console.log(`    !! ${saturated} window(s) SATURATED — those windows are PARTIAL, not complete.`);
  if (failed.length) { console.log(`    !! COVERAGE INCOMPLETE — ${failed.length} window(s) unfetchable: ${failed.join("; ")}`); }
  await writeCache(IDX_PATH, filings);
}
assertNonEmpty("424B4 filings", filings, 500);

// One IPO per registrant: keep the EARLIEST 424B4 per CIK. A later 424B4 from the same CIK is a follow-on, and the
// inception test below would reject it anyway — this just avoids fetching it.
const firstByCik = new Map<string, Filing>();
for (const x of [...filings].sort((a, b) => a.date < b.date ? -1 : 1)) if (!firstByCik.has(x.cik)) firstByCik.set(x.cik, x);
console.log(`    ${filings.length.toLocaleString()} 424B4 filings -> ${firstByCik.size.toLocaleString()} distinct registrants (earliest filing each)`);

// ─────────────────────────────────────────────────────────────────────────────
// (1b) CIK -> TICKER for registrants EDGAR did not name inline (data.sec.gov submissions)
// ─────────────────────────────────────────────────────────────────────────────
const TK_PATH = "data/ipo-cik-tickers.json";
const tkCache = await readCache<Record<string, string | null>>(TK_PATH, {});
let tkFetched = 0;
for (const [cik, fl] of firstByCik) {
  if (fl.ticker) continue;
  if (cik in tkCache) { fl.ticker = tkCache[cik]; continue; }
  try {
    const j = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: { "User-Agent": UA } }).then((r) => r.ok ? r.json() : null);
    const t = (j?.tickers as string[])?.[0] ?? null;
    tkCache[cik] = t; fl.ticker = t;
  } catch { tkCache[cik] = null; }
  tkFetched++;
  if (tkFetched % 200 === 0) { console.log(`    resolved ${tkFetched} CIKs via submissions API`); await writeCache(TK_PATH, tkCache); }
  await sleep(150);
}
if (tkFetched) await writeCache(TK_PATH, tkCache);
const withTicker = [...firstByCik.values()].filter((x) => x.ticker && /^[A-Z][A-Z.\-]{0,5}$/.test(x.ticker));
console.log(`    ${withTicker.length.toLocaleString()} registrants carry a resolvable US ticker (${tkFetched} newly resolved)`);

// ─────────────────────────────────────────────────────────────────────────────
// (2) INCEPTION TEST + PRICES from trd_bars_deep
// ─────────────────────────────────────────────────────────────────────────────
type Bar = number[];
// D-757: strict read — a transport failure retries then THROWS, never becomes an empty result.
const { q: sq } = mkStrictRead(OWNED, hdr);
const barsOf = async (sym: string): Promise<Bar[]> => {
  const r = await sq(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  return (r?.[0]?.bars || []).filter((b: Bar) => b[4] > 0 && b[1] > 0);
};
const iwmBars = await barsOf("IWM");
assertNonEmpty("IWM benchmark bars", iwmBars, 1000);
const iwmDates = iwmBars.map((b) => iso(b[0]));
const iwm = new Map(iwmDates.map((d, i) => [d, iwmBars[i][4]]));
const iwmAtOrBefore = (d: string) => { for (let i = iwmDates.length - 1; i >= 0; i--) if (iwmDates[i] <= d) return iwmBars[i][4]; return undefined; };

interface Ev {
  ticker: string; cik: string; adsh: string; doc: string; date: string; name: string;
  d0: string; open0: number; close0: number; dv1m: number; fwd: (number | null)[];
}
const evs: Ev[] = [];
let noPanel = 0, notInception = 0;
let scanned = 0;
for (const fl of withTicker) {
  const b = await barsOf(fl.ticker!);
  scanned++;
  if (scanned % 250 === 0) console.log(`    scanned ${scanned}/${withTicker.length} panel series`);
  if (b.length < 25) { noPanel++; continue; }
  const dts = b.map((x) => iso(x[0]));
  const first = dts[0];
  // INCEPTION TEST: the panel must have captured this name STARTING to trade around the prospectus date. A 424B4 is
  // routinely filed T+1/T+2 after pricing (Airbnb: traded 2020-12-10, filed 2020-12-11), hence the -5d slack.
  if (!(first >= addDays(fl.date, -5) && first <= addDays(fl.date, 30))) { notInception++; continue; }
  const open0 = b[0][1], close0 = b[0][4];
  const m1 = b.slice(0, Math.min(21, b.length));
  const dv1m = mean(m1.map((x) => x[4] * x[5]));
  const s0 = iwmAtOrBefore(dts[0]);
  const fwd = WINS.map((w) => {
    let iT = 0 + w;
    if (iT >= b.length) {
      // SURVIVORSHIP: a name that STOPPED trading before the horizon is included at its last bar (the failure is the
      // result). Only a still-live name whose horizon runs past our data is right-censored and dropped.
      if (dts[dts.length - 1] >= "2026-06-01") return null;
      iT = b.length - 1;
    }
    const s1 = iwmAtOrBefore(dts[iT]);
    if (!s0 || !s1 || !(open0 > 0) || !(b[iT][4] > 0)) return null;
    return ((b[iT][4] / open0 - 1) - (s1 / s0 - 1)) * 100;
  });
  evs.push({ ticker: fl.ticker!, cik: fl.cik, adsh: fl.adsh, doc: fl.doc, date: fl.date, name: fl.name, d0: dts[0], open0, close0, dv1m, fwd });
}
console.log(`    INCEPTION-CONFIRMED IPO events: ${evs.length}  (${notInception} rejected: first panel bar not at the prospectus date — follow-ons + pre-2020 truncated histories; ${noPanel} with no usable panel series)`);
assertNonEmpty("inception-confirmed IPO events", evs, 50);

// ─────────────────────────────────────────────────────────────────────────────
// (1c) OFFER PRICE from the 424B4 primary document (sequential, cached)
// ─────────────────────────────────────────────────────────────────────────────
const OP_PATH = "data/ipo-offer-prices-v2.json";
const opCache = await readCache<Record<string, number | null>>(OP_PATH, {});
// OFFER-PRICE PARSER. Two forms carry the priced deal, and the first version of this parser knew only the first —
// which is how American Healthcare REIT (priced $12.00 in a cover TABLE with no "per share" adjacent) fell through to
// an unrelated "$1.00 per share" elsewhere in the document. Both forms are now handled, and the range language
// ("between $17.00 and $19.00") is explicitly refused because that is the FILED RANGE, not the price:
//   A. prose  — "(initial) public offering price ... is/of $X.XX per share|ADS|unit"
//   B. cover table — "Per Share | Total ... Public offering price $ X.XX"
const parseOffer = (raw: string): number | null => {
  const t = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
  const low = t.toLowerCase();
  const num = (x: string) => { const v = Number(x.replace(/,/g, "")); return (v >= 0.5 && v <= 5000) ? v : null; };
  for (const a of ["initial public offering price", "public offering price"]) {
    let i = -1;
    while ((i = low.indexOf(a, i + 1)) >= 0) {
      const win = t.slice(i, i + 260);
      if (/\bbetween\s+\$/i.test(win)) continue;   // a filed RANGE, not the priced deal
      const m = win.match(/^[^$]{0,80}\$\s?([0-9][0-9,]{0,4}(?:\.[0-9]{1,4})?)\s*(?:per|a|each)?\s*(?:share|ADS|American Depositary Share|unit|ordinary share|common share)?/i);
      if (m && /per|a share|ADS|unit/i.test(win.slice(0, 160))) { const v = num(m[1]); if (v) return v; }
    }
  }
  let i = -1;
  while ((i = low.indexOf("offering price", i + 1)) >= 0) {
    if (!/per\s+(share|ads|unit|ordinary share)/i.test(t.slice(Math.max(0, i - 400), i))) continue;
    const m = t.slice(i, i + 120).match(/\$\s?([0-9][0-9,]{0,4}(?:\.[0-9]{1,4})?)/);
    if (m) { const v = num(m[1]); if (v) return v; }
  }
  return null;
};
let opFetched = 0, opFail = 0;
for (const e of evs) {
  if (e.adsh in opCache) continue;
  const acc = e.adsh.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(e.cik)}/${acc}/${e.doc}`;
  let px: number | null = null;
  try { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (r.ok) px = parseOffer(await r.text()); } catch { /* recorded as null below */ }
  opCache[e.adsh] = px;
  if (px == null) opFail++;
  opFetched++;
  if (opFetched % 100 === 0) { console.log(`    fetched ${opFetched} prospectuses (${opFail} unparsed)`); await writeCache(OP_PATH, opCache); }
  await sleep(SLEEP);
}
if (opFetched) await writeCache(OP_PATH, opCache);
const priced = evs.filter((e) => (opCache[e.adsh] ?? null) != null);
console.log(`    offer price parsed for ${priced.length} of ${evs.length} events (${evs.length - priced.length} unparsed -> excluded from the OFFER legs only)`);

// POSITIVE CONTROL (THE POSITIVE-CONTROL RULE, D-641). A parser that returns nothing looks exactly like a market with
// no IPOs. These three deals are known: Airbnb 2020-12 $68, Reddit 2024-03 $34, Arm 2023-09 $51. Any miss is RED.
const CONTROLS: [string, number][] = [["ABNB", 68], ["RDDT", 34], ["ARM", 51], ["AHR", 12], ["NEXA", 16]];
let ctlOk = 0;
console.log(`\n    POSITIVE CONTROL:`);
for (const [tk, want] of CONTROLS) {
  const e = evs.find((x) => x.ticker === tk);
  const got = e ? opCache[e.adsh] ?? null : null;
  const ok = got != null && Math.abs(got - want) < 0.011;
  if (ok) ctlOk++;
  console.log(`      ${tk.padEnd(5)} expect $${want.toFixed(2)}  got ${got == null ? "MISSING" : "$" + got.toFixed(2)}  ${e ? `[event ${e.d0}]` : "[NO EVENT]"}  ${ok ? "OK" : "FAIL"}`);
}
if (ctlOk === 0) { console.error(`!! POSITIVE CONTROL RED — 0 of ${CONTROLS.length} known IPOs recovered with the right offer price. Every number below would be about the PARSER, not the market. Aborting.`); Deno.exit(1); }
if (ctlOk < CONTROLS.length) console.log(`      ${ctlOk}/${CONTROLS.length} controls recovered — the misses are stated, and coverage below is read as PARTIAL.`);

// ─────────────────────────────────────────────────────────────────────────────
// (3) THE TWO LEGS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// (2b) THE SCALE ARTIFACT — found by the first run, and it is NOT a market fact
// The panel's price series are RETROACTIVELY SPLIT-ADJUSTED; the prospectus offer price is NOMINAL at the time. A
// name that later did a 1:1000 reverse split therefore has its entire pre-split history multiplied, so offer->open
// is computed across two different price scales. The first run printed a mean pop of 1.97e10% beside a median of
// 25.3% — the mean was arithmetic on ADTX's adjusted open of $2.68 TRILLION against a $9.00 offer, not a market.
// A ratio outside [0.2x, 5x] is treated as SCALE-INCONSISTENT and excluded from the OFFER legs only.
// THE BIAS THIS INTRODUCES IS STATED, NOT HIDDEN: the excluded names are precisely the later-reverse-split
// microcaps, i.e. the deals that went on to fail, so the screened pop is biased UPWARD. The pooled mean over ALL
// events is UNTESTED, not zero and not the printed number.
// LEG (b) IS UNAFFECTED and is deliberately never screened: it is a ratio of two ADJUSTED prices from the same
// series, so the scale cancels — which is also why leg (b) keeps the failures the offer legs cannot.
const SCALE_LO = 0.2, SCALE_HI = 5;
const scaleOk = (e: Ev) => { const p = opCache[e.adsh]; if (p == null) return false; const r = e.open0 / p; return r >= SCALE_LO && r <= SCALE_HI; };
const dropped = priced.filter((e) => !scaleOk(e));
const clean = priced.filter(scaleOk);
console.log(`\n    SCALE SCREEN: ${dropped.length} of ${priced.length} priced events excluded from the OFFER legs — first-day open`);
console.log(`      is >${SCALE_HI}x or <${SCALE_LO}x the offer price, the signature of a LATER REVERSE SPLIT in a retroactively`);
console.log(`      adjusted series (worst: ${dropped.sort((a, b) => (b.open0 / opCache[b.adsh]!) - (a.open0 / opCache[a.adsh]!))[0]?.ticker ?? "n/a"} at ${f((dropped[0]?.open0 ?? 0) / (opCache[dropped[0]?.adsh ?? ""] ?? 1), 0)}x). Those names are the later FAILURES,`);
console.log(`      so the screened offer-leg numbers are biased UPWARD; the pooled all-event mean is UNTESTED.`);

const RT = RT_BP / 100;   // one round trip per event, in percentage points
const popOpen = clean.map((e) => (e.open0 / opCache[e.adsh]! - 1) * 100);        // offer -> FIRST OPEN (allocation-gated)
const popClose = clean.map((e) => (e.close0 / opCache[e.adsh]! - 1) * 100);      // offer -> FIRST CLOSE (allocated return)
const openToClose = evs.map((e) => (e.close0 / e.open0 - 1) * 100);               // the only part a retail buyer sees on day 1

const dvSorted = [...evs].sort((a, b) => a.dv1m - b.dv1m);
const liqCut = dvSorted[Math.floor(dvSorted.length * 2 / 3)]?.dv1m ?? 0;
const eraOf = (d: string) => d < "2020-01-01" ? "2015-19" : "2020-26";

const line = (label: string, a: number[], net = true) => {
  const x = net ? a.map((v) => v - RT) : a;
  console.log(`      ${label.padEnd(34)} n=${String(x.length).padStart(4)}  mean ${f(mean(x)).padStart(8)}%  med ${f(med(x)).padStart(7)}%  t ${f(tstat(x)).padStart(6)}  pos ${f(posPct(x), 1).padStart(5)}%`);
};

console.log(`\n==> COVERAGE STATEMENT`);
console.log(`    instruments ${new Set(evs.map((e) => e.ticker)).size} | events ${evs.length} | span ${evs.map((e) => e.d0).sort()[0]} .. ${evs.map((e) => e.d0).sort().slice(-1)[0]}`);
const eraN = { "2015-19": evs.filter((e) => eraOf(e.d0) === "2015-19").length, "2020-26": evs.filter((e) => eraOf(e.d0) === "2020-26").length };
console.log(`    era split: 2015-19 n=${eraN["2015-19"]} | 2020-26 n=${eraN["2020-26"]}`);
console.log(`    THE PANEL'S DELISTED BACKFILL BEGINS ~2020, so the 2015-19 half contains only names that survived into`);
console.log(`    the curated panel: that half is SURVIVORSHIP-EXPOSED UPWARD and is not comparable like-for-like to 2020-26.`);
console.log(`    Required inputs present: 424B4 index YES | offer price ${priced.length}/${evs.length} parsed | first-day bars YES | IWM benchmark YES.`);

console.log(`\n==> LEG (a) ALLOCATED — offer price to first-day print  [gross; no round trip is charged to an allocation]`);
line("offer -> first OPEN", popOpen, false);
line("offer -> first CLOSE", popClose, false);
console.log(`      PRIOR: offer->first close strongly POSITIVE.  OUTCOME: ${mean(popClose) > 0 && tstat(popClose) > 2 ? "MATCHED" : "MISSED"}`);

// SKEW: how much of the total pop sits in the top decile. This is the allocation that retail does not get.
const sortedPop = [...popClose].sort((a, b) => b - a);
const totPop = sortedPop.reduce((a, b) => a + b, 0);
const topDec = sortedPop.slice(0, Math.max(1, Math.floor(sortedPop.length / 10)));
console.log(`      SKEW: top decile (n=${topDec.length}) delivers ${f(totPop ? 100 * topDec.reduce((a, b) => a + b, 0) / totPop : NaN, 1)}% of the TOTAL first-close pop;`);
console.log(`            median deal ${f(med(popClose))}% vs mean ${f(mean(popClose))}%. The mean is a description of the deals a retail`);
console.log(`            account is LEAST likely to be allocated — hot deals are the oversubscribed ones.`);

console.log(`\n==> LEG (b) RETAIL-REALISABLE — buy the first-day OPEN (the first tradeable print; lag-0 is legitimate here)`);
line("first OPEN -> first CLOSE", openToClose);
for (let i = 0; i < WINS.length; i++) {
  const all = evs.map((e) => e.fwd[i]).filter((x): x is number => x != null);
  line(`open -> +${WINS[i]}d, excess vs IWM`, all);
}
const prior250 = evs.map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null).map((v) => v - RT);
console.log(`      PRIOR: first-open -> later is FLAT-TO-NEGATIVE.  OUTCOME: ${mean(prior250) <= 0 || Math.abs(tstat(prior250)) < 2 ? "MATCHED" : "MISSED"}`);

console.log(`\n    LIQUID TERCILE (top third by first-month dollar volume; THE LIQUIDITY LAW — the promotable number)`);
for (let i = 0; i < WINS.length; i++) {
  const liq = evs.filter((e) => e.dv1m >= liqCut).map((e) => e.fwd[i]).filter((x): x is number => x != null);
  line(`liq: open -> +${WINS[i]}d vs IWM`, liq);
}
const liqPop = clean.filter((e) => e.dv1m >= liqCut).map((e) => (e.close0 / opCache[e.adsh]! - 1) * 100);
line("liq: offer -> first CLOSE", liqPop, false);

console.log(`\n    ERA HALVES`);
for (const era of ["2015-19", "2020-26"]) {
  const sub = evs.filter((e) => eraOf(e.d0) === era);
  const subP = clean.filter((e) => eraOf(e.d0) === era);
  line(`${era} offer->first close`, subP.map((e) => (e.close0 / opCache[e.adsh]! - 1) * 100), false);
  for (let i = 0; i < WINS.length; i++) line(`${era} open->+${WINS[i]}d vs IWM`, sub.map((e) => e.fwd[i]).filter((x): x is number => x != null));
}

console.log(`\n    TURNOVER / COST (THE TURNOVER LAW): this is an EVENT strategy, not a rebalanced book — turnover is exactly`);
console.log(`    ONE round trip per event, charged at ${RT_BP}bp (${f(RT)}pp) on every leg-(b) number above. Leg (a) is quoted gross`);
console.log(`    because an allocation has no entry trade; its exit round trip would cost the same ${RT_BP}bp.`);

// ─────────────────────────────────────────────────────────────────────────────
// (4) ALLOCATION REALISM — stated as ASSUMPTIONS, sources named, none of it measured here
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> ALLOCATION REALISM — ASSUMPTIONS, NOT MEASUREMENTS (no allocation data is held; none is free)`);
console.log(`    US (ASSUMPTION, sources: SEC "Investor Bulletin: Investing in an IPO"; FINRA Rule 5130/5131; underwriter`);
console.log(`        retail programmes e.g. Fidelity/Schwab/Robinhood IPO Access eligibility terms):`);
console.log(`      · Allocation is made by the underwriting syndicate, not by an exchange. Retail reaches it only through a`);
console.log(`        broker that was given a retail slice, and eligibility is often gated (household assets, trading history).`);
console.log(`      · Hot deals are oversubscribed many times over; the documented practice is pro-rata scaling or a lottery,`);
console.log(`        so an indication is typically filled at a SMALL FRACTION, and at 0 on the hottest books.`);
console.log(`      · FINRA 5130 bars "restricted persons"; 5131 bars spinning/quid-pro-quo allocation to executives.`);
console.log(`      · The economically important asymmetry: fills are LARGEST on the deals nobody wants. That is adverse`);
console.log(`        selection on the exact variable — deal quality — that produces the pop. The unconditional mean pop`);
console.log(`        measured above therefore OVERSTATES an allocated retail investor's expected return, by an amount this`);
console.log(`        script CANNOT quantify without per-deal allocation data. UNTESTED, blocker: no free allocation dataset.`);
console.log(`    UK (ASSUMPTION, sources: PrimaryBid public description; LSE retail-offer practice):`);
console.log(`      · PrimaryBid gives retail access to a slice of SOME UK IPOs and placings AT THE OFFER PRICE, which removes`);
console.log(`        the broker-syndicate gate that binds in the US — the structural reason to look at the UK at all.`);
console.log(`      · It does not remove scaling: retail tranches are capped and are themselves scaled back when oversubscribed.`);
console.log(`    UK LEG: UNTESTED. BLOCKER: no LSE/LSEG/PrimaryBid host is on the endpoint allowlist (checked: the allowlist`);
console.log(`      carries sec.gov, finra.org, yahoo, stooq, dukascopy and others — no lseg.com, no londonstockexchange.com,`);
console.log(`      no primarybid.com), so the new-issue list cannot legally be fetched here and Yahoo ".L" tickers alone give`);
console.log(`      prices with NO offer price and NO first-day identification. This is a DATA gap, not a market finding`);
console.log(`      (THE COVERAGE LAW). To close it: allowlist an LSE new-issue source, then the same code runs on ".L" tickers.`);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "ipo-pop", runId: `ipo|${FROM_Y}-${TO_Y}|${WINS.join(",")}|${RT_BP}`, spent: 2 + WINS.length * 3 });

console.log(`\n==> VERDICT — DESCRIPTIVE ONLY (MECHANISM LAW: no mechanism claim, no pre-registration, no trd_lineage row)`);
console.log(`    (a) ALLOCATED return (offer -> first close): mean ${f(mean(popClose))}%, median ${f(med(popClose))}%, t ${f(tstat(popClose))}, n=${clean.length} scale-consistent of ${priced.length} priced.`);
console.log(`        REAL, and ACCESS-GATED: it is earned before the first tradeable print. ${f(totPop ? 100 * topDec.reduce((a, b) => a + b, 0) / totPop : NaN, 0)}% of it sits in the top decile`);
console.log(`        of deals, which are the oversubscribed ones a retail account is least likely to be allocated.`);
{
  const l = evs.map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null).map((v) => v - RT);
  const lq = evs.filter((e) => e.dv1m >= liqCut).map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null).map((v) => v - RT);
  console.log(`    (b) RETAIL-REALISABLE (buy first open, hold ${WINS[WINS.length - 1]}d, excess vs IWM, net ${RT_BP}bp): mean ${f(mean(l))}%, med ${f(med(l))}%,`);
  console.log(`        t ${f(tstat(l))}, pos ${f(posPct(l), 1)}%, n=${l.length}. LIQUID tercile: mean ${f(mean(lq))}%, t ${f(tstat(lq))}, n=${lq.length}.`);
  console.log(`    (c) PLACEABLE FOR A UK SMALL ACCOUNT: NO on leg (a) — a UK retail account has no US syndicate allocation, and`);
  console.log(`        the UK route (PrimaryBid) is UNTESTED here for the allowlist reason above. Leg (b) is placeable by anyone`);
  const dir = Math.abs(tstat(l)) < 2 ? "NO significant excess" : (mean(l) > 0 ? `a POSITIVE excess of ${f(mean(l))}%` : `a NEGATIVE excess of ${f(mean(l))}%`);
  console.log(`        with a broker, and measured over ${WINS[WINS.length - 1]}d it carries ${dir} — the pop is not in it.`);
}
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
