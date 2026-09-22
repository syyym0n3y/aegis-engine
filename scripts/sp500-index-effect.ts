#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// sp500-index-effect.ts (D-963) — S&P 500 ADD/DELETE event study: run-up INTO the effective date + post-effective
// reversal, BOTH SIDES, era-decomposed. Forced-flow thesis: trackers MUST buy additions and sell deletions.
//
// RELATION TO PRIOR WORK (D-938 precedent — extend, never clobber): `scripts/index-inclusion-event.ts` (D-740)
// already measured ADDITIONS post-effective at {5,21,63,250}d vs SPY — NULL, prior MATCHED, liquid tercile both
// halves. It is untouched. What D-740 did NOT measure and this script does: (a) the RUN-UP into and including the
// effective date (the forced-buying footprint), (b) DELETIONS (forced selling — the mirror), (c) the mandatory
// era decomposition (the literature says the index effect DECAYED after ~2005 — finding that decay is a success).
//
// ============================== PRE-SPECIFICATION (written BEFORE running) ==============================
// DATA LIMITATION, stated up front: `date` is the EFFECTIVE date (Wikipedia). Announcement dates are typically
// ~5 trading days earlier and are NOT in this data — they are not invented here. Consequence: the run-up window
// is a MEASUREMENT of the forced-flow footprint, not a tradable expression (trading it requires knowing the
// announcement, which this dataset cannot time). The announcement-to-effective pop itself remains UNTESTED (D-740).
//
// REGISTERED DIRECTIONS (SIGN LAW D-553, no post-hoc flips):
//   ADD  run-up  (5 trading days into and including the effective close): POSITIVE  (trackers forced to buy)
//   ADD  reversal (20 trading days after, LAG-1 entry):                   NEGATIVE  (pop reverses / decays)
//   DEL  run-up  (same window):                                           NEGATIVE  (trackers forced to sell)
//   DEL  reversal (same window, LAG-1):                                   POSITIVE  (mirror reversal)
// TRIALS = 3, pre-specified and minimal: {5d run-up}, {20d reversal}, {10d reversal (single alternative)}.
// Eras and add/delete sides are DECOMPOSITIONS of the registered stats, not separate trials. Family
// "sp500-index-effect", runId "D-963-sp500-index-effect", spent via the ledger before any number is read.
//
// EXECUTION LAW (D-498 same-bar corollary): the effective-date close IS the rebalance auction. Any tradable
// expression (the reversal) enters at the FIRST BAR STRICTLY AFTER the effective date — LAG-1. The run-up ends AT
// the effective close and is descriptive only (see above).
//
// BENCHMARK LAW (D-627/630): every event-window return is the EXCESS over SPY measured on the SAME stock-trading-day
// window. Chosen matched control: SPY (the placeable tracker whose forced flow is the hypothesis; a same-window
// market control in the D-740 convention), applied uniformly to every window. Consequence: events before SPY's
// 1993-01-29 inception CANNOT be benchmarked and are reported as UNBENCHMARKED coverage, never as nulls.
//
// COVERAGE LAW (D-641/645): adds and removes with/without panel bars are counted and reported. Deleted names are
// often MISSING from the panel (acquired/renamed/delisted) — that is survivorship in this panel, stated as a
// number; a null on missing names is UNTESTED, not evidence. If fewer than ~80 events have usable windows the
// verdict is UNDERPOWERED, with the n required stated.
//
// ERAS (mandatory decomposition): pre-2000 (floored at 1993-02 by SPY), 2000-2010, 2010-2020, 2020-2026.
// TRAIN/TEST (SELECTION LAW D-455): the only tradable expression is the LAG-1 reversal; the rule is formed on the
// first 2/3 of events chronologically and applied frozen to the last 1/3.
// EFFECT-SIZE LAW: any positive result is stated in bp per event against a 20bp round-trip cost (index members are
// liquid large caps by construction — the LIQUIDITY LAW is satisfied by the universe itself; D-740 additionally
// verified the liquid-tercile decomposition on the adds side).
// ========================================================================================================
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("sp500-index-effect", [
  { name: "SIE_SRC", def: "data/sp500-changes.json", note: "from ingest-sp500-changes.ts (D-740)" },
  { name: "SIE_RUN_ID", def: "D-963-sp500-index-effect" },
]);
const RUNUP = 5, REV = 20, REV_ALT = 10; // pre-specified; changing these is a NEW trial
const COST_BP = 20;                      // round-trip cost assumption, liquid large caps

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sie", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q: sq } = mkStrictRead(OWNED, hdr);

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / Math.max(1, a.length);

const barCache = new Map<string, number[][]>();
async function bars(sym: string): Promise<number[][]> {
  if (barCache.has(sym)) return barCache.get(sym)!;
  const raw = await sq(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  const b = ((raw?.[0]?.bars || []) as number[][]).filter((x) => x[4] > 0);
  barCache.set(sym, b);
  return b;
}

// ---- events ----
interface Chg { date: string; added: string | null; removed: string | null }
const src = JSON.parse(await Deno.readTextFile(new URL(`../${K.SIE_SRC}`, import.meta.url))) as { source: string; date_span: string[]; changes: Chg[] };
const tickOK = (s: string | null): s is string => !!s && /^[A-Z][A-Z.\-]{0,5}$/.test(s);
interface Ev { date: string; sym: string; kind: "ADD" | "DEL" }
const events: Ev[] = [];
for (const c of src.changes) {
  if (tickOK(c.added)) events.push({ date: c.date, sym: c.added, kind: "ADD" });
  if (tickOK(c.removed)) events.push({ date: c.date, sym: c.removed, kind: "DEL" });
}
events.sort((a, b) => a.date.localeCompare(b.date));
assertNonEmpty("S&P500 add/delete events", events, 100);
const nAddsAll = events.filter((e) => e.kind === "ADD").length, nDelsAll = events.filter((e) => e.kind === "DEL").length;

// ---- benchmark: SPY ----
const spyBars = await bars("SPY");
assertNonEmpty("SPY bars", spyBars, 1000);
const spyDates = spyBars.map((b) => iso(b[0]));
function spyAt(d: string): number | null { // last SPY close on or before d; null before inception
  let lo = 0, hi = spyDates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (spyDates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? spyBars[ans][4] : null;
}
const SPY_MIN = spyDates[0];

// ---- measure ----
interface Obs { date: string; sym: string; runup: number | null; rev20: number | null; rev10: number | null }
const obs: Record<"ADD" | "DEL", Obs[]> = { ADD: [], DEL: [] };
const cov = { ADD: { total: 0, preSpy: 0, noBars: 0, notCovered: 0, usable: 0, miss: [] as string[] }, DEL: { total: 0, preSpy: 0, noBars: 0, notCovered: 0, usable: 0, miss: [] as string[] } };

for (const ev of events) {
  const c = cov[ev.kind];
  c.total++;
  if (ev.date < SPY_MIN) { c.preSpy++; continue; }              // UNBENCHMARKED — no SPY control exists
  const b = await bars(ev.sym);
  if (!b.length) { c.noBars++; c.miss.push(ev.sym); continue; }
  const dt = b.map((x) => iso(x[0]));
  let i0 = -1;                                                   // first bar STRICTLY AFTER the effective date
  for (let i = 0; i < dt.length; i++) if (dt[i] > ev.date) { i0 = i; break; }
  const iEff = i0 > 0 ? i0 - 1 : (i0 === -1 && dt.length ? dt.length - 1 : -1); // last bar <= effective date
  // panel must actually cover the event window, not start after or end before it
  const near = (d: string, days: number) => Math.abs(Date.parse(d) - Date.parse(ev.date)) <= days * 864e5;
  const covers = iEff >= 0 && near(dt[iEff], 10);
  if (!covers) { c.notCovered++; c.miss.push(ev.sym); continue; }

  const o: Obs = { date: ev.date, sym: ev.sym, runup: null, rev20: null, rev10: null };
  // RUN-UP: close at iEff-RUNUP -> close at iEff (into and including the effective close), excess over SPY
  if (iEff >= RUNUP) {
    const p0 = b[iEff - RUNUP][4], p1 = b[iEff][4], s0 = spyAt(dt[iEff - RUNUP]), s1 = spyAt(dt[iEff]);
    if (p0 > 0 && p1 > 0 && s0 && s1) o.runup = ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100;
  }
  // REVERSAL: LAG-1 entry at close of first bar strictly after effective; exit close REV bars later, excess SPY
  if (i0 >= 0 && near(dt[i0], 30)) {
    for (const [w, key] of [[REV, "rev20"], [REV_ALT, "rev10"]] as [number, "rev20" | "rev10"][]) {
      const iT = i0 + w;
      if (iT >= b.length) continue;                              // right-censored: neutral, not a number
      const p0 = b[i0][4], p1 = b[iT][4], s0 = spyAt(dt[i0]), s1 = spyAt(dt[iT]);
      if (p0 > 0 && p1 > 0 && s0 && s1) o[key] = ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100;
    }
  }
  if (o.runup !== null || o.rev20 !== null || o.rev10 !== null) { c.usable++; obs[ev.kind].push(o); }
  else { c.notCovered++; c.miss.push(ev.sym); }
}

// ---- trials: paid BEFORE any number is read ----
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "sp500-index-effect", runId: K.SIE_RUN_ID, spent: 3 });

// ---- report ----
const ERAS: [string, string, string][] = [
  ["pre-2000", "0000-00-00", "1999-12-31"], ["2000-2010", "2000-01-01", "2009-12-31"],
  ["2010-2020", "2010-01-01", "2019-12-31"], ["2020-2026", "2020-01-01", "9999-99-99"],
];
const cell = (a: number[]) => a.length < 5
  ? `n=${String(a.length).padStart(3)}  UNTESTED(<5)`.padEnd(38)
  : `n=${String(a.length).padStart(3)} ${mean(a).toFixed(2).padStart(7)}% t ${tstat(a).toFixed(2).padStart(6)} pos ${pctPos(a).toFixed(0).padStart(3)}%`.padEnd(38);
const pick = (kind: "ADD" | "DEL", key: keyof Obs, lo = "0000", hi = "9999") =>
  obs[kind].filter((o) => o.date >= lo && o.date <= hi && o[key] !== null).map((o) => o[key] as number);

console.log(`\n==> D-963 S&P 500 INDEX ADD/DELETE EVENT STUDY — run-up + reversal, both sides, era-decomposed`);
console.log(`    source: ${src.source} | span ${src.date_span[0]}..${src.date_span[1]} | benchmark: SPY same-window excess`);
console.log(`    trials 3 spent (family sp500-index-effect) | N ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(3)}`);
console.log(`\n  LIMITATION (stated, not patched): dates are EFFECTIVE dates; announcement dates (~5td earlier) are NOT`);
console.log(`  in the data. The run-up is a forced-flow FOOTPRINT measurement, not a tradable expression; the`);
console.log(`  announcement-to-effective pop stays UNTESTED (D-740). The only tradable expression is the LAG-1 reversal.`);

console.log(`\n  COVERAGE (COVERAGE LAW) — a null on missing names is UNTESTED, not evidence`);
for (const k of ["ADD", "DEL"] as const) {
  const c = cov[k];
  console.log(`    ${k}  events ${c.total} | pre-SPY(<${SPY_MIN}) UNBENCHMARKED ${c.preSpy} | no bars ${c.noBars} | panel misses window ${c.notCovered} | USABLE ${c.usable} (${(100 * c.usable / (c.total - c.preSpy)).toFixed(1)}% of benchmarkable)`);
  console.log(`         missing (first 12): ${c.miss.slice(0, 12).join(" ")}`);
}
console.log(`    SELECTION MECHANISM of the missing: acquired/renamed/delisted names absent from the panel. On the DEL`);
console.log(`    side this is SURVIVORSHIP — the deletions most likely to show the effect (failing names) are the ones`);
console.log(`    most likely to be missing, so the DEL rows are measured on the survivors.`);

console.log(`\n  REGISTERED DIRECTIONS (pre-specified): ADD run-up +, ADD reversal -, DEL run-up -, DEL reversal +`);
console.log(`\n  EXCESS vs SPY (%) BY ERA ${" ".repeat(14)}run-up 5d (into eff.)${" ".repeat(18)}reversal 20d (LAG-1)${" ".repeat(18)}reversal 10d (LAG-1)`);
for (const k of ["ADD", "DEL"] as const) {
  for (const [name, lo, hi] of ERAS) {
    console.log(`    ${k} ${name.padEnd(10)} ${cell(pick(k, "runup", lo, hi))} ${cell(pick(k, "rev20", lo, hi))} ${cell(pick(k, "rev10", lo, hi))}`);
  }
  console.log(`    ${k} ${"POOLED".padEnd(10)} ${cell(pick(k, "runup"))} ${cell(pick(k, "rev20"))} ${cell(pick(k, "rev10"))}`);
}

// ---- SIGN LAW outcomes on the pooled benchmarkable sample ----
console.log(`\n  SIGN LAW (D-553) — outcome vs registered direction, pooled:`);
const signRow = (label: string, a: number[], want: 1 | -1) => {
  if (a.length < 5) { console.log(`    ${label}: UNTESTED (n=${a.length})`); return; }
  const m = mean(a), t = tstat(a);
  const matched = Math.sign(m) === want && Math.abs(t) >= 2;
  const flat = Math.abs(t) < 2;
  console.log(`    ${label}: mean ${m.toFixed(2)}% t ${t.toFixed(2)} -> ${matched ? "MATCHED" : flat ? "FLAT (|t|<2 — direction not established either way)" : "MISSED (significant in the WRONG direction)"}`);
};
signRow("ADD run-up  (+)", pick("ADD", "runup"), 1);
signRow("ADD rev 20d (-)", pick("ADD", "rev20"), -1);
signRow("DEL run-up  (-)", pick("DEL", "runup"), -1);
signRow("DEL rev 20d (+)", pick("DEL", "rev20"), 1);

// ---- TRAIN/TEST on the only tradable expression: the LAG-1 reversal (SELECTION LAW D-455) ----
console.log(`\n  TRADABLE RULE, TRAIN/TEST (first 2/3 vs last 1/3 chronologically; rule = registered reversal direction,`);
console.log(`  formed on TRAIN only, frozen): short ADDs / long DELs at LAG-1, hold 20 bars, P&L = registered-direction excess`);
let anyClears = false;
for (const k of ["ADD", "DEL"] as const) {
  const dir = k === "ADD" ? -1 : 1; // registered reversal direction as P&L sign
  const rows = obs[k].filter((o) => o.rev20 !== null).map((o) => ({ date: o.date, pnl: dir * (o.rev20 as number) }));
  if (rows.length < 30) { console.log(`    ${k}: UNTESTED (n=${rows.length} < 30)`); continue; }
  const cut = Math.floor(rows.length * 2 / 3);
  const tr = rows.slice(0, cut).map((r) => r.pnl), te = rows.slice(cut).map((r) => r.pnl);
  const forms = mean(tr) > 0 && tstat(tr) >= 2;
  const bpTe = mean(te) * 100;
  console.log(`    ${k}(${dir > 0 ? "long DEL" : "short ADD"})  TRAIN n=${tr.length} mean ${mean(tr).toFixed(2)}% t ${tstat(tr).toFixed(2)} ${forms ? "-> RULE FORMS" : "-> RULE DOES NOT FORM on train (mean<=0 or t<2) — test shown for the record only"}`);
  console.log(`         TEST  n=${te.length} mean ${mean(te).toFixed(2)}% (${bpTe.toFixed(0)}bp/event) t ${tstat(te).toFixed(2)} | EFFECT SIZE vs ${COST_BP}bp round trip: ${(bpTe / COST_BP).toFixed(2)}x ${bpTe / COST_BP >= 1 && forms && tstat(te) >= 2 ? "" : "— NOT an edge"}`);
  if (forms && tstat(te) >= 2 && bpTe / COST_BP >= 1) anyClears = true;
}

const usableTotal = cov.ADD.usable + cov.DEL.usable;
console.log(`\n  LIQUIDITY LAW: satisfied by the universe — index members are liquid large caps by construction; D-740`);
console.log(`  additionally verified the liquid-tercile decomposition on the ADD side (null there too).`);
console.log(`\n  VERDICT: ${
  usableTotal < 80
    ? `UNDERPOWERED — only ${usableTotal} usable events (< 80). To detect a ~1% mean excess at sd~6% with t>=2 requires n >~ 145 per cell.`
    : anyClears
      ? "CANDIDATE — a train-formed reversal rule clears t>=2 on test AND >=1x cost; deflate against the ceiling above and re-test before any claim."
      : "see SIGN LAW rows + era table above — read decay across eras as the literature's prediction, not a failure."
}\n`);
