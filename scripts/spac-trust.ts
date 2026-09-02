#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// spac-trust.ts (frontier: "paid for holding cash with an option attached") — PRE-DEAL SPAC TRUST ARBITRAGE.
//
// THE OBJECT. A SPAC IPOs units at $10.00; substantially all of the proceeds sit in a trust account invested in
// short T-bills. Every public share carries a CONTRACTUAL REDEMPTION RIGHT at the pro-rata trust value at the
// business-combination vote, and at liquidation if no deal closes by the deadline. So the common share is a
// T-bill with a free option attached: buy BELOW trust and the redemption is a near-riskless yield; the premium
// ABOVE trust is the market's price for the deal option.
//
// WHY THIS IS NOT AN "EDGE" CLAIM AND WHAT IT IS MEASURED AGAINST. A cash-like instrument must be benchmarked
// against CASH. THE BENCHMARK LAW: the honest comparator is the contemporaneous 3-month T-bill (ust_3m), not
// zero and not SPY. A sub-trust discount that annualises to 4% in a 5% bill year is a LOSS, not a yield. Every
// number below is reported beside the bill.
//
// DESCRIPTIVE ONLY (MECHANISM LAW) — no causal claim, no pre-registration, no trd_lineage row, no DECISIONS write.
//
// THE DEAL BOUNDARY, STATED UP FRONT. "Pre-deal" has TWO boundaries and they are held to different standards.
// The de-SPAC COMPLETION is REAL DATA — the completion 8-K ingest (D-734), joined on the SPAC's own CIK, which
// persists through the merger; every series is truncated there. The DEFINITIVE-AGREEMENT ANNOUNCEMENT, which
// comes months earlier, is NOT held, and is approximated as the first month-end whose close exceeds
// trust x (1+DEAL_PCT). That proxy is biased in a knowable direction: it can only misclassify a month as
// pre-deal when the market has not yet moved, so it cannot manufacture the announcement pop it is used to
// detect, but it WILL classify a quiet post-announcement month as pre-deal. Read every "pre-deal" figure so.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("spac-trust", [
  { name: "FROM_Y", def: "2017", note: "first calendar year of the 424B4 blank-check search" },
  { name: "TO_Y", def: "2023", note: "last calendar year (the SPAC era: boom 2020-21, discount year 2022)" },
  { name: "DEAL_PCT", def: "15", note: "% above trust that proxies a definitive-agreement announcement" },
  { name: "EXIT_PCT", def: "2", note: "% above trust at which the sub-trust rule closes the position" },
  { name: "EXT_M", def: "3", note: "ASSUMED months of deadline extension beyond the charter deadline" },
  { name: "RT_BP", def: "50", note: "round-trip cost in bp on a sub-$10 illiquid SPAC common" },
  { name: "SLEEP_MS", def: "300", note: "SEC courtesy delay between sequential fetches" },
  { name: "REFRESH", def: "0", note: "1 = ignore on-disk caches and re-fetch" },
]);
const FROM_Y = Number(K.FROM_Y), TO_Y = Number(K.TO_Y), SLEEP = Number(K.SLEEP_MS);
const DEAL = Number(K.DEAL_PCT) / 100, EXITP = Number(K.EXIT_PCT) / 100, EXT_M = Number(K.EXT_M);
const RT = Number(K.RT_BP) / 10000;
const REFRESH = K.REFRESH === "1";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "spac", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// STRICT READS on the owned DB: a failed read must RAISE, never return [] that reads as "the market has none"
// (plumbing RULE 6). Third-party fetches (EDGAR) keep their own retry/report handling below.
const { q } = mkStrictRead(OWNED, hdr);

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const ymOf = (d: string) => d.slice(0, 7);
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const qtl = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
const med = (a: number[]) => qtl(a, 0.5);
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";

const readCache = async <T>(p: string, fb: T): Promise<T> => { if (REFRESH) return fb; try { return JSON.parse(await Deno.readTextFile(p)) as T; } catch { return fb; } };
const writeCache = async (p: string, v: unknown) => { await Deno.writeTextFile(p, JSON.stringify(v)); };

// ═════════════════════════════════════════════════════════════════════════════
// (1) IDENTIFY — 424B4 prospectuses containing "blank check"
// ═════════════════════════════════════════════════════════════════════════════
interface Filing { adsh: string; doc: string; cik: string; date: string; name: string }
const IDX = "data/spac-424b4-index.json";
let filings = await readCache<Filing[]>(IDX, []);

console.log(`==> PRE-DEAL SPAC TRUST ARBITRAGE — EDGAR 424B4 "blank check", ${FROM_Y}-${TO_Y}`);
if (filings.length) {
  console.log(`    blank-check 424B4 index loaded from cache: ${filings.length.toLocaleString()} filings (REFRESH=1 to re-fetch)`);
} else {
  const QS: [string, string][] = [];
  for (let y = FROM_Y; y <= TO_Y; y++) QS.push([`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]);
  const failed: string[] = []; let saturated = 0; const byY = new Map<number, number>();
  for (const [start, end] of QS) {
    let total = -1, from = 0, got = 0;
    while (true) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"blank check"')}&forms=424B4&startdt=${start}&enddt=${end}&from=${from}`;
      let j: { hits?: { total?: { value: number }; hits?: { _id: string; _source: { ciks: string[]; display_names: string[]; file_date: string; adsh: string } }[] } } | null = null;
      let lastErr = "";
      for (let a = 0; a < 4 && !j; a++) {
        if (a) await sleep(SLEEP * (2 ** a) + 400);
        try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; } j = await r.json(); }
        catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP.
      if (!j) { failed.push(`${start}..${end} (${lastErr})`); break; }
      const hits = j?.hits?.hits ?? [];
      if (total < 0) total = j?.hits?.total?.value ?? 0;
      if (!hits.length) break;
      for (const h of hits) {
        const s = h._source;
        filings.push({ adsh: s.adsh, doc: String(h._id).split(":")[1] ?? "", cik: (s.ciks?.[0] ?? "").replace(/\D/g, ""), date: s.file_date, name: s.display_names?.[0] ?? "" });
      }
      got += hits.length; from += hits.length;
      if (from >= 9900 && got < total) { saturated++; console.log(`    ${start} WINDOW SATURATED at ${from} of ${total} — PARTIAL coverage`); break; }
      if (got >= total) break;
      await sleep(SLEEP);
    }
    byY.set(Number(start.slice(0, 4)), (byY.get(Number(start.slice(0, 4))) ?? 0) + Math.max(0, total));
    await sleep(SLEEP);
  }
  console.log(`    blank-check 424B4 hits per year:`);
  for (const y of [...byY.keys()].sort()) console.log(`      ${y}  ${String(byY.get(y)).padStart(5)}`);
  if (saturated) console.log(`    !! ${saturated} window(s) SATURATED — PARTIAL.`);
  if (failed.length) console.log(`    !! COVERAGE INCOMPLETE — ${failed.length} window(s) unfetchable: ${failed.join("; ")}`);
  await writeCache(IDX, filings);
}
assertNonEmpty("blank-check 424B4 filings", filings, 300);

// one IPO per registrant: the EARLIEST blank-check 424B4 per CIK (a later one is an over-allotment/second deal)
const firstByCik = new Map<string, Filing>();
for (const x of [...filings].sort((a, b) => a.date < b.date ? -1 : 1)) if (!firstByCik.has(x.cik)) firstByCik.set(x.cik, x);
console.log(`    ${filings.length.toLocaleString()} filings -> ${firstByCik.size.toLocaleString()} distinct blank-check registrants`);

// ═════════════════════════════════════════════════════════════════════════════
// (2) PARSE the prospectus: trust per unit, unit offer price, deadline months, listing symbols
// ═════════════════════════════════════════════════════════════════════════════
// THE "blank check" PHRASE IS NOISY AND THAT WAS MEASURED, NOT ASSUMED. EDGAR full-text matches "blank check
// PREFERRED STOCK" — a boilerplate charter provision in ordinary operating-company prospectuses — so 90 of the
// first 175 hits were names like JELD-WEN, AnaptysBio and Univar. The discriminant is therefore the phrase
// "blank check company" (how a SPAC describes ITSELF) plus a trust account plus a business combination, and the
// trust value must additionally be VOTED for by at least TVOTE_MIN separate mentions.
interface Pros { spac: boolean; bcc: boolean; trust: number | null; tVotes: number; offer: number | null; months: number | null; syms: string[] }
const TVOTE_MIN = 5;
const PPATH = "data/spac-prospectus.json";
const pCache = await readCache<Record<string, Pros>>(PPATH, {});

const parsePros = (raw: string): Pros => {
  const t = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/gi, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
  const low = t.toLowerCase();
  const bcc = /blank[- ]check (?:company|companies)/.test(low) || /we are a blank[- ]check/.test(low);

  // TRUST PER SHARE/UNIT: the prospectus says "$10.00 per Unit" (or per public share) within a sentence about the
  // trust account. Collect every such number within a +/-400 char window of a "trust account" mention and take the
  // MODE — the number the document repeats, which is the trust figure, rather than the first number encountered.
  const votes = new Map<number, number>();
  let i = -1;
  while ((i = low.indexOf("trust account", i + 1)) >= 0) {
    const win = t.slice(Math.max(0, i - 400), i + 400);
    for (const m of win.matchAll(/\$\s?(\d{1,2}\.\d{2})\s*(?:per|for each)\s*(?:public\s+)?(?:unit|share|ordinary share|class a)/gi)) {
      const v = Number(m[1]); if (v >= 9.5 && v <= 30) votes.set(v, (votes.get(v) ?? 0) + 1);
    }
  }
  let trust: number | null = null, best = 0;
  for (const [v, c] of votes) if (c > best) { best = c; trust = v; }
  const spac = bcc && low.includes("trust account") && low.includes("business combination") && best >= TVOTE_MIN;

  // UNIT OFFER PRICE — "$10.00 per Unit" on the cover / "public offering price"
  // take the FIRST match in a plausible range: the underwriting discount is also quoted "per Unit" ($0.35), and
  // taking match[0] blindly returned that.
  let offer: number | null = null;
  for (const m of t.matchAll(/\$\s?(\d{1,2}\.\d{2})\s*per\s*(?:unit|Unit)/g)) { const v = Number(m[1]); if (v >= 5 && v <= 30) { offer = v; break; } }

  // DEADLINE — "within 24 months of the closing of this offering". The window MUST name the OFFERING, not just
  // "the closing": an unqualified "(\d+) months from the closing" also matches lock-up and warrant language, and on
  // CCIV that made 12 the mode where the charter deadline is 24. Take the MODE of the qualified matches.
  const mv = new Map<number, number>();
  for (const m of low.matchAll(/(\d{1,2})\s*months\s*(?:from|of|after|following)\s*(?:the\s*)?(?:closing|consummation|completion)\s*(?:of)?\s*(?:the|this)?\s*(?:initial public )?offering/g)) {
    const v = Number(m[1]); if (v >= 9 && v <= 36) mv.set(v, (mv.get(v) ?? 0) + 1);
  }
  let months: number | null = null, mb = 0;
  for (const [v, c] of mv) if (c > mb) { mb = c; months = v; }

  // LISTING SYMBOLS — 'under the symbol "XYZU"' / 'under the symbols "XYZ" and "XYZ WS"'
  const syms = new Set<string>();
  for (const m of t.matchAll(/under the symbols?\s*[:"']?\s*"?([A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,2})?)"?/g)) syms.add(m[1]);
  return { spac, bcc, trust, tVotes: best, offer, months, syms: [...syms] };
};

const cands = [...firstByCik.values()];
let pf = 0, pnew = 0; const t0 = Date.now();
for (const fl of cands) {
  if (fl.adsh in pCache && pCache[fl.adsh]?.bcc !== undefined) continue;   // re-fetch entries cached before the discriminant was tightened
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(fl.cik)}/${fl.adsh.replace(/-/g, "")}/${fl.doc}`;
  let p: Pros = { spac: false, bcc: false, trust: null, tVotes: 0, offer: null, months: null, syms: [] };
  try { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (r.ok) p = parsePros(await r.text()); } catch { /* recorded as a non-SPAC below; counted */ }
  pCache[fl.adsh] = p; pnew++;
  if (!p.spac) pf++;
  if (pnew % 25 === 0) { console.log(`    fetched ${pnew}/${cands.length} prospectuses (${pf} not confirmed blank-check) ${f((Date.now() - t0) / pnew / 1000, 2)}s/doc`); await writeCache(PPATH, pCache); }
  await sleep(SLEEP);
}
if (pnew) await writeCache(PPATH, pCache);

const spacs = cands.filter((c) => pCache[c.adsh]?.spac && pCache[c.adsh]?.trust != null);
console.log(`    ${cands.length} registrants -> ${cands.filter((c) => pCache[c.adsh]?.bcc).length} say "blank check company" -> ${cands.filter((c) => pCache[c.adsh]?.spac).length} confirmed SPAC (trust voted >=${TVOTE_MIN}x) -> ${spacs.length} with a trust value`);

// ═════════════════════════════════════════════════════════════════════════════
// (3) RESOLVE THE COMMONS TICKER against the panel
// ═════════════════════════════════════════════════════════════════════════════
// SPAC display_names carry no ticker and data.sec.gov/submissions returns the POST-MERGER ticker for a CIK that
// de-SPAC'd (CCIV -> LCID), whose panel series is retroactively split-adjusted (LCID's 2020 bars print ~$98 after
// its 2025 1:10 reverse split). Using it would compare a $10 trust to a $98 "price". So the ticker is taken from
// the PROSPECTUS ITSELF (contemporaneous), with the submissions ticker only as a last resort, and every candidate
// must pass a SCALE CHECK against its own stated trust before it is accepted.
type Bar = number[];
const barCache = new Map<string, Bar[]>();
const barsOf = async (sym: string): Promise<Bar[]> => {
  if (barCache.has(sym)) return barCache.get(sym)!;
  const r = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars?: Bar[] }[];
  const b = (r?.[0]?.bars || []).filter((x: Bar) => x[4] > 0);
  barCache.set(sym, b); return b;
};

interface SP { cik: string; adsh: string; name: string; fdate: string; ticker: string; trust: number; offer: number; months: number; d0: string; bars: Bar[]; symSrc: string }
const universe: SP[] = [];
let noTicker = 0, noBars = 0, notInception = 0, badScale = 0;
for (const fl of spacs) {
  const p = pCache[fl.adsh];
  const base = new Set<string>();
  for (const s of p.syms) {
    const c = s.replace(/\./g, "");
    if (!/^[A-Z]{2,6}$/.test(c)) continue;
    base.add(c);
    if (c.length >= 4 && /[UW]$/.test(c)) base.add(c.slice(0, -1));   // XYZU units / XYZW warrants -> XYZ commons
    if (c.length >= 5 && /WS$/.test(c)) base.add(c.slice(0, -2));
  }
  // THE data.sec.gov/submissions FALLBACK IS REMOVED, AND THAT REMOVAL IS THE POINT. A merged SPAC's CIK resolves
  // today to the POST-merger ticker, so the fallback silently substituted the operating company for the SPAC: 37 of
  // 655 names came in that way, and they are exactly the rows that produced "sub-trust SPAC" positions like EVLV
  // (Evolv Technologies, the de-SPAC of NewHold Investment) bought at $8.13 and held to $2.20. A SPAC with no
  // symbol in its own prospectus is DROPPED — a coverage cost, counted below, and far cheaper than the alternative.
  if (!base.size) { noTicker++; continue; }
  const trust = p.trust!, offer = p.offer ?? trust, months = p.months ?? 24;
  let chosen: { tk: string; b: Bar[] } | null = null; let sawBars = false, sawIncept = false;
  for (const tk of [...base].sort((a, b) => a.length - b.length)) {
    const b = await barsOf(tk);
    if (b.length < 10) continue;
    sawBars = true;
    const first = iso(b[0][0]);
    // INCEPTION TEST: SPAC COMMONS begin trading ~45-60 days AFTER the unit IPO (units separate into shares and
    // warrants). The window is therefore wide on the right and tight on the left.
    if (!(first >= addDays(fl.date, -10) && first <= addDays(fl.date, 200))) continue;
    sawIncept = true;
    // SCALE CHECK: a SPAC common trades at the trust value. A series whose first-30-bar median is not within
    // [0.55x, 1.8x] of the stated trust is a DIFFERENT INSTRUMENT (units, or a retro-split-adjusted successor).
    const m30 = med(b.slice(0, 30).map((x) => x[4]));
    if (!(m30 >= 0.55 * trust && m30 <= 1.8 * trust)) continue;
    chosen = { tk, b }; break;
  }
  if (!chosen) { if (!sawBars) noBars++; else if (!sawIncept) notInception++; else badScale++; continue; }
  universe.push({ cik: fl.cik, adsh: fl.adsh, name: fl.name, fdate: fl.date, ticker: chosen.tk, trust, offer, months, d0: iso(chosen.b[0][0]), bars: chosen.b, symSrc: p.syms.length ? "prospectus" : "submissions" });
}
console.log(`    ticker+panel resolution: ${universe.length} SPACs usable  (${noTicker} no symbol parsed, ${noBars} no panel series, ${notInception} series not at inception, ${badScale} failed the trust-scale check)`);
assertNonEmpty("resolved SPAC commons series", universe, 100);

// ── COVERAGE + POSITIVE CONTROL (THE POSITIVE-CONTROL RULE, D-641) ──────────
const byYear = new Map<number, number>();
for (const s of spacs) byYear.set(Number(s.date.slice(0, 4)), (byYear.get(Number(s.date.slice(0, 4))) ?? 0) + 1);
const boom = (byYear.get(2020) ?? 0) + (byYear.get(2021) ?? 0);
console.log(`\n==> COVERAGE STATEMENT`);
console.log(`    blank-check 424B4 registrants with a parsed trust, by IPO year:`);
for (const y of [...byYear.keys()].sort()) console.log(`      ${y}  ${String(byYear.get(y)).padStart(4)}  (usable with panel bars: ${universe.filter((u) => u.fdate.startsWith(String(y))).length})`);
console.log(`    span ${universe.map((u) => u.d0).sort()[0]} .. ${universe.map((u) => u.bars[u.bars.length - 1][0]).sort((a, b) => a - b).map(iso).slice(-1)[0]}`);
console.log(`    required inputs: 424B4 index YES | trust value ${spacs.length}/${cands.filter((c) => pCache[c.adsh]?.spac).length} parsed | commons bars ${universe.length} | ust_3m benchmark YES`);
console.log(`\n    POSITIVE CONTROL:`);
console.log(`      2020-21 SPAC IPOs identified: ${boom}  (floor 300)  ${boom >= 300 ? "OK" : "FAIL"}`);
for (const [tk, wantTrust] of [["CCIV", 10.00], ["PSTH", 20.00]] as [string, number][]) {
  const u = universe.find((x) => x.ticker === tk);
  const inSpacs = spacs.find((s) => (pCache[s.adsh].syms.join(" ")).includes(tk));
  console.log(`      ${tk.padEnd(5)} expect trust $${wantTrust.toFixed(2)}  ${u ? `got $${u.trust.toFixed(2)} [${u.d0}, ${u.bars.length} bars] ${Math.abs(u.trust - wantTrust) < 0.011 ? "OK" : "TRUST MISMATCH"}` : inSpacs ? "identified but no usable panel series" : "MISSING"}`);
}
if (boom < 300) console.error(`!! POSITIVE CONTROL RED — fewer than 300 SPAC IPOs found in the 2020-21 boom. Every number below would be about the SEARCH, not the market.`);

// ═════════════════════════════════════════════════════════════════════════════
// (4) THE TRUST PATH — trust value accretes at the bill rate
// ═════════════════════════════════════════════════════════════════════════════
// ASSUMPTION, STATED: the trust is invested in <=185-day T-bills, so trust_t = trust_0 * exp(int ust_3m dt). Real
// trusts pay tax and (in some charters) permit withdrawal of interest for working capital, so this OVERSTATES the
// redemption value slightly — which makes every discount below CONSERVATIVE (a real discount is a touch larger).
const billRows = (await q(`trd_macro_series?series=eq.ust_3m&select=d,v&order=d.asc`)) as { d: string; v: number }[];
assertNonEmpty("ust_3m bill series", billRows, 1000);
const billD = billRows.map((r) => r.d), billV = billRows.map((r) => r.v / 100);
const billAt = (d: string) => { let lo = 0, hi = billD.length - 1, ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (billD[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return billV[ans]; };
// cumulative log-growth factor of $1 rolled at the bill, by date index
const cum = new Map<string, number>(); { let c = 0; for (let i = 0; i < billD.length; i++) { if (i) c += billV[i - 1] * dayDiff(billD[i - 1], billD[i]) / 365; cum.set(billD[i], c); } }
const cumAt = (d: string) => { let lo = 0, hi = billD.length - 1, ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (billD[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return cum.get(billD[ans]) ?? 0; };

// ═════════════════════════════════════════════════════════════════════════════
// (5) WHERE THE PRE-DEAL LIFE ENDS — and why the de-SPAC completion table could not supply it
// ═════════════════════════════════════════════════════════════════════════════
// THE OBVIOUS SOURCE WAS TRIED FIRST AND FAILED ITS OWN POSITIVE CONTROL. trd_raw_filings carries 3,941 rows typed
// "8-K|despac" (the D-734 ingest) across 1,276 CIKs, and joining them on the SPAC's CIK looked like the exact fix
// for the price-proxy approximation. It is not: the earliest such row for Churchill Capital IV is 2020-08-04, its
// IPO-CLOSING 8-K, not the 2021-07-23 Lucid merger; Pershing Square Tontine — which NEVER completed a combination
// and liquidated — carries one dated 2020-07-28. Using those dates truncated 647 of 703 series to nothing. The
// classifier is catching business-combination LANGUAGE, which every SPAC 8-K contains from the day it lists.
// REPORTED, NOT WORKED AROUND SILENTLY: this also bears on despac-event.ts (D-734), which reads the same rows as
// completion dates. That is outside this script's scope and is flagged, not fixed here.
{
  const despacRows = (await q(`trd_raw_filings?filing_type=like.%25despac%25&select=disclosed_date,raw&order=disclosed_date.asc&limit=20000`)) as { disclosed_date: string; raw: { cik?: string } }[];
  const byCik = new Map<string, string>();
  for (const r of despacRows) { const c = (r.raw?.cik ?? "").replace(/^0+/, ""); if (!c || !r.disclosed_date) continue; const cur = byCik.get(c); if (!cur || r.disclosed_date < cur) byCik.set(c, r.disclosed_date); }
  // POSITIVE CONTROL (D-641): CCIV completed 2021-07-23 and PSTH never completed at all.
  const cc = byCik.get("1811210"), ps = byCik.get("1811882");
  console.log(`\n    DE-SPAC COMPLETION TABLE — REJECTED AS A COMPLETION SOURCE, by its own positive control:`);
  console.log(`      ${despacRows.length.toLocaleString()} "8-K|despac" rows over ${byCik.size.toLocaleString()} CIKs. CCIV (merged 2021-07-23): earliest row ${cc ?? "none"}.`);
  console.log(`      PSTH (never merged; liquidated): earliest row ${ps ?? "none"}. Both wrong, so the table is NOT used below.`);
  const before = universe.filter((u) => { const d = byCik.get(u.cik.replace(/^0+/, "")); return d && u.bars.length && iso(u.bars[0][0]) >= d; }).length;
  console.log(`      ${before} of ${universe.length} series would have been truncated to zero length by it.`);
}
// WHAT IS USED INSTEAD — two boundaries, both structural, both stated:
//  (a) THE SYMBOL ITSELF. The ticker comes from the SPAC's own prospectus, and the panel's series under that symbol
//      ENDS when the symbol changes at the merger or is delisted at liquidation. That is a real boundary requiring
//      no external table, and it is why removing the submissions fallback (above) was the substantive fix.
//  (b) AN IDENTITY FLOOR. A pre-deal SPAC common CANNOT trade at half its trust value — the redemption right is
//      contractual and a segregated trust backs it. A series that does is a post-merger company or a data error,
//      not a trust claim. The series is cut at the first bar below IDENT_FLOOR x trust. This is an INSTRUMENT
//      IDENTIFICATION rule, not a return filter, and the data it removes is counted so the reader can judge it.
const IDENT_FLOOR = 0.5;
let identCut = 0, identBars = 0;
for (const u of universe) {
  const c0 = cumAt(u.fdate);
  const bad = u.bars.findIndex((b) => b[4] < IDENT_FLOOR * u.trust * Math.exp(cumAt(iso(b[0])) - c0));
  if (bad >= 0) { identCut++; identBars += u.bars.length - bad; u.bars = u.bars.slice(0, bad); }
}
const truncated = universe.filter((u) => u.bars.length >= 10);
console.log(`    IDENTITY FLOOR (${IDENT_FLOOR}x trust): ${identCut} of ${universe.length} series cut, removing ${identBars.toLocaleString()} bars; ${truncated.length} SPACs retain >=10 bars.`);
const withCompletion = truncated;   // every retained series ends at its own symbol's last bar
// (6) THE SPAC-MONTH PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface MRow { ticker: string; month: string; d: string; px: number; trustNow: number; disc: number; annYTD: number; preDeal: boolean; proxyOnly: boolean; dollarVol: number; deadline: string; bill: number }
const rows: MRow[] = [];
const dealMonth = new Map<string, string>();
interface MPt { d: string; i: number; px: number; trustNow: number }
const perSpac: { u: SP; ms: MPt[]; deadline: string; hasCompletion: boolean }[] = [];
for (const u of truncated) {
  const dts = u.bars.map((b) => iso(b[0]));
  const deadline = addMonths(u.d0, u.months + EXT_M);
  const c0 = cumAt(u.fdate);
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < dts.length; i++) lastIdx.set(ymOf(dts[i]), i);
  const ms: MPt[] = [];
  for (const [m, i] of [...lastIdx.entries()].sort()) {
    const d = dts[i], px = u.bars[i][4];
    const trustNow = u.trust * Math.exp(cumAt(d) - c0);
    ms.push({ d, i, px, trustNow });
    if (px > trustNow * (1 + DEAL) && !dealMonth.has(u.ticker)) dealMonth.set(u.ticker, m);
  }
  const hasCompletion = true;   // the boundary is the symbol's own last bar, present for every retained series
  perSpac.push({ u, ms, deadline, hasCompletion });
  const dm = dealMonth.get(u.ticker);
  for (const r of ms) {
    const m = ymOf(r.d);
    const yrs = Math.max(1 / 12, dayDiff(r.d, deadline) / 365);
    const trustAtDl = r.trustNow * Math.exp(billAt(r.d) * yrs);
    // ADV: the MEAN of trailing 21 daily dollar volumes. The MEDIAN was $0 because a SPAC common has many
    // zero-volume days — a real property of the instrument that the median converts into a useless statistic.
    const win = u.bars.slice(Math.max(0, r.i - 20), r.i + 1);
    rows.push({
      ticker: u.ticker, month: m, d: r.d, px: r.px, trustNow: r.trustNow, disc: r.px / r.trustNow - 1,
      annYTD: Math.pow(trustAtDl / r.px, 1 / yrs) - 1, preDeal: !dm || m < dm, proxyOnly: !hasCompletion,
      dollarVol: mean(win.map((b) => b[4] * b[5])), deadline, bill: billAt(r.d),
    });
  }
}
assertNonEmpty("SPAC-month panel", rows, 1000);

await writeCache("data/spac-universe.json", {
  built: new Date().toISOString(), span: `${FROM_Y}-${TO_Y}`, source: 'EDGAR full-text 424B4 q="blank check", confirmed by "blank check company" + trust account + business combination + trust value voted >=5x',
  registrants_blank_check_phrase: cands.length, say_blank_check_company: cands.filter((c) => pCache[c.adsh]?.bcc).length,
  confirmed_spac: cands.filter((c) => pCache[c.adsh]?.spac).length, usable_with_bars: universe.length,
  identity_floor_cuts: identCut, after_identity_cut: truncated.length, spac_months: rows.length,
  coverage_note: "Identification is 424B4-based; a SPAC that never filed a 424B4 carrying these phrases, or whose COMMONS never entered the panel, is absent. The ticker is taken ONLY from the SPAC's own prospectus: data.sec.gov/submissions resolves a merged SPAC's CIK to the POST-merger ticker, whose panel series is the operating company and is retroactively split-adjusted, and using it as a fallback put de-SPACs (EVLV, CIFR) into the sub-trust book. The de-SPAC completion table (trd_raw_filings 8-K|despac) was tried as a pre-deal boundary and REJECTED - it dates CCIV at its IPO-closing 8-K and gives PSTH, which never merged, a completion date. The boundary used instead is the SPAC symbol's own last bar plus a 0.5x-trust identity floor. Pre-2020 SPACs are absent because the panel's delisted backfill begins ~2020, not because they did not exist.",
  spacs: truncated.map((u) => ({ ticker: u.ticker, cik: u.cik, name: u.name, ipo_424b4: u.fdate, commons_first_bar: u.d0, trust_per_share: u.trust, unit_offer: u.offer, deadline_months: u.months, ext_assumed_months: EXT_M, charter_deadline: addMonths(u.d0, u.months + EXT_M), last_pre_deal_bar: iso(u.bars[u.bars.length - 1][0]), n_bars: u.bars.length, symbol_source: u.symSrc })),
});
console.log(`    wrote data/spac-universe.json (${truncated.length} SPACs, ${rows.length.toLocaleString()} SPAC-months)`);

// ═════════════════════════════════════════════════════════════════════════════
// (7) THE DISCOUNT DISTRIBUTION — by year (2022 is the control: the discount year)
// ═════════════════════════════════════════════════════════════════════════════
const pre = rows.filter((r) => r.preDeal);
console.log(`\n==> DISCOUNT / PREMIUM TO TRUST — pre-deal SPAC-months (n=${pre.length.toLocaleString()} of ${rows.length.toLocaleString()})`);
console.log(`    year   n    breadth  p10      p25      median   p75      p90     %below  medAnnYTD   bill`);
for (const y of [...new Set(pre.map((r) => r.month.slice(0, 4)))].sort()) {
  const s = pre.filter((r) => r.month.startsWith(y));
  const d = s.map((r) => r.disc * 100);
  const nm = [...new Set(s.map((r) => r.month))].length;
  const below = s.filter((r) => r.disc < 0);
  console.log(`    ${y}  ${String(s.length).padStart(5)}  ${String(Math.round(s.length / Math.max(1, nm))).padStart(5)}  ${f(qtl(d, .1)).padStart(7)}% ${f(qtl(d, .25)).padStart(7)}% ${f(med(d)).padStart(7)}% ${f(qtl(d, .75)).padStart(7)}% ${f(qtl(d, .9)).padStart(7)}%  ${f(100 * below.length / s.length, 1).padStart(5)}%  ${f(100 * med(below.map((r) => r.annYTD)), 2).padStart(7)}%  ${f(100 * mean(s.map((r) => r.bill)), 2).padStart(5)}%`);
}
console.log(`    "breadth" = mean SPACs alive per month that year (THE BREADTH LAW: a month of few names is few names).`);
console.log(`    medAnnYTD is the annualised yield-to-deadline on the BELOW-TRUST months only, against the bill beside it.`);

// ═════════════════════════════════════════════════════════════════════════════
// (8) THE RULE — buy every pre-deal SPAC below trust at month-end
// ═════════════════════════════════════════════════════════════════════════════
// EXITS, and the mechanic each one models:
//   · close > trust+EXIT_PCT%  — the market has repriced the option; the cash-like trade is over.
//   · DE-SPAC COMPLETION       — the holder REDEEMS at trust. Proceeds = trustNow, NOT the last market print.
//                                A pessimistic variant using the last market print is reported beside it, because
//                                a holder who MISSES the tender deadline gets the market, not the trust.
//   · LAST BAR                 — liquidation/delisting. Proceeds = the last traded close (conservative: a real
//                                liquidation pays trust, so this UNDERSTATES).
// THE CHARTER DEADLINE IS NOT USED AS A FORCED EXIT, and the first run showed why: it produced 2,244 "deadline"
// exits at a MEDIAN HOLD OF 3 DAYS, because SPAC deadline EXTENSIONS are routine (monthly extension payments were
// standard from 2022) and the modelled charter date is long past by the time many of these entries occur. Forcing
// an exit at a date the real instrument sailed through is a modelling error, not a conservative assumption.
interface Pos { ticker: string; entry: string; exitD: string; entryPx: number; exitVal: number; exitMkt: number; trustExit: number; days: number; ret: number; retMkt: number; ann: number; why: string; dollarVol: number; dealPop: number | null; segs: { m: string; r: number }[] }
const positions: Pos[] = [];
for (const { u, ms, hasCompletion } of perSpac) {
  const dts = u.bars.map((b) => iso(b[0]));
  const dm = dealMonth.get(u.ticker);
  const c0 = cumAt(u.fdate);
  let openUntil = -1;
  for (const r of ms) {
    const m = ymOf(r.d);
    if (dm && m >= dm) break;
    if (r.i <= openUntil) continue;
    if (!(r.px < r.trustNow)) continue;
    let ex = u.bars.length - 1;
    // The series ends at the merger (symbol change) or at liquidation/delisting. In BOTH cases the holder's
    // contractual outcome is the trust, so the terminal exit is valued at trustNow, with the market-print
    // alternative reported beside it for the holder who misses the tender.
    let why = "series end: merger vote or liquidation (redeem at trust)";
    for (let j = r.i + 1; j < u.bars.length; j++) {
      const tj = u.trust * Math.exp(cumAt(dts[j]) - c0);
      if (u.bars[j][4] > tj * (1 + EXITP)) { ex = j; why = `close > trust+${K.EXIT_PCT}%`; break; }
    }
    const trustExit = u.trust * Math.exp(cumAt(dts[ex]) - c0);
    const exitMkt = u.bars[ex][4];
    const exitVal = why.startsWith("series end") ? trustExit : exitMkt;
    const days = Math.max(1, dayDiff(r.d, dts[ex]));
    const ret = exitVal / r.px - 1 - RT, retMkt = exitMkt / r.px - 1 - RT;
    let pop: number | null = null;
    for (let j = r.i + 1; j < u.bars.length; j++) { const tj = u.trust * Math.exp(cumAt(dts[j]) - c0); if (u.bars[j][4] > tj * (1 + DEAL)) { pop = u.bars[j][4] / r.px - 1; break; } }
    // MONTHLY SEGMENTS — the honest book. The first version spread each position's total return evenly over its
    // holding months, which manufactures a smooth series and therefore a fake Sharpe. These are the ACTUAL
    // month-to-month price moves, with the exit value substituted on the final segment and the cost in the first.
    const bounds: number[] = [r.i];
    for (const q of ms) if (q.i > r.i && q.i < ex) bounds.push(q.i);
    bounds.push(ex);
    const segs: { m: string; r: number }[] = [];
    for (let z = 0; z < bounds.length - 1; z++) {
      const a = u.bars[bounds[z]][4], bIdx = bounds[z + 1];
      const bv = bIdx === ex ? exitVal : u.bars[bIdx][4];
      segs.push({ m: ymOf(dts[bIdx]), r: bv / a - 1 - (z === 0 ? RT : 0) });
    }
    positions.push({ ticker: u.ticker, entry: r.d, exitD: dts[ex], entryPx: r.px, exitVal, exitMkt, trustExit, days, ret, retMkt, ann: Math.pow(1 + Math.max(-0.999, ret), 365 / days) - 1, why, dollarVol: mean(u.bars.slice(Math.max(0, r.i - 20), r.i + 1).map((b) => b[4] * b[5])), dealPop: pop, segs });
    openUntil = ex;
    void hasCompletion;
  }
}
assertNonEmpty("sub-trust positions", positions, 30);

const rets = positions.map((p) => p.ret * 100), retsMkt = positions.map((p) => p.retMkt * 100);
const anns = positions.map((p) => p.ann * 100);
console.log(`\n==> THE RULE — buy every pre-deal SPAC trading BELOW trust at month-end; hold to the earlier of`);
console.log(`    close>trust+${K.EXIT_PCT}%, or the series end (merger vote / liquidation, REDEEMED at trust). Net of ${K.RT_BP}bp round trip.`);
console.log(`    PRIOR (SIGN LAW): a below-trust entry redeemed at trust should return POSITIVE.`);
console.log(`    N positions ${positions.length}  across ${new Set(positions.map((p) => p.ticker)).size} distinct SPACs  |  median hold ${f(med(positions.map((p) => p.days)), 0)} days  |  mean hold ${f(mean(positions.map((p) => p.days)), 0)} days`);
console.log(`    per-position return, REDEMPTION assumed   mean ${f(mean(rets))}%  median ${f(med(rets))}%  t ${f(tstat(rets))}  pos ${f(100 * rets.filter((x) => x > 0).length / rets.length, 1)}%`);
console.log(`    per-position return, MARKET exit (missed the tender)  mean ${f(mean(retsMkt))}%  median ${f(med(retsMkt))}%  t ${f(tstat(retsMkt))}  pos ${f(100 * retsMkt.filter((x) => x > 0).length / retsMkt.length, 1)}%`);
// THE CASH COMPARISON DONE PER POSITION, which is the apples-to-apples one: each position's annualised return
// against the BILL OVER ITS OWN HOLDING WINDOW. This is the number a holder of this instrument actually receives;
// the monthly-rebalanced book below is a different and much larger number, and section (9) says why.
// THE BILL OVER EACH POSITION'S OWN WINDOW, both raw and annualised. The RAW excess is the well-behaved
// statistic and it carries the t; the ANNUALISED one is reported as a median and quartiles ONLY, because
// annualising a short hold is exactly the operation that produced a 4e150 in the first run of this script and
// it does the same thing to a mean of annualised excesses. A number that explodes is not made safe by relabelling.
const posBillRaw = positions.map((p) => (Math.exp(cumAt(p.exitD) - cumAt(p.entry)) - 1) * 100);
const posBill = positions.map((p, i) => (Math.pow(1 + posBillRaw[i] / 100, 365 / p.days) - 1) * 100);
const annEx = anns.map((x, i) => x - posBill[i]);
const rawEx = rets.map((x, i) => x - posBillRaw[i]);
console.log(`    ANNUALISED per position: median ${f(med(anns))}%  p25 ${f(qtl(anns, .25))}%  p75 ${f(qtl(anns, .75))}%`);
console.log(`    ANNUALISED EXCESS over the bill during the SAME holding window (the honest cash comparison):`);
console.log(`      RAW excess over the hold (carries the t): mean ${f(mean(rawEx))}%  median ${f(med(rawEx))}%  t ${f(tstat(rawEx))}  positive ${f(100 * rawEx.filter((x) => x > 0).length / rawEx.length, 1)}%`);
console.log(`      ANNUALISED excess: median ${f(med(annEx))}%/yr  p25 ${f(qtl(annEx, .25))}%/yr  p75 ${f(qtl(annEx, .75))}%/yr  (bill over those windows: median ${f(med(posBill))}%/yr)`);
console.log(`      NO MEAN OF THE ANNUALISED EXCESS IS PRINTED: annualising a 1-day hold blows up, and a mean over such`);
console.log(`      terms is the same 4e150 defect this script already caught once, wearing a different label.`);
console.log(`    OUTCOME vs PRIOR: ${med(rets) > 0 && tstat(rets) > 2 ? "MATCHED" : "MISSED"} (median ${f(med(rets))}%, t ${f(tstat(rets))})`);
const byWhy = new Map<string, number>(); for (const p of positions) byWhy.set(p.why, (byWhy.get(p.why) ?? 0) + 1);
for (const [w, c] of [...byWhy.entries()].sort((a, b) => b[1] - a[1])) {
  const sub = positions.filter((p) => p.why === w);
  console.log(`      exit "${w}": n=${c}  mean ${f(mean(sub.map((p) => p.ret * 100)))}%  median ${f(med(sub.map((p) => p.ret * 100)))}%  median hold ${f(med(sub.map((p) => p.days)), 0)}d`);
}
const worst = [...positions].sort((a, b) => a.ret - b.ret).slice(0, 8);
const failed = positions.filter((p) => p.exitVal < p.trustExit * 0.9);
console.log(`\n    WORST OUTCOMES (a SPAC that failed to return trust would appear here):`);
for (const p of worst) console.log(`      ${p.ticker.padEnd(6)} ${p.entry} -> ${p.exitD}  $${f(p.entryPx)} -> $${f(p.exitVal)} (trust $${f(p.trustExit)})  ${f(p.ret * 100)}%  [${p.why}]`);
console.log(`    positions exiting >10% BELOW trust: ${failed.length} of ${positions.length} (${f(100 * failed.length / positions.length, 1)}%)`);
console.log(`      A true failure-to-return-trust is rare BY CONSTRUCTION — the trust is a segregated account and the`);
console.log(`      redemption right is contractual — and this count is NOT independent evidence of that, because the`);
console.log(`      terminal exit here is VALUED AT TRUST by assumption. What the count does show is that no position`);
console.log(`      reached its terminal exit from a price far below trust. We hold no liquidation-proceeds data, so`);
console.log(`      "no failures" is UNTESTED on the proceeds themselves (COVERAGE LAW), not measured as zero.`);

// CAPACITY + TURNOVER
const dv = positions.map((p) => p.dollarVol);
const liqCut = qtl(dv, 2 / 3);
console.log(`\n    CAPACITY (THE LIQUIDITY LAW): MEAN trailing-21d dollar volume at entry — median across positions $${f(med(dv), 0)}/day`);
console.log(`      p25 $${f(qtl(dv, .25), 0)}  p75 $${f(qtl(dv, .75), 0)}  p90 $${f(qtl(dv, .9), 0)}. At 10% of ADV a position is ~$${f(med(dv) * 0.1, 0)}.`);
console.log(`      (The MEDIAN daily volume is $0 for many of these names — a real property of a pre-deal SPAC common,`);
console.log(`       which is why the mean is used here and why the capacity conclusion is what it is.)`);
const liq = positions.filter((p) => p.dollarVol >= liqCut);
console.log(`      LIQUID TERCILE (ADV >= $${f(liqCut, 0)}/day): n=${liq.length}  mean ${f(mean(liq.map((p) => p.ret * 100)))}%  median ${f(med(liq.map((p) => p.ret * 100)))}%  t ${f(tstat(liq.map((p) => p.ret * 100)))}`);
console.log(`    TURNOVER (THE TURNOVER LAW): an EVENT position, ONE round trip of ${K.RT_BP}bp, already charged. Median hold`);
console.log(`      ${f(med(positions.map((p) => p.days)), 0)} days => ${f(365 / med(positions.map((p) => p.days)), 2)} round trips/yr per name if continuously recycled = ${f(365 / med(positions.map((p) => p.days)) * Number(K.RT_BP) / 100, 2)}%/yr of drag.`);

// ═════════════════════════════════════════════════════════════════════════════
// (9) THE BENCHMARK — a cash-like instrument is judged against CASH
// ═════════════════════════════════════════════════════════════════════════════
const segByMonth = new Map<string, number[]>();
for (const p of positions) for (const s of p.segs) (segByMonth.get(s.m) ?? segByMonth.set(s.m, []).get(s.m)!).push(s.r);
const bookMonths = [...segByMonth.keys()].sort();
const br = bookMonths.map((m) => mean(segByMonth.get(m)!));
const bb = bookMonths.map((m) => billAt(`${m}-28`) / 12);
const exc = br.map((x, i) => x - bb[i]);
const annOf = (a: number[]) => (Math.pow(a.reduce((x, y) => x * (1 + y), 1), 12 / a.length) - 1) * 100;
console.log(`\n==> BENCHMARK (THE BENCHMARK LAW) — a cash-like instrument is judged against CASH, not against zero`);
console.log(`    months with an open book: ${bookMonths.length} (${bookMonths[0]} .. ${bookMonths[bookMonths.length - 1]}), mean ${f(mean(bookMonths.map((m) => segByMonth.get(m)!.length)), 1)} positions/month`);
console.log(`    equal-weight book   ${f(annOf(br))}%/yr   vol ${f(sd(br) * Math.sqrt(12) * 100)}%   SR ${f(mean(exc) / (sd(br) || 1e-12) * Math.sqrt(12))}`);
console.log(`    3m T-BILL over the SAME months  ${f(annOf(bb))}%/yr`);
console.log(`    EXCESS over the bill  ${f(annOf(br) - annOf(bb))}%/yr   monthly-excess t ${f(tstat(exc))}   months positive ${f(100 * exc.filter((x) => x > 0).length / exc.length, 1)}%`);
console.log(`      MEDIAN monthly book return ${f(med(br) * 100, 3)}% vs median monthly bill ${f(med(bb) * 100, 3)}%.`);
// THE GEOMETRIC ANNUALISED FIGURE AND THE t DISAGREE, AND THIN MONTHS ARE WHY. A month holding two positions, one
// of which gapped on a deal announcement, enters the equal-weight mean at full weight; that single month can
// dominate an 81-month compounding while contributing one observation to a t computed on 81. The disagreement is
// REPORTED rather than resolved by picking whichever number flatters.
{
  const thick = bookMonths.map((m, i) => ({ n: segByMonth.get(m)!.length, r: br[i], b: bb[i] })).filter((x) => x.n >= 10);
  const tr = thick.map((x) => x.r), tb = thick.map((x) => x.b), te = tr.map((x, i) => x - tb[i]);
  console.log(`      MONTHS BY BREADTH: ${bookMonths.filter((m) => segByMonth.get(m)!.length < 10).length} of ${bookMonths.length} months hold FEWER THAN 10 positions.`);
  console.log(`      Restricted to months with >=10 positions (n=${thick.length}): book ${f(annOf(tr))}%/yr vs bill ${f(annOf(tb))}%/yr,`);
  console.log(`      excess ${f(annOf(tr) - annOf(tb))}%/yr, monthly-excess t ${f(tstat(te))}, vol ${f(sd(tr) * Math.sqrt(12) * 100)}%.`);
  console.log(`      The gap between this and the all-months figure IS the thin-month artifact, stated not smoothed.`);
}
let peak = 1, eq = 1, run = 0, worstRun = 0, ddw = 0;
for (const x of exc) { eq *= 1 + x; if (eq >= peak) { peak = eq; run = 0; } else { run++; worstRun = Math.max(worstRun, run); ddw = Math.min(ddw, eq / peak - 1); } }
// THE BOOK AND THE POSITIONS DISAGREE BY AN ORDER OF MAGNITUDE, AND THE BOOK IS THE OPTIMISTIC ONE. Both
// arithmetics are correct; they measure different instruments. The book takes the EQUAL-WEIGHT ARITHMETIC MEAN
// across ~165 concurrent names each month and COMPOUNDS it, so the minority of names that gap on a deal
// announcement lift every month and monthly rebalancing harvests that dispersion. At a median ADV near $13k/day
// that rebalancing is not executable. The reconciliation is PRINTED rather than resolved by quoting the larger one.
console.log(`    RECONCILIATION — the per-position and book numbers disagree, and the BOOK is the optimistic one:`);
console.log(`      per position, median annualised excess ${f(med(annEx))}%/yr; monthly-rebalanced book, ${f(annOf(br) - annOf(bb))}%/yr.`);
console.log(`      The book equal-weights ~${f(mean(bookMonths.map((m) => segByMonth.get(m)!.length)), 0)} concurrent names monthly and compounds the ARITHMETIC mean, so the few`);
console.log(`      names that gap on an announcement lift every month. At a median ADV of ~$${f(med(dv), 0)}/day that monthly`);
console.log(`      rebalance IS NOT EXECUTABLE. The DEPLOYABLE figure is the per-position one; the book figure is`);
console.log(`      reported because hiding it would be worse, and is labelled rather than promoted.`);
console.log(`    HOLDABILITY (D-565): max drawdown of the excess curve ${f(ddw * 100)}%, longest time underwater ${worstRun} months.`);

// ═════════════════════════════════════════════════════════════════════════════
// (10) UNIVERSE SENSITIVITY (THE UNIVERSE LAW)
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n==> UNIVERSE SENSITIVITY (THE UNIVERSE LAW) — the same rule across defensible definitions`);
const discAt = new Map(rows.map((r) => [`${r.ticker}|${r.d}`, r.disc]));
const variants: [string, (p: Pos) => boolean][] = [
  ["all sub-trust positions", () => true],
  ["discount > 1%", (p) => (discAt.get(`${p.ticker}|${p.entry}`) ?? 0) < -0.01],
  ["discount > 3%", (p) => (discAt.get(`${p.ticker}|${p.entry}`) ?? 0) < -0.03],
  ["liquid tercile (ADV)", (p) => p.dollarVol >= liqCut],
  ["ADV >= $250k/day", (p) => p.dollarVol >= 250_000],
  ["held to series end", (p) => p.why.startsWith("series end")],
  ["2020-21 entries", (p) => p.entry < "2022-01-01"],
  ["2022-23 entries", (p) => p.entry >= "2022-01-01" && p.entry < "2024-01-01"],
  ["2024+ entries", (p) => p.entry >= "2024-01-01"],
];
const bookOf = (sub: Pos[]) => {
  const sm = new Map<string, number[]>();
  for (const p of sub) for (const s of p.segs) (sm.get(s.m) ?? sm.set(s.m, []).get(s.m)!).push(s.r);
  const ks = [...sm.keys()].sort(); if (!ks.length) return NaN;
  return annOf(ks.map((m) => mean(sm.get(m)!))) - annOf(ks.map((m) => billAt(`${m}-28`) / 12));
};
for (const [lab, fn] of variants) {
  const sub = positions.filter(fn);
  if (sub.length < 10) { console.log(`    ${lab.padEnd(26)} n=${sub.length} (too few — UNTESTED, not null)`); continue; }
  const rr = sub.map((p) => p.ret * 100);
  console.log(`    ${lab.padEnd(26)} n=${String(sub.length).padStart(4)}  ret mean ${f(mean(rr)).padStart(7)}%  med ${f(med(rr)).padStart(6)}%  t ${f(tstat(rr)).padStart(6)}  book excess vs bill ${f(bookOf(sub)).padStart(8)}%/yr`);
}
{
  const spread = variants.map(([, fn]) => positions.filter(fn)).filter((s) => s.length >= 10).map((s) => bookOf(s)).filter(Number.isFinite);
  console.log(`    SPREAD across definitions: ${f(Math.min(...spread))}%/yr .. ${f(Math.max(...spread))}%/yr. THE UNIVERSE LAW asks whether the`);
  console.log(`    headline is IDENTIFIED across defensible universes; a spread of this width is the answer, not a footnote.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (11) THE OPTION LEG — DESCRIPTIVE
// ═════════════════════════════════════════════════════════════════════════════
const withPop = positions.filter((p) => p.dealPop != null);
console.log(`\n==> THE OPTION LEG (DESCRIPTIVE ONLY) — of the ${positions.length} below-trust entries, ${withPop.length} (${f(100 * withPop.length / positions.length, 1)}%) later saw`);
console.log(`    a close above trust+${K.DEAL_PCT}% before the series ended (the deal-announcement PROXY).`);
if (withPop.length) {
  const pops = withPop.map((p) => p.dealPop! * 100);
  console.log(`    return from the below-trust entry to that first close: mean ${f(mean(pops))}%  median ${f(med(pops))}%  p90 ${f(qtl(pops, .9))}%  max ${f(Math.max(...pops))}%`);
  console.log(`    This is NOT a return the rule earns — the rule exits at trust+${K.EXIT_PCT}%, far below the announcement print.`);
  console.log(`    It is the size of the option the rule GIVES AWAY, measured. Whether it is capturable is UNTESTED here:`);
  console.log(`    doing so means holding past trust+${K.EXIT_PCT}% and giving up the redemption floor, a different instrument.`);
  for (const y of [...new Set(withPop.map((p) => p.entry.slice(0, 4)))].sort()) {
    const s = withPop.filter((p) => p.entry.startsWith(y)).map((p) => p.dealPop! * 100);
    const n = positions.filter((p) => p.entry.startsWith(y)).length;
    console.log(`      ${y}: ${s.length}/${n} entries reached the proxy (${f(100 * s.length / n, 0)}%), median ${f(med(s))}%`);
  }
}
// ═════════════════════════════════════════════════════════════════════════════
// (11) TRIALS + LIMITS + VERDICT
// ═════════════════════════════════════════════════════════════════════════════
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "spac-trust", runId: `spac|${FROM_Y}-${TO_Y}|${K.DEAL_PCT}|${K.EXIT_PCT}|${EXT_M}|${K.RT_BP}`, spent: 1 + variants.length + 2 });

console.log(`\n==> HONEST LIMITS`);
console.log(`    1. SURVIVORSHIP. A liquidated SPAC's bars end at its last traded print, not at its redemption cheque.`);
console.log(`       Redemption pays trust, so the last traded close UNDERSTATES the realised exit — the rule's return is`);
console.log(`       biased DOWNWARD by this convention, which is the safe direction. Separately, any SPAC whose commons`);
console.log(`       never entered the panel is absent entirely: ${noBars} identified SPACs had no series and ${notInception} had a`);
console.log(`       series that did not start at inception. Those are a DATA hole (COVERAGE LAW), not a market finding.`);
console.log(`    2. THE DEAL APPROXIMATION — STILL OPEN, AND THE OBVIOUS FIX DID NOT WORK. The de-SPAC completion table`);
console.log(`       (trd_raw_filings "8-K|despac", D-734) was tried and REJECTED: it dates CCIV at its IPO-closing 8-K`);
console.log(`       and gives PSTH — which never merged — a completion date. So the end of the pre-deal life rests on`);
console.log(`       two structural facts instead: the SPAC's own symbol stops trading at the merger vote or the`);
console.log(`       liquidation, and an identity floor of ${IDENT_FLOOR}x trust (which cut ${identCut} series). The DEFINITIVE-AGREEMENT`);
console.log(`       ANNOUNCEMENT, months before completion, remains a >trust+${K.DEAL_PCT}% PRICE PROXY, so the pre-deal window`);
console.log(`       still contains post-announcement months for any deal the market did not reprice by ${K.DEAL_PCT}%. The proxy`);
console.log(`       cannot manufacture the announcement pop it is used to detect, but it does widen the discount`);
console.log(`       distribution. Closing it properly needs a definitive-agreement 8-K classifier we do not hold.`);
console.log(`    3. REDEMPTION MECHANICS ARE NOT FREE. Redeeming requires (a) holding through the record date, (b) tendering`);
console.log(`       via the broker before a deadline that is typically 2 BUSINESS DAYS BEFORE the vote and is often missed,`);
console.log(`       (c) in many cases voting. This script measures the MARKET price path, so it never assumes a redemption`);
console.log(`       was executed — but a live implementation that failed to tender would hold a post-deal equity instead,`);
console.log(`       which is the de-SPAC underperformance measured separately in despac-event.ts. UNTESTED here.`);
console.log(`    4. ERA. The trust discount is a FUNDING-CONDITION phenomenon: it widened in 2022 when the bill rate rose`);
console.log(`       and SPAC issuance stopped. The by-year table above is the evidence; the 2024-26 question is answered by`);
console.log(`       the count of live pre-deal SPACs, not by the historical mean.`);
{ const late = rows.filter((r) => r.month >= "2024-01" && r.preDeal); console.log(`       pre-deal SPAC-months 2024-01 onward IN THIS PANEL: ${late.length} (across ${new Set(late.map((r) => r.ticker)).size} names).`);
  console.log(`       NOTE THE PANEL BOUNDARY: the 424B4 search stops at ${TO_Y}, so 2024-26 IPOs are ABSENT BY CONSTRUCTION.`);
  console.log(`       The 2024-26 opportunity is therefore UNTESTED here, not measured as absent (COVERAGE LAW).`); }

console.log(`\n==> VERDICT — DESCRIPTIVE ONLY (MECHANISM LAW: no mechanism claim, no pre-registration, no trd_lineage row)`);
console.log(`    (a) THE DISCOUNT IS REAL AND MEASURED: ${f(100 * pre.filter((r) => r.disc < 0).length / pre.length, 1)}% of ${pre.length.toLocaleString()} pre-deal SPAC-months traded BELOW`);
console.log(`        trust; median pre-deal discount ${f(100 * med(pre.map((r) => r.disc)))}%; median annualised yield-to-deadline on the below-trust`);
console.log(`        months ${f(100 * med(pre.filter((r) => r.disc < 0).map((r) => r.annYTD)))}%. The 2022 row is the control and it behaves as the era says it should.`);
console.log(`    (b) THE DEPLOYABLE NUMBER IS PER POSITION: median ${f(med(anns))}%/yr, a median ${f(med(annEx))}%/yr EXCESS over the bill`);
console.log(`        during the same holding windows (raw excess over the hold: mean ${f(mean(rawEx))}%, t ${f(tstat(rawEx))}, positive ${f(100 * rawEx.filter((x) => x > 0).length / rawEx.length, 1)}% of ${positions.length} in`);
console.log(`        ${new Set(positions.map((p) => p.ticker)).size} names), assuming the redemption is tendered — missing the tender and exiting at the market`);
console.log(`        instead gives per-position mean ${f(mean(retsMkt))}% against ${f(mean(rets))}%. The monthly-rebalanced book prints`);
console.log(`        ${f(annOf(br) - annOf(bb))}%/yr excess (t ${f(tstat(exc))}); that figure assumes rebalancing ~${f(mean(bookMonths.map((m) => segByMonth.get(m)!.length)), 0)} names of ~$${f(med(dv), 0)}/day ADV`);
console.log(`        every month and is NOT executable. It is reported, not promoted.`);
console.log(`    (c) CAPACITY: median ADV $${f(med(dv), 0)}/day at entry. At 10% of ADV that is ~$${f(med(dv) * 0.1, 0)} per name and`);
console.log(`        ~$${f(med(dv) * 0.1 * mean(bookMonths.map((m) => segByMonth.get(m)!.length)), 0)} of book at the mean concurrent position count. A SMALL-ACCOUNT instrument, and`);
console.log(`        that is the honest headline: the constraint here is size, not significance.`);
console.log(`    (d) ${Math.abs(tstat(exc)) < 2 ? "NO significant excess over the bill" : (annOf(br) > annOf(bb) ? "A POSITIVE excess over the bill" : "A NEGATIVE excess over the bill")} on the monthly book (t ${f(tstat(exc))}). Nothing here is promoted: this run`);
console.log(`        is DESCRIPTIVE, the universe spread is reported above, and no lineage row is written.`);
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
