#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// despac-short-net.ts — THE BORROW-COST TEST for the corrected de-SPAC underperformance short (D-734c).
//
// THE QUESTION. despac-event-506.ts re-derived the de-SPAC underperformance on the correct Item 5.06 merger dates:
// 500d excess-vs-IWM, ALL and LIQUID tercile, a strong NEGATIVE (a SHORT). The stated blocker on every short this
// programme has produced is that it lives in HARD-TO-BORROW names, and the borrow cost was always ASSUMED, never
// observed (INSTRUMENT LAW: a premium measured in research space and assumed to convert has failed 4/4). Per-name
// borrow FEES are now fetchable (iBorrowDesk republishes the IBKR retail feed, ~1y daily history). This script asks
// the honest final question: does the de-SPAC short survive its MEASURED borrow cost, and can a retail account even
// locate the borrow?  DESCRIPTIVE ONLY — no lineage/DECISIONS/prereg writes.
//
// THE STRUCTURAL LIMIT, STATED UP FRONT (this is the finding, not a footnote). iBorrowDesk carries ~1 YEAR of history
// (measured: 2025-09-03 -> 2026-09-01). The de-SPAC event windows are HISTORICAL — completions peak in 2021 (128),
// and a 2021 completion's 500-trading-day window (~2021-2023) has ZERO overlap with the fee era. Only de-SPACs whose
// window's tail reaches into ~2025-2026 have any measured fee at all, and only 2025-2026 completions have a fee AT
// ENTRY. So the borrow cost during the crowded post-merger months where the -57% was earned is, for most names,
// UNOBSERVED. What we CAN measure is (a) the fee de-SPACs of this class carry in the recent window, as a proxy, and
// (b) whether availability even exists. Both are reported with their coverage under the COVERAGE / INSTRUMENT LAWS.

import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("despac-short-net", [
  { name: "WINDOWS", def: "250,500", note: "forward horizons (trading days) — mirror despac-event-506" },
  { name: "BENCH", def: "IWM", note: "benchmark (matches the event study)" },
  { name: "DS_BUDGET", def: "120", note: "iBorrowDesk fetches this run — host BANS at ~100/window (HTTP 444), so a partial honest sample is expected" },
  { name: "DS_SLEEP", def: "150", note: "ms between fetches (the ingest measured the ban is on COUNT not spacing)" },
  { name: "DS_CACHE", def: "data/despac-borrow.json", note: "resumable per-name borrow cache" },
  { name: "DS_NO_FETCH", def: "", note: "set to 1 to skip the API entirely and analyse the cache + DB only" },
]);
const WINS = K.WINDOWS.split(",").map(Number);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dsn", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); // plumbing RULE 6: owned-DB reads THROW on transport failure, never []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0" };
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const srt = (a: number[]) => [...a].sort((x, y) => x - y);
const med = (a: number[]) => { const s = srt(a); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a: number[], p: number) => { const s = srt(a); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const winrate = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : 0;

console.log(`\n${"=".repeat(112)}\n  DE-SPAC SHORT — NET OF MEASURED BORROW COST (DESCRIPTIVE ONLY)\n${"=".repeat(112)}`);

// ── de-SPAC events (earliest Item 5.06 date per ticker), same filter as despac-event-506 ──────────────────────
interface Ev { ticker: string | null; date: string; }
const doc = JSON.parse(await Deno.readTextFile("data/despac-506-events.json")) as { events: Ev[] };
const evs = doc.events.filter((e) => e.ticker && /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.date)) as { ticker: string; date: string }[];
assertNonEmpty("resolved 506 de-SPAC events", evs, 50);
const byT = new Map<string, string>();
for (const e of evs) { const c = byT.get(e.ticker); if (!c || e.date < c) byT.set(e.ticker, e.date); }
const tickers = [...byT.keys()];
console.log(`  de-SPAC tickered events: ${evs.length} -> ${tickers.length} distinct tickers (earliest 5.06 date each)`);

// ── borrow cache: {sym: {daily:[{date,fee,available}]}} ─ resumable; also SEED from the DB ingest (same feed) ───
type Daily = { date: string; fee: number | null; available: number | null };
type Cache = { built: string; note: string; fetched: Record<string, Daily[]>; banHit: boolean };
let cache: Cache;
try { cache = JSON.parse(await Deno.readTextFile(K.DS_CACHE)) as Cache; }
catch { cache = { built: new Date().toISOString(), note: "iBorrowDesk (IBKR retail feed) per de-SPAC ticker", fetched: {}, banHit: false }; }

// Seed from trd_macro_series (borrow_fee:* / borrow_avail:*) — those rows came from the SAME iBorrowDesk feed via
// ingest-borrow-fees.ts, so folding them in is free coverage and costs no API budget. Only for de-SPAC tickers.
const tickSet = new Set(tickers);
const feeRows = (await q(`trd_macro_series?series=like.borrow_fee:*&select=series,d,v&order=d.asc&limit=200000`)) as { series: string; d: string; v: number }[];
const avRows = (await q(`trd_macro_series?series=like.borrow_avail:*&select=series,d,v&order=d.asc&limit=400000`)) as { series: string; d: string; v: number }[];
const dbFee = new Map<string, Map<string, number>>();
const dbAv = new Map<string, Map<string, number>>();
for (const r of feeRows) { const s = r.series.slice(11); if (!tickSet.has(s)) continue; (dbFee.get(s) ?? dbFee.set(s, new Map()).get(s)!).set(r.d, r.v); }
for (const r of avRows) { const s = r.series.slice(13); if (!tickSet.has(s)) continue; (dbAv.get(s) ?? dbAv.set(s, new Map()).get(s)!).set(r.d, r.v); }
let seeded = 0;
for (const s of tickSet) {
  if (cache.fetched[s]) continue;
  const f = dbFee.get(s), a = dbAv.get(s);
  if (!f && !a) continue;
  const dates = new Set<string>([...(f?.keys() ?? []), ...(a?.keys() ?? [])]);
  cache.fetched[s] = [...dates].sort().map((d) => ({ date: d, fee: f?.get(d) ?? null, available: a?.get(d) ?? null }));
  seeded++;
}
console.log(`  DB seed (free): ${seeded} de-SPAC tickers already carried borrow rows from ingest-borrow-fees`);

// ── FETCH the rest from iBorrowDesk. PRIORITY: recent completions first — only their windows can overlap the ~1y ──
// ── fee era, so they are the only names where a fee is measurable at all. Budget-bounded; STOP on the 444 ban. ──
const need = tickers.filter((t) => !cache.fetched[t]).sort((a, b) => (byT.get(b)! < byT.get(a)! ? -1 : 1)); // desc by completion
let fetched = 0, banHit = false;
if (K.DS_NO_FETCH.trim() === "" && need.length) {
  const todo = need.slice(0, Number(K.DS_BUDGET));
  console.log(`  fetch: ${need.length} outstanding, ${todo.length} this run (DS_BUDGET=${K.DS_BUDGET}); recent completions first`);
  let consecFail = 0;
  for (let i = 0; i < todo.length; i++) {
    const sym = todo[i];
    try {
      const r = await fetch(`https://www.iborrowdesk.com/api/ticker/${sym}`, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        consecFail++;
        if (r.status === 444 || consecFail >= 12) { banHit = true; console.log(`\n  !! HTTP ${r.status} after ${fetched} fetched (${consecFail} consec) — iBorrowDesk rate-limit ban. STOPPING; cache is durable, re-run resumes.`); break; }
        continue;
      }
      consecFail = 0;
      const daily = ((await r.json())?.daily ?? []) as Daily[];
      cache.fetched[sym] = daily.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? ""));
      fetched++;
    } catch (_e) { consecFail++; if (consecFail >= 12) { banHit = true; console.log(`\n  !! ${consecFail} consecutive fetch errors after ${fetched} — stopping.`); break; } }
    if ((i + 1) % 25 === 0) console.log(`    ${i + 1}/${todo.length}  fetched=${fetched}`);
    await sleep(Number(K.DS_SLEEP));
  }
} else console.log(`  fetch: skipped (DS_NO_FETCH set or nothing outstanding)`);
cache.banHit = banHit;
cache.built = new Date().toISOString();
await Deno.writeTextFile(K.DS_CACHE, JSON.stringify(cache));
const covered = Object.keys(cache.fetched).filter((s) => tickSet.has(s));
const withFee = covered.filter((s) => cache.fetched[s].some((d) => Number.isFinite(d.fee)));
console.log(`  cache now holds ${covered.length} de-SPAC tickers (${withFee.length} with >=1 real fee row); ban this run: ${banHit}`);

// ── POSITIVE CONTROL: de-SPACs are hard-to-borrow by nature — at least one must show a fee > 20%/yr. ──────────
let ctlName = "", ctlMax = 0;
for (const s of withFee) { const mx = Math.max(...cache.fetched[s].map((d) => Number.isFinite(d.fee) ? d.fee! : 0)); if (mx > ctlMax) { ctlMax = mx; ctlName = s; } }
const ctlOk = ctlMax > 20;
console.log(`  POSITIVE CONTROL — hardest-to-borrow de-SPAC in sample: ${ctlName || "(none)"} peak fee ${ctlMax.toFixed(1)}%/yr (must exceed 20%): ${ctlOk ? "PASS" : "*** FAIL"}`);
if (withFee.length && !ctlOk) console.log(`  !! Every fetched de-SPAC shows GC-like fees — the sample or the join is suspect. Verdict below is NOT trustworthy on borrow cost.`);

// ── bars ───────────────────────────────────────────────────────────────────────────────────────────────────
async function bars(sym: string): Promise<number[][]> { const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`); return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0); }
const bench = new Map((await bars(K.BENCH)).map((b) => [iso(b[0]), b[4]]));
const benchAsc = [...bench.entries()];

// per-despac window record with fee/availability during the hold
interface Rec { sym: string; win: number; entry: string; exit: string; tdHeld: number; excess: number; dvol: number;
  medFee: number | null; meanFee: number | null; entryFee: number | null; medAvail: number | null; zeroAvailShare: number | null; feeDays: number; }
const recs: Rec[] = [];
let trials = 0;
let noPrice = 0, noWindow = 0;
for (const [sym, d] of byT) {
  const b = await bars(sym); if (b.length < 40) { noPrice++; continue; }
  const dt = b.map((x) => iso(x[0]));
  const dv = b.map((x) => x[4] * x[5]); const medDV = srt(dv)[Math.floor(dv.length / 2)];
  const ci = dt.findIndex((x) => x >= d); if (ci < 0 || (ci + 20 >= b.length && dt[dt.length - 1] >= "2026-06-01")) { noWindow++; continue; }
  const lastDt = dt[dt.length - 1];
  const fdaily = cache.fetched[sym] ?? [];
  for (const w of WINS) {
    trials++;
    let iT = ci + w;
    if (iT >= b.length) { if (lastDt >= "2026-06-01") continue; iT = b.length - 1; }
    if (iT <= ci) continue;
    const p0 = b[ci][4], p1 = b[iT][4];
    const s0 = bench.get(dt[ci]) ?? benchAsc.find(([sd]) => sd >= dt[ci])?.[1];
    const s1 = bench.get(dt[iT]) ?? [...benchAsc].reverse().find(([sd]) => sd <= dt[iT])?.[1];
    if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
    const entry = dt[ci], exit = dt[iT];
    const inWin = fdaily.filter((x) => x.date >= entry && x.date <= exit);
    const feeVals = inWin.filter((x) => Number.isFinite(x.fee)).map((x) => x.fee!);
    const avVals = inWin.filter((x) => Number.isFinite(x.available)).map((x) => x.available!);
    const entryFeeRow = inWin.filter((x) => Number.isFinite(x.fee)).sort((a, z) => a.date < z.date ? -1 : 1)[0];
    recs.push({
      sym, win: w, entry, exit, tdHeld: iT - ci, excess: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dvol: medDV,
      medFee: feeVals.length ? med(feeVals) : null, meanFee: feeVals.length ? mean(feeVals) : null,
      entryFee: entryFeeRow ? entryFeeRow.fee! : null,
      medAvail: avVals.length ? med(avVals) : null,
      zeroAvailShare: avVals.length ? avVals.filter((x) => x <= 0).length / avVals.length : null,
      feeDays: feeVals.length,
    });
  }
}
console.log(`  event windows built: ${recs.length} (${noPrice} no price, ${noWindow} no window) | trials this run: ${trials}`);

// ── REPORT, per window ────────────────────────────────────────────────────────────────────────────────────────
function tercileLiquid<T extends { dvol: number }>(rows: T[]): T[] { const s = [...rows].sort((a, b) => a.dvol - b.dvol); return s.slice(Math.floor(s.length * 2 / 3)); }
function line(label: string, xs: number[]) {
  if (xs.length < 3) return `${label} n=${xs.length} (too few)`;
  return `${label} n=${String(xs.length).padStart(4)} median ${med(xs).toFixed(1)}% mean ${mean(xs).toFixed(1)}% t ${tstat(xs).toFixed(2)} win ${winrate(xs).toFixed(0)}%`;
}

for (const w of WINS) {
  const all = recs.filter((r) => r.win === w);
  if (all.length < 3) { console.log(`\n  ── ${w}d: n=${all.length} (too few) ──`); continue; }
  console.log(`\n  ${"─".repeat(108)}\n  HORIZON ${w}d — ${all.length} de-SPAC windows\n  ${"─".repeat(108)}`);

  // (A) GROSS short = -(excess vs bench), the +57% mirror, on ALL captured windows (no borrow needed to state it)
  const grossAll = all.map((r) => -r.excess);
  const grossLiq = tercileLiquid(all).map((r) => -r.excess);
  console.log(`  GROSS SHORT (no borrow) : ${line("ALL   ", grossAll)}`);
  console.log(`                          : ${line("LIQUID", grossLiq)}`);

  // (B) the covered subset — only windows with >=1 measured fee day
  const cov = all.filter((r) => r.feeDays > 0 && r.meanFee != null);
  if (cov.length < 3) { console.log(`  BORROW-COVERED subset: n=${cov.length} — UNTESTED ON COST at ${w}d (fee history does not overlap these windows)`); continue; }
  const yrs = (r: Rec) => r.tdHeld / 252;
  const dragMean = cov.map((r) => r.meanFee! * yrs(r));
  const dragEntry = cov.map((r) => (r.entryFee ?? r.meanFee!) * yrs(r));
  console.log(`  BORROW-COVERED subset n=${cov.length} (fee days per window: median ${med(cov.map((r) => r.feeDays)).toFixed(0)} of ${w})`);
  console.log(`    fee %/yr in window   : median ${med(cov.map((r) => r.medFee!)).toFixed(1)}  mean ${mean(cov.map((r) => r.meanFee!)).toFixed(1)}  90th ${pct(cov.map((r) => r.meanFee!), 0.9).toFixed(1)}  max ${Math.max(...cov.map((r) => r.meanFee!)).toFixed(1)}`);
  console.log(`    borrow DRAG over hold: median ${med(dragMean).toFixed(1)}%  mean ${mean(dragMean).toFixed(1)}%  90th ${pct(dragMean, 0.9).toFixed(1)}%  (accrued fee x ${(mean(cov.map(yrs))).toFixed(2)}y held)`);

  const grossCov = cov.map((r) => -r.excess);
  const netMean = cov.map((r) => -r.excess - r.meanFee! * yrs(r));
  const netEntry = cov.map((r) => -r.excess - (r.entryFee ?? r.meanFee!) * yrs(r));
  const covLiq = tercileLiquid(cov);
  const grossCovLiq = covLiq.map((r) => -r.excess);
  const netMeanLiq = covLiq.map((r) => -r.excess - r.meanFee! * yrs(r));
  console.log(`    GROSS short (subset) : ${line("ALL   ", grossCov)}`);
  console.log(`                         : ${line("LIQUID", grossCovLiq)}`);
  console.log(`    NET short (avg fee)  : ${line("ALL   ", netMean)}`);
  console.log(`                         : ${line("LIQUID", netMeanLiq)}`);
  console.log(`    NET short (entry fee): ${line("ALL   ", netEntry)}`);

  // (C) execution reality — availability
  const av = cov.filter((r) => r.medAvail != null);
  if (av.length) {
    const zeroShares = av.map((r) => r.zeroAvailShare!);
    const medAvails = av.map((r) => r.medAvail!);
    console.log(`    AVAILABILITY (${av.length} windows w/ avail): median lendable shares ${med(medAvails).toLocaleString()}  ; 10th pct ${pct(medAvails, 0.1).toLocaleString()}`);
    console.log(`      share of hold-days with ZERO availability: median ${(100 * med(zeroShares)).toFixed(0)}%  ; windows fully-zero (uborrowable whole hold): ${av.filter((r) => r.zeroAvailShare === 1).length}/${av.length}`);
  } else console.log(`    AVAILABILITY: no lendable-share rows in these windows`);
}

// ── COVERAGE / INSTRUMENT / VERDICT ───────────────────────────────────────────────────────────────────────────
const feeMin = feeRows.length ? feeRows[0].d : "?", feeMax = feeRows.length ? feeRows[feeRows.length - 1].d : "?";
console.log(`\n  ${"=".repeat(108)}`);
console.log(`  COVERAGE (COVERAGE LAW): ${tickers.length} distinct de-SPAC tickers | ${covered.length} hold borrow rows | ${withFee.length} hold >=1 real fee.`);
console.log(`    fee-history span in DB: ${feeMin} -> ${feeMax} (~1y). de-SPAC completions peak 2021 (128); a 2021 window (~2y) does NOT overlap.`);
console.log(`    borrow-COVERED event windows: ${recs.filter((r) => r.feeDays > 0).length} of ${recs.length} — the rest are UNTESTED ON COST, not zero-cost.`);
console.log(`    ban-window limit: iBorrowDesk serves ~100 requests/window then HTTP 444; this run fetched ${fetched}${banHit ? " and HIT THE BAN (partial, honest)" : ""}.`);
console.log(`  INSTRUMENT / EXECUTION LAW: fee is a DAILY-RESETTABLE indicative retail rate (IBKR). A short can be RECALLED and the`);
console.log(`    rate can SPIKE intraday, so the entry fee UNDERSTATES realised cost; and the crowded first post-merger months —`);
console.log(`    where the drawdown is deepest — sit BEFORE the fee history for almost every name, so the measured fee is a`);
console.log(`    LATE-WINDOW, survivor-biased LOWER BOUND on what the short actually paid.`);
console.log(`  TRIALS this run: ${trials} (windows x specs). DESCRIPTIVE ONLY — no lineage/DECISIONS/prereg write.`);
console.log(`  ${"=".repeat(108)}\n`);
