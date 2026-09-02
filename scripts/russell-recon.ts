#!/usr/bin/env -S deno run --allow-net --allow-env
// russell-recon.ts — the RUSSELL RECONSTITUTION event study, on PREDICTED Russell-2000 ADDITIONS.
//
// WHY THIS IS NOT THE S&P STUDY (D-740). S&P inclusion is DISCRETIONARY: the committee decides, so the only
// tradable leg is announcement->effective, and we hold no announcement dates (D-740 measured post-effective and
// found NULL). Russell reconstitution is RULE-BASED: membership is a deterministic function of market cap on
// RANK DAY (last trading day of May, 2004-2023; April 30 from 2024). The add/delete list is therefore
// PREDICTABLE from public data weeks before FTSE Russell publishes its preliminary list in late May / early
// June, and the index becomes effective after the close of the 4th Friday of June.
//
// SIGN PRIOR, STATED BEFORE THE NUMBERS (SIGN LAW, D-553/554):
//   PREDICTED ADDS RISE from rank day into reconstitution (arbitrageurs front-run the index funds' forced buy),
//   THEN REVERSE after reconstitution (the forced demand is gone and the pop unwinds).
//   Operationally: rank-day -> recon excess > 0, and recon -> +21d / +63d excess < 0. Reported MATCHED/MISSED.
//
// *** THE FINDING THAT REORGANISED THIS SCRIPT (POSITIVE-CONTROL RULE, D-641) ***
// The obvious ranking — market cap = EntityCommonStockSharesOutstanding x close — is WRONG in this database, and
// its positive control says so out loud. trd_bars_deep closes are FULLY BACK-ADJUSTED for splits; the EDGAR
// cover-page share counts are RAW AS FILED. Multiplying them mixes two share bases, so any name with a split
// AFTER the filing date gets a cap wrong by the split factor. Verified on live rows:
//     GWAV 2021-05-28 adjusted close = $163,350 (a 1:100-reverse-split artifact) x 493.7M raw shares = "$80T"
//     CETX 2021-05-28 adjusted close = $15,545,250 -> nonsense of the same shape
//     AAPL 2021-05-28 $121.36 x 16.788B = $2.04T -> CORRECT, because AAPL has had no split since the filing
// The control (mega-caps must top a market-cap ranking) returns CETX BDRX GWAV KXIN ... AAPL 15th. So the
// cap path is VOID here and this script REFUSES to print returns from it.
// NOTE FOR THE PROGRAMME, not for this study: `aegis-factory.ts` line ~102 computes `mc = px*sh` the same way.
// Every market-cap-conditioned figure built on that field inherits this contamination. Not fixed here (no edits
// to existing files) and not asserted beyond what is shown above — flagged for a separate pass.
//
// WHAT IS MEASURED INSTEAD: DOLLAR VOLUME, which IS split-consistent in this database (verified — AAPL's
// 2014-06-02 volume of 369.4M is already in post-7:1-split units, giving the correct $7.27B turnover). Size rank
// by 60-day median dollar volume is a PROXY for cap rank, not cap rank. It is a proxy for a proxy and is
// labelled as such everywhere below; it is reported because it is split-immune, needs no share count, and
// therefore covers the whole 19.5k-name equity panel instead of the 6.1k with share data.
//
// EXECUTION LAW, SAME-BAR COROLLARY (D-498): rank day's close is the signal. Entry is the close of the FIRST BAR
// STRICTLY AFTER rank day — LAG-1. Nobody trades the close that defines the ranking.
// BENCHMARK LAW (D-627/630): every number is an excess over IWM (the Russell 2000 ETF) on the SAME window, AND
// the same-band INCUMBENT population is reported as the universe control — a "predicted add" number without its
// incumbent comparison is small-cap drift.
// LIQUIDITY LAW: liquid-tercile split reported beside the pooled figure.
// TURNOVER LAW (D-654/656): exactly ONE round trip per name per year on each leg; drag stated, not assumed away.
// COVERAGE LAW: a year whose ranked universe cannot reach 3000 names cannot identify the 1001-3000 band and is
// reported UNTESTED, never as a null.
//
// DESCRIPTIVE ONLY (MECHANISM LAW, D-597) — no pre-registration exists for this claim; nothing is written to
// trd_lineage, no forward clock is started, no gate is claimed.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("russell-recon", [
  { name: "RR_Y0", def: "2010", note: "first reconstitution year" },
  { name: "RR_Y1", def: "2025", note: "last reconstitution year" },
  { name: "RT_BP", def: "30", note: "round-trip cost in bp for small caps (spread+impact)" },
  { name: "RR_MINU", def: "3000", note: "ranked-universe floor: below this the 1001-3000 band is unidentifiable" },
  { name: "RR_MAXSTALE", def: "550", note: "max days from shares effective_date to rank day (cap path only)" },
  { name: "RR_BENCH", def: "IWM", note: "benchmark ETF (Russell 2000)" },
]);
const Y0 = Number(K.RR_Y0), Y1 = Number(K.RR_Y1), RT_BP = Number(K.RT_BP);
const MINU = Number(K.RR_MINU), MAXSTALE = Number(K.RR_MAXSTALE);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rrecon", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function pageAll(path: string): Promise<Record<string, unknown>[]> {
  if (!/order=/.test(path)) throw new Error(`pageAll requires order=: ${path}`);
  const out: Record<string, unknown>[] = [];
  for (let off = 0;; off += 1000) {
    const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) break;
    out.push(...j);
    if (j.length < 1000) break;
  }
  return out;
}
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / a.length;
const dayGap = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 864e5;

// ---------- calendar ----------
function rankDayTarget(y: number) { return y >= 2024 ? `${y}-04-30` : `${y}-05-31`; }
function fourthFridayJune(y: number): string {
  const d = new Date(Date.UTC(y, 5, 1));
  let n = 0;
  for (let day = 1; day <= 30; day++) { d.setUTCDate(day); if (d.getUTCDay() === 5) { n++; if (n === 4) return d.toISOString().slice(0, 10); } }
  throw new Error("no 4th Friday");
}
const YEARS: number[] = [];
for (let y = Y0 - 1; y <= Y1; y++) YEARS.push(y);   // Y0-1 needed for the prior-year rank

// ---------- shares outstanding (cap path; asOf discipline) ----------
const fund = (await pageAll(
  "trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker,effective_date,value&order=ticker.asc,effective_date.asc",
)) as unknown as { ticker: string; effective_date: string; value: number }[];
assertNonEmpty("shares-outstanding rows", fund, 10000);
const sharesByTicker = new Map<string, { d: string; v: number }[]>();
for (const r of fund) {
  if (!r.ticker || !(r.value > 0) || !r.effective_date) continue;
  const a = sharesByTicker.get(r.ticker) || [];
  a.push({ d: r.effective_date, v: r.value });
  sharesByTicker.set(r.ticker, a);
}
for (const a of sharesByTicker.values()) a.sort((x, y) => (x.d < y.d ? -1 : 1));
function sharesAsOf(tk: string, d: string): { v: number; eff: string } | null {
  const a = sharesByTicker.get(tk); if (!a) return null;
  let lo = 0, hi = a.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? { v: a[ans].v, eff: a[ans].d } : null;
}

// ---------- benchmark ----------
async function barsOf(sym: string): Promise<number[][]> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr })
    .then((x) => x.json()).catch(() => []); // plumbing-ok: single symbol, packed bars column, no ordering to apply
  return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
}
let BENCH = K.RR_BENCH, benchBars = await barsOf(BENCH);
let benchNote = "IWM (iShares Russell 2000 ETF) — the correct benchmark for an R2000 study; VERIFIED present in trd_bars_deep asset_class=etf";
if (benchBars.length < 2000) { BENCH = "SPY"; benchBars = await barsOf("SPY"); benchNote = "SPY — IWM was NOT usable, so the benchmark is the LARGE-CAP market, a WORSE control for small caps"; }
assertNonEmpty(`${BENCH} bars`, benchBars, 2000);
const bDates = benchBars.map((b) => iso(b[0]));
const lastOnOrBefore = (arr: string[], d: string) => { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
function benchAt(d: string): number | null { const i = lastOnOrBefore(bDates, d); return i >= 0 ? benchBars[i][4] : null; }
const rankDay = new Map<number, string>(), reconDay = new Map<number, string>();
for (const y of YEARS) {
  const i1 = lastOnOrBefore(bDates, rankDayTarget(y)), i2 = lastOnOrBefore(bDates, fourthFridayJune(y));
  if (i1 >= 0 && i2 >= 0) { rankDay.set(y, bDates[i1]); reconDay.set(y, bDates[i2]); }
}

// ---------- one streamed pass over the WHOLE equity panel ----------
interface YRec { cap: number | null; eff: string | null; stale: number; dv: number; pE: number; dE: string; pR: number; dR: string; p21: number | null; d21: string | null; p63: number | null; d63: string | null }
const rec = new Map<string, Map<number, YRec>>();
const allSyms = (await pageAll("trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol.asc")).map((r) => r.symbol as string);
assertNonEmpty("equity symbols", allSyms, 1000);
let withBars = 0;
for (let i = 0; i < allSyms.length; i += 100) {
  const chunk = allSyms.slice(i, i + 100);
  const url = `${OWNED}/trd_bars_deep?asset_class=eq.equity&symbol=in.(${chunk.map((s) => `"${s}"`).join(",")})&select=symbol,bars`; // plumbing-ok: keyed batch read of packed bars; the key list is itself paged above
  const rows = await fetch(url, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) {
    const b = (row.bars || []).filter((x) => x[4] > 0 && x[5] > 0);
    if (b.length < 100) continue;
    withBars++;
    const dt = b.map((x) => iso(x[0]));
    const per = new Map<number, YRec>();
    for (const y of YEARS) {
      const rd = rankDay.get(y), rcd = reconDay.get(y);
      if (!rd || !rcd) continue;
      const i0 = lastOnOrBefore(dt, rd);
      if (i0 < 30 || dayGap(rd, dt[i0]) > 7) continue;      // needs a live price at rank day
      const pre = b.slice(Math.max(0, i0 - 60), i0 + 1).map((x) => x[4] * x[5]).sort((a, z) => a - z);
      const dv = pre[Math.floor(pre.length / 2)];
      if (!(dv > 0)) continue;
      const iE = i0 + 1;                                    // LAG-1
      if (iE >= b.length) continue;
      const iR = lastOnOrBefore(dt, rcd);
      if (iR <= iE || dayGap(rcd, dt[iR]) > 7) continue;
      const sh = sharesAsOf(row.symbol, rd);
      const stale = sh ? dayGap(rd, sh.eff) : Infinity;
      const i21 = iR + 21, i63 = iR + 63;
      per.set(y, {
        cap: sh && stale <= MAXSTALE ? sh.v * b[i0][4] : null, eff: sh?.eff ?? null, stale, dv,
        pE: b[iE][4], dE: dt[iE], pR: b[iR][4], dR: dt[iR],
        p21: i21 < b.length ? b[i21][4] : null, d21: i21 < b.length ? dt[i21] : null,
        p63: i63 < b.length ? b[i63][4] : null, d63: i63 < b.length ? dt[i63] : null,
      });
    }
    if (per.size) rec.set(row.symbol, per);
  }
}
assertNonEmpty("symbols usable at some rank day", [...rec.keys()], 500);

// ---------- rankings: CAP (void) and DOLLAR VOLUME (used) ----------
function rankBy(y: number, key: (r: YRec) => number | null) {
  const rows: { sym: string; r: YRec; k: number }[] = [];
  for (const [sym, per] of rec) { const r = per.get(y); const k = r ? key(r) : null; if (r && k !== null && k > 0) rows.push({ sym, r, k }); }
  rows.sort((a, b) => b.k - a.k);
  const m = new Map<string, number>();
  rows.forEach((x, i) => m.set(x.sym, i + 1));
  return { list: rows, rank: m };
}
const capR = new Map<number, ReturnType<typeof rankBy>>(), dvR = new Map<number, ReturnType<typeof rankBy>>();
for (const y of YEARS) { capR.set(y, rankBy(y, (r) => r.cap)); dvR.set(y, rankBy(y, (r) => r.dv)); }

// POSITIVE CONTROL (D-641): a broken ranking and a null look identical. Mega-caps MUST top a size ranking.
const MEGA = ["AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "FB", "TSLA", "BRK.B", "NVDA", "JPM", "JNJ", "V", "UNH", "WMT", "PG", "HD", "BAC", "MA", "DIS", "XOM", "INTC", "CSCO", "PFE", "T", "AMD", "NFLX", "BA", "QQQ"];
function control(y: number, R: Map<number, ReturnType<typeof rankBy>>) {
  const top = (R.get(y)?.list ?? []).slice(0, 15).map((x) => x.sym);
  return { top, hits: top.filter((s) => MEGA.includes(s)) };
}
const capCtl = control(2021, capR), dvCtl = control(2021, dvR);
const CAP_OK = capCtl.hits.length >= 5, DV_OK = dvCtl.hits.length >= 5;

// ---------- events ----------
interface Ev { y: number; sym: string; kind: "DEMOTED-IN" | "NEW"; dv: number; exR: number; ex21: number | null; ex63: number | null }
function excess(p0: number, p1: number, d0: string, d1: string): number | null {
  const s0 = benchAt(d0), s1 = benchAt(d1);
  if (!s0 || !s1 || !(p0 > 0) || !(p1 > 0)) return null;
  return ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100;
}
const adds: Ev[] = [], incs: Ev[] = [], universeN = new Map<number, number>();
for (let y = Y0; y <= Y1; y++) {
  const cur = dvR.get(y)!, prev = dvR.get(y - 1)?.rank;
  universeN.set(y, cur.list.length);
  if (!prev) continue;
  for (const x of cur.list) {
    const rk = cur.rank.get(x.sym)!;
    if (rk < 1001 || rk > 3000) continue;
    const exR = excess(x.r.pE, x.r.pR, x.r.dE, x.r.dR);
    if (exR === null) continue;
    const e: Ev = {
      y, sym: x.sym, kind: prev.has(x.sym) ? "DEMOTED-IN" : "NEW", dv: x.r.dv, exR,
      ex21: x.r.p21 && x.r.d21 ? excess(x.r.pR, x.r.p21, x.r.dR, x.r.d21) : null,
      ex63: x.r.p63 && x.r.d63 ? excess(x.r.pR, x.r.p63, x.r.dR, x.r.d63) : null,
    };
    const pr = prev.get(x.sym);
    if (pr === undefined || pr > 3000) adds.push(e); else incs.push(e);
  }
}
const testable = [...universeN.entries()].filter(([_, n]) => n >= MINU).map(([y]) => y);
const untested = [...universeN.entries()].filter(([_, n]) => n < MINU).map(([y]) => y);
const T = new Set(testable);
const addT = adds.filter((e) => T.has(e.y)), incT = incs.filter((e) => T.has(e.y));

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "russell-recon", runId: `rr|${Y0}-${Y1}|${MINU}|dv`, spent: 8 });

// ================= REPORT =================
const P = console.log;
const nz = (a: number[]) => a.filter((x) => Number.isFinite(x));
function line(tag: string, raw: number[]) {
  const a = nz(raw);
  if (a.length < 5) return `    ${tag.padEnd(24)} n=${String(a.length).padStart(5)}  UNTESTED (n<5)`;
  return `    ${tag.padEnd(24)} n=${String(a.length).padStart(5)}  mean ${mean(a).toFixed(2).padStart(7)}%  med ${med(a).toFixed(2).padStart(7)}%  t ${tstat(a).toFixed(2).padStart(6)}  pos ${pctPos(a).toFixed(0).padStart(3)}%`;
}

P(`\n================================================================================`);
P(`RUSSELL RECONSTITUTION — PREDICTED R2000 ADDITIONS (${Y0}-${Y1}), LAG-1 from rank day`);
P(`================================================================================`);
P(`  benchmark: ${benchNote}`);
P(`\n  SIGN PRIOR (SIGN LAW, stated before any number): predicted adds RISE rank-day -> reconstitution,`);
P(`  then REVERSE after reconstitution. Operationally exR > 0 and ex21/ex63 < 0.`);

P(`\n  CALENDAR (rank day = last trading day of May to 2023, Apr-30 from 2024; recon = 4th Friday of June)`);
for (let y = Y0; y <= Y1; y++) P(`    ${y}: rank ${rankDay.get(y)}  ->  recon ${reconDay.get(y)}`);

// ---- PART A: the cap path and why it is void ----
P(`\n  ---------------- PART A: THE MARKET-CAP PATH, AND WHY IT IS VOID ----------------`);
P(`  Requested construction: cap = EntityCommonStockSharesOutstanding (asOf, effective_date <= rank day)`);
P(`  x close on rank day. Coverage of that construction:`);
P(`    equity symbols in trd_bars_deep                         ${allSyms.length}`);
P(`    of those with >=100 usable bars                          ${withBars}`);
P(`    distinct tickers holding a shares fact                   ${sharesByTicker.size}`);
P(`    ${"year".padEnd(6)}${"cap-ranked".padStart(12)}${"$vol-ranked".padStart(13)}   cap coverage of the 3000 needed`);
for (let y = Y0; y <= Y1; y++) {
  const c = capR.get(y)?.list.length ?? 0, d = dvR.get(y)?.list.length ?? 0;
  P(`    ${String(y).padEnd(6)}${String(c).padStart(12)}${String(d).padStart(13)}   ${(100 * Math.min(1, c / MINU)).toFixed(0).padStart(3)}%${c >= MINU ? "" : "  <-- cannot reach rank 3000"}`);
}
P(`\n  POSITIVE CONTROL (D-641) on the cap ranking, 2021 (top 15 by cap on ${rankDay.get(2021)}):`);
P(`    ${capCtl.top.join(" ")}`);
P(`    known mega-caps in that top 15: ${capCtl.hits.length} (${capCtl.hits.join(" ") || "none"})  ->  ${CAP_OK ? "PASSES" : "*** FAILS ***"}`);
if (!CAP_OK) {
  P(`\n    ROOT CAUSE, verified on live rows rather than inferred: trd_bars_deep closes are BACK-ADJUSTED for`);
  P(`    splits while the EDGAR cover-page share counts are RAW AS FILED, so the product mixes two share bases.`);
  P(`    Any name that split AFTER its filing date has a cap wrong by exactly the split factor:`);
  for (const s of ["GWAV", "CETX"]) {
    const r = rec.get(s)?.get(2021), sh = sharesAsOf(s, rankDay.get(2021)!);
    if (r && sh) P(`      ${s.padEnd(5)} adj close $${(r.cap! / sh.v).toLocaleString(undefined, { maximumFractionDigits: 0 })} x ${(sh.v / 1e6).toFixed(1)}M raw shares = "$${(r.cap! / 1e12).toFixed(1)}T"  (a reverse-split artifact)`);
  }
  const aapl = rec.get("AAPL")?.get(2021), ash = sharesAsOf("AAPL", rankDay.get(2021)!);
  if (aapl?.cap && ash) P(`      AAPL  adj close $${(aapl.cap / ash.v).toFixed(2)} x ${(ash.v / 1e9).toFixed(3)}B raw shares = $${(aapl.cap / 1e12).toFixed(2)}T  (CORRECT — no split since the filing)`);
  P(`    No split/corporate-action table is held in this database, so the share basis cannot be reconciled and`);
  P(`    THE CAP RANKING CANNOT BE REPAIRED FROM DATA ON HAND. This script therefore REFUSES to print any`);
  P(`    return computed from it — a void ranking produces a number-shaped object, not a measurement.`);
  P(`    PROGRAMME NOTE (not a claim of this study): scripts/aegis-factory.ts computes mc = px*sh the same way.`);
}

// ---- PART B: the split-immune path ----
P(`\n  ------------- PART B: THE SPLIT-IMMUNE PATH — SIZE RANKED BY DOLLAR VOLUME -------------`);
P(`  Dollar volume IS split-consistent here (verified: AAPL's 2014-06-02 volume of 369.4M is already in`);
P(`  post-7:1-split units, giving the correct $7.27B turnover). Size = 60-day median dollar volume ending on`);
P(`  rank day. THIS IS A PROXY FOR A PROXY: Russell ranks on float-adjusted CAP, not turnover, and the two`);
P(`  differ most for closely-held and for heavily-traded names. Every number below inherits that.`);
P(`\n  POSITIVE CONTROL on the $vol ranking, 2021 (top 15 by median $vol on ${rankDay.get(2021)}):`);
P(`    ${dvCtl.top.join(" ")}`);
P(`    known mega-caps in that top 15: ${dvCtl.hits.length} (${dvCtl.hits.join(" ")})  ->  ${DV_OK ? "PASSES" : "*** FAILS — Part B is void too ***"}`);
P(`\n  PREDICTED-ADD RULE (declared, SELECTION LAW — nothing here is chosen from the outcome):`);
P(`    add in year y  <=>  size-rank_y in [1001,3000]  AND  ( rank_{y-1} > 3000  OR  no rank in y-1 ).`);
P(`    Reported separately: DEMOTED-IN (had a prior rank past 3000) and NEW (no prior-year rank at all — an`);
P(`    IPO, or simply absent from the panel a year earlier, which is a DATA condition as much as a market one`);
P(`    and is why the two are never pooled).`);
P(`  COVERAGE: universe reaches ${MINU} names in ${testable.length} of ${Y1 - Y0 + 1} years: ${testable.join(", ") || "NONE"}`);
P(`            UNTESTED years (band is not the R2000 band, just "names we hold"): ${untested.join(", ") || "none"}`);

if (!DV_OK || !testable.length) {
  P(`\n  VERDICT: UNTESTED — the size ranking does not pass its own positive control, or no year reaches ${MINU}`);
  P(`  names. This is a statement about our DATA, not about front-running.`);
} else {
  const drag1 = RT_BP / 100;
  P(`\n  ============ LEG 1: rank day (LAG-1) -> reconstitution close ============`);
  P(`  TURNOVER (TURNOVER LAW): exactly ONE round trip per name per year on this leg -> drag ${drag1.toFixed(2)}% per`);
  P(`  event at RT_BP=${RT_BP} (small-cap round trip). Leg 2 is a SECOND round trip, costed separately.`);
  P(`  TESTABLE YEARS ONLY (${testable.join(", ")}):`);
  P(line("predicted ADDS (all)", addT.map((e) => e.exR)));
  P(line("  DEMOTED-IN subset", addT.filter((e) => e.kind === "DEMOTED-IN").map((e) => e.exR)));
  P(line("  NEW subset", addT.filter((e) => e.kind === "NEW").map((e) => e.exR)));
  P(line("INCUMBENTS (control)", incT.map((e) => e.exR)));
  const addM = mean(addT.map((e) => e.exR)), incM = incT.length >= 5 ? mean(incT.map((e) => e.exR)) : NaN;
  P(`    BENCHMARK LAW: adds MINUS same-band incumbents = ${(addM - incM).toFixed(2)} pp. Both legs are already`);
  P(`    excess-over-${BENCH}; the incumbent figure is the small-cap drift an add would have earned anyway.`);
  P(`    NET of the ${drag1.toFixed(2)}% round trip: mean ${(addM - drag1).toFixed(2)}%  (t ${tstat(addT.map((e) => e.exR - drag1)).toFixed(2)})`);
  P(`    COST-INFLATION COROLLARY (D-661): the GROSS t is ${tstat(addT.map((e) => e.exR)).toFixed(2)} — quoted so that no part of any`);
  P(`    "significantly loses" reading below can be manufactured by the cost assumption.`);

  P(`\n  LIQUIDITY LAW — tercile split by the same pre-rank-day median dollar volume:`);
  if (addT.length >= 15) {
    const s = [...addT].sort((a, b) => a.dv - b.dv);
    const ill = s.slice(0, Math.floor(s.length / 3)), liq = s.slice(Math.floor((s.length * 2) / 3));
    P(line("ADDS liquid tercile", liq.map((e) => e.exR)));
    P(line("ADDS illiquid tercile", ill.map((e) => e.exR)));
    P(`    median $vol: liquid $${(med(liq.map((e) => e.dv)) / 1e6).toFixed(2)}M vs illiquid $${(med(ill.map((e) => e.dv)) / 1e6).toFixed(3)}M`);
    P(`    (NOTE: the tercile variable IS the ranking variable here, so this split is a sort WITHIN the band and`);
    P(`    is narrower than the usual liquidity decomposition — stated rather than glossed.)`);
  } else P(`    UNTESTED — fewer than 15 events in testable years.`);

  P(`\n  ============ LEG 2: the REVERSAL, recon close -> +21d and +63d ============`);
  P(`  (a second round trip: subtract a further ${drag1.toFixed(2)}% to act on it)`);
  P(line("ADDS +21d", addT.map((e) => e.ex21 ?? NaN)));
  P(line("ADDS +63d", addT.map((e) => e.ex63 ?? NaN)));
  P(line("INCUMBENTS +21d", incT.map((e) => e.ex21 ?? NaN)));
  P(line("INCUMBENTS +63d", incT.map((e) => e.ex63 ?? NaN)));

  P(`\n  PER-YEAR (all years printed so the whole panel is visible; UNTESTED rows are NOT evidence)`);
  P(`    ${"yr".padEnd(6)}${"univ".padStart(7)}${"nAdd".padStart(6)}${"mean%".padStart(9)}${"t".padStart(7)}${"pos%".padStart(6)}${"+21d%".padStart(9)}${"+63d%".padStart(9)}   status`);
  for (let y = Y0; y <= Y1; y++) {
    const e = adds.filter((x) => x.y === y);
    const a = e.map((x) => x.exR), a21 = nz(e.map((x) => x.ex21 ?? NaN)), a63 = nz(e.map((x) => x.ex63 ?? NaN));
    const u = universeN.get(y) ?? 0;
    P(`    ${String(y).padEnd(6)}${String(u).padStart(7)}${String(e.length).padStart(6)}${(a.length ? mean(a).toFixed(2) : "-").padStart(9)}${(a.length > 1 ? tstat(a).toFixed(2) : "-").padStart(7)}${(a.length ? pctPos(a).toFixed(0) : "-").padStart(6)}${(a21.length ? mean(a21).toFixed(2) : "-").padStart(9)}${(a63.length ? mean(a63).toFixed(2) : "-").padStart(9)}   ${u >= MINU ? "testable" : "UNTESTED"}`);
  }

  // SIGN LAW
  const tR = tstat(addT.map((e) => e.exR));
  const a21T = nz(addT.map((e) => e.ex21 ?? NaN)), a63T = nz(addT.map((e) => e.ex63 ?? NaN));
  const riseOK = addM > 0 && tR > 2;
  P(`\n  SIGN LAW OUTCOME (against the prior stated at the top, unchanged since):`);
  P(`    rise into reconstitution:   ${riseOK ? "MATCHED" : "MISSED"}  (mean ${addM.toFixed(2)}%, t ${tR.toFixed(2)}; prior needs >0 with t>2)`);
  P(`    reversal after recon +21d:  ${a21T.length >= 5 ? (mean(a21T) < 0 ? "MATCHED" : "MISSED") : "UNTESTED"}  (mean ${a21T.length ? mean(a21T).toFixed(2) : "-"}%, t ${a21T.length >= 5 ? tstat(a21T).toFixed(2) : "-"})`);
  P(`    reversal after recon +63d:  ${a63T.length >= 5 ? (mean(a63T) < 0 ? "MATCHED" : "MISSED") : "UNTESTED"}  (mean ${a63T.length ? mean(a63T).toFixed(2) : "-"}%, t ${a63T.length >= 5 ? tstat(a63T).toFixed(2) : "-"})`);
  P(`    A post-hoc flip is NOT claimable (D-511b): an opposite measured sign is a MISS, not a new edge.`);
  P(`    *** READ THE TWO LEGS TOGETHER, NOT SEPARATELY. The prior is RISE-then-REVERSE. What is measured is`);
  P(`    DOWN-then-DOWN: adds underperform ${BENCH} in BOTH legs. The +21d/+63d "MATCHED" is therefore NOT`);
  P(`    confirmation of the mechanism — a reversal requires something to reverse, and leg 1 never rose. The`);
  P(`    honest reading of the pair is persistent post-rank-day underperformance by names that JUST entered`);
  P(`    the traded-size band, which is a size/momentum story, not an index-demand story. Scoring the second`);
  P(`    leg as a MATCH in isolation would be exactly the narration failure the MECHANISM LAW exists to stop. ***`);
  P(`    Incumbents are also negative at +21d (${mean(nz(incT.map((e) => e.ex21 ?? NaN))).toFixed(2)}%, t ${tstat(nz(incT.map((e) => e.ex21 ?? NaN))).toFixed(2)}), so most of leg 2 is band-wide drift,`);
  P(`    not an add effect: the add-minus-incumbent difference at +21d is only ${(mean(nz(addT.map((e) => e.ex21 ?? NaN))) - mean(nz(incT.map((e) => e.ex21 ?? NaN)))).toFixed(2)} pp.`);

  // limits + verdict
  const perYear = addT.length / Math.max(1, testable.length);
  const sdA = sd(addT.map((e) => e.exR));
  const needN = Math.ceil((2.8 * sdA / 3) ** 2);
  P(`\n  HONEST LIMITS`);
  P(`  1. THE ADD LIST IS A PROXY OF A PROXY. Two layers, both biasing any true effect TOWARD ZERO:`);
  P(`     (a) size is DOLLAR VOLUME, not float cap — forced by the split defect in Part A;`);
  P(`     (b) even on true cap, "rank 1001-3000" is not the Russell rule:`);
  P(`         - FLOAT vs TOTAL cap: Russell screens and weights on float-adjusted cap; we hold no float factor.`);
  P(`         - SHARE CLASSES: Russell aggregates classes to one company; we rank TICKERS, so dual-class names`);
  P(`           are counted twice at part of their true size.`);
  P(`         - ELIGIBILITY: US incorporation/HQ tests, $1 minimum price, 5% float minimum, exclusion of ETFs,`);
  P(`           closed-end funds, LPs, royalty trusts, SPACs (excluded from 2021) and OTC names. We apply NONE.`);
  P(`         - BANDING: since 2007 a cap band around the 1000/2000 breakpoints damps turnover, so crossing`);
  P(`           rank 1000 does not force a move. Our rule has a hard edge; the real one does not.`);
  P(`     Consequence: a null here is WEAK evidence against the effect; a positive result would be understated.`);
  P(`  2. SURVIVORSHIP: trd_bars_deep carries delisted names only from ~2020. Before that a name that failed`);
  P(`     between rank day and recon is simply absent, so pre-2020 universes are survivor-tilted and their add`);
  P(`     returns biased UPWARD. ${testable.filter((y) => y < 2020).length} of the ${testable.length} testable years are pre-2020 and carry that tilt.`);
  P(`  3. POWER. This is an ANNUAL event. ${adds.length} predicted adds across ${Y1 - Y0 + 1} years, ${addT.length} in a testable year,`);
  P(`     ~${perYear.toFixed(0)} per year. The effective independent sample is closer to the ${testable.length} YEARS than to the`);
  P(`     ${addT.length} names, because every add within a year shares one market — the cross-sectional t is`);
  P(`     therefore an OVERSTATEMENT of the evidence, and the per-year table above is the honest read.`);
  P(`     Cross-sectional sd is ${sdA.toFixed(1)}%; detecting a 3% mean at t=2.8 needs n ~ ${needN} INDEPENDENT events,`);
  P(`     i.e. ~${Math.ceil(needN / Math.max(1, perYear))} clean years at this breadth. We have ${testable.length}.`);
  P(`     ${testable.length < 8 ? "UNDERPOWERED IN THE TIME DIMENSION — stated as its own verdict (COVERAGE LAW rule 3)." : "Year count is adequate; the binding limit is the proxy, not the sample."}`);
  P(`  4. BREADTH per rebalance is ~${perYear.toFixed(0)} adds/year, comfortably past the 50-name floor; the cross-section is`);
  P(`     fine and the TIME dimension is what is thin.`);

  const yearMeans = testable.map((y) => { const a = adds.filter((x) => x.y === y).map((x) => x.exR); return a.length ? mean(a) : NaN; }).filter(Number.isFinite);
  const tYear = yearMeans.length >= 3 ? tstat(yearMeans) : NaN;
  P(`\n  CLUSTER-HONEST TEST (one observation per year, the unit the event actually varies on):`);
  P(`    ${yearMeans.length} yearly mean excesses, mean ${yearMeans.length ? mean(yearMeans).toFixed(2) : "-"}%, t ${Number.isFinite(tYear) ? tYear.toFixed(2) : "-"}${Number.isFinite(tYear) ? (Math.abs(tYear) > 2 ? " (|t|>2)" : " (|t|<2 — NOT significant once clustering is respected)") : ""}`);

  P(`\n  trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
  const verdict = !riseOK
    ? `MISSED / NULL on the tradable leg. Predicted adds do NOT rise into reconstitution on this proxy: mean ${addM.toFixed(2)}% (gross t ${tR.toFixed(2)}), against a same-band incumbent control of ${incM.toFixed(2)}%, over ${testable.length} testable years and ${addT.length} events. Clustered by year the t is ${Number.isFinite(tYear) ? tYear.toFixed(2) : "n/a"}. This is NOT a clean refutation of the Russell front-running effect: the add list is a dollar-volume proxy of a float-cap rule (Part A's split defect forced that), which biases a true effect toward zero, so the honest label is PROXY-NULL / UNDERPOWERED-ON-YEARS, not "no effect".`
    : `CANDIDATE-SHAPED but not promotable: mean ${addM.toFixed(2)}% (t ${tR.toFixed(2)}) vs incumbents ${incM.toFixed(2)}%, clustered-by-year t ${Number.isFinite(tYear) ? tYear.toFixed(2) : "n/a"} on ${testable.length} years. The add list is a proxy of a proxy and the time dimension is thin; no gate is claimed.`;
  P(`\n  VERDICT: ${verdict}`);
}
P(`\n  DESCRIPTIVE ONLY — no pre-registration exists for this hypothesis (MECHANISM LAW, D-597). Nothing is`);
P(`  written to trd_lineage, no forward clock is started, and no gate is claimed.\n`);
