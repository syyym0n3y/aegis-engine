#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// fpi-flags.ts (D-747b) — DETECT foreign private issuers and, where possible, MEASURE their ADR ratio.
//
// THE DEFECT. `trd_bars_deep` carries the ADR price; `trd_fundamentals` concept
// `EntityCommonStockSharesOutstanding` is the EDGAR cover-page count, which a foreign private issuer files in
// ORDINARY shares. `mc = px_adr * shares_ordinary` is therefore wrong by the ADR RATIO (ordinary shares per ADR),
// which no split ratio touches — LTM prices out at $29.05T, BSAC at $6.63T. Every mc-derived yield (bm, ep,
// cfo_yield, fcf_yield, buyback_yield, div_yield, shareholder_yield) is contaminated for those names.
//
// DETECTION. `https://data.sec.gov/submissions/CIK##########.json` — a registrant that has ever filed a 20-F or
// 40-F is a foreign private issuer by definition (those are the FPI annual-report forms; a domestic issuer files
// 10-K). `stateOfIncorporation` is recorded beside it as corroboration, never as the test: many FPIs are recorded
// with a US state (a Delaware holdco of a foreign operating group) and some domestic issuers carry a foreign one.
//
// RATIO. Yahoo `quoteSummary` `defaultKeyStatistics.sharesOutstanding` is reported in ADR units for many ADRs, so
//     adr_ratio = ordinary_shares_from_EDGAR / yahoo_shares_outstanding
// is a MEASURED conversion, not an assumed one (THE INSTRUMENT LAW). It is accepted only when it lands in
// [0.01, 100] AND is within 8% of an integer or a simple fraction (1/N) — real ADR ratios are ratios like 1, 2, 4,
// 5, 10, 1/2. Anything else means Yahoo reported ordinary shares too (ratio ~1 is then indistinguishable from a
// true 1:1, which is why ~1 is accepted: it is the correct multiplier either way).
//
// FOR AN FPI WITH NO USABLE RATIO THE CORRECT ACTION IS EXCLUSION, NOT A GUESS — the factory sets mc = null and
// every mc-derived yield becomes null. A missing input is not a zero (D-423) and is not a market finding
// (COVERAGE LAW).
//
// Resumable: every completed ticker is written to data/fpi-flags.json and skipped on the next run.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("fpi-flags", [
  { name: "SLEEP_MS", def: "150", note: "SEC asks <=10 req/s" },
  { name: "OUT", def: "data/fpi-flags.json", note: "resumable cache" },
  { name: "RATIO_ONLY", def: "0", note: "1 = skip SEC pass, only fill missing ADR ratios" },
  { name: "LIMIT", def: "0", note: "0 = all; >0 caps tickers processed this run (for probing)" },
]);
const SLEEP_MS = +(Deno.env.get("SLEEP_MS") || 150);
const OUT = Deno.env.get("OUT") || "data/fpi-flags.json";
const RATIO_ONLY = Deno.env.get("RATIO_ONLY") === "1";
const LIMIT = +(Deno.env.get("LIMIT") || 0);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fpi", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "aegis-research ona@revitalise.io" };

export interface FpiFlag {
  cik: string | null;
  ticker: string;
  fpi: boolean;
  forms_seen: string[];        // the FPI-indicating forms actually observed (20-F / 40-F / 6-K)
  state_of_inc: string | null;
  adr_ratio: number | null;    // ordinary shares per ADR; null = unusable, EXCLUDE from mc
  ratio_src: string | null;
  ordinary_shares: number | null;
  yahoo_shares: number | null;
}

// ---------- load / init cache ----------
let flags: Record<string, FpiFlag> = {};
try { flags = JSON.parse(await Deno.readTextFile(OUT)); } catch { /* first run */ }
const save = async () => await Deno.writeTextFile(OUT, JSON.stringify(flags, null, 0));

// ---------- universe: every ticker carrying a cover-page share count ----------
const tickers = new Set<string>();
for (let off = 0;; off += 10000) {
  const p = await fetch(`${OWNED}/trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker&order=ticker&offset=${off}&limit=10000`, { headers: hdr }).then((r) => r.json()).catch(() => []);
  if (!Array.isArray(p) || !p.length) break;
  for (const r of p as { ticker: string | null }[]) if (r.ticker) tickers.add(r.ticker);
  if (p.length < 10000) break;
}
assertNonEmpty("tickers in trd_fundamentals", [...tickers], 1000);
console.log(`==> ${tickers.size.toLocaleString()} tickers carry EntityCommonStockSharesOutstanding`);

// ---------- ticker -> CIK ----------
const cikOf = new Map<string, string>();
{
  const j = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (j) for (const v of Object.values(j) as { cik_str: number; ticker: string }[]) {
    const t = String(v.ticker).toUpperCase();
    if (!cikOf.has(t)) cikOf.set(t, String(v.cik_str).padStart(10, "0"));
    // BRK.B / BRK-B / BRKB are the same registrant under three punctuations
    const alt = t.replace(/[^A-Z0-9]/g, "");
    if (!cikOf.has(alt)) cikOf.set(alt, String(v.cik_str).padStart(10, "0"));
  }
  assertNonEmpty("SEC ticker->CIK map", [...cikOf], 5000);
  console.log(`    ticker->CIK map: ${cikOf.size.toLocaleString()} entries`);
}

// ---------- PASS 1: SEC submissions, per ticker ----------
const FPI_FORMS = /^(20-F|40-F|6-K)/;
let done = 0, newN = 0, fpiN = 0, noCik = 0, failed = 0;
if (!RATIO_ONLY) {
  const todo = [...tickers].sort().filter((t) => !flags[t]);
  console.log(`==> SEC pass: ${todo.length.toLocaleString()} tickers to classify (${Object.keys(flags).length.toLocaleString()} already cached)`);
  const work = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  for (const t of work) {
    const cik = cikOf.get(t.toUpperCase()) ?? cikOf.get(t.toUpperCase().replace(/[^A-Z0-9]/g, "")) ?? null;
    if (!cik) {
      flags[t] = { cik: null, ticker: t, fpi: false, forms_seen: [], state_of_inc: null, adr_ratio: null, ratio_src: null, ordinary_shares: null, yahoo_shares: null };
      noCik++; done++; continue;
    }
    let j: Record<string, unknown> | null = null;
    try { j = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: UA }).then((r) => r.ok ? r.json() : null); } catch { j = null; }
    await sleep(SLEEP_MS);
    if (!j) { failed++; continue; }                        // not cached: retried on the next run (resumable)
    const recent = ((j.filings as Record<string, Record<string, string[]>>)?.recent?.form) || [];
    // `filings.files` holds the older pages; their form types are not in this response. The recent page covers
    // ~1000 filings, and an FPI files 6-K continuously, so a currently-listed FPI is always caught here. A
    // registrant that stopped filing decades ago may not be — recorded as a known limit, not papered over.
    const seen = [...new Set(recent.filter((f) => FPI_FORMS.test(f)))].sort();
    const fpi = seen.some((f) => /^(20-F|40-F)/.test(f));
    flags[t] = {
      cik, ticker: t, fpi, forms_seen: seen,
      state_of_inc: (j.stateOfIncorporation as string) || null,
      adr_ratio: null, ratio_src: null, ordinary_shares: null, yahoo_shares: null,
    };
    if (fpi) fpiN++;
    newN++; done++;
    if (done % 200 === 0) { await save(); console.log(`    ${done}/${work.length}  fpi=${fpiN}  no-cik=${noCik}  failed=${failed}`); }
  }
  await save();
  console.log(`==> SEC pass done: ${newN} newly classified, ${fpiN} FPI, ${noCik} no CIK, ${failed} fetch-failed (retry on rerun)`);
}

// ---------- PASS 2: ADR ratio for FPIs, from Yahoo ----------
const nearSimple = (r: number) => {
  for (const c of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 40, 50, 100, 0.5, 0.25, 0.2, 0.1, 0.05, 0.02]) {
    if (Math.abs(r - c) / c <= 0.08) return c;
  }
  return null;
};
// point-in-time-irrelevant: the ADR ratio is a contract term, not a time series. The LATEST ordinary count is the
// right numerator because the latest Yahoo ADR count is the denominator; the ratio is then applied at every date.
async function latestOrdinary(t: string): Promise<number | null> {
  const p = await fetch(`${OWNED}/trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&ticker=eq.${encodeURIComponent(t)}&select=value,effective_date&order=effective_date.desc&limit=1`, { headers: hdr }).then((r) => r.json()).catch(() => []);
  const v = Array.isArray(p) && p.length ? +p[0].value : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}
// Yahoo's quoteSummary requires a cookie+crumb pair since 2023; without it every call returns "Invalid Crumb" and
// a naive run would record "no Yahoo count" for EVERY name — a false zero of exactly the shape THE POSITIVE-CONTROL
// RULE exists to stop. The cookie comes from fc.yahoo.com (allowlisted), the crumb from /v1/test/getcrumb.
let YCOOKIE = "", YCRUMB = "";
async function yahooAuth() {
  const r = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual" }).catch(() => null);
  YCOOKIE = (r?.headers.get("set-cookie") || "").split(";")[0];
  const c = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": "Mozilla/5.0", Cookie: YCOOKIE } }).then((x) => x.ok ? x.text() : "").catch(() => "");
  YCRUMB = c.trim();
  if (!YCRUMB) console.log(`  !! could not obtain a Yahoo crumb — every ratio lookup will fail. Ratios will be UNAVAILABLE, not zero.`);
  else console.log(`    yahoo auth ok (crumb ${YCRUMB.length} chars)`);
}
async function yahooShares(t: string): Promise<number | null> {
  const sym = t.replace(/\./g, "-");
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=defaultKeyStatistics,price&crumb=${encodeURIComponent(YCRUMB)}`, { headers: { "User-Agent": "Mozilla/5.0", Cookie: YCOOKIE } });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.quoteSummary?.result?.[0];
      const v = res?.defaultKeyStatistics?.sharesOutstanding?.raw ?? res?.price?.sharesOutstanding?.raw ?? null;
      if (Number.isFinite(v) && v > 0) return v as number;
    } catch { /* next host */ }
  }
  return null;
}

const fpis = Object.values(flags).filter((f) => f.fpi);
const needRatio = fpis.filter((f) => f.ratio_src == null);
console.log(`==> ratio pass: ${fpis.length} FPIs, ${needRatio.length} without a ratio attempt yet`);
if (needRatio.length) await yahooAuth();
// POSITIVE CONTROL on the ratio channel itself: AAPL is not an FPI, but Yahoo must return a share count for it.
// If it does not, the crumb is dead and every "unavailable" below is about our auth, not about the ADR.
if (needRatio.length) {
  const probe = await yahooShares("AAPL");
  console.log(`    ratio-channel control: AAPL yahoo sharesOutstanding = ${probe ? probe.toLocaleString() : "NULL"}`);
  if (!probe) { console.error(`!! the Yahoo channel returns nothing for a control that must work — aborting rather than recording ${needRatio.length} false "unavailable" rows.`); Deno.exit(1); }
}
let got = 0, rejected = 0, noYahoo = 0;
for (const f of (LIMIT > 0 ? needRatio.slice(0, LIMIT) : needRatio)) {
  const ord = await latestOrdinary(f.ticker);
  const ysh = await yahooShares(f.ticker);
  await sleep(SLEEP_MS);
  f.ordinary_shares = ord; f.yahoo_shares = ysh;
  if (!ord || !ysh) { f.ratio_src = "unavailable"; f.adr_ratio = null; noYahoo++; continue; }
  const raw = ord / ysh;
  const snap = (raw >= 0.01 && raw <= 100) ? nearSimple(raw) : null;
  if (snap == null) { f.ratio_src = "rejected"; f.adr_ratio = null; rejected++; continue; }
  f.adr_ratio = snap; f.ratio_src = `yahoo:${raw.toFixed(4)}->${snap}`;
  got++;
  if ((got + rejected + noYahoo) % 25 === 0) await save();
}
await save();
console.log(`==> ratio pass done: ${got} usable, ${rejected} rejected (not a simple ratio), ${noYahoo} no Yahoo/EDGAR count`);

// ---------- POSITIVE CONTROLS (D-641): a classification that has never separated anything is unverified ----------
const MUST_FPI = ["BABA", "TM", "HSBC", "BCH", "LTM"];
const MUST_NOT = ["AAPL", "MSFT"];
let bad = 0;
console.log(`\n-- POSITIVE CONTROLS --`);
for (const t of MUST_FPI) {
  const f = flags[t];
  const ok = !!f?.fpi;
  if (!ok && f) bad++;                                     // present but misclassified = a real failure
  console.log(`   ${ok ? "OK  " : f ? "FAIL" : "n/a "} ${t.padEnd(6)} fpi=${f?.fpi ?? "—"} forms=[${f?.forms_seen.join(",") ?? ""}] state=${f?.state_of_inc ?? "—"} ratio=${f?.adr_ratio ?? "—"}`);
}
for (const t of MUST_NOT) {
  const f = flags[t];
  const ok = f ? !f.fpi : false;
  if (f && !ok) bad++;
  console.log(`   ${ok ? "OK  " : f ? "FAIL" : "n/a "} ${t.padEnd(6)} fpi=${f?.fpi ?? "—"} forms=[${f?.forms_seen.join(",") ?? ""}] state=${f?.state_of_inc ?? "—"}`);
}
const withRatio = fpis.filter((f) => f.adr_ratio != null);
console.log(`\n==> ${Object.keys(flags).length.toLocaleString()} tickers classified; ${fpis.length} FPI; ${withRatio.length} with a usable ADR ratio; ${fpis.length - withRatio.length} EXCLUDED from mc-derived yields.`);
if (bad) { console.error(`!! ${bad} positive control(s) FAILED — the classifier is not verified.`); Deno.exit(1); }
