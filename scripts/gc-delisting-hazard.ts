#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// gc-delisting-hazard.ts (W4) — PREREG W4-gc-predicts-delisting.
//
// WHY THIS TEST EXISTS, AND WHY IT REPLACED THE ONE I MEANT TO RUN. The intended test was whether going-concern
// language predicts RETURNS. It is structurally blocked: `trd_bars_deep` holds 4 delisted names out of 4,348, so the
// population of interest — companies that may fail — is 99.9% unobservable in our price panel. Measuring returns
// there would measure companies that got a going-concern opinion AND SURVIVED, which is close to the opposite of
// the hypothesis. Reporting that as a null would be a statement about our data narrated as one about the market:
// exactly the failure THE COVERAGE LAW was written for.
//
// This version needs no prices. Both sides are event records keyed on CIK, and the SEC retains every registrant's
// filing history permanently — including companies with no ticker and no exchange. That makes it SURVIVORSHIP-FREE
// BY CONSTRUCTION rather than by correction, which is the rarest property in this programme's history.
//
// WHAT IT DOES AND DOES NOT SHOW. It tests whether the TEXT CARRIES INFORMATION ABOUT FIRM OUTCOMES. It does not
// test tradability and must never be reported as if it did — D-516 already measured delisting notices themselves at
// -42.6%/yr, t -3.98, and found them structurally uncollectable because the names cannot be borrowed. Information
// and tradability are different claims; THE INSTRUMENT LAW exists because this programme conflated them four times.
//
// THE CONTROL IS THE WHOLE POINT. Flagged filers are microcaps and microcaps delist often, so the comparison is
// against OTHER 10-K FILERS drawn from the same calendar years, not against the market. A hazard ratio measured
// against an unmatched base rate would be the D-590 shape: a pooled number carrying a composition effect.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("gc-delisting-hazard", [
  { name: "HORIZON_D", def: "365", note: "days after the reference filing to look for a 3.01" },
  { name: "EXCLUDE_D", def: "90", note: "mechanical-cooccurrence window, also reported excluded" },
  { name: "N_CONTROL", def: "1500", note: "control filers sampled, year-matched" },
  { name: "N_FLAGGED", def: "1500", note: "0 = all" },
  { name: "SLEEP_MS", def: "130", note: "SEC allows 10/s; this is under" },
  { name: "CACHE", def: "/tmp/aegis-sec-submissions", note: "on-disk cache; re-runs are free" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = "Aegis Research ona@revitalise.io";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gch", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const CACHE = K.CACHE, SLEEP = Number(K.SLEEP_MS);
const HORIZON = Number(K.HORIZON_D), EXCL = Number(K.EXCLUDE_D);
try { Deno.mkdirSync(CACHE, { recursive: true }); } catch { /* exists */ }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad10 = (c: string) => c.replace(/\D/g, "").padStart(10, "0");
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

// ---- flagged filers: earliest going-concern 10-K per CIK ----
const flaggedFirst = new Map<string, string>();
for (let off = 0;; off += 10000) {
  const rows = await fetch(`${OWNED}/trd_raw_filings?source=eq.edgar&filing_type=like.*going-concern*&select=disclosed_date,raw&offset=${off}&limit=10000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { disclosed_date: string; raw: { cik?: string } }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    const c = r.raw?.cik ? pad10(r.raw.cik) : null;
    if (!c) continue;
    // SYMMETRY WITH THE CONTROL, and both sides had the same defect. Keying on the firm's FIRST-EVER going-concern
    // filing left-censors exactly as the control did: 1,129 of 4,006 filers (28.2%) get a 2012 reference date purely
    // because that is when the window opens, not because 2012 is when their distress began. Fixing only the control
    // would have compared a left-censored flagged set against an uncensored control — an asymmetry worse than the
    // original artifact. Both sides are now one row per (CIK, year), so the comparison is exactly:
    //   "a firm filing a GOING-CONCERN 10-K in year Y"  vs  "a firm filing an ORDINARY 10-K in year Y".
    const key = `${c}|${r.disclosed_date.slice(0, 4)}`;
    const prev = flaggedFirst.get(key);
    if (!prev || r.disclosed_date < prev) flaggedFirst.set(key, r.disclosed_date);
  }
  if (rows.length < 10000) break;
}
assertNonEmpty("flagged filer-years", [...flaggedFirst.keys()], 500);
// A firm flagged in ANY year is excluded from the control in EVERY year — otherwise the same company appears on
// both sides of the comparison and the contrast is diluted by construction.
const flaggedCiks = new Set([...flaggedFirst.keys()].map((k) => k.split("|")[0]));

// ---- control: 10-K filers from the SAME years, never flagged ----
const yearsNeeded = [...new Set([...flaggedFirst.values()].map((d) => d.slice(0, 4)))].sort();
const controlFirst = new Map<string, string>();
for (const y of yearsNeeded) {
  for (const q of ["QTR1", "QTR2", "QTR3", "QTR4"]) {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/${q}/form.idx`;
    let txt = "";
    const cf = `${CACHE}/idx-${y}-${q}.txt`;
    try { txt = Deno.readTextFileSync(cf); } catch {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA } });
        if (!r.ok) continue;
        txt = await r.text();
        Deno.writeTextFileSync(cf, txt);
        await sleep(SLEEP);
      } catch { continue; }
    }
    for (const line of txt.split("\n")) {
      if (!line.startsWith("10-K ")) continue;
      // fixed-width: form(12) name(62) cik(12) date(12) file
      const m = line.match(/^10-K\s+.{1,70}?\s+(\d{4,10})\s+(\d{4}-\d{2}-\d{2})\s/);
      if (!m) continue;
      const c = pad10(m[1]), d = m[2];
      if (flaggedCiks.has(c)) continue;   // never let a flagged firm sit in the control, in ANY year
      // ONE ROW PER (CIK, YEAR), NOT PER CIK. Keying on the firm's FIRST 10-K in the window is left-censoring: every
      // company already filing in 2012 gets a 2012 reference date regardless of its actual age. Measured on the real
      // index, that put 50.0% of control firms in 2012 and left later years populated almost entirely by NEWLY
      // REGISTERED filers — a population with its own delisting hazard, which is a composition effect, not a control.
      // The matched comparison is "a firm filing a 10-K in year Y" against "a firm filing a GOING-CONCERN 10-K in
      // year Y", so the reference event must be an ordinary 10-K in that same year.
      const key = `${c}|${d.slice(0, 4)}`;
      const prev = controlFirst.get(key);
      if (!prev || d < prev) controlFirst.set(key, d);
    }
  }
}
assertNonEmpty("control CIKs", [...controlFirst.keys()], 500);

// ---- sample, year-matched so the comparison is not a calendar artifact ----
const byYear = <T,>(m: Map<string, string>) => {
  const o = new Map<string, string[]>();
  for (const [c, d] of m) { const y = d.slice(0, 4); (o.get(y) ?? o.set(y, []).get(y)!).push(c); }
  return o;
};
const fy = byYear(flaggedFirst), cy = byYear(controlFirst);
const NF = Number(K.N_FLAGGED), NC = Number(K.N_CONTROL);
// Deterministic pick (sort, then stride) rather than randomness — a re-run must give the identical sample, or the
// trial count means nothing.
const pick = (arr: string[], n: number) => { const s = [...arr].sort(); if (s.length <= n) return s;
  const step = s.length / n, out: string[] = []; for (let i = 0; i < n; i++) out.push(s[Math.floor(i * step)]); return out; };

const flagSel: [string, string][] = [], ctrlSel: [string, string][] = [];
const totF = [...fy.values()].reduce((a, b) => a + b.length, 0);
for (const [y, arr] of fy) {
  const share = NF > 0 ? Math.max(1, Math.round(NF * arr.length / totF)) : arr.length;
  for (const k of pick(arr, share)) flagSel.push([k.split("|")[0], flaggedFirst.get(k)!]);
  // match the control count per YEAR to the flagged count per year
  const cand = cy.get(y) ?? [];
  const cshare = Math.min(cand.length, Math.max(1, Math.round(NC * arr.length / totF)));
  for (const k of pick(cand, cshare)) ctrlSel.push([k.split("|")[0], controlFirst.get(k)!]);
}
console.log(`==> GOING-CONCERN -> DELISTING HAZARD — PREREG W4-gc-predicts-delisting`);
console.log(`    flagged filer-years ${flaggedFirst.size.toLocaleString()} (sampling ${flagSel.length}) | control 10-K filers ${controlFirst.size.toLocaleString()} (sampling ${ctrlSel.length})`);
console.log(`    horizon ${HORIZON}d | mechanical window excluded ${EXCL}d | year-matched\n`);

// ---- submissions: every 8-K item 3.01 date per CIK ----
async function delistDates(cik: string): Promise<string[] | null> {
  const cf = `${CACHE}/${cik}.json`;
  let txt: string | null = null;
  try { txt = Deno.readTextFileSync(cf); } catch { /* miss */ }
  if (txt === null) {
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) return null;
      txt = await r.text();
      Deno.writeTextFileSync(cf, txt);
      await sleep(SLEEP);
    } catch { return null; }
  }
  try {
    const d = JSON.parse(txt) as { filings?: { recent?: { form?: string[]; items?: string[]; filingDate?: string[] } } };
    const r = d.filings?.recent;
    if (!r?.form) return [];
    const out: string[] = [];
    for (let i = 0; i < r.form.length; i++) {
      if (r.form[i] !== "8-K") continue;
      if (!(r.items?.[i] ?? "").split(",").map((x) => x.trim()).includes("3.01")) continue;
      out.push(r.filingDate![i]);
    }
    return out;
  } catch { return null; }
}

interface Res { n: number; hit: number; hitExcl: number; unresolved: number }
async function run(sel: [string, string][], label: string): Promise<Res> {
  const r: Res = { n: 0, hit: 0, hitExcl: 0, unresolved: 0 };
  let i = 0;
  for (const [cik, ref] of sel) {
    if (++i % 400 === 0) console.log(`    ${label}: ${i}/${sel.length}...`);
    const ds = await delistDates(cik);
    if (ds === null) { r.unresolved++; continue; }
    r.n++;
    const within = ds.filter((d) => { const g = days(ref, d); return g >= 0 && g <= HORIZON; });
    if (within.length) r.hit++;
    if (within.some((d) => days(ref, d) > EXCL)) r.hitExcl++;
  }
  return r;
}

const F = await run(flagSel, "flagged");
const C = await run(ctrlSel, "control");

const rate = (h: number, n: number) => n ? h / n : 0;
const fR = rate(F.hit, F.n), cR = rate(C.hit, C.n);
const fRx = rate(F.hitExcl, F.n), cRx = rate(C.hitExcl, C.n);
const HR = cR > 0 ? fR / cR : NaN, HRx = cRx > 0 ? fRx / cRx : NaN;

// two-proportion z
const z = (h1: number, n1: number, h2: number, n2: number) => {
  if (!n1 || !n2) return 0;
  const p = (h1 + h2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (h1 / n1 - h2 / n2) / se : 0;
};

console.log(`\n    ${"".padEnd(28)}${"flagged".padStart(12)}${"control".padStart(12)}${"hazard".padStart(10)}${"z".padStart(9)}`);
console.log(`    ${"filers resolved".padEnd(28)}${String(F.n).padStart(12)}${String(C.n).padStart(12)}`);
console.log(`    ${`3.01 within ${HORIZON}d`.padEnd(28)}${String(F.hit).padStart(12)}${String(C.hit).padStart(12)}${(Number.isFinite(HR) ? HR.toFixed(2) + "x" : "n/a").padStart(10)}${z(F.hit, F.n, C.hit, C.n).toFixed(2).padStart(9)}`);
console.log(`    ${`  rate`.padEnd(28)}${(100 * fR).toFixed(2).padStart(11)}%${(100 * cR).toFixed(2).padStart(11)}%`);
console.log(`    ${`3.01 in ${EXCL}-${HORIZON}d (no mech.)`.padEnd(28)}${String(F.hitExcl).padStart(12)}${String(C.hitExcl).padStart(12)}${(Number.isFinite(HRx) ? HRx.toFixed(2) + "x" : "n/a").padStart(10)}${z(F.hitExcl, F.n, C.hitExcl, C.n).toFixed(2).padStart(9)}`);
console.log(`    ${`  rate`.padEnd(28)}${(100 * fRx).toFixed(2).padStart(11)}%${(100 * cRx).toFixed(2).padStart(11)}%`);
if (F.unresolved || C.unresolved) console.log(`\n    unresolved CIKs: flagged ${F.unresolved}, control ${C.unresolved} (submissions fetch failed; excluded from both rates)`);

// ---- pre-registered gates, applied mechanically ----
const g1 = Number.isFinite(HR) && HR >= 2.0;
const g2 = Number.isFinite(HRx) && HRx >= 2.0;
const g3 = F.hitExcl >= 30;
console.log(`\n    PRE-REGISTERED GATES:`);
console.log(`      (1) hazard ratio >= 2.0 ......................... ${g1 ? "PASS" : "FAIL"}  (${Number.isFinite(HR) ? HR.toFixed(2) : "n/a"}x)`);
console.log(`      (2) survives excluding the ${EXCL}d mechanical window ${g2 ? "PASS" : "FAIL"}  (${Number.isFinite(HRx) ? HRx.toFixed(2) : "n/a"}x)`);
console.log(`      (3) >= 30 flagged filers reach a 3.01 ........... ${g3 ? "PASS" : "FAIL"}  (${F.hitExcl})`);
console.log(`\n    ${g1 && g2 && g3
  ? "SUPPORTED — the text carries information about firm outcomes, direction MATCHED. NOT a tradability claim: D-516 measured delisting notices at -42.6%/yr and found them uncollectable on borrow."
  : !g3 ? `UNDERPOWERED — only ${F.hitExcl} flagged filers reach a delisting notice outside the mechanical window; the pre-registered floor is 30. UNTESTED, not null.`
  : !g2 && g1 ? "MECHANICAL ONLY — the association lives inside the co-occurrence window and does not survive excluding it. The pre-registered kill condition fires."
  : `NOT SUPPORTED — hazard ratio ${Number.isFinite(HR) ? HR.toFixed(2) : "n/a"}x is below the pre-registered 2.0.`}`);
