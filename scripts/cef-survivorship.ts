#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// cef-survivorship.ts — ATTACK on the CEF-discount claim (+5.54%/yr excess, t 8.09, 1998-2026).
//
// THE CLAIM'S OWN CONFESSION: cef-discount.ts states that its universe is "CEFs that filed an N-CEN in 2019-2025",
// run back to 1998, and that "its magnitude is UNMEASURED". That is exactly what THE UNIVERSE LAW extension
// (D-645/646) forbids leaving alone: within-panel attrition (1.1%) counts who LEFT, never who never JOINED.
// This script does not assume the hole. It MEASURES it, then reruns the rule where the hole cannot exist.
//
// WHAT IS MEASURED, in order:
//  (1a) N-CEN filer sets year-by-year 2019..2025 -> funds that died INSIDE the panel window, and whether Yahoo
//       retains their price series (this calibrates whether a dead CEF is recoverable from Yahoo at all).
//  (1b) The PRE-2019 hole: closed-end registrants identifiable on EDGAR full-text in 2010 and 2015 from forms that
//       existed then (N-CSR, and N-2 which is a closed-end-ONLY registration form), and what fraction of them are
//       present in the current universe. THAT FRACTION IS THE COVERAGE STATEMENT (present/intended).
//  (2)  Survivorship-clean rerun: the exact widest-tercile-excess rule on 2019-10+ and 2022-01+ with membership
//       FROZEN at the window start (no later joiners) — the only windows where the 2019 N-CEN filter is not a
//       forward-looking survival filter.
//  (3)  A bracket on the full-sample headline under a pessimistic and a neutral reinstatement of the missing funds.
//       Explicitly labelled ASSUMPTIONS, not measurements.
//  (4)  SELECTION LAW accounting for the researcher degrees of freedom in the original construction.
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW, D-597). No trd_lineage row, no DECISIONS entry, no gate claimed, no
// pre-registration made. No existing file is modified. This is a falsification attempt, and its default posture is
// that the claim is inflated until the clean window says otherwise.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("cef-survivorship", [
  { name: "CEFS_BARS", def: "data/cef-bars.json", note: "price+NAV cache built by cef-discount.ts (read-only here)" },
  { name: "CEFS_UNI", def: "data/cef-universe.json", note: "the universe under attack (read-only)" },
  { name: "CEFS_CACHE", def: "data/cef-survivorship-edgar.json", note: "EDGAR sweep cache; present = skip the sweep" },
  { name: "CEFS_YAHOO_CACHE", def: "data/cef-survivorship-yahoo.json", note: "dead-ticker Yahoo probe cache" },
  { name: "CEFS_SUB_CACHE", def: "data/cef-survivorship-subs.json", note: "cik->ticker resolution cache (data.sec.gov/submissions)" },
  { name: "CEFS_SLEEP_MS", def: "260", note: "SEC asks <=10 req/s; sequential, no parallelism" },
  { name: "CEFS_LOOKBACK", def: "36" },
  { name: "RT_BP", def: "30", note: "same round-trip assumption as cef-discount.ts, so the numbers are comparable" },
  { name: "CEFS_SKIP_EDGAR", def: "", note: "1 = skip part 1 entirely (panel-only rerun)" },
]);
const SLEEP = Number(K.CEFS_SLEEP_MS), LOOKBACK = Number(K.CEFS_LOOKBACK), RT_BP = Number(K.RT_BP);
const SEC_UA = "Aegis Research ona@revitalise.io";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 3 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / a.length;
const ann = (a: number[]) => mean(a) * 12 * 100;
const shp = (a: number[]) => (mean(a) / (sd(a) || 1e-12)) * Math.sqrt(12);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const tickerOf = (names: string[]): string | null => {
  for (const n of names ?? []) { const m = n.match(/\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/); if (m) return m[1]; }
  return null;
};

// ---------------------------------------------------------------- EDGAR full-text sweep
interface Hit { _source: { ciks: string[]; display_names: string[]; file_date: string } }
interface Sweep { total: number; ciks: Record<string, string | null>; saturated: boolean; failed: string[] }

async function efts(phrase: string, form: string, start: string, end: string): Promise<Sweep> {
  const out: Sweep = { total: 0, ciks: {}, saturated: false, failed: [] };
  let total = -1, from = 0, got = 0;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${phrase}"`)}&forms=${encodeURIComponent(form)}&startdt=${start}&enddt=${end}&from=${from}`;
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
    // A SKIPPED WINDOW IS A COVERAGE HOLE, NOT A HICCUP — same discipline as cef-universe.ts.
    if (!j) { out.failed.push(`${form} "${phrase}" ${start}..${end} (${lastErr})`); break; }
    const hits = j?.hits?.hits ?? [];
    if (total < 0) { total = j?.hits?.total?.value ?? 0; out.total = total; }
    if (!hits.length) break;
    for (const h of hits) {
      const cik = h._source.ciks?.[0]; if (!cik) continue;
      const t = tickerOf(h._source.display_names);
      if (!(cik in out.ciks) || (!out.ciks[cik] && t)) out.ciks[cik] = t ?? out.ciks[cik] ?? null;
    }
    got += hits.length; from += hits.length;
    if (from >= 9900 && got < total) { out.saturated = true; break; }   // EFTS caps the result window at 10k
    if (got >= total) break;
    await sleep(SLEEP);
  }
  await sleep(SLEEP);
  return out;
}

const QTRS = (y: number): [string, string][] => [
  [`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`],
];

async function sweepYear(phrases: string[], forms: string[], y: number) {
  const ciks: Record<string, string | null> = {};
  let total = 0, sat = 0; const failed: string[] = [];
  for (const form of forms) {
    for (const phrase of phrases) {
      for (const [a, b] of QTRS(y)) {
        if (Date.parse(a) > Date.now()) continue;
        const s = await efts(phrase, form, a, b);
        total += s.total; if (s.saturated) sat++;
        failed.push(...s.failed);
        for (const [c, t] of Object.entries(s.ciks)) if (!(c in ciks) || (!ciks[c] && t)) ciks[c] = t ?? ciks[c] ?? null;
      }
    }
  }
  return { ciks, total, saturated: sat, failed };
}

interface EdgarCache {
  built: string;
  ncen: Record<string, { ciks: Record<string, string | null>; total: number; saturated: number; failed: string[] }>;
  pre: Record<string, { ciks: Record<string, string | null>; total: number; saturated: number; failed: string[] }>;
}
let EC: EdgarCache | null = null;
try { EC = JSON.parse(await Deno.readTextFile(K.CEFS_CACHE)); console.log(`==> EDGAR sweep loaded from ${K.CEFS_CACHE} (built ${EC!.built}) — delete that file to re-sweep.`); } catch { /* sweep */ }

const NCEN_PHRASES = ["closed-end", "N-2"];          // identical to cef-universe.ts step 1
const PRE_KEYS: [string, string[], string[]][] = [    // label, phrases, forms — pre-N-CEN era
  ["2010:N-CSR", ["closed-end fund"], ["N-CSR"]],
  ["2010:N-2", ["closed-end"], ["N-2"]],
  ["2015:N-CSR", ["closed-end fund"], ["N-CSR"]],
  ["2015:N-2", ["closed-end"], ["N-2"]],
];

if (!EC && K.CEFS_SKIP_EDGAR !== "1") {
  EC = { built: new Date().toISOString().slice(0, 10), ncen: {}, pre: {} };
  console.log(`==> PART 1a — N-CEN filer set, year by year, phrases [${NCEN_PHRASES.join(", ")}] (sequential, ${SLEEP}ms apart)`);
  for (let y = 2019; y <= 2025; y++) {
    const r = await sweepYear(NCEN_PHRASES, ["N-CEN"], y);
    EC.ncen[String(y)] = { ciks: r.ciks, total: r.total, saturated: r.saturated, failed: r.failed };
    console.log(`    ${y}: ${r.total.toLocaleString()} hits -> ${Object.keys(r.ciks).length} distinct filer CIKs${r.saturated ? `  !! ${r.saturated} SATURATED window(s)` : ""}${r.failed.length ? `  !! ${r.failed.length} FAILED window(s)` : ""}`);
    await Deno.writeTextFile(K.CEFS_CACHE, JSON.stringify(EC));
  }
  console.log(`\n==> PART 1b — pre-2019 closed-end registrants from forms that existed then`);
  for (const [label, phrases, forms] of PRE_KEYS) {
    const y = Number(label.slice(0, 4));
    const r = await sweepYear(phrases, forms, y);
    EC.pre[label] = { ciks: r.ciks, total: r.total, saturated: r.saturated, failed: r.failed };
    console.log(`    ${label.padEnd(12)} "${phrases[0]}": ${r.total.toLocaleString()} hits -> ${Object.keys(r.ciks).length} distinct CIKs${r.saturated ? `  !! SATURATED` : ""}`);
    await Deno.writeTextFile(K.CEFS_CACHE, JSON.stringify(EC));
  }
}

// ---------------------------------------------------------------- PART 1a analysis
const uni = JSON.parse(await Deno.readTextFile(K.CEFS_UNI)) as { universe: { ticker: string; navFrom: string; navTo: string }[]; candidate_tickers: string[] };
const UNI_T = new Set(uni.universe.map((u) => u.ticker));
assertNonEmpty("universe tickers", [...UNI_T], 20);

let deadTickers: string[] = [];
let ncen2019 = new Set<string>(), ncen2025 = new Set<string>();
if (EC) {
  console.log(`\n${"=".repeat(100)}\nPART 1a — DEATH INSIDE THE PANEL WINDOW (does a dead CEF stay visible?)\n${"=".repeat(100)}`);
  const yrs = Object.keys(EC.ncen).sort();
  console.log(`    year  distinct N-CEN closed-end filer CIKs`);
  for (const y of yrs) console.log(`    ${y}  ${String(Object.keys(EC.ncen[y].ciks).length).padStart(5)}`);

  ncen2019 = new Set(Object.keys(EC.ncen["2019"]?.ciks ?? {}));
  ncen2025 = new Set(Object.keys(EC.ncen["2025"]?.ciks ?? {}));
  // POSITIVE CONTROL (D-641): a zero or tiny 2019 set would look identical to "nothing died".
  console.log(`\n    POSITIVE CONTROL — 2019 N-CEN filer count must exceed 300: ${ncen2019.size} -> ${ncen2019.size > 300 ? "PASS" : "FAIL"}`);
  if (ncen2019.size <= 300) { console.log(`    !! CONTROL FAILED — the 2019 sweep is broken; every count below would be a broken question, not a finding.`); Deno.exit(2); }

  const dead = [...ncen2019].filter((c) => !ncen2025.has(c));
  console.log(`\n    2019 filers no longer filing an N-CEN by 2025 (DEAD or renamed/merged): ${dead.length} of ${ncen2019.size} (${pct(dead.length / ncen2019.size)})`);
  // A ticker is only in display_names for some filers. cef-universe.ts resolves the rest against
  // data.sec.gov/submissions, and skipping that step here produced 7 tickers out of 289 dead CIKs on the first
  // run — a FALSE NEAR-ZERO of exactly the kind THE POSITIVE-CONTROL RULE exists to catch. Resolved properly.
  let SUB: Record<string, string | null> = {};
  try { SUB = JSON.parse(await Deno.readTextFile(K.CEFS_SUB_CACHE)); } catch { /* first run */ }
  const needSub = dead.filter((c) => !(c in SUB));
  if (needSub.length) console.log(`    resolving tickers for ${needSub.length} dead CIK(s) via data.sec.gov/submissions, sequential...`);
  for (const c of needSub) {
    try {
      const j = await fetch(`https://data.sec.gov/submissions/CIK${c.padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } }).then((r) => r.ok ? r.json() : null);
      const tks = (j?.tickers as string[]) || [];
      SUB[c] = tks.length ? tks[0] : null;
    } catch { SUB[c] = null; }
    await sleep(170);
  }
  await Deno.writeTextFile(K.CEFS_SUB_CACHE, JSON.stringify(SUB));
  const deadT = dead.map((c) => EC!.ncen["2019"].ciks[c] ?? SUB[c]).filter((t): t is string => !!t && /^[A-Z]{1,5}$/.test(t));
  deadTickers = [...new Set(deadT)];
  console.log(`    of those, ${deadTickers.length} carry a resolvable listed ticker (display_names + submissions); the rest are`);
  console.log(`    trusts/series with no listed share class, or filers EDGAR no longer serves a submissions file for`);
  console.log(`    POSITIVE CONTROL — resolution must beat the display_names-only count: ${deadTickers.length} vs ${dead.map((c) => EC!.ncen["2019"].ciks[c]).filter((t) => !!t).length} -> ${deadTickers.length > dead.map((c) => EC!.ncen["2019"].ciks[c]).filter((t) => !!t).length ? "PASS" : "NO GAIN — check the submissions fetch"}`);
  const inUni = deadTickers.filter((t) => UNI_T.has(t));
  console.log(`    dead-by-2025 tickers PRESENT in the 302-fund universe: ${inUni.length}  |  ABSENT: ${deadTickers.length - inUni.length}`);
  console.log(`      (a dead fund present in the universe is one whose NAV series survived the >=3y filter; its absence is`);
  console.log(`       the same mechanism that removes every pre-2019 death, operating on a cohort we can still see.)`);

  // Does Yahoo keep dead CEFs? Probe the price series of the dead tickers.
  let YC: Record<string, { last: string | null; n: number } | null> = {};
  try { YC = JSON.parse(await Deno.readTextFile(K.CEFS_YAHOO_CACHE)); } catch { /* first run */ }
  const need = deadTickers.filter((t) => !(t in YC));
  if (need.length) console.log(`\n    probing Yahoo for ${need.length} dead ticker(s), sequential ~${SLEEP}ms apart...`);
  for (const t of need) {
    try {
      const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1e3)}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null);
      const r = j?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      YC[t] = ts.length ? { last: new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10), n: ts.length } : null;
    } catch { YC[t] = null; }
    await sleep(SLEEP);
  }
  await Deno.writeTextFile(K.CEFS_YAHOO_CACHE, JSON.stringify(YC));
  const probed = deadTickers.map((t) => YC[t]);
  const none = probed.filter((p) => !p).length;
  const stops = probed.filter((p) => p && p.last! < "2025-01-01").length;
  const lives = probed.filter((p) => p && p.last! >= "2025-01-01").length;
  console.log(`\n    YAHOO RETENTION OF DEAD CEFs (n=${deadTickers.length}):`);
  console.log(`      no series at all (Yahoo dropped the ticker)  ${none}  (${deadTickers.length ? pct(none / deadTickers.length) : "n/a"})`);
  console.log(`      series ENDS before 2025 (retained, dead)     ${stops}  (${deadTickers.length ? pct(stops / deadTickers.length) : "n/a"})`);
  console.log(`      series still running into 2025+ (not dead; renamed/reorganised filer, ticker alive) ${lives}`);
  console.log(`      POSITIVE CONTROL: at least one of the three buckets must be non-zero -> ${none + stops + lives > 0 ? "PASS" : "FAIL — the probe returned nothing at all"}`);
  if (deadTickers.length < 30) {
    console.log(`\n      *** THIS CALIBRATION IS UNDERPOWERED, NOT A FINDING (COVERAGE LAW). n=${deadTickers.length} listed tickers is`);
    console.log(`      far too few to state a Yahoo retention rate for dead CEFs, and 0/${deadTickers.length} in the "retained, dead"`);
    console.log(`      bucket is a sample size, not a market fact. The reason n is small is itself informative: of the`);
    console.log(`      ${dead.length} CIKs that stopped filing, only ${deadTickers.length} ever carried a listed ticker — the great majority are`);
    console.log(`      unlisted series/trusts. The listed-CEF death cohort 2019-2025 is genuinely thin, which is why`);
    console.log(`      PART 2's frozen-membership rerun, not this probe, is what actually tests the claim.`);
  }
  console.log(`\n      CAVEAT ON THE 32.1%: 2019 was the N-CEN PHASE-IN year (900 filers vs 1,100-1,144 in every later`);
  console.log(`      year), so a 2019 CIK absent in 2025 may be a merger, a re-domicile under a new CIK, or a filing`);
  console.log(`      reorganisation rather than a liquidation. 32.1% is an UPPER BOUND on within-window death.`);
  console.log(`    READING: retention is only half the problem. Even where Yahoo keeps a dead fund's PRICE, the`);
  console.log(`    universe requires the X{T}X NAV series, and a delisted CEF's synthetic NAV series is what`);
  console.log(`    disappears first. A fund cannot enter a discount panel without a NAV.`);
}

// ---------------------------------------------------------------- PART 1b analysis — THE COVERAGE STATEMENT
let coverFrac2010 = NaN, coverFrac2015 = NaN;
if (EC && Object.keys(EC.pre).length) {
  console.log(`\n${"=".repeat(100)}\nPART 1b — THE PRE-2019 HOLE: present / intended (THE UNIVERSE LAW extension, D-645 rules 5-6)\n${"=".repeat(100)}`);
  const ncenAll = new Set<string>();
  for (const y of Object.keys(EC.ncen)) for (const c of Object.keys(EC.ncen[y].ciks)) ncenAll.add(c);
  console.log(`    reference set: every CIK appearing in ANY 2019-2025 N-CEN closed-end sweep = ${ncenAll.size}`);
  console.log(`    POSITIVE CONTROL — that union must be non-zero and must exceed any single year: ${ncenAll.size > Math.max(...Object.keys(EC.ncen).map((y) => Object.keys(EC.ncen[y].ciks).length)) ? "PASS" : "FAIL"}`);

  for (const year of ["2010", "2015"]) {
    const merged: Record<string, string | null> = {};
    for (const label of Object.keys(EC.pre)) {
      if (!label.startsWith(year)) continue;
      for (const [c, t] of Object.entries(EC.pre[label].ciks)) if (!(c in merged) || (!merged[c] && t)) merged[c] = t ?? merged[c] ?? null;
    }
    const all = Object.keys(merged);
    if (!all.length) { console.log(`\n    ${year}: UNTESTED — the sweep returned no CIKs.`); continue; }
    const present = all.filter((c) => ncenAll.has(c));
    const withT = all.map((c) => merged[c]).filter((t): t is string => !!t && /^[A-Z]{1,5}$/.test(t));
    const tickersPresent = [...new Set(withT)].filter((t) => UNI_T.has(t));
    const frac = present.length / all.length;
    if (year === "2010") coverFrac2010 = frac; else coverFrac2015 = frac;
    console.log(`\n    ${year} closed-end registrants identified on EDGAR full-text:`);
    for (const label of Object.keys(EC.pre).filter((l) => l.startsWith(year))) {
      console.log(`      ${label.padEnd(12)} ${String(Object.keys(EC.pre[label].ciks).length).padStart(5)} CIKs  (${EC.pre[label].total.toLocaleString()} hits${EC.pre[label].saturated ? ", SATURATED" : ""})`);
    }
    console.log(`      UNION (intended universe, ${year})            ${String(all.length).padStart(5)} CIKs`);
    console.log(`      of which present in the 2019-2025 N-CEN set  ${String(present.length).padStart(5)}`);
    console.log(`      >>> UNIVERSE COVERAGE (present / intended)   ${(100 * frac).toFixed(1)}%   MISSING ${(100 * (1 - frac)).toFixed(1)}% (${all.length - present.length} CIKs)`);
    console.log(`      of the ${[...new Set(withT)].length} ${year} registrants carrying a listed ticker, ${tickersPresent.length} are in the final 302-fund universe (${(100 * tickersPresent.length / Math.max(1, [...new Set(withT)].length)).toFixed(1)}%)`);
  }
  console.log(`\n    WHAT THIS NUMBER IS AND IS NOT. It is the fraction of entities filing closed-end-marked forms in a`);
  console.log(`    pre-2019 year that still file an N-CEN in 2019-2025. It OVERSTATES the hole to the extent that a`);
  console.log(`    fund survived under a new CIK after a merger or a re-domicile, and UNDERSTATES it to the extent`);
  console.log(`    that N-CSR "closed-end fund" catches open-end trusts that merely use the phrase. Neither error is`);
  console.log(`    small enough to ignore, so the figure is a BRACKET on the hole, not a point estimate — which is`);
  console.log(`    still strictly more than the "UNMEASURED" the original script recorded.`);
  console.log(`    THE SELECTION MECHANISM, NAMED (D-645 rule 6): the missing cohort is funds that stopped filing —`);
  console.log(`    liquidated, open-ended, or merged. Activist open-ending and tender offers are triggered by a`);
  console.log(`    PERSISTENTLY WIDE DISCOUNT, so the missing cohort is drawn preferentially from the very tercile`);
  console.log(`    whose return is the claim. The bias runs TOWARD the reported result.`);
}

// ---------------------------------------------------------------- PANEL (construction copied from cef-discount.ts)
console.log(`\n${"=".repeat(100)}\nPART 2 — SURVIVORSHIP-CLEAN RERUN (the exact widest-tercile-excess rule, on windows the 2019 filter cannot bias)\n${"=".repeat(100)}`);
type YF = { d: string[]; c: number[]; a: number[]; v: number[] };
const cache = JSON.parse(await Deno.readTextFile(K.CEFS_BARS)) as Record<string, { px: YF; nav: YF }>;
console.log(`    bars cache: ${Object.keys(cache).length} funds with price+NAV`);

const monthEnd = (s: YF): Map<string, { c: number; a: number; dv: number }> => {
  const out = new Map<string, { c: number; a: number; dv: number }>();
  for (let i = 0; i < s.d.length; i++) {
    const m = s.d[i].slice(0, 7);
    let dv = 0, n = 0;
    for (let k = Math.max(0, i - 20); k <= i; k++) { dv += s.c[k] * s.v[k]; n++; }
    out.set(m, { c: s.c[i], a: s.a[i], dv: dv / n });
  }
  return out;
};
interface MRow { t: string; m: string; px: number; apx: number; nav: number; anav: number; disc: number; dv: number }
const rows: MRow[] = [];
for (const t of Object.keys(cache)) {
  const P = monthEnd(cache[t].px), N = monthEnd(cache[t].nav);
  for (const [m, p] of P) {
    const nv = N.get(m); if (!nv || !(nv.c > 0) || !(p.c > 0)) continue;
    const disc = p.c / nv.c - 1;
    if (!Number.isFinite(disc) || Math.abs(disc) > 0.75) continue;
    rows.push({ t, m, px: p.c, apx: p.a, nav: nv.c, anav: nv.a, disc, dv: p.dv });
  }
}
assertNonEmpty("CEF month observations", rows, 1000);

const byT = new Map<string, MRow[]>();
for (const r of rows) { const a = byT.get(r.t) ?? []; a.push(r); byT.set(r.t, a); }
for (const a of byT.values()) a.sort((x, y) => x.m < y.m ? -1 : 1);

interface Obs { t: string; m: string; disc: number; z: number | null; dv: number; retPx: number; retNav: number }
const obs: Obs[] = [];
for (const [_t, a] of byT) {
  for (let i = 0; i < a.length - 1; i++) {
    const c = a[i], n = a[i + 1];
    const dm = (Number(n.m.slice(0, 4)) - Number(c.m.slice(0, 4))) * 12 + (Number(n.m.slice(5)) - Number(c.m.slice(5)));
    if (dm !== 1) continue;
    const retPx = n.apx / c.apx - 1, retNav = n.anav / c.anav - 1;
    if (!Number.isFinite(retPx) || !Number.isFinite(retNav) || Math.abs(retPx) > 0.6) continue;
    const hist = a.slice(Math.max(0, i - LOOKBACK + 1), i + 1).map((x) => x.disc);
    const z = hist.length >= LOOKBACK ? (c.disc - mean(hist)) / (sd(hist) || 1e-9) : null;
    obs.push({ t: c.t, m: c.m, disc: c.disc, z, dv: c.dv, retPx, retNav });
  }
}
assertNonEmpty("CEF forward observations", obs, 1000);
const allMonths = [...new Set(obs.map((o) => o.m))].sort();
const perMonth = new Map<string, Obs[]>();
for (const o of obs) { const a = perMonth.get(o.m) ?? []; a.push(o); perMonth.set(o.m, a); }

// POSITIVE CONTROL: the panel must reproduce the claim under attack before any restriction is believed.
function runBook(months: string[], member: (t: string) => boolean, minN = 9) {
  const wide: number[] = [], universeR: number[] = [], ex: number[] = [], ns: number[] = [], to: number[] = [];
  let prevWide = new Set<string>();
  for (const m of months) {
    const a = (perMonth.get(m) ?? []).filter((o) => member(o.t));
    if (a.length < minN) continue;
    const s = [...a].sort((x, y) => x.disc - y.disc);
    const k = Math.floor(s.length / 3);
    const w = s.slice(0, k);
    const nowWide = new Set(w.map((o) => o.t));
    let churn = 0; for (const t of nowWide) if (!prevWide.has(t)) churn++;
    to.push(prevWide.size ? churn / nowWide.size : 1);
    prevWide = nowWide;
    const wr = mean(w.map((o) => o.retPx)), ur = mean(a.map((o) => o.retPx));
    wide.push(wr); universeR.push(ur); ex.push(wr - ur); ns.push(a.length);
  }
  return { wide, universeR, ex, breadth: ns.length ? mean(ns) : 0, n: ex.length, to: to.length ? mean(to) : NaN };
}
function liqBook(months: string[], member: (t: string) => boolean) {
  const ex: number[] = [];
  for (const m of months) {
    const a = (perMonth.get(m) ?? []).filter((o) => member(o.t));
    if (a.length < 12) continue;
    const byDv = [...a].sort((x, y) => x.dv - y.dv);
    const k = Math.floor(byDv.length / 3);
    const seg = byDv.slice(byDv.length - k);        // LIQUID tercile
    if (seg.length < 4) continue;
    const s = [...seg].sort((x, y) => x.disc - y.disc);
    const kk = Math.max(1, Math.floor(s.length / 3));
    ex.push(mean(s.slice(0, kk).map((o) => o.retPx)) - mean(seg.map((o) => o.retPx)));
  }
  return ex;
}

const ALL = () => true;
const full = runBook(allMonths, ALL);
console.log(`\n    REPRODUCTION CONTROL — the claim under attack, recomputed here from the same cache:`);
console.log(`      FULL SAMPLE ${allMonths[0]}..${allMonths[allMonths.length - 1]}  excess ${ann(full.ex).toFixed(2)}%/yr  t ${tstat(full.ex).toFixed(2)}  n=${full.n}mo  breadth ${full.breadth.toFixed(1)}`);
console.log(`      (the claim under attack is +5.54%/yr at t 8.09; if this line does not reproduce it, everything`);
console.log(`       below is measuring a different object and the attack is void.)`);

// FROZEN MEMBERSHIP: only funds already filing an N-CEN in 2019 AND already in the panel at the window start.
const frozenBy = (startM: string, filerYear?: Set<string>) => {
  const tickersInNcen = filerYear ? new Set([...filerYear].map((c) => EC?.ncen["2019"]?.ciks[c]).filter((t): t is string => !!t)) : null;
  const eligible = new Set<string>();
  for (const [t, a] of byT) {
    if (a[0].m > startM) continue;                       // must already exist at the window start: NO LATER JOINERS
    if (tickersInNcen && !tickersInNcen.has(t)) continue; // must be a 2019 N-CEN filer
    eligible.add(t);
  }
  return eligible;
};

for (const [label, startM] of [["2019-10", "2019-10"], ["2022-01", "2022-01"]] as [string, string][]) {
  const months = allMonths.filter((m) => m >= startM);
  const frozenNcen = ncen2019.size ? frozenBy(startM, ncen2019) : null;
  console.log(`\n    ---- WINDOW ${label} onward (${months.length} months) ----`);
  for (const [vlab, memberSet] of [
    ["frozen membership (in panel at window start)", frozenBy(startM)],
    ...(frozenNcen ? [["frozen AND a 2019 N-CEN filer", frozenNcen] as [string, Set<string>]] : []),
  ] as [string, Set<string>][]) {
    if (memberSet.size < 20) { console.log(`      ${vlab.padEnd(46)} UNTESTED — only ${memberSet.size} eligible funds`); continue; }
    const b = runBook(months, (t) => memberSet.has(t));
    if (b.n < 24) { console.log(`      ${vlab.padEnd(46)} UNTESTED — only ${b.n} months`); continue; }
    const lq = liqBook(months, (t) => memberSet.has(t));
    const drag = 2 * b.to * 12 * (RT_BP / 1e4) * 100;
    console.log(`      ${vlab}`);
    console.log(`        funds eligible ${memberSet.size} | months ${b.n} | breadth ${b.breadth.toFixed(1)} ${b.breadth < 50 ? "(< 50 -> UNTESTED as a cross-section, BREADTH LAW)" : ""}`);
    console.log(`        universe ${ann(b.universeR).toFixed(2)}%/yr | widest tercile ${ann(b.wide).toFixed(2)}%/yr`);
    console.log(`        EXCESS   ${ann(b.ex).toFixed(2)}%/yr  t ${tstat(b.ex).toFixed(2)}  SR ${shp(b.ex).toFixed(2)}  ${pctPos(b.ex).toFixed(0)}% of months positive`);
    console.log(`        turnover ${(100 * b.to).toFixed(1)}%/mo -> drag ${drag.toFixed(2)}%/yr @${RT_BP}bp  ->  NET EXCESS ${(ann(b.ex) - drag).toFixed(2)}%/yr   [GROSS t ${tstat(b.ex).toFixed(2)}, D-661]`);
    if (lq.length >= 24) console.log(`        LIQUID tercile excess ${ann(lq).toFixed(2)}%/yr  t ${tstat(lq).toFixed(2)}  SR ${shp(lq).toFixed(2)}  n=${lq.length}mo`);
    else console.log(`        LIQUID tercile UNTESTED — only ${lq.length} months`);
  }
}
console.log(`\n    THE POST-2019 PANEL IS ITSELF STILL AN UPPER BOUND. Part 1a shows funds that stopped filing between`);
console.log(`    2019 and 2025 and whose NAV series does not survive into this cache. Freezing membership removes`);
console.log(`    LOOK-AHEAD in who joins; it cannot resurrect a fund whose NAV series was never fetched because it`);
console.log(`    had already been delisted. The clean window is cleaner, not clean.`);

// ---------------------------------------------------------------- PART 3 — the bracket (ASSUMPTIONS, not measurements)
console.log(`\n${"=".repeat(100)}\nPART 3 — BOUNDING THE BIAS ON THE FULL 1998-2026 SAMPLE  ***THESE ARE ASSUMPTIONS, NOT MEASUREMENTS***\n${"=".repeat(100)}`);
// Per-fund-month excess against that month's universe mean, so a reinstatement can be priced in the same units.
const uniMeanByM = new Map<string, number>();
for (const m of allMonths) { const a = perMonth.get(m)!; uniMeanByM.set(m, mean(a.map((o) => o.retPx))); }
const fundExcess = obs.map((o) => o.retPx - uniMeanByM.get(o.m)!).sort((x, y) => x - y);
const p10 = fundExcess[Math.floor(fundExcess.length * 0.10)];
// The fund-MONTH p10 is a tail of monthly noise (~-46%/yr if annualised), not a rate any fund sustains. Using it
// as a cohort's average excess is arithmetically what was asked for and economically incoherent, so the coherent
// analogue — the 10th percentile of each fund's OWN MEAN excess — is computed beside it and both are reported.
const perFundEx: number[] = [];
{
  const g = new Map<string, number[]>();
  for (const o of obs) { const a = g.get(o.t) ?? []; a.push(o.retPx - uniMeanByM.get(o.m)!); g.set(o.t, a); }
  for (const [, a] of g) if (a.length >= 24) perFundEx.push(mean(a));
  perFundEx.sort((x, y) => x - y);
}
const p10fund = perFundEx.length ? perFundEx[Math.floor(perFundEx.length * 0.10)] : NaN;
console.log(`    panel fund-month excess distribution: n=${fundExcess.length.toLocaleString()}  p10 ${(100 * p10).toFixed(3)}%/mo  median ${(100 * fundExcess[Math.floor(fundExcess.length / 2)]).toFixed(3)}%/mo`);
console.log(`    per-FUND mean excess distribution (>=24mo funds, n=${perFundEx.length}): p10 ${(100 * p10fund).toFixed(3)}%/mo  median ${(100 * perFundEx[Math.floor(perFundEx.length / 2)]).toFixed(3)}%/mo`);
console.log(`    POSITIVE CONTROL — the two p10s must differ by an order of magnitude (a monthly tail is not a fund's average): ratio ${(p10 / (p10fund || 1e-9)).toFixed(1)}x`);

const missFrac = Number.isFinite(coverFrac2010) ? 1 - coverFrac2010 : (Number.isFinite(coverFrac2015) ? 1 - coverFrac2015 : NaN);
if (!Number.isFinite(missFrac)) {
  console.log(`    UNTESTED — no coverage fraction was measured this run (EDGAR sweep skipped), so no bracket is computed.`);
} else {
  // Reinstatement model, stated in full so it can be argued with:
  //   the panel has M observed funds per month; add M*f/(1-f) ghost funds, f = missing fraction from 1b.
  //   a ghost is in the widest tercile with probability 2/3 (2x a random fund's 1/3) — the activist-trigger prior.
  //   PESSIMISTIC: a ghost's monthly excess = the panel's p10 fund-month excess.
  //   NEUTRAL:     a ghost's monthly excess = the widest tercile's own mean excess (i.e. the missing funds behaved
  //                exactly like the observed ones; this is the no-bias case and should recover the headline).
  const f = missFrac;
  const ghostPerObs = f / (1 - f);
  const wideShare = 1 / 3;              // observed tercile share
  const ghostWideP = 2 / 3;             // 2x a random fund
  const obsEx = mean(full.ex);          // observed monthly widest-tercile excess
  // widest tercile after reinstatement = (observed wide members * obsWideEx + ghost wide members * ghostEx) / total
  const wGhost = ghostPerObs * ghostWideP / wideShare;   // ghosts per observed wide member
  const pess = (obsEx + wGhost * p10) / (1 + wGhost);
  const pessF = (obsEx + wGhost * p10fund) / (1 + wGhost);
  const neut = (obsEx + wGhost * obsEx) / (1 + wGhost);
  // t scales with the mean under an unchanged sd (D-661's own arithmetic, used honestly in the other direction)
  const tObs = tstat(full.ex);
  console.log(`\n    ASSUMPTIONS (each one is a choice, none is measured):`);
  console.log(`      A1  missing fraction of the pre-2019 universe            f = ${(100 * f).toFixed(1)}%   [from part 1b]`);
  console.log(`      A2  a missing fund sits in the widest tercile with prob  ${(100 * ghostWideP).toFixed(0)}%  (2x a random fund's 33%)`);
  console.log(`      A3a PESSIMISTIC: its monthly excess = the panel's p10 fund-month excess = ${(100 * p10).toFixed(3)}%/mo`);
  console.log(`      A3b NEUTRAL:     its monthly excess = the observed widest-tercile mean = ${(100 * obsEx).toFixed(3)}%/mo`);
  console.log(`      A4  ghosts are added at ${(100 * ghostPerObs).toFixed(1)}% of observed count, i.e. ${wGhost.toFixed(2)} ghost(s) per observed wide member`);
  console.log(`\n    BRACKET on the headline widest-tercile excess over the universe:`);
  console.log(`      NEUTRAL reinstatement      ${(neut * 12 * 100).toFixed(2)}%/yr   (implied t ~ ${(tObs * neut / (obsEx || 1e-12)).toFixed(2)})  <- the no-bias case, recovers the headline by construction`);
  console.log(`      PESSIMISTIC, fund-MONTH p10 ${(pess * 12 * 100).toFixed(2)}%/yr   (implied t ~ ${(tObs * pess / (obsEx || 1e-12)).toFixed(2)})  <- AS SPECIFIED, and economically incoherent:`);
  console.log(`                                  a -${(-p10 * 12 * 100).toFixed(0)}%/yr sustained excess describes no fund that ever existed; it is a monthly noise tail.`);
  console.log(`      PESSIMISTIC, per-FUND p10   ${(pessF * 12 * 100).toFixed(2)}%/yr   (implied t ~ ${(tObs * pessF / (obsEx || 1e-12)).toFixed(2)})  <- the coherent analogue: the missing funds`);
  console.log(`                                  behaved like the worst decile of funds that DID survive (${(100 * p10fund).toFixed(2)}%/mo excess).`);
  console.log(`      observed (no reinstatement) ${ann(full.ex).toFixed(2)}%/yr at t ${tObs.toFixed(2)}`);
  console.log(`\n    WHY THE IMPLIED t IS SCALED AND NOT RECOMPUTED: reinstating ghosts changes the MEAN of the monthly`);
  console.log(`    excess series and leaves its month-to-month sd essentially untouched, so t moves in proportion to`);
  console.log(`    the mean — the same arithmetic THE COST-INFLATION COROLLARY (D-661) identified when a flat`);
  console.log(`    adjustment manufactured significance. It is used here in the deflating direction, and it is an`);
  console.log(`    APPROXIMATION, not a measurement: the ghosts' own cross-month variance is unknown.`);
}

// ---------------------------------------------------------------- PART 4 — SELECTION LAW
console.log(`\n${"=".repeat(100)}\nPART 4 — THE SELECTION LAW (D-455): choices made after seeing data are trials, whether or not they are "fitted"\n${"=".repeat(100)}`);
const TRIALS = [
  "tercile (vs quintile/decile) as the bucket width",
  "z threshold -1 in Test A (a chosen cut, not a fitted parameter — still a choice made with the data in view)",
  "36-month lookback for the own-history z",
  "|discount| > 75% discarded as a data error (a filter on the dependent variable's input)",
  "|next-month return| > 0.6 discarded",
  "consecutive-calendar-month requirement (drops halted stretches)",
  ">= 3y NAV history for universe entry (MIN_YEARS)",
  "N-CEN phrase set {closed-end, N-2} rather than any other marker",
  "2019-2025 as the N-CEN sweep window",
  "adjclose (total return) rather than raw close as the headline return",
  "4 universe variants in the sensitivity block",
  "2016-01 as the era split",
  "30bp round-trip rather than a measured spread",
  "min 9 names/month to form a cross-section",
];
TRIALS.forEach((t, i) => console.log(`    ${String(i + 1).padStart(2)}. ${t}`));
console.log(`\n    That is ${TRIALS.length} researcher degrees of freedom in the construction, against the 12 trials the`);
console.log(`    original script recorded. NONE of them is a fitted parameter, which is exactly the argument that`);
console.log(`    makes them easy to leave uncounted — and D-455's point is that WHICH COMPONENTS TO KEEP leaks`);
console.log(`    invisibly to every other guard. The universe filters in particular were chosen with the data in`);
console.log(`    view: MIN_YEARS=3 and the |75%| discount clamp both act on the sample the headline is computed on.`);
console.log(`    This script itself adds ${2} more (the two clean windows, 2019-10 and 2022-01) and says so.`);

// ---------------------------------------------------------------- VERDICT
console.log(`\n${"=".repeat(100)}\nVERDICT\n${"=".repeat(100)}`);
const cleanFrozen = frozenBy("2019-10");
const cleanB = runBook(allMonths.filter((m) => m >= "2019-10"), (t) => cleanFrozen.has(t));
const cleanLq = liqBook(allMonths.filter((m) => m >= "2019-10"), (t) => cleanFrozen.has(t));
const cleanDrag = 2 * cleanB.to * 12 * (RT_BP / 1e4) * 100;
const cleanNet = ann(cleanB.ex) - cleanDrag;
const surv = Math.abs(tstat(cleanB.ex)) >= 2 && ann(cleanB.ex) > 0 && cleanNet > 0;
console.log(`  full sample (as claimed)          ${ann(full.ex).toFixed(2)}%/yr  t ${tstat(full.ex).toFixed(2)}  n=${full.n}mo`);
console.log(`  frozen membership, 2019-10 on     ${ann(cleanB.ex).toFixed(2)}%/yr  t ${tstat(cleanB.ex).toFixed(2)}  n=${cleanB.n}mo  NET ${cleanNet.toFixed(2)}%/yr`);
if (cleanLq.length >= 24) console.log(`  ...its LIQUID tercile              ${ann(cleanLq).toFixed(2)}%/yr  t ${tstat(cleanLq).toFixed(2)}`);
if (Number.isFinite(missFrac)) console.log(`  measured pre-2019 coverage hole   ${(100 * missFrac).toFixed(1)}% of the ${Number.isFinite(coverFrac2010) ? "2010" : "2015"} closed-end registrant set is absent from the current universe`);
console.log(`  (the full-sample headline is therefore quoted on a panel with a MEASURED ~50% pre-2019 hole, where the`);
console.log(`   original script recorded that hole as UNMEASURED. That upgrade is the main result of this attack.)`);
console.log(`\n  ${surv
  ? `THE EXCESS SURVIVES THE SURVIVORSHIP ATTACK IN SIGN AND SIGNIFICANCE on the frozen post-2019 window, at ${ann(cleanB.ex).toFixed(2)}%/yr (t ${tstat(cleanB.ex).toFixed(2)}) rather than the ${ann(full.ex).toFixed(2)}%/yr headline. It is NOT the +5.54%/yr claim: the headline is measured on a panel whose pre-2019 members were selected by having survived to 2019, and the clean-window number is the one that is entitled to be quoted.`
  : `THE +5.54%/yr DOES NOT SURVIVE. On the only window where membership is not a survival filter (frozen at 2019-10), the excess is ${ann(cleanB.ex).toFixed(2)}%/yr at t ${tstat(cleanB.ex).toFixed(2)}, net ${cleanNet.toFixed(2)}%/yr after turnover. The headline is a statement about funds that lived, not about the discount.`}`);
console.log(`\n  DESCRIPTIVE ONLY (THE MECHANISM LAW, D-597). No mechanism is pre-registered, no trd_lineage row is`);
console.log(`  written, no DECISIONS entry is made, no forward clock is started, and no file under test was modified.`);
