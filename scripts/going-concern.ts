#!/usr/bin/env -S deno run --allow-net --allow-env
// going-concern.ts (W4) — first test of the text-derived event family, PRE-REGISTERED as W4-going-concern.
//
// Hypothesis: the exact auditor phrase "substantial doubt about its ability to continue as a going concern" in a
// 10-K predicts UNDERPERFORMANCE over the following quarter. Direction registered NEGATIVE before any measurement.
//
// EVERY LAW THIS PROGRAMME HAS BOUGHT IS BUILT IN FROM THE START, rather than discovered as a correction afterwards:
//
//   THE EXECUTION LAW, SAME-BAR COROLLARY (D-498) — entry is the session AFTER the filing date. A 10-K is routinely
//     filed after the close, so acting at the file-date close is acting on information not yet available. The four
//     specs that ever cleared all six gates sign-flipped under exactly one day of lag; lag-1 is the structural floor.
//   THE BENCHMARK / ABSOLUTE DIAGNOSTIC (D-627) — the flagged bucket's RAW return is reported beside its excess. The
//     strongest result this programme produced decomposed into a bucket that ROSE while a universe rose faster; the
//     headline was a statement about universe drift. That test is run here before any claim, not after one.
//   THE LIQUIDITY LAW (D-424) — reported split by dollar-volume median. Distress signals are the canonical case of an
//     edge that lives entirely in names that cannot absorb size.
//   PSEUDO-REPLICATION (D-612) — the t-statistic is computed on the MONTHLY PORTFOLIO series, not across events.
//     Event-level t inflated a real result 4x (8.00 -> 2.01) by treating co-dated names as independent.
//   THE COVERAGE LAW — if the flagged panel is too thin to detect the effect, the verdict is UNTESTED, not null.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("going-concern", [
  { name: "HOLD_D", def: "63", note: "sessions held, ~one quarter" },
  { name: "ENTRY_LAG", def: "1", note: "sessions after file_date; 1 is the SAME-BAR floor, never 0" },
  { name: "COST_BP", def: "40", note: "round trip; distress names are wide" },
  { name: "MIN_NAMES", def: "5", note: "flagged names per month" },
  { name: "MIN_PERIODS", def: "24" },
  { name: "TAG", def: "going-concern" },
  { name: "LIQ_SPLIT", def: "1", note: "1 = also report liquid/illiquid halves" },
  { name: "PLACEBO", def: "", note: "1 = shift entry 250 sessions LATER, a null that must not reproduce the effect" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

const HOLD = Number(K.HOLD_D), LAG = Number(K.ENTRY_LAG), COST = Number(K.COST_BP) / 1e4;
const MINN = Number(K.MIN_NAMES), MINP = Number(K.MIN_PERIODS), TAG = K.TAG;
const PLACEBO = K.PLACEBO === "1" ? 250 : 0;

// ---- the flagged events ----
interface Ev { ticker: string; d: string }
const evs: Ev[] = [];
const cikNeed = new Map<string, string[]>();   // cik -> adsh list, for rows with no ticker in display_names
for (let off = 0;; off += 10000) {
  const rows = await fetch(`${OWNED}/trd_raw_filings?source=eq.edgar&filing_type=like.*${TAG}*&select=ticker,disclosed_date,raw&order=source_id&offset=${off}&limit=10000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { ticker: string | null; disclosed_date: string; raw: { cik?: string } }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    if (r.ticker) evs.push({ ticker: r.ticker, d: r.disclosed_date });
    else if (r.raw?.cik) { const c = r.raw.cik.replace(/^0+/, ""); (cikNeed.get(c) ?? cikNeed.set(c, []).get(c)!).push(r.disclosed_date); }
  }
  if (rows.length < 10000) break;
}
assertNonEmpty("going-concern filings with a resolvable date", evs, 200);

// Resolve the ticker-less filers against our own cik->ticker map rather than dropping them. Dropping every filer
// whose EDGAR display name lacks a ticker would silently bias the panel toward larger, better-tagged issuers.
if (cikNeed.size) {
  const map = new Map<string, string>();
  for (let off = 0;; off += 50000) {
    const rows = await fetch(`${OWNED}/trd_fundamentals?select=cik,ticker&order=cik&offset=${off}&limit=50000`, { headers: hdr })
      .then((r) => r.ok ? r.json() : []).catch(() => []) as { cik: string; ticker: string }[];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) if (r.ticker && r.cik) map.set(String(r.cik).replace(/^0+/, ""), r.ticker);
    if (rows.length < 50000) break;
  }
  let resolved = 0;
  for (const [c, dates] of cikNeed) { const t = map.get(c); if (t) { for (const d of dates) { evs.push({ ticker: t, d }); resolved++; } } }
  console.log(`    resolved ${resolved} additional filing(s) via the cik->ticker map (${cikNeed.size} ticker-less CIKs seen)`);
}

// ---- prices ----
const need = [...new Set(evs.map((e) => e.ticker))];
const px = new Map<string, { d: string[]; c: number[]; v: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (const b of raw) {
      const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(b[4]), vv = Number(b[5]) || 0;
      if (cc > 0) { d.push(dd); c.push(cc); v.push(vv * cc); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c, v });
  }
}
assertNonEmpty("priced flagged tickers", [...px.keys()], 50);

// The UNIVERSE for the absolute diagnostic is every priced name we hold, not the flagged set. Without it there is no
// way to tell a falling bucket from a rising bucket in a faster-rising market.
const uni = new Map<string, { d: string[]; c: number[] }>();
{
  const syms = await fetch(`${OWNED}/trd_bars_deep?select=symbol&order=symbol&limit=4000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string }[];
  const all = [...new Set((Array.isArray(syms) ? syms : []).map((s) => s.symbol))];
  for (let i = 0; i < all.length; i += 40) {
    const part = all.slice(i, i + 40).map((s) => `"${s}"`).join(",");
    const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
      .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string; bars: unknown }[];
    for (const r of Array.isArray(rows) ? rows : []) {
      const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
      const d: string[] = [], c: number[] = [];
      for (const b of raw) {
        const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
        const cc = Number(b[4]); if (cc > 0) { d.push(dd); c.push(cc); }
      }
      if (d.length > 300) uni.set(r.symbol, { d, c });
    }
  }
}
assertNonEmpty("universe tickers", [...uni.keys()], 200);

const idxAt = (arr: string[], d: string) => { let lo = 0, hi = arr.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= d) { at = m; lo = m + 1; } else hi = m - 1; } return at; };

const fwd = (p: { d: string[]; c: number[] }, d: string, lag: number, hold: number): number | null => {
  const i0 = idxAt(p.d, d) + lag + PLACEBO, i1 = i0 + hold;
  if (i0 < 1 || i1 >= p.d.length) return null;
  const r = p.c[i1] / p.c[i0] - 1;
  return Number.isFinite(r) && Math.abs(r) < 5 ? r : null;
};

// ---- monthly portfolio series ----
const byMonth = new Map<string, Ev[]>();
for (const e of evs) { const m = e.d.slice(0, 7); (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(e); }

const flagRaw: number[] = [], uniRaw: number[] = [], excess: number[] = [];
const liqRaw: number[] = [], illRaw: number[] = [], liqExc: number[] = [], illExc: number[] = [];
let breadth = 0, periods = 0, negPeriods = 0;

for (const [m, group] of [...byMonth.entries()].sort()) {
  const seenT = new Set<string>();
  const rows: { r: number; dv: number }[] = [];
  for (const e of group) {
    if (seenT.has(e.ticker)) continue; seenT.add(e.ticker);
    const p = px.get(e.ticker); if (!p) continue;
    const r = fwd(p, e.d, LAG, HOLD); if (r === null) continue;
    const i0 = idxAt(p.d, e.d);
    const dv = i0 > 20 ? mean(p.v.slice(Math.max(0, i0 - 20), i0)) : 0;
    rows.push({ r, dv });
  }
  if (rows.length < MINN) continue;

  // universe over the IDENTICAL window — same entry date, same hold, same lag
  const uRets: number[] = [];
  const anchor = group[0].d;
  for (const [, p] of uni) { const r = fwd(p, anchor, LAG, HOLD); if (r !== null) uRets.push(r); }
  if (uRets.length < 100) continue;

  const fr = mean(rows.map((x) => x.r)) - COST;
  const ur = mean(uRets);
  flagRaw.push(fr); uniRaw.push(ur); excess.push(fr - ur);
  if (fr < 0) negPeriods++;
  breadth += rows.length; periods++;

  if (K.LIQ_SPLIT === "1" && rows.length >= 6) {
    const s = [...rows].sort((a, b) => a.dv - b.dv);
    const half = Math.floor(s.length / 2);
    const ill = mean(s.slice(0, half).map((x) => x.r)) - COST;
    const liq = mean(s.slice(-half).map((x) => x.r)) - COST;
    illRaw.push(ill); liqRaw.push(liq); illExc.push(ill - ur); liqExc.push(liq - ur);
  }
  void m;
}
assertNonEmpty("monthly periods", excess, MINP);

const perYr = 252 / HOLD;
const pct = (a: number[]) => (mean(a) * perYr * 100).toFixed(2);

console.log(`\n==> GOING-CONCERN LANGUAGE IN 10-K — PREREG W4-going-concern`);
console.log(`    ${evs.length.toLocaleString()} filings | ${periods} monthly periods | mean breadth ${(breadth / periods).toFixed(1)} flagged names`);
console.log(`    entry: file_date + ${LAG} session${PLACEBO ? ` + ${PLACEBO} PLACEBO SHIFT` : ""} | hold ${HOLD} | cost ${K.COST_BP}bp round trip`);

console.log(`\n    ABSOLUTE DIAGNOSTIC (D-627 — the test that reduced the last headline by 75%):`);
console.log(`      flagged bucket RAW        ${pct(flagRaw).padStart(8)}%/yr   t ${tstat(flagRaw).toFixed(2)}`);
console.log(`      universe over same window ${pct(uniRaw).padStart(8)}%/yr   t ${tstat(uniRaw).toFixed(2)}`);
console.log(`      flagged NEGATIVE in ${negPeriods}/${periods} periods (${(100 * negPeriods / periods).toFixed(0)}%) — needs >50% to be a fall rather than a lag`);

console.log(`\n    EXCESS vs universe        ${pct(excess).padStart(8)}%/yr   PORTFOLIO t ${tstat(excess).toFixed(2)}`);

if (liqExc.length) {
  console.log(`\n    LIQUIDITY DECOMPOSITION (THE LIQUIDITY LAW — the promotable number is the liquid one):`);
  console.log(`      illiquid half  raw ${pct(illRaw).padStart(8)}%/yr   excess ${pct(illExc).padStart(8)}%/yr  t ${tstat(illExc).toFixed(2)}`);
  console.log(`      LIQUID half    raw ${pct(liqRaw).padStart(8)}%/yr   excess ${pct(liqExc).padStart(8)}%/yr  t ${tstat(liqExc).toFixed(2)}`);
}

// ---- the pre-registered verdict, applied mechanically ----
const tExc = tstat(excess), bAvg = breadth / periods;
const c1 = tExc <= -2.0;
const c2 = bAvg >= 50;
const c3 = negPeriods / periods > 0.5;
const c4 = liqExc.length ? tstat(liqExc) <= -2.0 : false;
console.log(`\n    PRE-REGISTERED GATES:`);
console.log(`      (1) portfolio t <= -2.0 ................ ${c1 ? "PASS" : "FAIL"}  (${tExc.toFixed(2)})`);
console.log(`      (2) mean breadth >= 50 ................. ${c2 ? "PASS" : "FAIL"}  (${bAvg.toFixed(1)})`);
console.log(`      (3) flagged negative in >50% periods ... ${c3 ? "PASS" : "FAIL"}  (${(100 * negPeriods / periods).toFixed(0)}%)`);
console.log(`      (4) effect present in the LIQUID half .. ${c4 ? "PASS" : "FAIL"}  (${liqExc.length ? tstat(liqExc).toFixed(2) : "n/a"})`);
console.log(`\n    ${c1 && c2 && c3 && c4 ? "ALL FOUR GATES PASS — direction MATCHED, forward registration warranted."
  : !c2 ? `UNTESTED on breadth — ${bAvg.toFixed(1)} names per period is below the pre-registered floor of 50. This is a statement about our panel, not about the market (THE COVERAGE LAW).`
  : !c3 && c1 ? "RELATIVE ONLY — the flagged bucket does not fall; it rises more slowly than the universe. The D-627 outcome, and the pre-registered kill condition fires."
  : !c1 ? `NOT SUPPORTED — portfolio |t| ${Math.abs(tExc).toFixed(2)} does not reach 2.0.`
  : "CAPACITY-BOUND — present pooled, absent in the liquid half."}`);
