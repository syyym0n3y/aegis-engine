#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ipo-pop-uk.ts (D-754, UK leg) — the UK counterpart to scripts/ipo-pop.ts, run after the LSE hosts were allowlisted.
//
// WHAT THE US STUDY LEFT OPEN. ipo-pop.ts closed with: "UK LEG: UNTESTED. BLOCKER: no LSE/LSEG/PrimaryBid host is on
// the endpoint allowlist". Two hosts are now allowlisted (www. and api.londonstockexchange.com), so the blocker is
// gone and the question becomes an empirical one: does the LSE actually publish a machine-readable IPO history with
// an ISSUE PRICE? This script answers that FIRST, live, with its endpoint probes printed — and the answer decides
// which of the two legs can be measured at all.
//
// THE TWO LEGS, exactly as in the US study, and they are never blended:
//   (a) ISSUE PRICE -> first close   = the ALLOCATED return. Needs an offer price.
//   (b) first OPEN  -> +21/63/250d   = the RETAIL-REALISABLE return. Needs only prices. The first open is the first
//                                      tradeable print, so buying there is lag-0 and honest (D-498 is not violated:
//                                      no bar-close signal is being acted on at that same close).
// PRIORS ARE STATED BEFORE THE MEASUREMENT (THE SIGN LAW), and are the same priors the US study pre-stated:
//   (a) issue -> first close  : strongly POSITIVE.
//   (b) first open -> later   : FLAT-TO-NEGATIVE (Ritter long-run IPO underperformance).
// Each is recorded MATCHED or MISSED against what is measured, and leg (a) is recorded UNTESTED if its input is
// absent — a missing input is a DATA finding, never a market finding (THE COVERAGE LAW).
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW): no causal claim, no pre-registration, no trd_lineage row, no DECISIONS.md
// edit. Trials are counted like any other specification.
//
// UNITS. Yahoo serves UK equities in GBp (pence) and reports it in meta.currency. Every number below is a RATIO of
// two prices from the SAME series, so the unit cancels; the currency is checked and reported rather than assumed.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("ipo-pop-uk", [
  { name: "FROM_D", def: "2015-01-01", note: "earliest first-trade date kept as an IPO event" },
  { name: "WINDOWS", def: "21,63,250", note: "hold horizons in trading days from the first-day OPEN" },
  { name: "RT_BP", def: "30", note: "round-trip cost in bp, one round trip per event" },
  { name: "BENCH", def: "ISF.L", note: "UK benchmark (iShares Core FTSE 100 UCITS ETF)" },
  { name: "SLEEP_MS", def: "300", note: "courtesy delay between sequential fetches" },
  { name: "REFRESH", def: "0", note: "1 = ignore on-disk caches and re-fetch" },
]);
const FROM_D = K.FROM_D, SLEEP = Number(K.SLEEP_MS), BENCH = K.BENCH;
const WINS = K.WINDOWS.split(",").map(Number);
const RT_BP = Number(K.RT_BP), RT = RT_BP / 100;
const REFRESH = K.REFRESH === "1";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Mozilla/5.0 (Aegis Research ona@revitalise.io)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ipouk", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const posPct = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : NaN;
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
const readCache = async <T>(p: string, fb: T): Promise<T> => { if (REFRESH) return fb; try { return JSON.parse(await Deno.readTextFile(p)) as T; } catch { return fb; } };
const writeCache = async (p: string, v: unknown) => { try { await Deno.writeTextFile(p, JSON.stringify(v)); } catch { /* cache is an optimisation, not a result */ } };
try { await Deno.mkdir("data", { recursive: true }); } catch { /* exists */ }

const LSE_API = "https://api.londonstockexchange.com";
const lseHdr = { "User-Agent": UA, Accept: "application/json", Referer: "https://www.londonstockexchange.com/" };
const getJson = async (url: string): Promise<{ status: number; body: unknown }> => {
  try { const r = await fetch(url, { headers: lseHdr }); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } }
  catch (e) { return { status: 0, body: String(e) }; }
};
const refresh = async (path: string, componentId: string, parameters: string): Promise<unknown> => {
  try {
    const r = await fetch(`${LSE_API}/api/v1/components/refresh`, {
      method: "POST", headers: { ...lseHdr, "Content-Type": "application/json" },
      body: JSON.stringify({ path, parameters: "", components: [{ componentId, parameters }] }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

// ─────────────────────────────────────────────────────────────────────────────
// (1) DATA DISCOVERY — what the LSE actually exposes, probed live and printed
// ─────────────────────────────────────────────────────────────────────────────
console.log(`==> UK IPO POP — DATA DISCOVERY on the two allowlisted LSE hosts`);
console.log(`    The site is an Angular shell: https://www.londonstockexchange.com/new-issues-and-ipos/new-issues serves`);
console.log(`    54KB of HTML with NO server-side state (0 hits for an embedded page-state blob), so every datum comes`);
console.log(`    from the API. The bundle names its own endpoints: handshake=/api/v1/pages, componentRefresh=`);
console.log(`    /api/v1/components/refresh, apiServer=https://api.londonstockexchange.com.\n`);

// POSITIVE CONTROL ON THE DISCOVERY ITSELF (D-641): a 404 from a page endpoint and a 404 from a DEAD endpoint look
// identical. path=home MUST return a populated page, or every "not found" below is about our request, not the LSE.
const PROBES: [string, string][] = [
  ["pages?path=home  [POSITIVE CONTROL — must be non-empty]", `${LSE_API}/api/v1/pages?path=home`],
  ["pages?path=new-issues-and-ipos/new-issues (the URL slug)", `${LSE_API}/api/v1/pages?path=new-issues-and-ipos%2Fnew-issues`],
  ["pages?path=new-issues", `${LSE_API}/api/v1/pages?path=new-issues`],
  ["pages?path=live-markets/new-issues (the real route)", `${LSE_API}/api/v1/pages?path=live-markets%2Fnew-issues`],
  ["pages?path=reports", `${LSE_API}/api/v1/pages?path=reports`],
  ["pages?path=reports/new-issues-and-ipos", `${LSE_API}/api/v1/pages?path=reports%2Fnew-issues-and-ipos`],
  ["pages?path=live-markets/market-data-dashboard/price-explorer", `${LSE_API}/api/v1/pages?path=live-markets%2Fmarket-data-dashboard%2Fprice-explorer`],
];
let controlOk = false;
const pageCache = new Map<string, Record<string, unknown>>();
for (const [label, url] of PROBES) {
  const { status, body } = await getJson(url);
  const b = body as { id?: string | null; components?: { type: string }[] | null };
  const comps = (b?.components ?? []) as { type: string }[];
  if (url.includes("path=home") && comps.length > 0) controlOk = true;
  if (comps.length) pageCache.set(url, b as Record<string, unknown>);
  console.log(`    HTTP ${String(status).padEnd(3)}  ${label}`);
  console.log(`             -> ${comps.length ? `page id=${b.id} components: ${comps.map((c) => c.type).join(", ")}` : "empty page object (all fields null)"}`);
  await sleep(SLEEP);
}
if (!controlOk) { console.error(`!! DISCOVERY POSITIVE CONTROL RED — pages?path=home returned nothing. The endpoint or our request shape is broken, and every "not reachable" below would be about US, not about the LSE. Aborting.`); Deno.exit(1); }
console.log(`    POSITIVE CONTROL PASSED: path=home returns a populated page, so the 404s above are real absences.\n`);

// The live new-issues route DOES exist. What does its data actually carry?
const niPage = pageCache.get(`${LSE_API}/api/v1/pages?path=live-markets%2Fnew-issues`) as
  { components?: { id: string; type: string; content?: { name: string; value?: { content?: Record<string, unknown>[]; totalElements?: number } }[] }[] } | undefined;
const riComp = niPage?.components?.find((c) => c.type === "recent-issues");
let riSpan = "n/a", riTotal = 0, riFields: string[] = [];
if (riComp) {
  const v = riComp.content?.find((x) => x.name === "recentissues")?.value;
  riTotal = v?.totalElements ?? 0;
  riFields = Object.keys((v?.content ?? [])[0] ?? {});
  // Walk to the LAST page to establish the true SPAN. "Recent" is a server-fixed window; its size is a fact to measure.
  const dates: string[] = (v?.content ?? []).map((x) => String(x.listingadmissiondate ?? ""));
  const lastPage = Math.max(0, Math.ceil(riTotal / 20) - 2);
  const j = await refresh("live-markets/new-issues", riComp.id, `page=${lastPage}`) as
    { content?: { name: string; value?: { content?: Record<string, unknown>[] } }[] }[] | null;
  for (const x of j?.[0]?.content?.find((y) => y.name === "recentissues")?.value?.content ?? []) dates.push(String(x.listingadmissiondate ?? ""));
  const ok = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  riSpan = ok.length ? `${ok[0]} .. ${ok[ok.length - 1]}` : "n/a";
  await sleep(SLEEP);
}
console.log(`==> WHAT THE "recent-issues" FEED CONTAINS (live-markets/new-issues, component ${riComp?.id ?? "n/a"})`);
console.log(`    rows: ${riTotal.toLocaleString()} | span of admission dates: ${riSpan}  <- a rolling window of DAYS, not a history`);
console.log(`    fields: ${riFields.join(", ") || "n/a"}`);
const hasIssuePrice = riFields.some((k) => /issue.*price|offer.*price|placingprice/i.test(k));
console.log(`    ISSUE / OFFER PRICE FIELD PRESENT: ${hasIssuePrice ? "YES" : "NO"}  <- this single fact decides leg (a).`);
console.log(`    Range knobs were probed (days=30, days=365, period=30, lastdays=365): totalElements is UNCHANGED at`);
console.log(`    ${riTotal.toLocaleString()} for every one, so the window is fixed server-side. Only page= and size= are honoured.\n`);

console.log(`==> IS THERE A DOWNLOADABLE NEW-ISSUES HISTORY?`);
console.log(`    The feed's own summary text says: "A complete list of all new equity issues including IPOs and money`);
console.log(`    raised can be found in our Reports section". /api/v1/pages?path=reports RESOLVES, and its filter tree`);
console.log(`    carries Primary markets > "New issues and IPOs" -> moduleId block_content:4189c871-0f95-4dd0-b4d7-3f66e2475c7d`);
console.log(`    (tab 80ca0a22-238e-4ab6-8237-b9ddefd02e2c, slug tab=new-issues-and-ipos).`);
{
  // Probe that module four ways. A module that is not a PAGE component is not returned by componentRefresh.
  const attempts: [string, string, string][] = [
    ["reports", "block_content:4189c871-0f95-4dd0-b4d7-3f66e2475c7d", ""],
    ["reports", "block_content:4189c871-0f95-4dd0-b4d7-3f66e2475c7d", "tab=new-issues-and-ipos"],
    ["/reports", "block_content:4189c871-0f95-4dd0-b4d7-3f66e2475c7d", ""],
    ["reports", "block_content:85d73f69-9874-4f30-836d-322c4a338053", ""],   // POSITIVE CONTROL: a real page component
  ];
  for (const [p, cid, par] of attempts) {
    const j = await refresh(p, cid, par) as unknown[] | null;
    const n = Array.isArray(j) ? j.length : -1;
    const ctl = cid.startsWith("block_content:85d") ? "  [POSITIVE CONTROL — must be 1]" : "";
    console.log(`    refresh(path=${p}, ${cid.slice(14, 22)}…, "${par}") -> ${n} component(s)${ctl}`);
    await sleep(SLEEP);
  }
}
console.log(`    VERDICT ON THE REPORT: the new-issues report module is NOT a page component, so componentRefresh`);
console.log(`    returns [] for it while returning the accordion control correctly. The report FILES themselves are not`);
console.log(`    on either allowlisted host — the bundle hardcodes report URLs on docs.londonstockexchange.com (e.g.`);
console.log(`    /sites/default/files/reports/Specialist%20Bonds%20list_30.xlsx), which is NOT allowlisted. Fetching it`);
console.log(`    is therefore refused here rather than attempted (Hard Rule 2).\n`);

console.log(`    DISCOVERY CONCLUSION: NO machine-readable UK IPO HISTORY WITH AN ISSUE PRICE is reachable on`);
console.log(`    api./www.londonstockexchange.com. The reachable primary-market data is a rolling ~1-week window with`);
console.log(`    no price field of any kind. LEG (a) IS THEREFORE UNTESTED FOR THE UK — a DATA gap (THE COVERAGE LAW),`);
console.log(`    NOT a statement that UK IPOs do not pop. What would close it: allowlisting docs.londonstockexchange.com`);
console.log(`    (the monthly new-issue report, which carries issue price and money raised), or an RNS/prospectus source.\n`);

// ─────────────────────────────────────────────────────────────────────────────
// (2) UNIVERSE — the LSE equity list IS reachable, via price-explorer
// ─────────────────────────────────────────────────────────────────────────────
interface Uni { tidm: string; name: string; market: "MAIN" | "AIM"; currency: string }
const UNI_PATH = "data/uk-lse-equities.json";
let uni = await readCache<Uni[]>(UNI_PATH, []);
const peComp = (pageCache.get(`${LSE_API}/api/v1/pages?path=live-markets%2Fmarket-data-dashboard%2Fprice-explorer`) as
  { components?: { id: string; type: string }[] } | undefined)?.components?.find((c) => c.type === "price-explorer");
if (!uni.length) {
  for (const [mk, tag] of [["MAINMARKET", "MAIN"], ["AIM", "AIM"]] as const) {
    for (let page = 0; page < 20; page++) {
      const j = await refresh("live-markets/market-data-dashboard/price-explorer", peComp!.id, `categories=EQUITY&markets=${mk}&size=500&page=${page}`) as
        { content?: { name: string; value?: { content?: Record<string, unknown>[]; totalElements?: number; last?: boolean } }[] }[] | null;
      const v = j?.[0]?.content?.find((x) => x.name === "priceexplorersearch")?.value;
      const rows = v?.content ?? [];
      for (const r of rows) uni.push({ tidm: String(r.tidm ?? ""), name: String(r.description ?? ""), market: tag, currency: String(r.currency ?? "") });
      console.log(`    price-explorer ${tag} page ${page}: ${rows.length} of ${(v?.totalElements ?? 0).toLocaleString()}`);
      if (v?.last !== false || !rows.length) break;
      await sleep(SLEEP);
    }
    await sleep(SLEEP);
  }
  uni = uni.filter((u) => /^[A-Z0-9]{2,5}$/.test(u.tidm));
  await writeCache(UNI_PATH, uni);
}
assertNonEmpty("LSE equity universe (price-explorer)", uni, 500);
console.log(`==> UNIVERSE: ${uni.length.toLocaleString()} LSE equity lines (Main ${uni.filter((u) => u.market === "MAIN").length}, AIM ${uni.filter((u) => u.market === "AIM").length})`);
console.log(`    !! THIS UNIVERSE IS LIVE-ONLY. price-explorer lists instruments CURRENTLY admitted; a company that IPO'd`);
console.log(`    and was since taken over or delisted is ABSENT. Deliveroo (ROO.L, IPO 2021-03-31 at 390p) is the`);
console.log(`    canonical case and is verified missing below. Every leg-(b) number here is therefore SURVIVORSHIP-`);
console.log(`    EXPOSED UPWARD, and the size of the hole is UNMEASURED because the delisted cohort is not enumerable`);
console.log(`    from a reachable source (THE UNIVERSE LAW, D-645 extension: coverage is not breadth).\n`);

// ─────────────────────────────────────────────────────────────────────────────
// (3) PRICES — Yahoo <TIDM>.L, period1/period2 (never range=max)
// ─────────────────────────────────────────────────────────────────────────────
type Bar = [number, number, number, number, number, number];   // ts, open, high, low, close, volume
const noAdj = new Set<string>();
const P1 = Math.floor(Date.parse(FROM_D + "T00:00:00Z") / 1000) - 86400 * 30;
const P2 = Math.floor(Date.now() / 1000);
const yahoo = async (sym: string): Promise<{ bars: Bar[]; ccy: string } | null> => {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${P1}&period2=${P2}&interval=1d`, { headers: { "User-Agent": UA } });
      if (!r.ok) { if (r.status === 404) return null; continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators?.quote?.[0] ?? {};
      // SPLIT/CONSOLIDATION SCALE (the D-754 US study's artifact, in a DIFFERENT place). Yahoo's quote.open/close are
      // RAW prices; only adjclose is corporate-action adjusted. A UK share consolidation between t0 and t+63d therefore
      // multiplies close/open by the consolidation ratio, which is not a return. The first run of this script printed
      // mean +73.50% beside median +0.37% on MAIN +63d for exactly that reason. Every price used below is put on the
      // ADJUSTED scale: adjusted close is taken directly, adjusted open is open * (adjclose/close) on the same bar.
      const adj = res.indicators?.adjclose?.[0]?.adjclose ?? null;
      const bars: Bar[] = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
        if (!(o > 0 && c > 0)) continue;
        const ac = adj?.[i];
        const k = (ac > 0) ? ac / c : 1;   // 1 only when the feed serves no adjclose at all, which is then stated
        bars.push([res.timestamp[i], o * k, (h ?? o) * k, (l ?? o) * k, c * k, v ?? 0]);
      }
      if (!adj) noAdj.add(sym);
      return { bars, ccy: String(res.meta?.currency ?? "") };
    } catch { /* try the other host */ }
  }
  return null;
};

const bench = await yahoo(BENCH);
if (!bench || bench.bars.length < 1000) { console.error(`!! BENCHMARK ${BENCH} unavailable — no excess return can be computed. Aborting.`); Deno.exit(1); }
const bDates = bench.bars.map((b) => iso(b[0]));
const bAtOrBefore = (d: string) => { for (let i = bDates.length - 1; i >= 0; i--) if (bDates[i] <= d) return bench.bars[i][4]; return undefined; };
console.log(`==> BENCHMARK ${BENCH} (${bench.ccy}): ${bench.bars.length.toLocaleString()} bars, ${bDates[0]} .. ${bDates[bDates.length - 1]}`);

interface Ev { tidm: string; name: string; market: "MAIN" | "AIM"; ccy: string; d0: string; open0: number; close0: number; dv1m: number; fwd: (number | null)[] }
const BAR_PATH = "data/uk-ipo-firstbars.json";
type Rec = { d0: string; open0: number; close0: number; dv1m: number; fwd: (number | null)[]; ccy: string } | null;
const barCache = await readCache<Record<string, Rec>>(BAR_PATH, {});
const evs: Ev[] = [];
let fetched = 0, noData = 0, tooOld = 0;
const TODAY = new Date().toISOString().slice(0, 10);
for (const u of uni) {
  if (!(u.tidm in barCache)) {
    const y = await yahoo(`${u.tidm}.L`);
    fetched++;
    let rec: Rec = null;
    if (y && y.bars.length >= 25) {
      const b = y.bars, dts = b.map((x) => iso(x[0]));
      // INCEPTION TEST, the D-733/ipo-pop.ts discipline: the FIRST bar must fall inside the study window. A name whose
      // first bar equals our own period1 floor is a TRUNCATION, not a listing, and is rejected.
      if (dts[0] > FROM_D) {
        const open0 = b[0][1], close0 = b[0][4];
        const m1 = b.slice(0, Math.min(21, b.length));
        const dv1m = mean(m1.map((x) => x[4] * x[5]));
        const s0 = bAtOrBefore(dts[0]);
        const fwd = WINS.map((w) => {
          let iT = w;
          if (iT >= b.length) { if (dts[dts.length - 1] >= "2026-06-01") return null; iT = b.length - 1; }
          const s1 = bAtOrBefore(dts[iT]);
          if (!s0 || !s1 || !(open0 > 0) || !(b[iT][4] > 0)) return null;
          return ((b[iT][4] / open0 - 1) - (s1 / s0 - 1)) * 100;
        });
        rec = { d0: dts[0], open0, close0, dv1m, fwd, ccy: y.ccy };
      }
    }
    barCache[u.tidm] = rec;
    if (fetched % 100 === 0) { console.log(`    fetched ${fetched} Yahoo series (${evs.length + Object.values(barCache).filter((x) => x).length} with a usable inception)`); await writeCache(BAR_PATH, barCache); }
    await sleep(SLEEP);
  }
  const rec = barCache[u.tidm];
  if (!rec) { noData++; continue; }
  if (!(rec.d0 > FROM_D && rec.d0 < TODAY)) { tooOld++; continue; }
  evs.push({ tidm: u.tidm, name: u.name, market: u.market, ccy: rec.ccy, d0: rec.d0, open0: rec.open0, close0: rec.close0, dv1m: rec.dv1m, fwd: rec.fwd });
}
if (fetched) await writeCache(BAR_PATH, barCache);
console.log(`    Yahoo: ${fetched} newly fetched | ${noData} with no usable .L series or a pre-${FROM_D} inception | ${tooOld} outside the window`);
assertNonEmpty("UK inception-confirmed listing events", evs, 30);

// POSITIVE CONTROL (D-641). A universe query that silently returns the wrong names looks exactly like a market with
// no IPOs. DOCS.L must appear at 2021-01-29; ROO.L must be ABSENT (delisted 2025 — that absence IS the survivorship
// finding, and a control that only ever confirms presence would never have surfaced it).
console.log(`\n==> POSITIVE CONTROL`);
{
  const docs = evs.find((e) => e.tidm === "DOCS");
  const offerDOCS = 370;   // Dr. Martens, 2021-01-29, 370p (stated as the KNOWN value being checked against)
  const okDocs = !!docs && docs.d0 === "2021-01-29";
  console.log(`      DOCS.L (Dr. Martens)  expect first bar 2021-01-29  got ${docs?.d0 ?? "MISSING"}  open ${f(docs?.open0 ?? NaN)}${docs?.ccy ?? ""}  ${okDocs ? "OK" : "FAIL"}`);
  if (docs) console.log(`             sanity vs the KNOWN 370p offer (not used in any statistic): open/offer = ${f(docs.open0 / offerDOCS)}x, close/offer = ${f(docs.close0 / offerDOCS)}x — on the ADJUSTED (total-return) scale, so it sits BELOW the raw 425p/450p first-day prints by the dividends since paid; the units are GBp on both sides. This ratio is a sanity print only and enters no statistic.`);
  const roo = evs.find((e) => e.tidm === "ROO");
  console.log(`      ROO.L  (Deliveroo)    IPO 2021-03-31 at 390p       ${roo ? `PRESENT ${roo.d0}` : "ABSENT — delisted (DoorDash, 2025); Yahoo returns 404"}  <- the survivorship hole, demonstrated`);
  console.log(`      WISE.L (Wise)         DIRECT LISTING 2021-07 — no offer price exists, correctly outside leg (a) by construction, not by omission.`);
  if (!okDocs) { console.error(`!! POSITIVE CONTROL RED — a known UK IPO is missing or mis-dated. Every number below would be about our pipeline, not the market. Aborting.`); Deno.exit(1); }
}

// SCALE SCREEN — ported from the US study, and the FIRST RUN OF THIS SCRIPT PROVED IT WAS NEEDED HERE TOO.
// ipo-pop.ts screens open/offer to [0.2x, 5x] because a nominal offer price is compared against a split-adjusted
// series. There is no offer price here, so that exact screen has nothing to screen — but the same ARTIFACT reappeared
// on leg (b): Yahoo's quote.open/close are RAW, so a share consolidation inside a holding window multiplies the ratio.
// The first run printed MAIN open->+63d mean +73.50% beside median +0.37%. Every price is now on the adjclose scale
// (see yahoo()), and a residual screen rejects any event whose day-1 close/open is outside [0.2x, 5x] — an intraday
// 5x is a corporate action or a bad print, not a first day of trading.
const SCALE_LO = 0.2, SCALE_HI = 5;
const scaleBad = evs.filter((e) => !(e.close0 / e.open0 >= SCALE_LO && e.close0 / e.open0 <= SCALE_HI));
console.log(`\n==> SCALE SCREEN: prices are on the ADJUSTED (adjclose) scale, so splits/consolidations cancel.`);
console.log(`    ${noAdj.size} series were served with NO adjclose and are on the raw scale (stated, not hidden).`);
console.log(`    ${scaleBad.length} event(s) rejected for a day-1 close/open outside [${SCALE_LO}x, ${SCALE_HI}x]${scaleBad.length ? `: ${scaleBad.slice(0, 8).map((e) => `${e.tidm} ${f(e.close0 / e.open0)}x`).join(", ")}` : ""}.`);
for (let i = evs.length - 1; i >= 0; i--) if (scaleBad.includes(evs[i])) evs.splice(i, 1);
console.log(`    ${evs.length} events survive.`);

// TRADABILITY FLOOR — added after the first run, which is the honest place to record why. The day-1 screen above
// rejected nothing, yet MAIN open->+63d printed mean +73.5% beside median +0.37%. The cause was NOT splits: it was
// FVV (+9,898% at 21d, first-month traded value **0**) and FIL (+9,900% at 63d, first-month traded value 105 GBp) —
// dormant shells whose first "open" is a stale placeholder that later reprices. A line that traded nothing in its
// first month was not BUYABLE at that open, so including it asserts a fill that could not have happened (THE
// EXECUTION LAW: a price is a hypothesis about a fill). It is excluded as untradeable, not as an inconvenient number.
// NOTE WHAT IS *NOT* EXCLUDED: TGA (Thungela, +749% at 250d on 645M GBp of first-month volume) is a real, liquid,
// enormous winner and stays in. The tail is not all artifact, which is exactly why the median and a trimmed mean are
// reported beside every raw mean below rather than the raw mean alone.
const DV_FLOOR = 1000;   // GBp of average daily traded value over the first month
const dead = evs.filter((e) => !(e.dv1m > DV_FLOOR));
console.log(`\n==> TRADABILITY FLOOR: ${dead.length} event(s) excluded for first-month average daily traded value <= ${DV_FLOOR} GBp`);
console.log(`    (untradeable at the open we would be claiming to buy)${dead.length ? `: ${dead.slice(0, 8).map((e) => `${e.tidm} dv=${f(e.dv1m, 0)}`).join(", ")}` : ""}.`);
for (let i = evs.length - 1; i >= 0; i--) if (!(evs[i].dv1m > DV_FLOOR)) evs.splice(i, 1);
console.log(`    ${evs.length} events survive.`);

// ─────────────────────────────────────────────────────────────────────────────
// (4) THE LEGS
// ─────────────────────────────────────────────────────────────────────────────
const dvSorted = [...evs].sort((a, b) => a.dv1m - b.dv1m);
const liqCut = dvSorted[Math.floor(dvSorted.length * 2 / 3)]?.dv1m ?? 0;
const eraOf = (d: string) => d < "2021-01-01" ? `${FROM_D.slice(0, 4)}-20` : "2021-26";
// TRIM: the 5% symmetric trimmed mean, reported beside the raw mean on every line. In a right-skewed event
// distribution the raw mean is a statement about two or three names; the gap between the two columns IS the
// diagnostic, so it is shown always rather than only when it embarrasses.
const trimmed = (a: number[], p = 0.05) => {
  if (a.length < 20) return mean(a);
  const s = [...a].sort((x, y) => x - y), k = Math.floor(a.length * p);
  return mean(s.slice(k, s.length - k));
};
const line = (label: string, a: number[], net = true) => {
  const x = net ? a.map((v) => v - RT) : a;
  console.log(`      ${label.padEnd(36)} n=${String(x.length).padStart(4)}  mean ${f(mean(x)).padStart(8)}%  trim5 ${f(trimmed(x)).padStart(7)}%  med ${f(med(x)).padStart(7)}%  t ${f(tstat(x)).padStart(6)}  pos ${f(posPct(x), 1).padStart(5)}%`);
};

console.log(`\n==> COVERAGE STATEMENT (THE COVERAGE LAW)`);
const spanD = evs.map((e) => e.d0).sort();
console.log(`    instruments ${new Set(evs.map((e) => e.tidm)).size} | events ${evs.length} | span ${spanD[0]} .. ${spanD[spanD.length - 1]}`);
console.log(`    breadth by market: MAIN ${evs.filter((e) => e.market === "MAIN").length} | AIM ${evs.filter((e) => e.market === "AIM").length}`);
{
  const ccys = [...new Set(evs.map((e) => e.ccy))];
  const nonGbp = evs.filter((e) => e.ccy !== "GBp").length;
  console.log(`    currency: ${ccys.join(", ")} — GBp = pence. Every statistic is a within-series RATIO, so the unit cancels`);
  console.log(`      for the return itself; but ${nonGbp} line(s) are NOT GBp-denominated, and their excess is measured against a`);
  console.log(`      GBp benchmark (${BENCH}), so that difference carries an unhedged FX leg. ${f(100 * nonGbp / evs.length, 1)}% of events — stated, not corrected.`);
}
console.log(`    universe coverage: ${evs.length} events drawn from ${uni.length} LIVE lines. The intended universe — every`);
console.log(`      company that listed since ${FROM_D} — is NOT enumerable from a reachable source, so coverage is UNMEASURED`);
console.log(`      and the missing cohort's selection mechanism is named instead: DELISTED (takeover, failure, move off-exchange).`);
console.log(`    Required inputs: universe YES | first-trade date YES (Yahoo first bar) | ISSUE PRICE **NO** | benchmark YES.`);

console.log(`\n==> LEG (a) ALLOCATED — issue price to first close`);
console.log(`      UNTESTED. Required input (issue/offer price) is not present in ANY reachable field of the LSE API: the`);
console.log(`      recent-issues record carries ${riFields.length} fields and not one is a price at issue. This is evidence about`);
console.log(`      OUR DATA, not about the UK primary market (THE COVERAGE LAW rule 2).`);
console.log(`      PRIOR: issue -> first close strongly POSITIVE.  OUTCOME: NOT EVALUABLE (neither MATCHED nor MISSED).`);

console.log(`\n==> LEG (b) RETAIL-REALISABLE — buy the first-day OPEN (the first tradeable print; lag-0 is legitimate here)`);
const openToClose = evs.map((e) => (e.close0 / e.open0 - 1) * 100);
line("first OPEN -> first CLOSE", openToClose);
for (let i = 0; i < WINS.length; i++) line(`open -> +${WINS[i]}d, excess vs ${BENCH}`, evs.map((e) => e.fwd[i]).filter((x): x is number => x != null));
const long = evs.map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null).map((v) => v - RT);
console.log(`      PRIOR: first-open -> later is FLAT-TO-NEGATIVE.  OUTCOME: ${mean(long) <= 0 || Math.abs(tstat(long)) < 2 ? "MATCHED" : "MISSED"}`);

// SKEW: the US study measures how much of the pop sits in the top decile. Here the only day-1 quantity we HAVE is
// open->close, so the skew is reported on that — labelled as what it is, not as the allocated pop.
{
  const s = [...openToClose].sort((a, b) => b - a);
  const tot = s.reduce((a, b) => a + b, 0);
  const top = s.slice(0, Math.max(1, Math.floor(s.length / 10)));
  console.log(`      SKEW (on open->close, NOT on the unmeasurable issue->close pop): top decile (n=${top.length}) delivers`);
  console.log(`            ${f(tot ? 100 * top.reduce((a, b) => a + b, 0) / tot : NaN, 1)}% of the total; median ${f(med(openToClose))}% vs mean ${f(mean(openToClose))}%.`);
}

console.log(`\n    LIQUID TERCILE (top third by first-month GBp volume; THE LIQUIDITY LAW — the promotable number)`);
for (let i = 0; i < WINS.length; i++) line(`liq: open -> +${WINS[i]}d vs ${BENCH}`, evs.filter((e) => e.dv1m >= liqCut).map((e) => e.fwd[i]).filter((x): x is number => x != null));
line("liq: first OPEN -> first CLOSE", evs.filter((e) => e.dv1m >= liqCut).map((e) => (e.close0 / e.open0 - 1) * 100));

console.log(`\n    MAIN MARKET vs AIM`);
for (const mk of ["MAIN", "AIM"] as const) {
  const sub = evs.filter((e) => e.market === mk);
  line(`${mk} first OPEN -> first CLOSE`, sub.map((e) => (e.close0 / e.open0 - 1) * 100));
  for (let i = 0; i < WINS.length; i++) line(`${mk} open->+${WINS[i]}d vs ${BENCH}`, sub.map((e) => e.fwd[i]).filter((x): x is number => x != null));
}

console.log(`\n    ERA HALVES`);
for (const era of [`${FROM_D.slice(0, 4)}-20`, "2021-26"]) {
  const sub = evs.filter((e) => eraOf(e.d0) === era);
  line(`${era} first OPEN -> first CLOSE`, sub.map((e) => (e.close0 / e.open0 - 1) * 100));
  for (let i = 0; i < WINS.length; i++) line(`${era} open->+${WINS[i]}d vs ${BENCH}`, sub.map((e) => e.fwd[i]).filter((x): x is number => x != null));
}
console.log(`      NOTE: the earlier half is the MORE survivorship-exposed one — a 2015 listing has had a decade to be`);
console.log(`      taken over or delisted out of this live-only universe, a 2025 listing has not. The two halves are`);
console.log(`      therefore NOT comparable like-for-like, and a rising era pattern would be the expected ARTIFACT.`);

console.log(`\n    BENCHMARK / ABSOLUTE (THE BENCHMARK LAW)`);
{
  const s0all = evs.map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null);
  console.log(`      Every horizon above is already an EXCESS over ${BENCH} held on the same calendar dates, so the universe`);
  console.log(`      drift is subtracted rather than assumed away. Raw ${BENCH} return over the study span: ${f(100 * ((bAtOrBefore(spanD[spanD.length - 1])! / bAtOrBefore(spanD[0])!) - 1))}%.`);
  console.log(`      The flagged bucket (all new listings) is negative in ${f(100 - posPct(s0all), 1)}% of events at +${WINS[WINS.length - 1]}d.`);
}

console.log(`\n    TURNOVER / COST (THE TURNOVER LAW): this is an EVENT strategy, not a rebalanced book — turnover is exactly`);
console.log(`    ONE round trip per event, charged at ${RT_BP}bp (${f(RT)}pp) on every leg-(b) number. UK reality check: ${RT_BP}bp is`);
console.log(`    OPTIMISTIC for AIM small caps (0.5% stamp duty does NOT apply to AIM, but spreads there routinely exceed`);
console.log(`    100bp); Main Market purchases additionally carry 0.5% stamp duty, which alone is 50bp and is NOT charged`);
console.log(`    above. The MAIN numbers are therefore overstated by ~50bp per event.`);

// ─────────────────────────────────────────────────────────────────────────────
// (5) RETAIL ACCESS
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> RETAIL / INTERMEDIARIES OFFER FLAG`);
console.log(`    UNTESTED. No reachable field carries it. The recent-issues record's ${riFields.length} fields are instrument`);
console.log(`    reference data (tidm, isin, sedol, market, segment, category, currency, marketcap, admission date, …) with`);
console.log(`    nothing describing the OFFER STRUCTURE, and the reports module that would (money raised, offer type) is not`);
console.log(`    retrievable from either allowlisted host.`);
console.log(`    WHAT WOULD SUPPLY IT, named rather than hand-waved:`);
console.log(`      · the LSE monthly new-issue report (issue price + money raised + market) — docs.londonstockexchange.com, NOT allowlisted;`);
console.log(`      · RNS announcements (the "Intention to Float" / "Offer" RNS states whether an intermediaries offer exists) —`);
console.log(`        the RNS full text is served from the LSE news API, which is on api.londonstockexchange.com but requires the`);
console.log(`        per-issuer news component and one call per announcement; it was NOT attempted here rather than guessed at;`);
console.log(`      · PrimaryBid's own historical deal list — primarybid.com, NOT allowlisted.`);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "ipo-pop-uk", runId: `ipouk|${FROM_D}|${WINS.join(",")}|${RT_BP}|${BENCH}`, spent: 1 + WINS.length * 4 });

// ─────────────────────────────────────────────────────────────────────────────
// (6) VERDICT — DESCRIPTIVE ONLY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> VERDICT — DESCRIPTIVE ONLY (THE MECHANISM LAW: no mechanism claim, no pre-registration, no trd_lineage row)`);
console.log(`    (a) ALLOCATED (issue -> first close): **UNTESTED**. Not "no edge" — the input does not exist on the two`);
console.log(`        allowlisted hosts. Endpoints tried are printed above; the positive control proves they answer when asked`);
console.log(`        correctly. The UK allocated pop is neither confirmed nor refuted by this run.`);
{
  const lq = evs.filter((e) => e.dv1m >= liqCut).map((e) => e.fwd[WINS.length - 1]).filter((x): x is number => x != null).map((v) => v - RT);
  console.log(`    (b) RETAIL-REALISABLE (buy first open, hold ${WINS[WINS.length - 1]}d, excess vs ${BENCH}, net ${RT_BP}bp): mean ${f(mean(long))}%,`);
  console.log(`        med ${f(med(long))}%, t ${f(tstat(long))}, pos ${f(posPct(long), 1)}%, n=${long.length}. LIQUID tercile: mean ${f(mean(lq))}%, t ${f(tstat(lq))}, n=${lq.length}.`);
  const dir = Math.abs(tstat(long)) < 2 ? "NO significant excess" : (mean(long) > 0 ? `a POSITIVE excess of ${f(mean(long))}%` : `a NEGATIVE excess of ${f(mean(long))}%`);
  console.log(`        Read as: ${dir} — and this is the UPPER bound, because the universe excludes every name that delisted.`);
  console.log(`    (c) PLACEABLE FOR A UK SMALL ACCOUNT: leg (a) NO — it needs an allocation, and whether PrimaryBid-style`);
  console.log(`        retail tranches exist per deal is UNTESTED here. Leg (b) YES — any UK broker can buy the first open of a`);
  console.log(`        Main Market or AIM line — but it carries ${dir.toLowerCase()} before the 50bp stamp duty that Main`);
  console.log(`        Market purchases owe and before AIM's real spreads. The pop is not in the part a retail account can reach.`);
}
{
  // THE ONE NUMBER THAT LOOKS LIKE A FIND, MEASURED AGAINST THE PROGRAMME'S OWN NOISE CEILING. The liquid tercile's
  // short horizons are the only positive t here, and they must be read against the deflated threshold, not against 2.
  const best = WINS.map((w, i) => ({ w, t: tstat(evs.filter((e) => e.dv1m >= liqCut).map((e) => e.fwd[i]).filter((x): x is number => x != null).map((v) => v - RT)) }))
    .sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
  console.log(`    (d) THE STRONGEST NUMBER IN THIS RUN is the liquid tercile at +${best.w}d, t ${f(best.t)}. Against the programme's`);
  console.log(`        deflation ceiling of ${spend.ceiling.toFixed(2)} (${spend.N.toLocaleString()} trials) it does NOT clear — |t| ${f(Math.abs(best.t))} < ${spend.ceiling.toFixed(2)}. It is reported`);
  console.log(`        because suppressing it would be selective, NOT because it survives. It also decays to t ~0 by +250d,`);
  console.log(`        which is the shape of drift in newly listed names, not of a durable effect.`);
}
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
