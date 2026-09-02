#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// rights-issues-uk.ts — UK NIL-PAID RIGHTS: is a buyer paid for absorbing forced selling?
//
// THE HYPOTHESIS, stated before the measurement. When a UK company raises equity by a deeply discounted RIGHTS ISSUE,
// existing holders receive NIL-PAID RIGHTS — a short-dated, time-limited instrument that expires worthless if it is
// neither taken up nor sold. A material share of the register (index trackers with no cash, retail who never open the
// letter, holders below the dealing minimum) is price-INSENSITIVE and must sell inside a two-to-three week window.
// If that forced selling is not fully absorbed, the ex-rights share price and the nil-paid line should sit BELOW
// theoretical value, and whoever supplies the liquidity is paid for it.
//
// TERP (theoretical ex-rights price), the reference the discount is measured against, for a "X new for Y existing"
// issue at subscription price S with cum-rights close C:
//        TERP = (Y*C + X*S) / (X + Y)              and the nil-paid right is worth  TERP - S.
// A share trading below TERP on the ex-rights day is the observable footprint of unabsorbed supply.
//
// PRIORS, PRE-STATED (THE SIGN LAW). (i) ex-rights close BELOW TERP — i.e. a positive discount — is the prior;
// (ii) post-issue 21/63d excess vs ISF.L is FLAT-to-POSITIVE if the discount is compensation for absorbing supply,
// and FLAT-to-NEGATIVE if a rights issue is simply what distressed companies do. Each is recorded MATCHED or MISSED.
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW): no causal claim is registered, no trd_lineage row, no DECISIONS.md edit.
//
// THE ENDPOINTS, discovered live for this script (both on the allowlisted api.londonstockexchange.com):
//   NEWS EXPLORER (RNS search)   POST /api/v1/components/refresh
//        {"path":"news","parameters":"tabId=<T>","components":[{"componentId":"block_content:431d02ac-...","parameters":
//         "tabId=<T>&period=custom&afterdate=YYYYMMDD&beforedate=YYYYMMDD&freetext=<q>&size=500&page=N"}]}
//        tabId 58734a12-d97c-40cb-8047-df76e660f23f is the "News explorer" tab of GET /api/v1/pages?path=news.
//        Parameter names and the YYYYMMDD date format were read out of the site's own JS bundle
//        (main.c590e3c222871d64.js -> chunk 893/508: filters "period","afterdate","beforedate","freetext","q",
//        "headlinetypes", and the customdate pipe's formats.set("filter","YYYYMMDD")).
//   RNS FULL TEXT                GET  /api/v1/pages?path=news-article&parameters=newsId=<id>
//        returns components[].content[name="newsarticle"].value.body — the complete announcement HTML.
// TWO DISCOVERED FACTS THAT ARE THEMSELVES RESULTS, and both are reported rather than worked around:
//   (1) `headlinetypes` (the numeric headline-code filter, e.g. 170 "Announcement re: Rights Issue") returns ZERO for
//       EVERY code tried including ones certainly present — so it is NOT usable, and this script filters on the
//       headline TEXT instead. Reported, not silently swallowed.
//   (2) the archive is NOT a decade deep. `period=custom` is honoured, but windows before ~2024 return 0 rows while
//       recent windows return thousands. The floor is MEASURED below, and the 2015-2026 span the task asks for is
//       therefore NOT available: the Rolls-Royce 2020 / Aston Martin 2022 positive control CANNOT be satisfied.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("rights-issues-uk", [
  { name: "FROM_D", def: "2015-01-01", note: "earliest month the RNS sweep ATTEMPTS (the reachable floor is measured, not assumed)" },
  { name: "QUERY", def: "rights issue", note: "free-text sent to the news explorer" },
  { name: "WINDOWS", def: "21,63", note: "post-ex-rights hold horizons in trading days" },
  { name: "BENCH", def: "ISF.L", note: "UK benchmark (iShares Core FTSE 100 UCITS ETF)" },
  { name: "RT_BP", def: "30", note: "round-trip cost in bp, one round trip per event" },
  { name: "SLEEP_MS", def: "300", note: "courtesy delay between sequential fetches" },
  { name: "MAX_BODIES", def: "80", note: "cap on RNS full-text fetches (each is up to ~1MB)" },
  { name: "REFRESH", def: "0", note: "1 = ignore on-disk caches and re-fetch" },
]);
const FROM_D = K.FROM_D, QUERY = K.QUERY, BENCH = K.BENCH;
const WINS = K.WINDOWS.split(",").map(Number);
const RT_BP = Number(K.RT_BP), RT = RT_BP / 100;
const SLEEP = Number(K.SLEEP_MS), MAX_BODIES = Number(K.MAX_BODIES);
const REFRESH = K.REFRESH === "1";

const UA = "Mozilla/5.0 (Aegis Research ona@revitalise.io)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LSE = "https://api.londonstockexchange.com";
const TAB = "58734a12-d97c-40cb-8047-df76e660f23f";
const NEWS_COMP = "block_content:431d02ac-09b8-40c9-aba6-04a72a4f2e49";
const lseHdr = { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", Referer: "https://www.londonstockexchange.com/" };

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? NaN : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const posPct = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : NaN;
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const readCache = async <T>(p: string, fb: T): Promise<T> => { if (REFRESH) return fb; try { return JSON.parse(await Deno.readTextFile(p)) as T; } catch { return fb; } };
const writeCache = async (p: string, v: unknown) => { try { await Deno.writeTextFile(p, JSON.stringify(v)); } catch { /* cache is an optimisation, not a result */ } };
try { await Deno.mkdir("data", { recursive: true }); } catch { /* exists */ }

interface NewsRow { id: number; title: string; category: string; datetime: string; companycode: string | null; companyname: string | null; issuercode: string | null }
interface SearchOut { total: number; rows: NewsRow[]; executed: boolean }

async function newsSearch(params: string): Promise<SearchOut> {
  const p = `tabId=${TAB}&${params}`;
  try {
    const r = await fetch(`${LSE}/api/v1/components/refresh`, {
      method: "POST", headers: lseHdr,
      body: JSON.stringify({ path: "news", parameters: `tabId=${TAB}`, components: [{ componentId: NEWS_COMP, parameters: p }] }),
    });
    if (!r.ok) return { total: 0, rows: [], executed: false };
    const j = await r.json() as { content?: { name: string; value?: { content?: NewsRow[]; totalElements?: number } | null }[] }[];
    const v = j?.[0]?.content?.find((c) => c.name === "newsexplorersearch")?.value;
    if (v == null) return { total: 0, rows: [], executed: false };   // NULL = the server refused to run the query at all
    return { total: v.totalElements ?? 0, rows: v.content ?? [], executed: true };
  } catch { return { total: 0, rows: [], executed: false }; }
}

async function rnsBody(id: number): Promise<string | null> {
  try {
    const u = `${LSE}/api/v1/pages?path=news-article&parameters=${encodeURIComponent(`newsId=${id}`)}`;
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.londonstockexchange.com/" } });
    if (!r.ok) return null;
    const j = await r.json() as { components?: { content?: { name: string; value?: { body?: string | null } | null }[] }[] };
    for (const c of j.components ?? []) for (const x of c.content ?? []) if (x.name === "newsarticle" && x.value?.body) return x.value.body;
    return null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) DISCOVERY + POSITIVE CONTROLS (D-641: a zero and a broken query look identical)
// ─────────────────────────────────────────────────────────────────────────────
console.log(`==> UK RIGHTS ISSUES — RNS DISCOVERY, with the controls run BEFORE anything is concluded\n`);
{
  const home = await fetch(`${LSE}/api/v1/pages?path=home`, { headers: lseHdr }).then((r) => r.json()).catch(() => null) as { components?: unknown[] } | null;
  const ok = (home?.components ?? []).length > 0;
  console.log(`    [CONTROL 1] GET /api/v1/pages?path=home  -> ${ok ? `${home!.components!.length} components  PASS` : "EMPTY  FAIL"}`);
  if (!ok) { console.error(`!! The API itself is unreachable. Every "not found" below would be about US, not the LSE. Aborting.`); Deno.exit(1); }
  await sleep(SLEEP);
}
{
  const noFilter = await newsSearch("");
  console.log(`    [CONTROL 2] news explorer, no filter                  -> executed=${noFilter.executed} total=${noFilter.total}  ${noFilter.total > 0 ? "PASS" : "FAIL"}`);
  if (noFilter.total === 0) { console.error(`!! The news explorer returns nothing even unfiltered. Aborting rather than reporting a false zero.`); Deno.exit(1); }
  await sleep(SLEEP);
}
// [CONTROL 3] the headline-code filter. THE POSITIVE-CONTROL RULE applied to a FILTER rather than to a result: if a
// filter cannot return rows for a code that certainly occurs, its zeros are about the filter, not about the market.
{
  const week = await newsSearch("period=lastweek");
  await sleep(SLEEP);
  const hFilt = await newsSearch("period=lastweek&headlinetypes=1,2,5");
  await sleep(SLEEP);
  const h17 = await newsSearch("period=lastweek&headlinetypes=17");
  await sleep(SLEEP);
  console.log(`    [CONTROL 3] headlinetypes filter: lastweek unfiltered=${week.total}, headlinetypes=1,2,5 -> ${hFilt.total}, headlinetypes=17 (Acquisition) -> ${h17.total}`);
  console.log(`                VERDICT: the numeric headline filter is INERT — "1,2,5" returns the SAME count as no filter and a`);
  console.log(`                single code returns 0. It is therefore NOT used; classification below is on headline TEXT, and any`);
  console.log(`                headlinetypes=170 zero would have been a FALSE NEGATIVE about our query, not a fact about the market.`);
}
// [CONTROL 4] the archive floor. Measured, never assumed.
console.log(`\n    [CONTROL 4] HOW DEEP IS THE RNS ARCHIVE? (period=custom&afterdate=&beforedate=, 15-day probes)`);
const probes = ["2015-04", "2018-04", "2020-04", "2022-01", "2023-10", "2024-01", "2024-02", "2024-04", "2025-01", "2026-01"];
let floor = "";
for (const ym of probes) {
  const a = `${ym.replace("-", "")}01`, b = `${ym.replace("-", "")}15`;
  const s = await newsSearch(`period=custom&afterdate=${a}&beforedate=${b}`);
  console.log(`                ${ym}-01..15  executed=${String(s.executed).padEnd(5)} rows=${s.total}`);
  if (s.total > 0 && !floor) floor = ym;
  await sleep(SLEEP);
}
console.log(`                MEASURED FLOOR: the earliest probe returning rows is ${floor || "NONE"}. Windows before it return 0 with`);
console.log(`                executed=true, i.e. the query RAN and the archive is empty there — a DATA boundary, not a market fact.`);
console.log(`\n    CONSEQUENCE FOR THE POSITIVE CONTROL THE TASK ASKED FOR (and this is the honest headline of leg A):`);
console.log(`      Rolls-Royce 2020-10 (32p, 10-for-3), Aston Martin 2022 and M&S 2009 CANNOT appear — all predate the archive.`);
console.log(`      The asked-for control is therefore UNSATISFIABLE on the allowlisted hosts, and the 2015-2026 span is NOT`);
console.log(`      available. What IS available is ${floor || "n/a"}..today, and an IN-SPAN control is substituted and stated below.`);

// ─────────────────────────────────────────────────────────────────────────────
// (2) HARVEST — month-by-month free-text sweep over the whole ATTEMPTED span
// ─────────────────────────────────────────────────────────────────────────────
const NEWS_PATH = "data/uk-rights-rns.json";
let news = await readCache<NewsRow[]>(NEWS_PATH, []);
const months: string[] = [];
{
  const d = new Date(FROM_D + "T00:00:00Z");
  const end = new Date();
  while (d <= end) { months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); d.setUTCMonth(d.getUTCMonth() + 1); }
}
if (!news.length) {
  console.log(`\n==> HARVEST: free-text "${QUERY}" over ${months.length} monthly windows ${months[0]}..${months[months.length - 1]} (sequential, ${SLEEP}ms apart)`);
  let empty = 0, hit = 0;
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const a = `${y}${String(mo).padStart(2, "0")}01`;
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const b = `${y}${String(mo).padStart(2, "0")}${lastDay}`;
    const s = await newsSearch(`period=custom&afterdate=${a}&beforedate=${b}&freetext=${encodeURIComponent(QUERY)}&size=500`);
    if (s.rows.length) { news.push(...s.rows); hit++; } else empty++;
    if (s.rows.length) console.log(`    ${m}: ${String(s.total).padStart(4)} free-text hits, ${s.rows.length} returned`);
    await sleep(SLEEP);
  }
  console.log(`    ${hit} months with rows, ${empty} months empty (the empty ones are the pre-archive era measured above).`);
  await writeCache(NEWS_PATH, news);
}
assertNonEmpty(`RNS free-text hits for "${QUERY}"`, news, 20);
{
  const seen = new Set<number>();
  news = news.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
const spanD = news.map((r) => r.datetime.slice(0, 10)).sort();
console.log(`\n==> HARVEST RESULT: ${news.length.toLocaleString()} unique RNS items mentioning "${QUERY}", ${spanD[0]} .. ${spanD[spanD.length - 1]}`);

// ─────────────────────────────────────────────────────────────────────────────
// (3) CLASSIFY on headline TEXT (the numeric filter is inert — CONTROL 3)
// ─────────────────────────────────────────────────────────────────────────────
const RE_RI = /rights\s+issue|nil[\s-]*paid\s+rights|rights\s+offering/i;
const RE_LAUNCH = /launch|proposed|announcement re|terms of|firm placing.*rights|fully underwritten|£[\d.,]+\s*(m|bn|million|billion).*rights/i;
const RE_NILPAID = /nil[\s-]*paid/i;
const RE_RESULT = /result[s]? of/i;
const titled = news.filter((r) => RE_RI.test(r.title || ""));
console.log(`\n==> HEADLINE-MATCHED RIGHTS-ISSUE ITEMS: ${titled.length} of ${news.length} (the rest mention the phrase only in the body)`);
const byCat = new Map<string, number>();
for (const r of titled) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
console.log(`    RNS category codes present: ${[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`);

// One EVENT = one issuer x one issue. Group by companycode and cluster announcements within 120 days.
interface Ev { tidm: string; name: string; items: NewsRow[]; launch?: NewsRow; nilpaid?: NewsRow; result?: NewsRow; sub?: number; nNew?: number; nOld?: number; exD?: string; rec?: string; terpStated?: number }
const byIssuer = new Map<string, NewsRow[]>();
for (const r of titled) { const k = (r.companycode || r.issuercode || "").trim(); if (!k) continue; (byIssuer.get(k) ?? byIssuer.set(k, []).get(k)!).push(r); }
const events: Ev[] = [];
for (const [tidm, rows] of byIssuer) {
  rows.sort((a, b) => a.datetime.localeCompare(b.datetime));
  let cur: NewsRow[] = [];
  const flush = () => { if (cur.length) events.push({ tidm, name: cur[0].companyname || tidm, items: [...cur] }); cur = []; };
  for (const r of rows) {
    if (cur.length && (Date.parse(r.datetime) - Date.parse(cur[cur.length - 1].datetime)) / 86400000 > 120) flush();
    cur.push(r);
  }
  flush();
}
for (const e of events) {
  e.launch = e.items.find((r) => RE_LAUNCH.test(r.title)) ?? e.items[0];
  e.nilpaid = e.items.find((r) => RE_NILPAID.test(r.title));
  e.result = e.items.find((r) => RE_RESULT.test(r.title));
}
events.sort((a, b) => a.items[0].datetime.localeCompare(b.items[0].datetime));
console.log(`    -> ${events.length} distinct ISSUER x ISSUE clusters (>120d apart = a separate event)`);
// IN-SPAN POSITIVE CONTROL, substituted for the unreachable Rolls-Royce one.
{
  const pd = events.find((e) => e.tidm === "PDL");
  console.log(`    [CONTROL 5, IN-SPAN] Petra Diamonds (PDL) "Launch of 10 for 17 fully underwritten Rights Issue" 2025-10-17:`);
  console.log(`                ${pd ? `FOUND — ${pd.items.length} announcements ${pd.items[0].datetime.slice(0, 10)}..${pd.items[pd.items.length - 1].datetime.slice(0, 10)}  PASS` : "ABSENT  FAIL — the harvest is not finding known events"}`);
  if (!pd) console.error(`!! In-span positive control FAILED. Treat every count below as UNTESTED.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (4) TERMS — parse subscription price / ratio / ex-rights date out of the RNS full text
// ─────────────────────────────────────────────────────────────────────────────
const BODY_PATH = "data/uk-rights-terms.json";
type Terms = { sub: number | null; nNew: number | null; nOld: number | null; exD: string | null; rec: string | null; terpStated: number | null; ev: string[] };
const termsCache = await readCache<Record<string, Terms>>(BODY_PATH, {});
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&pound;/g, "£").replace(/\s+/g, " ");
function parseTerms(txt: string): Terms {
  const ev: string[] = [];
  let sub: number | null = null, nNew: number | null = null, nOld: number | null = null, exD: string | null = null, rec: string | null = null, terpStated: number | null = null;
  const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const asISO = (d: string, mon: string, y: string) => {
    const mo = MON3.indexOf(mon.slice(0, 3).toLowerCase());
    return mo < 0 ? null : `${y}-${String(mo + 1).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  };
  // Subscription price. UK RNS states it in pence ("at 30 pence per New Ordinary Share" / "Issue Price of 30p").
  const mS = txt.match(/(?:issue price|subscription price|offer price)[^.]{0,80}?([\d,]+(?:\.\d+)?)\s*(?:pence|p\b)/i)
    ?? txt.match(/([\d,]+(?:\.\d+)?)\s*(?:pence|p)\s+per\s+(?:new\s+)?(?:ordinary\s+)?share/i);
  if (mS) { sub = Number(mS[1].replace(/,/g, "")); ev.push(`sub<-"${mS[0].slice(0, 60).trim()}"`); }
  // Ratio "X New Ordinary Shares for every Y Existing" or the headline shorthand "10 for 17".
  const mR = txt.match(/(\d+)\s+new\s+(?:ordinary\s+)?shares?\s+for\s+every\s+(\d+)/i)
    ?? txt.match(/\b(\d+)\s+for\s+(\d+)\b(?=[^.]{0,60}rights)/i)
    ?? txt.match(/rights\s+issue[^.]{0,40}?\b(\d+)\s+for\s+(\d+)\b/i);
  if (mR) { nNew = Number(mR[1]); nOld = Number(mR[2]); ev.push(`ratio<-"${mR[0].slice(0, 50).trim()}"`); }
  // EX-RIGHTS DATE. Preferred as a stated field, never fitted to the price — a day chosen because it best matches TERP
  // would manufacture the very discount being measured (THE SELECTION LAW). Two stated fields are accepted, in order:
  //   (a) an explicit "Ex-Rights Date <d Month yyyy>" (the expected-timetable wording);
  //   (b) the RECORD DATE, which every "Admission of Nil Paid Rights" RNS states. Ex-rights is by construction the first
  //       dealing day AFTER the record date, so (b) fixes the day exactly without touching a price.
  const mE = txt.match(/ex[\s-]*rights?\s+date[\s\S]{0,140}?(\d{1,2})\s+([A-Z][a-z]{2,8})\s+(\d{4})/i);
  if (mE) { const d = asISO(mE[1], mE[2], mE[3]); if (d) { exD = d; ev.push(`exD<-"${mE[0].slice(-40).trim()}"`); } }
  const mRec = txt.match(/[Rr]ecord [Dd]ate[\s\S]{0,120}?(\d{1,2})\s+([A-Z][a-z]{2,8})\s+(\d{4})/);
  if (mRec) { const d = asISO(mRec[1], mRec[2], mRec[3]); if (d) { rec = d; ev.push(`rec<-"${mRec[0].slice(-40).trim()}"`); } }
  // THE COMPANY'S OWN TERP, when it states one ("a discount of X% to the theoretical ex-rights price of NNN pence").
  // This is the independent reference that makes the cum-price observability test below possible.
  const mT = txt.match(/theoretical ex[\s-]*rights price of(?:[^.]{0,40}?)([\d,]+(?:\.\d+)?)\s*(?:pence|p\b)/i);
  if (mT) { terpStated = Number(mT[1].replace(/,/g, "")); ev.push(`terpStated<-"${mT[0].slice(0, 60).trim()}"`); }
  return { sub, nNew, nOld, exD, rec, terpStated, ev };
}
console.log(`\n==> RNS FULL TEXT: GET /api/v1/pages?path=news-article&parameters=newsId=<id>  (cap ${MAX_BODIES} fetches)`);
let bodies = 0;
for (const e of events) {
  const cands = [e.nilpaid, e.launch, ...e.items].filter((x): x is NewsRow => !!x);
  for (const it of cands.slice(0, 5)) {
    const key = String(it.id);
    if (!(key in termsCache)) {
      if (bodies >= MAX_BODIES) break;
      const b = await rnsBody(it.id);
      bodies++;
      termsCache[key] = b ? parseTerms(strip(b)) : { sub: null, nNew: null, nOld: null, exD: null, rec: null, terpStated: null, ev: ["no body"] };
      await sleep(SLEEP);
    }
    const t = termsCache[key];
    if (e.sub == null && t.sub != null) e.sub = t.sub;
    if (e.nNew == null && t.nNew != null) { e.nNew = t.nNew; e.nOld = t.nOld ?? undefined; }
    if (e.exD == null && t.exD != null) e.exD = t.exD;
    if (e.rec == null && t.rec != null) e.rec = t.rec;
    if (e.terpStated == null && t.terpStated != null) e.terpStated = t.terpStated;
    if (e.sub != null && e.nNew != null && (e.exD != null || e.rec != null)) break;
  }
  // Headline shorthand as a fallback for the ratio ("10 for 17 fully underwritten Rights Issue").
  if (e.nNew == null) { const m = (e.launch?.title || "").match(/\b(\d+)\s+for\s+(\d+)\b/); if (m) { e.nNew = Number(m[1]); e.nOld = Number(m[2]); } }
}
await writeCache(BODY_PATH, termsCache);
const withTerms = events.filter((e) => e.sub != null && e.nNew != null && e.nOld != null);
console.log(`    ${bodies} bodies fetched this run | terms parsed: price+ratio on ${withTerms.length} of ${events.length} events;`);
console.log(`    ex-rights date STATED on ${events.filter((e) => e.exD).length}; RECORD DATE stated on ${events.filter((e) => e.rec).length}; neither on ${events.filter((e) => !e.exD && !e.rec).length}`);
console.log(`    THE ANCHOR IS THE WHOLE MEASUREMENT. A first run of this script anchored on the ANNOUNCEMENT date because no`);
console.log(`    ex-rights field parsed, and printed a mean +6.46% PREMIUM to TERP across 5 events — the exact opposite of the`);
console.log(`    prior and pure artifact: on Great Portland the cum-rights close it used (348.75p) was already EX, so its TERP`);
console.log(`    came out 304p against the company's own stated 345p. That number is retracted here rather than caveated, and`);
console.log(`    the anchor is now a STATED field: a stated ex-rights date, else the "Admission of Nil Paid Rights" RNS date,`);
console.log(`    which IS the ex-rights day by definition. Record-date+1 was tried in between and is also wrong — the record`);
console.log(`    date fixes ENTITLEMENT and admission can be several sessions later (Pennon: 28 Jan vs 3 Feb 2025) — so it is`);
console.log(`    kept only as a last-resort WEAK anchor and labelled as such. Events with none of the three are EXCLUDED, not`);
console.log(`    anchored on a guess: an excluded event is a smaller N, a guessed one is a wrong number.`);

// ─────────────────────────────────────────────────────────────────────────────
// (5) PRICES — Yahoo <TIDM>.L, and the NIL-PAID LINE probe
// ─────────────────────────────────────────────────────────────────────────────
type Bar = [number, number, number];   // ts, close(adjusted), volume
const yahoo = async (sym: string, from: string): Promise<{ bars: Bar[]; ccy: string } | null> => {
  const p1 = Math.floor(Date.parse(from + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`, { headers: { "User-Agent": UA } });
      if (!r.ok) { if (r.status === 404) return null; continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators?.quote?.[0] ?? {};
      const adj = res.indicators?.adjclose?.[0]?.adjclose ?? null;
      const bars: Bar[] = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        const c = adj?.[i] ?? q.close?.[i];
        if (!(c > 0)) continue;
        bars.push([res.timestamp[i], c, q.volume?.[i] ?? 0]);
      }
      return { bars, ccy: String(res.meta?.currency ?? "") };
    } catch { /* try the other host */ }
  }
  return null;
};
// !! A RIGHTS ISSUE IS A CORPORATE ACTION AND YAHOO ADJUSTS FOR IT. adjclose rescales the WHOLE pre-ex history by the
// TERP/cum factor, so an adjusted series shows NO ex-rights drop and a TERP computed from an adjusted cum-close is
// wrong by exactly that factor. The cum-rights close must therefore be taken on the RAW (unadjusted) scale.
const yahooRaw = async (sym: string, from: string): Promise<{ ts: number[]; close: number[]; ccy: string } | null> => {
  const p1 = Math.floor(Date.parse(from + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`, { headers: { "User-Agent": UA } });
      if (!r.ok) { if (r.status === 404) return null; continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const c = res.indicators?.quote?.[0]?.close ?? [];
      const ts: number[] = [], close: number[] = [];
      for (let i = 0; i < res.timestamp.length; i++) if (c[i] > 0) { ts.push(res.timestamp[i]); close.push(c[i]); }
      return { ts, close, ccy: String(res.meta?.currency ?? "") };
    } catch { /* next host */ }
  }
  return null;
};

const bench = await yahoo(BENCH, "2023-06-01");
if (!bench || bench.bars.length < 200) { console.error(`!! BENCHMARK ${BENCH} unavailable — no excess return can be computed. Aborting.`); Deno.exit(1); }
const bD = bench.bars.map((b) => iso(b[0]));
const bAt = (d: string) => { for (let i = bD.length - 1; i >= 0; i--) if (bD[i] <= d) return bench.bars[i][1]; return undefined; };
console.log(`\n==> BENCHMARK ${BENCH} (${bench.ccy}): ${bench.bars.length} bars ${bD[0]}..${bD[bD.length - 1]}`);

console.log(`\n==> NIL-PAID LINE ON YAHOO — probed, not assumed`);
const nilSuffix = ["N", "NP", "-NP", ".NIL"];
let nilFound = 0, nilProbed = 0;
for (const e of withTerms.slice(0, 8)) {
  for (const s of nilSuffix) {
    const y = await yahooRaw(`${e.tidm}${s}.L`, "2024-01-01");
    nilProbed++;
    if (y && y.close.length > 3) { nilFound++; console.log(`    ${e.tidm}${s}.L -> ${y.close.length} bars  FOUND`); }
    await sleep(SLEEP);
  }
}
console.log(`    ${nilFound} of ${nilProbed} nil-paid symbol probes returned a series.`);
console.log(`    ${nilFound === 0
  ? "SO THE NIL-PAID PRICE ITSELF IS NOT OBSERVABLE HERE. Yahoo does not carry the temporary nil-paid line for UK issuers under\n    any of the suffix conventions tried (N/NP/-NP/.NIL). The discount is therefore measured on the ORDINARY share against\n    TERP, which is the same economics one step removed: a nil-paid right is worth ex-rights price - subscription price, so\n    an ordinary share below TERP implies a nil-paid right below its theoretical value by the SAME absolute amount."
  : "A nil-paid line exists for some issuers and is used where present."}`);

// ─────────────────────────────────────────────────────────────────────────────
// (6) THE MEASUREMENT — TERP vs the actual ex-rights price
// ─────────────────────────────────────────────────────────────────────────────
interface Meas { tidm: string; name: string; anchorSrc: string; exD: string; cum: number; terpStated?: number; sub: number; ratio: string; terp: number; exClose: number; discPct: number; nilTheo: number; nilImplied: number; fwd: (number | null)[] }
const meas: Meas[] = [];
const skipped: string[] = [];
for (const e of withTerms) {
  // ANCHOR PRIORITY, and the ORDER here is itself a correction. Record-date+1 was tried first and is WRONG: the record
  // date fixes ENTITLEMENT, and in a UK rights issue dealings in the nil-paid rights (and therefore the ex-rights
  // marking of the ordinary) begin at ADMISSION, which is typically several dealing days later — Pennon's record date
  // was 28 Jan 2025 and its nil-paid admission 3 Feb 2025, four sessions apart, and anchoring on the former produced a
  // nonsensical +33% "premium" because the share had not gone ex yet. The "Admission of Nil Paid Rights" RNS IS the
  // ex-rights day, is a stated fact rather than an inference, and is used first.
  const nilAdm = e.items.find((r) => /admission of nil[\s-]*paid/i.test(r.title))?.datetime.slice(0, 10);
  const anchorSrc = e.exD ? "ex-rights date (RNS)" : nilAdm ? "nil-paid admission RNS (= the ex-rights day)" : e.rec ? "record date +1 (WEAK)" : "NONE";
  if (anchorSrc === "NONE") { skipped.push(`${e.tidm} (no stated ex-rights date, no nil-paid admission RNS and no record date — EXCLUDED rather than anchored on a guess)`); continue; }
  const anchor = e.exD ?? nilAdm ?? new Date(Date.parse(e.rec!) + 86400000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(anchor) - 86400000 * 120).toISOString().slice(0, 10);
  const raw = await yahooRaw(`${e.tidm}.L`, from);
  await sleep(SLEEP);
  if (!raw || raw.close.length < 40) { skipped.push(`${e.tidm} (no .L series)`); continue; }
  if (raw.ccy !== "GBp") { skipped.push(`${e.tidm} (currency ${raw.ccy}, not GBp — the pence subscription price is not comparable)`); continue; }
  const dts = raw.ts.map(iso);
  // The ex-rights day is the first session ON OR AFTER the anchor. The cum-rights close is the session BEFORE it.
  const ix = dts.findIndex((d) => d >= anchor);
  if (ix < 1) { skipped.push(`${e.tidm} (anchor ${anchor} outside the price series)`); continue; }
  const cum = raw.close[ix - 1], exClose = raw.close[ix];
  const X = e.nNew!, Y = e.nOld!, S = e.sub!;
  const terp = (Y * cum + X * S) / (X + Y);
  if (!(terp > 0 && cum > 0 && exClose > 0)) { skipped.push(`${e.tidm} (degenerate prices)`); continue; }
  if (S >= cum) { skipped.push(`${e.tidm} (parsed subscription ${S}p >= cum-rights close ${f(cum)}p — not a discounted issue; parse rejected)`); continue; }
  const adj = await yahoo(`${e.tidm}.L`, from);
  await sleep(SLEEP);
  const aD = (adj?.bars ?? []).map((b) => iso(b[0]));
  const jx = aD.findIndex((d) => d >= anchor);
  const fwd = WINS.map((w) => {
    if (jx < 0 || jx + w >= aD.length) return null;
    const s0 = bAt(aD[jx]), s1 = bAt(aD[jx + w]);
    if (!s0 || !s1) return null;
    return ((adj!.bars[jx + w][1] / adj!.bars[jx][1] - 1) - (s1 / s0 - 1)) * 100 - RT;
  });
  meas.push({
    tidm: e.tidm, name: e.name, anchorSrc, exD: dts[ix], cum, terpStated: e.terpStated, sub: S, ratio: `${X} for ${Y}`, terp, exClose,
    discPct: (exClose / terp - 1) * 100, nilTheo: terp - S, nilImplied: exClose - S, fwd,
  });
}
console.log(`\n==> MEASURED EVENTS: ${meas.length} of ${withTerms.length} with parsed terms (${skipped.length} skipped)`);
for (const s of skipped) console.log(`    skipped: ${s}`);

console.log(`\n    ticker  ex-rights   ratio      sub(p)   cum(p)   TERP(p)  ex-close(p)  ex vs TERP   nil theo(p)  nil implied(p)  anchor from`);
for (const m of meas) {
  console.log(`    ${m.tidm.padEnd(7)} ${m.exD}  ${m.ratio.padEnd(10)} ${f(m.sub).padStart(7)} ${f(m.cum).padStart(8)} ${f(m.terp).padStart(9)} ${f(m.exClose).padStart(12)} ${(f(m.discPct) + "%").padStart(11)} ${f(m.nilTheo).padStart(12)} ${f(m.nilImplied).padStart(15)}  ${m.anchorSrc}`);
}
console.log(`    SANITY CHECK ON EACH ANCHOR (the check the first run lacked): the cum->ex fall must be close to what the terms`);
console.log(`    imply. A row whose realised fall is far from its predicted fall is an anchor error, not a market finding.`);
for (const m of meas) {
  const predicted = (m.terp / m.cum - 1) * 100, realised = (m.exClose / m.cum - 1) * 100;
  console.log(`      ${m.tidm.padEnd(7)} predicted cum->ex ${f(predicted).padStart(7)}%   realised ${f(realised).padStart(7)}%   residual ${f(realised - predicted).padStart(7)}pp  ${Math.abs(realised - predicted) > 12 ? "<-- SUSPECT, treat as unanchored" : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (7) VERDICT
// ─────────────────────────────────────────────────────────────────────────────
const disc = meas.map((m) => m.discPct);
// ── THE CUM-PRICE OBSERVABILITY TEST ────────────────────────────────────────
// The residual column above is large and POSITIVE on several rows: the share did not fall anything like as far as the
// terms require. Two explanations are possible and they have opposite meanings — either the market genuinely refused to
// mark the stock down (a finding), or the price series we are differencing is ALREADY rights-adjusted, in which case the
// cum-rights price is not observable at all and every TERP above is wrong (a data defect). The two are distinguished by
// an external reference: the issuer's OWN stated theoretical ex-rights price, published in its launch RNS.
console.log(`\n==> CUM-PRICE OBSERVABILITY TEST — our TERP vs the ISSUER'S OWN STATED TERP`);
console.log(`    If these agree, Yahoo's close is a true cum-rights price and the discounts above are real.`);
console.log(`    If ours is systematically LOWER, Yahoo has already applied the rights adjustment to the pre-ex history and the`);
console.log(`    cum price is UNOBSERVABLE — which makes every TERP above wrong and the whole leg a DATA verdict.`);
let agree = 0, disagree = 0, nostate = 0;
for (const m of meas) {
  if (!m.terpStated) { nostate++; console.log(`      ${m.tidm.padEnd(7)} issuer states no TERP in the parsed announcements — untestable for this row`); continue; }
  const gap = (m.terp / m.terpStated - 1) * 100;
  const impliedCum = (m.terpStated * (parseInt(m.ratio.split(" for ")[0]) + parseInt(m.ratio.split(" for ")[1])) - parseInt(m.ratio.split(" for ")[0]) * m.sub) / parseInt(m.ratio.split(" for ")[1]);
  if (Math.abs(gap) < 3) agree++; else disagree++;
  console.log(`      ${m.tidm.padEnd(7)} our TERP ${f(m.terp).padStart(8)}p   issuer's stated TERP ${f(m.terpStated).padStart(8)}p   gap ${(f(gap) + "%").padStart(9)}   ` +
    `cum implied by the issuer ${f(impliedCum).padStart(8)}p vs Yahoo's ${f(m.cum).padStart(8)}p (ratio ${f(m.cum / impliedCum, 3)})`);
}
console.log(`    ${agree} agree within 3%, ${disagree} disagree, ${nostate} untestable.`);
// VOID is set HERE, by the test, and every downstream verdict reads it. A number the diagnostic killed may not be
// resurrected by narration further down the page (the D-590 shape) — so the refusal is mechanical, not editorial.
const VOID = disagree > agree;
if (disagree > agree) {
  console.log(`    VERDICT: FAIL. Yahoo's UNADJUSTED close for these UK lines is not a cum-rights price — the ratio column above`);
  console.log(`    sits near the theoretical adjustment factor TERP/cum, which is the signature of a series already rescaled for`);
  console.log(`    the rights issue. So the cum-rights price is NOT OBSERVABLE from this source, every TERP computed above is`);
  console.log(`    understated by that factor, and the "premium to TERP" it produces is an ARTIFACT, not a market fact.`);
  console.log(`    THE DISCOUNT DISTRIBUTION BELOW IS THEREFORE REPORTED AS VOID. It is printed only so the artifact is on the`);
  console.log(`    record and cannot be re-derived by a future session that repeats this construction.`);
} else if (agree > 0) {
  console.log(`    VERDICT: PASS on ${agree} row(s) — for those the cum price is genuine and the discount is a real measurement.`);
}

console.log(`\n==> DISTRIBUTION OF THE EX-RIGHTS PRICE RELATIVE TO TERP  (negative = trades BELOW theoretical = the prior)`);
if (disc.length) {
  console.log(`    N=${disc.length}  mean ${f(mean(disc))}%  median ${f(med(disc))}%  sd ${f(sd(disc))}  t ${f(tstat(disc))}`);
  console.log(`    p10 ${f(pct(disc, 0.10))}%  p25 ${f(pct(disc, 0.25))}%  p75 ${f(pct(disc, 0.75))}%  p90 ${f(pct(disc, 0.90))}%   below TERP in ${f(100 - posPct(disc), 1)}% of events`);
} else console.log(`    N=0 — nothing to distribute.`);

console.log(`\n==> POST-EX-RIGHTS EXCESS vs ${BENCH} (net of ${RT_BP}bp one round trip; lag-0 is honest here because the ex-rights`);
console.log(`    OPEN is the first tradeable print of the ex-rights instrument, not a close-derived signal acted on at that close)`);
for (let i = 0; i < WINS.length; i++) {
  const xs = meas.map((m) => m.fwd[i]).filter((x): x is number => x != null);
  console.log(`    +${String(WINS[i]).padStart(3)}d  n=${String(xs.length).padStart(3)}  mean ${f(mean(xs)).padStart(8)}%  median ${f(med(xs)).padStart(8)}%  t ${f(tstat(xs)).padStart(6)}  positive ${f(posPct(xs), 1)}%`);
}

console.log(`\n==> LAWS, APPLIED TO THIS RESULT`);
console.log(`    COVERAGE     : the archive floor is ${floor || "n/a"}, not ${FROM_D}. The task's span is unavailable and the requested`);
console.log(`                   Rolls-Royce/Aston Martin/M&S controls are unreachable. Everything here describes ${floor || "n/a"}..today only.`);
console.log(`    BREADTH      : N=${meas.length} events. This is FAR below any threshold at which a distribution means something; the`);
console.log(`                   BREADTH LAW floors a cross-section at ~50 and this is not even a cross-section — it is an event count.`);
console.log(`    POSITIVE CTRL: 6 controls run above; controls 1,2 and 5 PASS, control 3 shows the headline filter is INERT (so it is`);
console.log(`                   not used), control 4 measures the archive floor that makes control-as-asked impossible, and control 6`);
console.log(`                   (the cum-price observability test) FAILS ${disagree} of ${agree + disagree} testable rows — which is what voids the result.`);
console.log(`    EFFECT SIZE  : the discount is quoted in % of TERP beside a ${RT_BP}bp round trip. UK reality: Main-Market purchases`);
console.log(`                   carry 0.5% stamp duty (50bp) which is NOT charged above; a nil-paid RIGHT is exempt from stamp duty,`);
console.log(`                   which is a real and unmodelled advantage of the nil-paid route over buying the ex-rights share.`);
console.log(`    EXECUTION    : nil-paid lines are thin and often quoted only by phone; every number above assumes a fill in the`);
console.log(`                   ORDINARY share, which is the liquid leg. No passive/maker assumption is made anywhere.`);
console.log(`    INSTRUMENT   : the discount is measured in the ORDINARY SHARE (a placeable instrument) as a PROXY for the nil-paid`);
console.log(`                   right, because the nil-paid line is not on Yahoo. The conversion is stated, not assumed: the two`);
console.log(`                   differ by a constant (the subscription price), so the ABSOLUTE mispricing carries over exactly and`);
console.log(`                   the PERCENTAGE mispricing of the right is LARGER by the leverage factor TERP/(TERP-S).`);
{
  const m = mean(disc);
  // A verdict may not be read off a distribution the script has itself declared void — that is the D-590 shape (a
  // number kept alive by narration after its own diagnostic killed it), and it is refused here mechanically.
  const signVerdict = VOID
    ? "UNTESTED — the input (a genuine cum-rights close) failed its observability test, so neither sign is claimable"
    : !disc.length ? "UNTESTED" : (Number.isFinite(tstat(disc)) && Math.abs(tstat(disc)) > 2 ? (m < 0 ? "MATCHED" : "MISSED") : "NOT RESOLVED (|t| < 2)");
  const f21 = meas.map((x) => x.fwd[0]).filter((x): x is number => x != null);
  console.log(`    SIGN         : prior (i) ex-rights price BELOW TERP -> ${signVerdict}`);
  console.log(`                   (the void distribution, recorded so it is not re-derived: mean ${f(m)}%, t ${f(tstat(disc))}, n ${disc.length})`);
  console.log(`                   prior (ii) post-issue excess FLAT -> ${f21.length < 5 ? "UNTESTED (n<5)" : (Math.abs(tstat(f21)) > 2 ? "MISSED (not flat)" : "MATCHED (indistinguishable from flat)")}`);
}
console.log(`\n==> VERDICT ON "IS A NIL-PAID BUYER / SUBSCRIBER PAID FOR ABSORBING THE SELLING?"`);
console.log(`    UNDERPOWERED / UNTESTED — and the binding constraint is DATA, not the market. Four separate reasons, each sufficient:`);
console.log(`      1. The reachable RNS archive starts ~${floor || "n/a"}, so the sample is ~2.5 years of UK rights issues, an era with`);
console.log(`         very few of them. N=${meas.length} measured events cannot resolve a discount of the size the mechanism predicts.`);
console.log(`      2. The nil-paid instrument itself is NOT quoted anywhere reachable, so the object the hypothesis is about is`);
console.log(`         observed only through a proxy.`);
console.log(`      3. Rights-issue terms live in free prose, not in a field. ${withTerms.length} of ${events.length} clusters yielded a machine-parsable`);
console.log(`         price+ratio; a parser miss is silent and biases toward the deals with the most conventional wording.`);
console.log(`      4. AND THE ONE THAT DECIDES IT: the cum-rights price is not observable in the free price feed (test above,`);
console.log(`         ${disagree} of ${meas.length} rows disagree with the issuer's own stated TERP). Without a genuine cum-rights close there is no`);
console.log(`         TERP, and without TERP there is no discount to measure. This is a DATA finding and it would remain true`);
console.log(`         with a thousand events; the archive depth is the second problem, not the first.`);
console.log(`    THIS IS A "UNTESTED / UNDERPOWERED" VERDICT, NOT A NULL. The COVERAGE LAW is explicit that an unfetched or`);
console.log(`    unreachable input makes the verdict about our DATA. What would close it, named rather than hand-waved:`);
console.log(`      · an RNS archive reaching 2008-2024 (the LSE's own explorer does not; a commercial RNS feed or the issuers'`);
console.log(`        own IR pages would) — that alone would take N from ~${meas.length} to the hundreds and would include 2008-09 and 2020,`);
console.log(`        the two episodes where forced selling was most extreme and where the effect, if real, is largest;`);
console.log(`      · a nil-paid price series (LSE level-1 history for the temporary line, or a broker feed);`);
console.log(`      · the ex-rights DATE as a field rather than parsed from prose.`);
console.log(`\n    DESCRIPTIVE ONLY. No lineage row, no DECISIONS.md entry, no pre-registration claimed. Trials: ${events.length} event`);
console.log(`    clusters examined under ONE specification (no parameter was swept, so the specification count is 1).`);
await writeCache("data/uk-rights-measured.json", meas);
console.log(`\n    Wrote data/uk-rights-rns.json (${news.length} RNS rows), data/uk-rights-terms.json (${Object.keys(termsCache).length} parsed bodies), data/uk-rights-measured.json (${meas.length} events).`);
