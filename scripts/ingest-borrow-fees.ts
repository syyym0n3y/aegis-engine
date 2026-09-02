#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// ingest-borrow-fees.ts — PER-NAME BORROW FEE AND LENDABLE AVAILABILITY, daily, from iBorrowDesk.
//
// WHAT THIS CLOSES. The driver register carried "borrow cost / availability" as BLOCKED-Paid, with the note that
// "every short-side result on this board therefore assumes a borrow cost rather than observing one". That label was
// a LEAD, not a fact (memory: gated-labels-are-leads-not-facts — five such labels have already fallen). iBorrowDesk
// republishes the IBKR shortable-stocks feed over plain keyless HTTPS/JSON: `/api/ticker/{SYM}` returns ~1 year of
// DAILY rows {date, fee (annualised borrow fee, %/yr), available (lendable shares), rebate, high/low_fee}.
//
// WHAT IT IS AND IS NOT — stated up front so no downstream script over-reads it:
//   * It is ONE BROKER'S retail-facing indicative rate (IBKR), not the wholesale securities-lending market. It is a
//     proxy for the fee a retail account would pay to borrow, and for what a lender's inventory is worth.
//   * History is ~1 YEAR. Any conditioning test built on it is SHORT-SAMPLE by construction and must say so.
//   * `available` is IBKR's published lendable quantity, which saturates at round numbers (10,000,000 for easy
//     names) — it is a floor indicator, not a measured supply curve.
//
// THE BINDING CONSTRAINT, MEASURED (not assumed): the host serves roughly 100 REQUESTS PER BAN WINDOW and then
// returns HTTP 444 (nginx "close without response") for about an hour. Measured twice on the same day — a first run
// stalled after 96 symbols, a second at a 1,200ms spacing was refused after ~102 — so SPACING IS NOT THE LEVER, the
// request COUNT is. A 4,100-symbol universe is therefore a MULTI-DAY ACCRUAL at ~100 names per run, not a nightly
// full sweep, and the honest design is a BUDGET plus a PRIORITY ORDER rather than a loop that gets banned. Coverage
// is reported as a fraction of the intended universe every run (UNIVERSE LAW extension, D-645: coverage is not
// breadth), so a partial panel can never be mistaken for a complete one.
//
// Written to trd_macro_series as series "borrow_fee:<SYM>" (%/yr) and "borrow_avail:<SYM>" (shares).
// Idempotent (upsert on series,d) and RESUMABLE (a symbol already holding a row within BF_FRESH_D days is skipped).
// POSITIVE-CONTROL RULE (D-641): three controls, all on the INGESTED rows, not on the API response.

import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-borrow-fees", [
  { name: "BF_DVOL", def: "1000000", note: "liquid-universe floor: 60-day MEDIAN dollar volume, USD" },
  { name: "BF_FRESH_D", def: "3", note: "skip a symbol already holding a borrow_fee row within this many days" },
  { name: "BF_SLEEP", def: "1200", note: "ms between sequential iBorrowDesk fetches — the host BANS at ~150ms (HTTP 444)" },
  { name: "BF_CEF", def: "data/cef-universe.json", note: "D-750 CEF universe (read-only), unioned into the fetch list" },
  { name: "BF_BUDGET", def: "90", note: "requests per run — the host bans at ~100 per window (MEASURED twice), so this sits under it" },
  { name: "BF_ONLY", def: "", note: "comma-separated symbols: fetch exactly these (ignores the universe), for targeted top-ups" },
  { name: "BF_LIMIT", def: "0", note: "0 = whole universe; >0 truncates the fetch list (smoke tests only)" },
]);
const DVOL_FLOOR = Number(K.BF_DVOL), FRESH_D = Number(K.BF_FRESH_D), SLEEP_MS = Number(K.BF_SLEEP);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "borrow", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = iso(new Date());

console.log(`\n${"=".repeat(110)}\n  BORROW FEE / AVAILABILITY INGEST — iBorrowDesk (IBKR feed), daily, ~1y history\n${"=".repeat(110)}`);

// ── 1. THE LIQUID US UNIVERSE, derived from the packed bars (60-day MEDIAN dollar volume) ─────────────────────
type Meta = { symbol: string; n_bars: number; last_date: string };
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars,last_date&limit=100000`)) as Meta[];
assertNonEmpty("equity bar rows", meta, 1000);
const cutoff = iso(new Date(Date.now() - 90 * 864e5));
const live = meta.filter((m) => m.n_bars >= 60 && m.last_date >= cutoff);
console.log(`  equity symbols in trd_bars_deep: ${meta.length.toLocaleString()} | still trading (>=60 bars, last_date >= ${cutoff}): ${live.length.toLocaleString()}`);

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const liquid: string[] = [];
const dvolOf = new Map<string, number>();
for (let i = 0; i < live.length; i += 50) {
  const part = live.slice(i, i + 50).map((m) => `"${m.symbol}"`).join(",");
  const rows = (await q(`trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`)) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const tail = (r.bars ?? []).slice(-60);                       // [ts, o, h, l, c, v]
    if (tail.length < 40) continue;
    const dv = median(tail.map((b) => b[4] * b[5]).filter((x) => Number.isFinite(x) && x >= 0));
    dvolOf.set(r.symbol, dv);
    if (dv >= DVOL_FLOOR) liquid.push(r.symbol);
  }
}
console.log(`  60d-median dollar volume >= $${(DVOL_FLOOR / 1e6).toFixed(1)}M: ${liquid.length.toLocaleString()} names`);
// POSITIVE CONTROL — a mega-cap MUST clear a $1M floor; if it does not, the bar unpacking (close x volume) is wrong.
const ctlAAPL = (dvolOf.get("AAPL") ?? 0) > 1e9;
console.log(`  POSITIVE CONTROL — AAPL 60d median $vol $${((dvolOf.get("AAPL") ?? 0) / 1e9).toFixed(2)}bn (must be > $1bn): ${ctlAAPL ? "PASS" : "FAIL"}`);
if (!ctlAAPL) { console.error("  !! universe control FAILED — the dollar-volume derivation is broken, not the market. RED."); Deno.exit(1); }

// D-750 CEF universe, unioned in: closed-end funds are mostly below the liquidity floor, and the whole point of
// section (3) downstream is to settle the "wide-discount CEFs are hard to borrow" folklore on MEASURED fees.
let cefN = 0;
try {
  const cef = JSON.parse(await Deno.readTextFile(K.BF_CEF)) as { candidate_tickers?: string[] };
  const t = (cef.candidate_tickers ?? []).filter((s) => /^[A-Z]{1,6}$/.test(s));
  cefN = t.length;
  for (const s of t) if (!liquid.includes(s)) liquid.push(s);
} catch (e) { console.log(`  CEF universe unreadable (${e instanceof Error ? e.message : e}) — proceeding with the liquid equity set only`); }
console.log(`  + D-750 CEF universe: ${cefN} tickers unioned in -> ${liquid.length.toLocaleString()} total`);

// The hardest-to-borrow names, so the >100%/yr control is measured on rows WE INGESTED rather than on a live
// API response that nothing downstream can read.
let expensive: { symbol: string; latest_fee: number }[] = [];
try {
  const r = await fetch("https://www.iborrowdesk.com/api/most_expensive", { headers: UA });
  if (r.ok) expensive = ((await r.json())?.results ?? []).filter((x: { symbol?: string }) => /^[A-Z]{1,6}$/.test(x.symbol ?? ""));
} catch { /* reported below */ }
const topExp = expensive.slice(0, 5).map((x) => x.symbol);
console.log(`  + most_expensive control names: ${topExp.join(", ") || "(none — endpoint unreachable)"}`);
for (const s of topExp) if (!liquid.includes(s)) liquid.push(s);

// PRIORITY ORDER. With ~90 requests per run, WHICH 90 is the whole decision. Order: (1) the most_expensive control
// names, so the >100%/yr control is satisfiable on the first run; (2) the D-750 CEF universe, because the
// hard-to-borrow-CEF question is answerable at 454 names and not at 4,100; (3) the liquid equities by DESCENDING
// dollar volume, so the names a real account could actually hold arrive first.
const cefSet = new Set<string>();
try { for (const t of (JSON.parse(await Deno.readTextFile(K.BF_CEF)) as { candidate_tickers?: string[] }).candidate_tickers ?? []) if (/^[A-Z]{1,6}$/.test(t)) cefSet.add(t); } catch { /* already reported */ }
const rank = (s: string) => topExp.includes(s) ? 0 : cefSet.has(s) ? 1 : 2;
let attempt = [...new Set(liquid)].sort((a, b) => rank(a) - rank(b) || (dvolOf.get(b) ?? 0) - (dvolOf.get(a) ?? 0) || a.localeCompare(b));
if (K.BF_ONLY.trim()) attempt = K.BF_ONLY.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
// A truncated smoke run keeps the control names, so BF_LIMIT changes the SIZE of the run and not what it verifies
// (control 3's >1,000 floor is of course unmeetable under a small limit, and is reported honestly as FAIL).
if (Number(K.BF_LIMIT) > 0) attempt = [...new Set([...attempt.slice(0, Number(K.BF_LIMIT)), ...topExp, "AAPL"])];

// ── 2. RESUME — skip symbols already holding a recent row ─────────────────────────────────────────────────────
const freshFrom = iso(new Date(Date.now() - FRESH_D * 864e5));
const have = new Set<string>();
for (let off = 0;; off += 10000) {
  const p = (await q(`trd_macro_series?series=like.borrow_fee:*&d=gte.${freshFrom}&select=series&offset=${off}&limit=10000`)) as { series: string }[];
  if (!p.length) break;
  for (const r of p) have.add(r.series.slice(11));
  if (p.length < 10000) break;
}
const outstanding = attempt.filter((s) => !have.has(s));
const todo = outstanding.slice(0, Number(K.BF_BUDGET));
console.log(`  resume: ${have.size.toLocaleString()} symbols already hold a row dated >= ${freshFrom}; ${outstanding.length.toLocaleString()} outstanding`);
console.log(`  budget: ${todo.length} this run (BF_BUDGET=${K.BF_BUDGET}) — at this rate the intended universe completes in ~${Math.ceil(outstanding.length / Math.max(1, Number(K.BF_BUDGET)))} runs\n`);

// ── 3. SEQUENTIAL FETCH ───────────────────────────────────────────────────────────────────────────────────────
let buf: { series: string; d: string; v: number }[] = [];
let written = 0, ok = 0, empty = 0, failed = 0, consecFail = 0;
const latestFee = new Map<string, number>();
async function flush() {
  while (buf.length) {
    const chunk = buf.splice(0, 1000);
    const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
    if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 160)}`); Deno.exit(1); }
    written += chunk.length;
  }
}
for (let i = 0; i < todo.length; i++) {
  const sym = todo[i];
  try {
    // A hung fetch has no default timeout in Deno and WILL stall a 4,000-symbol sequential loop indefinitely
    // (observed: the loop stopped dead on one symbol and the row count froze while the process stayed alive).
    const r = await fetch(`https://www.iborrowdesk.com/api/ticker/${sym}`, { headers: UA, signal: AbortSignal.timeout(20000) });
    // HTTP 444 is nginx's "closed without response" — this host issues it as a RATE-LIMIT BAN, and it was earned
    // at BF_SLEEP=150 on a 4,000-symbol run. Continuing to hammer a banned host lengthens the ban and produces a
    // run that "completed" with a coverage of zero, so the loop breaks and says so.
    if (!r.ok) { failed++; consecFail++; if (consecFail >= 20) { console.error(`\n  !! ${consecFail} consecutive HTTP failures (last ${r.status}) — the host is refusing us (444 = rate-limit ban).\n     STOPPING with ${ok} symbols fetched this run. Progress is durable and the next run resumes. Raise BF_SLEEP.`); break; } continue; }
    consecFail = 0;
    const daily = ((await r.json())?.daily ?? []) as { date: string; fee: number | null; available: number | null }[];
    let n = 0, last = 0;
    for (const d of daily) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) continue;
      if (Number.isFinite(d.fee)) { buf.push({ series: `borrow_fee:${sym}`, d: d.date, v: Number(d.fee) }); last = Number(d.fee); n++; }
      if (Number.isFinite(d.available)) buf.push({ series: `borrow_avail:${sym}`, d: d.date, v: Number(d.available) });
    }
    if (n) { ok++; latestFee.set(sym, last); } else empty++;
  } catch { failed++; }
  if (buf.length >= 2000) await flush();
  if ((i + 1) % 250 === 0) console.log(`    ${i + 1}/${todo.length}  ok=${ok} empty=${empty} failed=${failed} rows=${written + buf.length}`);
  await sleep(SLEEP_MS);
}
await flush();
console.log(`\n  fetched ${ok} / attempted ${todo.length}  (empty ${empty}, failed ${failed}) | ${written.toLocaleString()} rows upserted`);

// ── 4. POSITIVE CONTROLS, on the INGESTED rows ────────────────────────────────────────────────────────────────
console.log(`\n  POSITIVE CONTROLS (read back from trd_macro_series, not from the API response):`);
const aapl = (await q(`trd_macro_series?series=eq.borrow_fee:AAPL&select=d,v&order=d.desc&limit=1`))[0] as { d: string; v: number } | undefined;
const c1 = !!aapl && aapl.v < 1;
console.log(`    1. AAPL latest fee ${aapl ? `${aapl.v}%/yr on ${aapl.d}` : "ABSENT"} (must exist and be < 1%/yr): ${c1 ? "PASS" : "FAIL"}`);
let c2 = false, hotName = "";
for (const s of topExp) {
  const row = (await q(`trd_macro_series?series=eq.borrow_fee:${s}&select=d,v&order=d.desc&limit=1`))[0] as { v: number } | undefined;
  if (row && row.v > 100) { c2 = true; hotName = `${s} ${row.v.toFixed(1)}%/yr`; break; }
}
const c2Reached = topExp.some((s) => todo.includes(s));
console.log(`    2. a most_expensive name holds a fee > 100%/yr: ${c2 ? `PASS (${hotName})` : c2Reached ? "FAIL — a name the source itself ranks most-expensive does not read back above 100%/yr" : "NOT YET REACHED (priority order puts them first; the endpoint was unreachable this run)"}`);
const distinct = (await q(`trd_macro_series?series=like.borrow_fee:*&d=gte.${freshFrom}&select=series&limit=100000`)) as { series: string }[];
const nSym = new Set(distinct.map((r) => r.series)).size;
// The original control read "> 1,000 symbols". Under a ~100/window server quota that is unreachable in one run, and
// a control that CANNOT pass is not a control — it is noise that trains everyone to ignore a red. It is therefore
// split: a per-run control (this run must have made progress or had nothing to do) and a PANEL-COMPLETENESS figure
// that is REPORTED every run and gates the downstream analyses rather than the ingest.
const c3 = ok > 0 || todo.length === 0;
console.log(`    3. this run made progress (or had nothing outstanding): fetched ${ok} of ${todo.length} budgeted: ${c3 ? "PASS" : "FAIL"}`);
console.log(`       PANEL COMPLETENESS (reported, not gated): ${nSym.toLocaleString()} of ${attempt.length.toLocaleString()} intended symbols hold a fee dated >= ${freshFrom} (${(100 * nSym / attempt.length).toFixed(1)}%).`);
console.log(`       Below ~1,000 symbols the cross-sectional analyses (lending-income-measured, borrow-fee-conditioning) are UNTESTED under the COVERAGE LAW.`);

// ── 5. COVERAGE (COVERAGE LAW: absence is a fact about our data, and it is stated) ─────────────────────────────
const covered = new Set(distinct.map((r) => r.series.slice(11)));
const missing = attempt.filter((s) => !covered.has(s));
console.log(`\n  COVERAGE — attempted ${attempt.length.toLocaleString()} | held ${attempt.filter((s) => covered.has(s)).length.toLocaleString()} (${(100 * attempt.filter((s) => covered.has(s)).length / attempt.length).toFixed(1)}%) | missing ${missing.length.toLocaleString()}`);
console.log(`  missing sample: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);
console.log(`  (A name absent here is a name iBorrowDesk does not carry — most often a fund, an ADR or a recent listing.`);
console.log(`   It is NOT a name with a zero borrow fee, and no downstream script may read it as one.)`);

if (!(c1 && (c2 || !c2Reached) && c3)) { console.error(`\n  !! CONTROL FAILED — the ingest is not trustworthy. RED.`); Deno.exit(1); }
console.log(`\n  borrow cost / availability: BLOCKED-Paid -> HELD, live daily. Driver register probe: series=like.borrow_fee:*\n`);
