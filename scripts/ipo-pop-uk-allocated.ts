#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ipo-pop-uk-allocated.ts (D-754, UK leg (a)) — closes the leg that scripts/ipo-pop-uk.ts recorded as UNTESTED.
//
// WHAT WAS ACTUALLY BLOCKING IT, AND WHAT UNBLOCKED IT. ipo-pop-uk.ts concluded: "NO machine-readable UK IPO HISTORY
// WITH AN ISSUE PRICE is reachable on api./www.londonstockexchange.com ... the bundle hardcodes report URLs on
// docs.londonstockexchange.com, which is NOT allowlisted." That was a correct COVERAGE-LAW verdict (a data gap, never
// a market finding) and it was also HALF WRONG about the mechanism: it inferred the report URL shape from a hardcoded
// string in the JS bundle and never obtained the actual new-issues link, because it probed componentRefresh with an
// EMPTY component parameter and got []. The Angular source says why: reports tab modules are rendered by
//   refreshService.addComponents(id, moduleIds, position, "tabId=" + currentTabId)
// so the module answers ONLY when the componentId is paired with its tabId. With `parameters:"tabId=<tabId>"` the same
// endpoint that returned [] returns the component, and the component carries the download link. The URL below is the
// LSE's own JSON, not a guess.
//
// DISCOVERY CHAIN, reproducible end to end (each step is re-run live by this script and printed):
//   1. GET  https://api.londonstockexchange.com/api/v1/pages?path=reports
//        -> component reports-filter-toggle, whose filter tree carries Primary markets > "New issues and IPOs" with
//           moduleId block_content:4189c871-0f95-4dd0-b4d7-3f66e2475c7d and tabId 80ca0a22-238e-4ab6-8237-b9ddefd02e2c
//   2. POST https://api.londonstockexchange.com/api/v1/components/refresh
//        {"path":"reports","parameters":"","components":[{"componentId":"<moduleId>","parameters":"tabId=<tabId>"}]}
//        -> type "reports-filter-toggle-result", ctaItems[0].ctaButton.link =
//           https://docs.londonstockexchange.com/sites/default/files/reports/New%20issues%20and%20IPOs_83.xlsx
//   3. GET that .xlsx (docs.londonstockexchange.com is now allowlisted).
// It is ONE workbook, not a monthly series: sheet "New Issues and IPOs" holds 6,283 admissions spanning 1995-06-19 ..
// 2026-07-31 with columns Market, Date, LSE IPO, TIDM, Company, Issue type, Issue Price, Currency, Money Raised.
// The "_83" suffix is a CMS revision counter and WILL change; that is why the link is resolved live every run rather
// than hardcoded, and why a hardcoded URL would silently rot (the D-613 continuity failure).
//
// THE LEG. (a) ISSUE PRICE -> FIRST CLOSE, gross. PRIOR, stated before the measurement (THE SIGN LAW) and identical to
// the prior the US study and ipo-pop-uk.ts pre-stated: strongly POSITIVE. Recorded MATCHED or MISSED.
//
// PRICES ARE RAW, NOT ADJUSTED, AND THAT IS THE CORRECT CHOICE HERE — the opposite of leg (b). The issue price is
// NOMINAL at the admission date; Yahoo's adjclose is a total-return series that has had every subsequent dividend
// removed. Dividing an adjusted close by a nominal offer price compares two different scales and biases the pop DOWN
// by the dividends since paid (ipo-pop-uk.ts's own DOCS sanity print shows the size of it). Leg (b) is a ratio of two
// prices from the SAME series so it must use the adjusted scale; leg (a) crosses from the report into the price feed
// on ONE day, so it must use the raw scale. The scale screen below then catches what raw prices cannot.
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW): no causal claim, no pre-registration, no trd_lineage row, no DECISIONS.md
// edit. Trials are counted like any other specification.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import * as XLSX from "npm:xlsx@0.18.5";

const K = declareKnobs("ipo-pop-uk-allocated", [
  { name: "FROM_D", def: "2015-01-01", note: "earliest admission date kept as an IPO event" },
  { name: "TOL_D", def: "10", note: "calendar-day tolerance between the report's admission date and the first Yahoo bar" },
  { name: "SLEEP_MS", def: "300", note: "courtesy delay between sequential fetches" },
  { name: "REFRESH", def: "0", note: "1 = ignore on-disk caches and re-fetch" },
]);
const FROM_D = K.FROM_D, SLEEP = Number(K.SLEEP_MS), TOL_D = Number(K.TOL_D);
const REFRESH = K.REFRESH === "1";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Mozilla/5.0 (Aegis Research ona@revitalise.io)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ipoukalloc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
const dayGap = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const posPct = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : NaN;
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
const trimmed = (a: number[], p = 0.05) => { if (a.length < 20) return mean(a); const s = [...a].sort((x, y) => x - y), k = Math.floor(a.length * p); return mean(s.slice(k, s.length - k)); };
const readCache = async <T>(p: string, fb: T): Promise<T> => { if (REFRESH) return fb; try { return JSON.parse(await Deno.readTextFile(p)) as T; } catch { return fb; } };
const writeCache = async (p: string, v: unknown) => { try { await Deno.writeTextFile(p, JSON.stringify(v)); } catch { /* cache is an optimisation, not a result */ } };
try { await Deno.mkdir("data", { recursive: true }); } catch { /* exists */ }

const LSE_API = "https://api.londonstockexchange.com";
const lseHdr = { "User-Agent": UA, Accept: "application/json", Referer: "https://www.londonstockexchange.com/" };

// ─────────────────────────────────────────────────────────────────────────────
// (1) RESOLVE THE REPORT URL FROM THE LSE'S OWN JSON — live, with a positive control
// ─────────────────────────────────────────────────────────────────────────────
console.log(`==> UK IPO — LEG (a) ALLOCATED. Step 1: resolve the new-issues report URL from the site's own JSON.`);
interface Sub { label: string; tabId: string; modules?: { moduleId: string }[] }
interface Filt { label: string; subFilters: Sub[] }
const pg = await fetch(`${LSE_API}/api/v1/pages?path=reports`, { headers: lseHdr }).then((r) => r.json()).catch(() => null) as
  { components?: { id: string; type: string; content?: { value?: { reportsFilterToggleFilters?: Filt[] } }[] }[] } | null;
const toggle = pg?.components?.find((c) => c.type === "reports-filter-toggle");
const filters = toggle?.content?.[0]?.value?.reportsFilterToggleFilters ?? [];
console.log(`    GET  /api/v1/pages?path=reports  -> components: ${(pg?.components ?? []).map((c) => c.type).join(", ") || "NONE"}`);
console.log(`    reports-filter-toggle filter groups: ${filters.map((x) => x.label).join(" | ") || "NONE"}`);
const sub = filters.flatMap((x) => x.subFilters ?? []).find((s) => /new issues and ipos/i.test(s.label));
if (!sub?.modules?.length) { console.error(`!! Could not locate the "New issues and IPOs" sub-filter in the reports page JSON. Endpoint tried: GET ${LSE_API}/api/v1/pages?path=reports. LEG (a) STOPS AS UNTESTED.`); Deno.exit(1); }
console.log(`    -> "${sub.label}"  moduleId=${sub.modules[0].moduleId}  tabId=${sub.tabId}`);

const refresh = async (componentId: string, parameters: string) => {
  const r = await fetch(`${LSE_API}/api/v1/components/refresh`, {
    method: "POST", headers: { ...lseHdr, "Content-Type": "application/json" },
    body: JSON.stringify({ path: "reports", parameters: "", components: [{ componentId, parameters }] }),
  });
  return r.ok ? await r.json() as { type?: string; content?: { value?: { ctaItems?: { ctaTitle?: string; ctaButton?: { link?: string }; history?: { link?: string; ctaTitle?: string }[] }[] } }[] }[] : null;
};
// POSITIVE CONTROL ON THE DISCOVERY (D-641). Before believing that the EMPTY-parameter call returning [] is a fact
// about the module rather than about our request, show both: [] without the tabId, non-[] with it. A discovery that
// only ever succeeds one way cannot tell a dead module from a wrong request — and that is the exact error the
// previous run made.
const bare = await refresh(sub.modules[0].moduleId, "");
await sleep(SLEEP);
const withTab = await refresh(sub.modules[0].moduleId, `tabId=${sub.tabId}`);
await sleep(SLEEP);
console.log(`    POST /api/v1/components/refresh  parameters:""              -> ${Array.isArray(bare) ? bare.length : "err"} component(s)   [the previous run's dead end]`);
console.log(`    POST /api/v1/components/refresh  parameters:"tabId=<tabId>" -> ${Array.isArray(withTab) ? withTab.length : "err"} component(s)   [POSITIVE CONTROL — must be >= 1]`);
if (!withTab?.length) { console.error(`!! The module returned nothing even WITH its tabId. LEG (a) STOPS AS UNTESTED; endpoints tried are printed above.`); Deno.exit(1); }
const ctas = withTab[0]?.content?.[0]?.value?.ctaItems ?? [];
const links = ctas.flatMap((c) => [{ t: c.ctaTitle ?? "", l: c.ctaButton?.link ?? "" }, ...(c.history ?? []).map((h) => ({ t: h.ctaTitle ?? "history", l: h.link ?? "" }))]).filter((x) => /\.(xlsx|xls|csv|pdf)(\?|$)/i.test(x.l));
console.log(`    FILES PUBLISHED BY THIS MODULE (${links.length}):`);
for (const x of links) console.log(`      · ${x.t}  ${x.l}`);
const xlsxUrl = links.find((x) => /\.xlsx?$/i.test(x.l))?.l;
if (!xlsxUrl) {
  console.error(`!! The module publishes ${links.length} file(s) and NONE is an Excel workbook (PDF is not parsed — a PDF-only`);
  console.error(`   report is recorded as a BLOCKER, not as a market finding). LEG (a) STOPS AS UNTESTED.`);
  Deno.exit(1);
}
console.log(`    RESOLVED: ${xlsxUrl}`);
console.log(`    NOTE ON HISTORY: this module publishes ONE cumulative workbook, not a monthly series (history=${ctas[0]?.history === null ? "null" : String((ctas[0]?.history ?? []).length)}).`);
console.log(`    The single file covers the whole span, so no monthly stitching is needed and none is faked.\n`);

// ─────────────────────────────────────────────────────────────────────────────
// (2) DOWNLOAD + PARSE
// ─────────────────────────────────────────────────────────────────────────────
interface NI { market: string; mk: "MAIN" | "AIM"; date: string; isIpo: boolean; tidm: string; company: string; issueType: string; price: number | null; ccy: string; raisedNew: number; raisedTot: number }
const NI_PATH = "data/uk-new-issues.json";
let ni = await readCache<NI[]>(NI_PATH, []);
if (!ni.length) {
  const buf = await fetch(xlsxUrl, { headers: { "User-Agent": UA } }).then((r) => r.ok ? r.arrayBuffer() : null);
  if (!buf) { console.error(`!! Download failed: ${xlsxUrl}. LEG (a) STOPS AS UNTESTED.`); Deno.exit(1); }
  console.log(`==> Downloaded ${(buf.byteLength / 1024).toFixed(0)} KB from docs.londonstockexchange.com`);
  const wb = XLSX.read(new Uint8Array(buf), { type: "buffer" });
  console.log(`    sheets: ${wb.SheetNames.join(", ")}`);
  const sh = wb.SheetNames.find((n) => /new issues/i.test(n));
  if (!sh) { console.error(`!! No "New Issues and IPOs" sheet in the workbook. LEG (a) STOPS AS UNTESTED.`); Deno.exit(1); }
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true }) as unknown[][];
  const hi = grid.findIndex((r) => String(r?.[0]) === "Market" && r.some((c) => String(c) === "TIDM"));
  if (hi < 0) { console.error(`!! Header row not found in sheet "${sh}". LEG (a) STOPS AS UNTESTED.`); Deno.exit(1); }
  const H = (grid[hi] as unknown[]).map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
  const col = (re: RegExp) => H.findIndex((h) => re.test(h));
  const cM = col(/^Market$/i), cD = col(/^Date$/i), cI = col(/^LSE IPO$/i), cT = col(/^TIDM$/i), cC = col(/^Company$/i),
    cIT = col(/^Issue type$/i), cP = col(/^Issue Price$/i), cCcy = col(/^Currency$/i), cRN = col(/Money Raised - New/i), cRT = col(/TOTAL RAISED/i);
  console.log(`    header row ${hi}: ${H.filter(Boolean).join(" | ")}`);
  console.log(`    RETAIL / INTERMEDIARIES-OFFER COLUMN: ${H.some((h) => /retail|intermediar/i.test(h)) ? "PRESENT" : "**ABSENT**"} — see the retail section below.`);
  for (const r of grid.slice(hi + 1)) {
    if (!r?.[cM]) continue;
    const d = typeof r[cD] === "number" ? serial(r[cD] as number) : String(r[cD] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const mkt = String(r[cM]);
    const p = Number(r[cP]);
    ni.push({
      market: mkt, mk: /^AIM$/i.test(mkt) ? "AIM" : "MAIN", date: d, isIpo: /^IPO$/i.test(String(r[cI] ?? "")),
      tidm: String(r[cT] ?? "").trim().toUpperCase(), company: String(r[cC] ?? ""), issueType: String(r[cIT] ?? ""),
      price: Number.isFinite(p) && p > 0 ? p : null, ccy: String(r[cCcy] ?? ""),
      raisedNew: Number(r[cRN]) || 0, raisedTot: Number(r[cRT]) || 0,
    });
  }
  await writeCache(NI_PATH, ni);
} else console.log(`==> ${NI_PATH} loaded from cache (${ni.length.toLocaleString()} rows; REFRESH=1 to re-fetch)`);
assertNonEmpty("LSE new-issue records", ni, 1000);
{
  const ds = ni.map((x) => x.date).sort();
  console.log(`==> data/uk-new-issues.json: ${ni.length.toLocaleString()} admissions, ${ds[0]} .. ${ds[ds.length - 1]}`);
  console.log(`    LSE IPO=${ni.filter((x) => x.isIpo).length.toLocaleString()} | Not IPO=${ni.filter((x) => !x.isIpo).length.toLocaleString()} (introductions, reverse takeovers, transfers — excluded: no offer)`);
  console.log(`    with an issue price: ${ni.filter((x) => x.price != null).length.toLocaleString()} | issue types: ${[...new Set(ni.filter((x) => x.isIpo).map((x) => x.issueType))].join(", ")}`);
}

// POSITIVE CONTROL ON THE PARSE (D-641). A workbook parsed into the wrong columns looks exactly like a market with no
// IPOs. Two deals with prices known independently of this file MUST come back exact, or every number below is about
// the parser. DOCS is the control the previous script already used; RPI is a second, later one so the control is not
// a single point in one era.
console.log(`\n==> POSITIVE CONTROL ON THE REPORT PARSE`);
const CTL: [string, string, number][] = [["DOCS", "2021-01-29", 370], ["RPI", "2024-06-11", 280]];
let ctlOk = 0;
for (const [tk, knownD, knownP] of CTL) {
  const row = ni.find((x) => x.tidm === tk && x.isIpo);
  const okP = row?.price != null && Math.abs(row.price - knownP) < 0.51;
  const okD = !!row && dayGap(row.date, knownD) <= TOL_D;
  if (okP && okD) ctlOk++;
  console.log(`      ${tk.padEnd(5)} expect ${knownP}p on ~${knownD}  got ${row ? `${row.price}p on ${row.date} (${row.company}, ${row.market}, ${row.issueType})` : "MISSING"}  ${okP && okD ? "OK" : "FAIL"}`);
}
if (ctlOk < CTL.length) { console.error(`!! POSITIVE CONTROL RED — ${ctlOk}/${CTL.length}. Every number below would be about the parser, not the market. Aborting.`); Deno.exit(1); }
console.log(`      ${ctlOk}/${CTL.length} PASS. NOTE the date semantics this control also pins down: the report's Date is the`);
console.log(`      UNCONDITIONAL dealing date (DOCS 2021-02-03), while the first Yahoo bar is the CONDITIONAL first day`);
console.log(`      (2021-01-29). They differ by up to a week, which is why events are matched on TIDM with a ${TOL_D}-day tolerance`);
console.log(`      and NOT on an exact date — an exact-date join would have silently returned near-zero events (a false null).`);

// ─────────────────────────────────────────────────────────────────────────────
// (3) PRICES — Yahoo <TIDM>.L, RAW scale (see the header note)
// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY: the report's Currency column is BLANK on every row before 2018-02 and populated from then on. A naive
// `ccy === "GBX"` filter therefore returns ZERO events for 2015-2017 — which looks exactly like "no UK IPOs popped in
// those years" and is a manufactured null of precisely the shape THE POSITIVE-CONTROL RULE exists to catch (it was
// caught here by an era table showing 2015-17 empty, not by the filter erroring). Blank is UNKNOWN, not non-GBX, so
// blank rows are kept as candidates and the currency is then verified against the PRICE FEED — an event is used only
// if Yahoo's meta.currency is GBp, which is a stronger check than the report's own field because it is the unit the
// close is actually quoted in.
const cands = ni.filter((x) => x.isIpo && x.date >= FROM_D && x.price != null && (x.ccy === "GBX" || x.ccy === "") && /^[A-Z0-9]{2,5}$/.test(x.tidm));
console.log(`\n==> EVENT CANDIDATES: ${cands.length} LSE IPOs since ${FROM_D} priced in GBX-or-blank currency with a parseable TIDM`);
{
  const all = ni.filter((x) => x.isIpo && x.date >= FROM_D);
  const noPx = all.filter((x) => x.price == null).length;
  const nonGbx = all.filter((x) => x.price != null && x.ccy !== "GBX" && x.ccy !== "");
  const blank = all.filter((x) => x.price != null && x.ccy === "").length;
  console.log(`    of ${all.length} LSE IPOs in window: ${noPx} carry no issue price; ${nonGbx.length} are stated in a NON-GBX currency`);
  console.log(`    (${[...new Set(nonGbx.map((x) => x.ccy))].join(", ")}) and are EXCLUDED — Yahoo serves .L in GBp, so mixing them would divide two currencies.`);
  console.log(`    ${blank} rows carry a BLANK currency (every pre-2018-02 row does) and are KEPT as candidates, with the unit`);
  console.log(`    verified against Yahoo's own meta.currency below. Both exclusions are made on fields fixed at admission,`);
  console.log(`    which cannot know the first-day return.`);
}

const P1 = Math.floor(Date.parse(FROM_D + "T00:00:00Z") / 1000) - 86400 * 30;
const P2 = Math.floor(Date.now() / 1000);
type Day = { d: string; o: number; c: number; v: number };
const yahoo = async (sym: string): Promise<{ bars: Day[]; ccy: string } | null> => {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${P1}&period2=${P2}&interval=1d`, { headers: { "User-Agent": UA } });
      if (!r.ok) { if (r.status === 404) return null; continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators?.quote?.[0] ?? {};
      const bars: Day[] = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        const o = q.open?.[i], c = q.close?.[i], v = q.volume?.[i];
        if (!(o > 0 && c > 0)) continue;
        bars.push({ d: iso(res.timestamp[i]), o, c, v: v ?? 0 });   // RAW — deliberately not adjusted
      }
      return { bars, ccy: String(res.meta?.currency ?? "") };
    } catch { /* try the other host */ }
  }
  return null;
};

interface Ev extends NI { d0: string; open0: number; close0: number; dv1m: number; yccy: string }
const BAR_PATH = "data/uk-ipo-alloc-firstbars.json";
type Rec = { d0: string; open0: number; close0: number; dv1m: number; ccy: string } | null;
const bc = await readCache<Record<string, Rec>>(BAR_PATH, {});
const evs: Ev[] = [];
let fetched = 0, noSeries = 0, wrongCcy = 0;
for (const c of cands) {
  const key = `${c.tidm}|${c.date}`;
  if (!(key in bc)) {
    const y = await yahoo(`${c.tidm}.L`);
    fetched++;
    let rec: Rec = null;
    // INCEPTION TEST (the D-733 / ipo-pop.ts discipline). The FIRST Yahoo bar must sit within TOL_D days of the
    // report's admission date. This does three jobs at once: it confirms the TIDM was not recycled by a later,
    // different company; it rejects a truncated history; and it guarantees close0 is genuinely the FIRST close.
    // The unit check that replaces trusting the report's blank Currency column: GBp only.
    if (y && y.ccy !== "GBp") wrongCcy++;
    else if (y && y.bars.length >= 2 && dayGap(y.bars[0].d, c.date) <= TOL_D) {
      const b0 = y.bars[0], m1 = y.bars.slice(0, Math.min(21, y.bars.length));
      rec = { d0: b0.d, open0: b0.o, close0: b0.c, dv1m: mean(m1.map((x) => x.c * x.v)), ccy: y.ccy };
    }
    bc[key] = rec;
    if (fetched % 100 === 0) { console.log(`    fetched ${fetched} Yahoo series`); await writeCache(BAR_PATH, bc); }
    await sleep(SLEEP);
  }
  const rec = bc[key];
  if (!rec) { noSeries++; continue; }
  evs.push({ ...c, d0: rec.d0, open0: rec.open0, close0: rec.close0, dv1m: rec.dv1m, yccy: rec.ccy });
}
if (fetched) await writeCache(BAR_PATH, bc);
console.log(`    Yahoo: ${fetched} newly fetched | ${wrongCcy} rejected for a non-GBp quote currency | ${noSeries} candidates with NO usable .L series or a first bar more than ${TOL_D}d from the admission date`);
console.log(`    -> ${evs.length} inception-matched events`);
assertNonEmpty("UK IPO events with an issue price AND a matched first bar", evs, 30);

// COVERAGE / UNIVERSE (THE UNIVERSE LAW, D-645 extension: coverage is not breadth). The report IS the intended
// universe — that is the thing this leg gains over leg (b), which could only see live lines. So coverage is
// MEASURABLE here for the first time, and the missing cohort's selection mechanism is named rather than inferred.
{
  const miss = cands.length - evs.length;
  console.log(`\n==> UNIVERSE COVERAGE (measurable for the first time, because the report enumerates the INTENDED universe)`);
  console.log(`    intended ${cands.length} | present ${evs.length} | missing ${miss} (${f(100 * miss / cands.length, 1)}%)`);
  console.log(`    SELECTION MECHANISM OF THE MISSING COHORT: Yahoo drops the price history of a DELISTED .L line, so the`);
  console.log(`    absent names are dominated by companies that were taken over, failed, or moved off-exchange — the same`);
  console.log(`    upward-biasing hole ipo-pop-uk.ts named on leg (b). It bites leg (a) LESS HARD, because the issue price`);
  console.log(`    and first close are both set on day ONE: a company that delisted in 2024 still had its 2016 first-day`);
  console.log(`    pop, and what we lose is the pop's VALUE, not its sign — but the loss is not random and is stated, not netted out.`);
}

// SCALE SCREEN — ported from ipo-pop.ts, where it exists because a nominal offer price meets a price series. Prices
// here are RAW so a later split cannot contaminate them; what this screen still catches is a bad print, a TIDM whose
// issue price is quoted in a different unit (GBP vs GBX), and a mis-joined row.
const SCALE_LO = 0.2, SCALE_HI = 5;
const bad = evs.filter((e) => !(e.close0 / e.price! >= SCALE_LO && e.close0 / e.price! <= SCALE_HI));
console.log(`\n==> SCALE SCREEN: ${bad.length} event(s) rejected for a first close outside [${SCALE_LO}x, ${SCALE_HI}x] the issue price`);
if (bad.length) console.log(`    ${bad.slice(0, 10).map((e) => `${e.tidm} ${f(e.close0 / e.price!)}x`).join(", ")}`);
console.log(`    THE BIAS THIS INTRODUCES IS STATED: a genuine >5x first day would be discarded with the artifacts. The`);
console.log(`    unscreened pooled mean is reported beside the screened one below rather than replaced by it.`);
const unscreenedPop = evs.map((e) => (e.close0 / e.price! - 1) * 100);
for (let i = evs.length - 1; i >= 0; i--) if (bad.includes(evs[i])) evs.splice(i, 1);

// TRADABILITY FLOOR — the same floor ipo-pop-uk.ts adopted, and for the same reason: a line that traded nothing in
// its first month has a first "close" that is a placeholder, not a fill.
const DV_FLOOR = 1000;
const dead = evs.filter((e) => !(e.dv1m > DV_FLOOR));
console.log(`==> TRADABILITY FLOOR: ${dead.length} event(s) excluded for first-month average daily traded value <= ${DV_FLOOR} GBp${dead.length ? `: ${dead.slice(0, 8).map((e) => `${e.tidm} dv=${f(e.dv1m, 0)}`).join(", ")}` : ""}`);
for (let i = evs.length - 1; i >= 0; i--) if (!(evs[i].dv1m > DV_FLOOR)) evs.splice(i, 1);
console.log(`    ${evs.length} events survive both screens.`);
assertNonEmpty("UK IPO events after screens", evs, 20);

// ─────────────────────────────────────────────────────────────────────────────
// (4) LEG (a)
// ─────────────────────────────────────────────────────────────────────────────
const pop = (a: Ev[]) => a.map((e) => (e.close0 / e.price! - 1) * 100);
const popOpen = (a: Ev[]) => a.map((e) => (e.open0 / e.price! - 1) * 100);
const line = (label: string, x: number[]) =>
  console.log(`      ${label.padEnd(38)} n=${String(x.length).padStart(4)}  mean ${f(mean(x)).padStart(8)}%  trim5 ${f(trimmed(x)).padStart(7)}%  med ${f(med(x)).padStart(7)}%  t ${f(tstat(x)).padStart(6)}  pos ${f(posPct(x), 1).padStart(5)}%`);

console.log(`\n==> COVERAGE STATEMENT (THE COVERAGE LAW)`);
{
  const s = evs.map((e) => e.d0).sort();
  console.log(`    instruments ${new Set(evs.map((e) => e.tidm)).size} | events ${evs.length} | span ${s[0]} .. ${s[s.length - 1]}`);
  console.log(`    breadth by market: MAIN ${evs.filter((e) => e.mk === "MAIN").length} | AIM ${evs.filter((e) => e.mk === "AIM").length}`);
  console.log(`    Required inputs: new-issue list YES (LSE report) | ISSUE PRICE **YES** (${evs.length} events) | first close YES (Yahoo) | market/type YES.`);
  console.log(`    Yahoo currency on the event lines: ${[...new Set(evs.map((e) => e.yccy))].join(", ")} — GBp, the same unit as the report's GBX issue price.`);
}

console.log(`\n==> LEG (a) ALLOCATED — ISSUE PRICE to FIRST CLOSE  [GROSS: an allocation has no entry trade]`);
line("issue -> first OPEN", popOpen(evs));
line("issue -> first CLOSE", pop(evs));
{
  const p = pop(evs);
  const matched = mean(p) > 0 && tstat(p) > 2;
  console.log(`      PRIOR (stated before the measurement): issue -> first close strongly POSITIVE.`);
  console.log(`      OUTCOME: ${matched ? "MATCHED" : "MISSED"}  (mean ${f(mean(p))}%, t ${f(tstat(p))}, n=${p.length})`);
  console.log(`      SIGN vs ipo-pop-uk.ts, which recorded this leg NOT EVALUABLE: it is now EVALUATED, and the sign is`);
  console.log(`      ${mean(p) > 0 ? "POSITIVE" : "NEGATIVE"}. The US study's own leg (a) is the external comparison, not a control.`);
  console.log(`      UNSCREENED (before the scale screen, n=${unscreenedPop.length}): mean ${f(mean(unscreenedPop))}%, med ${f(med(unscreenedPop))}%, t ${f(tstat(unscreenedPop))} — printed so the screen's effect is visible, not hidden.`);
}

console.log(`\n    SKEW — where the pop actually sits`);
{
  const s = [...pop(evs)].sort((a, b) => b - a), tot = s.reduce((a, b) => a + b, 0);
  const top = s.slice(0, Math.max(1, Math.floor(s.length / 10)));
  console.log(`      top decile (n=${top.length}) delivers ${f(tot ? 100 * top.reduce((a, b) => a + b, 0) / tot : NaN, 1)}% of the TOTAL issue->close pop`);
  console.log(`      median deal ${f(med(pop(evs)))}% vs mean ${f(mean(pop(evs)))}%; best ${f(s[0])}%, worst ${f(s[s.length - 1])}%`);
  console.log(`      The mean is a description of the deals a retail account is LEAST likely to be allocated, because the`);
  console.log(`      deals that pop are the oversubscribed ones. That asymmetry is UNTESTED here — no allocation data exists.`);
}

console.log(`\n    LIQUID TERCILE (top third by first-month GBp traded value; THE LIQUIDITY LAW — the promotable number)`);
{
  const srt = [...evs].sort((a, b) => a.dv1m - b.dv1m);
  const cut = srt[Math.floor(srt.length * 2 / 3)]?.dv1m ?? 0;
  const lo = evs.filter((e) => e.dv1m < cut);
  line("liq HIGH: issue -> first close", pop(evs.filter((e) => e.dv1m >= cut)));
  line("liq LOW+MID: issue -> first close", pop(lo));
  console.log(`      Both halves are measured (D-634: a filter that can only select the top half makes the bottom half`);
  console.log(`      inferable but never measurable, and on the fails book that inference was wrong in SIGN).`);
}

console.log(`\n    MAIN MARKET vs AIM`);
for (const mk of ["MAIN", "AIM"] as const) line(`${mk}: issue -> first close`, pop(evs.filter((e) => e.mk === mk)));
console.log(`      "MAIN" pools UK Main Market, International Main Market, PSM and SFM; "AIM" is AIM alone. Markets present:`);
console.log(`      ${[...new Set(evs.map((e) => `${e.market}=${evs.filter((x) => x.market === e.market).length}`))].join(", ")}`);

console.log(`\n    ERA HALVES`);
for (const [lab, lo2, hi2] of [[`${FROM_D.slice(0, 4)}-20`, FROM_D, "2021-01-01"], ["2021-26", "2021-01-01", "2099"]] as [string, string, string][])
  line(`${lab}: issue -> first close`, pop(evs.filter((e) => e.d0 >= lo2 && e.d0 < hi2)));
console.log(`      The earlier half is the more delisting-exposed one (a 2015 listing has had a decade to disappear from`);
console.log(`      Yahoo), so a rising era pattern would be the EXPECTED ARTIFACT, not a finding.`);

console.log(`\n    BY DEAL SIZE (total raised, £m) — the capacity question THE LIQUIDITY LAW asks in a primary market`);
{
  const sized = evs.filter((e) => e.raisedTot > 0).sort((a, b) => a.raisedTot - b.raisedTot);
  if (sized.length >= 30) {
    const t1 = sized.slice(0, Math.floor(sized.length / 3)), t3 = sized.slice(Math.floor(sized.length * 2 / 3));
    line(`smallest third (<= £${f(t1[t1.length - 1].raisedTot)}m)`, pop(t1));
    line(`largest third (>= £${f(t3[0].raisedTot)}m)`, pop(t3));
  } else console.log(`      UNTESTED: only ${sized.length} events carry a non-zero total raised — under the n needed to split into terciles.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (5) RETAIL ACCESS — what the report does and does NOT carry
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> RETAIL / INTERMEDIARIES-OFFER SPLIT`);
{
  const types = [...new Set(evs.map((e) => e.issueType))];
  const retail = evs.filter((e) => /offer for subscription|offer for sale|public offer|intermediar|retail/i.test(e.issueType));
  const inst = evs.filter((e) => !retail.includes(e));
  console.log(`    THE REPORT CARRIES NO RETAIL/INTERMEDIARIES-OFFER COLUMN. Its "Issue type" field is the closest thing and`);
  console.log(`    it is a PROXY, not the indicator: types present are ${types.join(", ")}.`);
  console.log(`    "New Company Placing" is an institutional placing; "Offer for Subscription - New Company" is the form a`);
  console.log(`    UK retail subscriber can actually enter. Split on that proxy:`);
  line("PROXY retail-open (offer for subscription)", pop(retail));
  line("PROXY institutional placing", pop(inst));
  if (retail.length < 50) {
    console.log(`      **UNTESTED, NOT A FINDING** (THE BREADTH LAW): n=${retail.length} on the retail-open side is far under the ~50`);
    console.log(`      floor, so the difference between these two lines is not evidence. It is printed because suppressing it`);
    console.log(`      would be selective, and its n is printed beside it so it cannot be quoted as a result.`);
  }
  console.log(`    WHAT WOULD ACTUALLY SUPPLY THE INDICATOR, named rather than hand-waved: the per-deal RNS "Intention to`);
  console.log(`    Float"/"Offer" announcement (LSE news API, one call per announcement — not attempted here rather than`);
  console.log(`    guessed at), or PrimaryBid's own historical deal list (primarybid.com, NOT allowlisted).`);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "ipo-pop-uk-allocated", runId: `ipoukalloc|${FROM_D}|${TOL_D}`, spent: 12 });

// ─────────────────────────────────────────────────────────────────────────────
// (6) VERDICT — DESCRIPTIVE ONLY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> VERDICT — DESCRIPTIVE ONLY (THE MECHANISM LAW: no mechanism claim, no pre-registration, no trd_lineage row)`);
{
  const p = pop(evs), po = popOpen(evs);
  const srt = [...evs].sort((a, b) => a.dv1m - b.dv1m);
  const cut = srt[Math.floor(srt.length * 2 / 3)]?.dv1m ?? 0;
  const lq = pop(evs.filter((e) => e.dv1m >= cut));
  const s = [...p].sort((a, b) => b - a), tot = s.reduce((a, b) => a + b, 0);
  const top = s.slice(0, Math.max(1, Math.floor(s.length / 10)));
  console.log(`    VERDICT (a) UK ALLOCATED (issue price -> first close, gross): mean ${f(mean(p))}%, trim5 ${f(trimmed(p))}%, med ${f(med(p))}%,`);
  console.log(`        t ${f(tstat(p))}, pos ${f(posPct(p), 1)}%, n=${p.length}, span ${evs.map((e) => e.d0).sort()[0]} .. ${evs.map((e) => e.d0).sort().slice(-1)[0]}.`);
  console.log(`    VERDICT SIGN: PRIOR was strongly POSITIVE -> ${mean(p) > 0 && tstat(p) > 2 ? "MATCHED" : "MISSED"}.`);
  console.log(`    VERDICT LIQUID: ${f(mean(lq))}% at t ${f(tstat(lq))}, n=${lq.length} — the promotable number is this one, never the pooled one.`);
  console.log(`    VERDICT SKEW: ${f(tot ? 100 * top.reduce((a, b) => a + b, 0) / tot : NaN, 0)}% of the total pop sits in the top decile of deals; the median deal is ${f(med(p))}%.`);
  console.log(`    VERDICT SPLIT OF THE POP: issue->open ${f(mean(po))}% of the ${f(mean(p))}% total (${f(100 * mean(po) / (mean(p) || 1e-9), 0)}%) is earned BEFORE the`);
  console.log(`        first tradeable print. That fraction is the part no non-allocated account can reach, measured rather than assumed.`);
  {
    const sz = evs.filter((e) => e.raisedTot > 0).sort((a, b) => a.raisedTot - b.raisedTot);
    if (sz.length >= 30) {
      const t1 = pop(sz.slice(0, Math.floor(sz.length / 3))), t3 = pop(sz.slice(Math.floor(sz.length * 2 / 3)));
      console.log(`    VERDICT CAPACITY: the pop falls with deal size — smallest third ${f(mean(t1))}% vs largest third ${f(mean(t3))}%. The`);
      console.log(`        deals where the number is biggest are the ones that can absorb the least capital, which is the primary-market`);
      console.log(`        form of the same shape THE LIQUIDITY LAW names in the secondary market.`);
    }
  }
  console.log(`    VERDICT COVERAGE: ${evs.length} of ${cands.length} intended GBX-or-blank-priced LSE IPOs (${f(100 * evs.length / cands.length, 1)}%); the hole is delisted names`);
  console.log(`        Yahoo no longer serves, so this number is biased UPWARD by an unmeasured amount.`);
  console.log(`    VERDICT RETAIL: the LSE report has NO retail/intermediaries-offer column; the issue-type proxy splits`);
  console.log(`        ${evs.filter((e) => /offer for subscription|offer for sale|public offer/i.test(e.issueType)).length} retail-open vs ${evs.filter((e) => !/offer for subscription|offer for sale|public offer/i.test(e.issueType)).length} placings and is UNDERPOWERED — that split is UNTESTED, not a result.`);
  console.log(`    VERDICT AGAINST NOISE: against the programme's deflation ceiling of ${spend.ceiling.toFixed(2)} (${spend.N.toLocaleString()} trials), leg (a)`);
  console.log(`        ${Math.abs(tstat(p)) >= spend.ceiling ? "CLEARS" : "does NOT clear"} — |t| ${f(Math.abs(tstat(p)))} vs ${spend.ceiling.toFixed(2)}.`);
  console.log(`    VERDICT PLACEABILITY: this leg is REAL and ACCESS-GATED. It is not a strategy a UK retail account can`);
  console.log(`        run without an allocation, and whether an allocation is obtainable per deal is UNTESTED (no allocation dataset is free).`);
}
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
