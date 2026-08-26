#!/usr/bin/env -S deno run --allow-net --allow-env
// retail-internalisation.ts (D-614) — the split inside the dark-pool data that no spec has ever used.
//
// THE GAP. trd_ats_weekly holds 7,649,286 rows against 8 tested specs, and every one collapses the two record types
// into a single number: the factory computes `shTot = atsSh + otcSh` and ranks on that. But the two types are
// economically opposite. ATS_W_SMBL is dark-pool block trading — institutional size seeking to hide. OTC_W_SMBL is
// non-ATS internalisation — retail marketable flow sold to wholesalers. Summing them discards exactly the
// information that distinguishes who is trading.
//
// Their RATIO is a retail-participation proxy, and the prediction is directional: names retail crowds into get bid
// above value and subsequently underperform (Barber-Odean attention/overvaluation).
//
// PRE-REGISTERED as D-614-retail-internalisation with a genuinely two-sided prior — Boehmer-Jones-Zhang-Zhang find
// retail order IMBALANCE predicts returns POSITIVELY, so a positive sign here is a real possibility and is recorded
// in advance as a SIGN MISS rather than something to reframe afterwards.
//
// STATISTIC LEVEL IS FIXED IN ADVANCE: the portfolio t and nothing else. D-612 found an event-level t inflating
// PEAD 4x (8.00 -> 2.01) on overlapping observations, and my pre-registration there failed to specify the level.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("retail-internalisation", [
  { name: "HOLD_W", def: "4", note: "weeks held" },
  { name: "QUINTILES", def: "5" },
  { name: "COST_BP", def: "20", note: "round trip" },
  { name: "LIQUID_ONLY", def: "", note: "1 = liquid half only, the confound control" },
  { name: "MIN_NAMES", def: "200", note: "per rebalance" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ri", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

// Which symbols have prices at all — no point loading ATS rows we can never evaluate.
const bd = await fetch(`${OWNED}/trd_bars_deep?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
const priced = new Set((Array.isArray(bd) ? bd : []).map((x) => x.symbol));
assertNonEmpty("symbols with price series", [...priced], 500);

// ATS weekly, aggregated per symbol-week into ats vs otc shares.
interface Wk { ats: number; otc: number }
const ats = new Map<string, Map<string, Wk>>();   // week -> symbol -> {ats,otc}
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_ats_weekly?select=symbol,week_start,type,shares&order=week_start&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; week_start: string; type: string; shares: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    if (!priced.has(r.symbol)) continue;
    const w = ats.get(r.week_start) ?? ats.set(r.week_start, new Map()).get(r.week_start)!;
    const e = w.get(r.symbol) ?? w.set(r.symbol, { ats: 0, otc: 0 }).get(r.symbol)!;
    if (r.type === "ATS_W_SMBL") e.ats += +r.shares; else e.otc += +r.shares;
  }
  if (rows.length < 50000) break;
}
assertNonEmpty("ATS weeks", [...ats.keys()], 50);

// Prices for the symbols that actually appear.
const need = [...new Set([...ats.values()].flatMap((m) => [...m.keys()]))];
const px = new Map<string, { d: string[]; c: number[]; v: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (const b of raw) {
      const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(b[4]), vv = Number(b[5]);
      if (cc > 0) { d.push(dd); c.push(cc); v.push(Number.isFinite(vv) ? vv : 0); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c, v });
  }
}
assertNonEmpty("priced ATS symbols", [...px.keys()], 300);

const HOLD = Number(K.HOLD_W), Q = Number(K.QUINTILES), COST = Number(K.COST_BP) / 1e4, MINN = Number(K.MIN_NAMES);
const weeks = [...ats.keys()].sort();
const idxAt = (s: string, d: string) => { const p = px.get(s)!; let lo = 0, hi = p.d.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { at = m; lo = m + 1; } else hi = m - 1; } return at; };

// FINRA publishes ATS data with a lag (weeks for ATS tier). Entering 2 weeks after the week_start is the
// conservative reading of when the number was actually knowable.
const PUB_LAG_W = 2;
const periodRets: number[] = [];
const qRets: number[][] = Array.from({ length: Q }, () => []);
let breadth = 0, periods = 0;

for (let wi = PUB_LAG_W; wi + HOLD < weeks.length; wi += HOLD) {
  const sigWeek = weeks[wi - PUB_LAG_W];
  const entryD = weeks[wi], exitD = weeks[wi + HOLD];
  const m = ats.get(sigWeek); if (!m) continue;
  const cands: { s: string; sig: number; ret: number; dvol: number }[] = [];
  for (const [s, e] of m) {
    const tot = e.ats + e.otc; if (!(tot > 0)) continue;
    const p = px.get(s); if (!p) continue;
    const i0 = idxAt(s, entryD), i1 = idxAt(s, exitD);
    if (i0 < 30 || i1 <= i0) continue;
    const r = p.c[i1] / p.c[i0] - 1;
    if (!Number.isFinite(r) || Math.abs(r) > 2) continue;
    let dv = 0, k = 0;
    for (let j = i0 - 30; j < i0; j++) if (p.v[j] > 0) { dv += p.c[j] * p.v[j]; k++; }
    cands.push({ s, sig: e.otc / tot, ret: r, dvol: k ? dv / k : 0 });   // RETAIL INTERNALISATION SHARE
  }
  if (cands.length < MINN) continue;
  let pool = cands;
  if (K.LIQUID_ONLY === "1") {
    const med = [...pool.map((x) => x.dvol)].sort((a, b) => a - b)[Math.floor(pool.length / 2)];
    pool = pool.filter((x) => x.dvol >= med);
    if (pool.length < MINN / 2) continue;
  }
  pool.sort((a, b) => a.sig - b.sig);            // ascending: q0 = LOWEST retail share
  const per = Math.floor(pool.length / Q);
  if (per < 20) continue;
  for (let q = 0; q < Q; q++) {
    const slice = pool.slice(q * per, (q + 1) * per);
    qRets[q].push(mean(slice.map((x) => x.ret)));
  }
  // The book: SHORT high retail share, LONG low — the pre-registered direction.
  const lowQ = pool.slice(0, per), highQ = pool.slice(-per);
  periodRets.push(mean(lowQ.map((x) => x.ret)) - mean(highQ.map((x) => x.ret)) - 2 * COST);
  breadth += pool.length; periods++;
}
assertNonEmpty("rebalance periods", periodRets, 20);

const m = mean(periodRets), s2 = sd(periodRets) || 1e-12;
const tPort = m / (s2 / Math.sqrt(periodRets.length));
const perYr = 52 / HOLD;
console.log(`\n==> RETAIL INTERNALISATION (OTC non-ATS share of off-exchange volume)`);
console.log(`    ${periodRets.length} rebalances of ${HOLD}w, mean breadth ${(breadth / periods).toFixed(0)} names${K.LIQUID_ONLY === "1" ? ", LIQUID HALF ONLY" : ""}`);
console.log(`    quintile mean ${HOLD}w return, q0 = LOWEST retail share -> q${Q - 1} = HIGHEST:`);
for (let q = 0; q < Q; q++) console.log(`      q${q}  ${(mean(qRets[q]) * 100).toFixed(3)}%`);
const monotone = qRets.every((_, q) => q === 0 || mean(qRets[q]) <= mean(qRets[q - 1]));
console.log(`    monotone DECREASING in retail share (the prediction): ${monotone ? "YES" : "NO"}`);
console.log(`\n    BOOK long-low / short-high retail share: ${(m * perYr * 100).toFixed(2)}%/yr  PORTFOLIO t ${tPort.toFixed(2)}  [bar: |t| >= 2.0, sign must be POSITIVE for this book = negative predictor]`);
const supported = tPort >= 2.0 && monotone;
console.log(`\n    ${supported ? "SUPPORTED — high retail internalisation predicts underperformance." :
  tPort <= -2.0 ? "SIGN MISS — high retail share predicts OUTPERFORMANCE, the Boehmer direction, opposite to what was registered." :
  `NOT SUPPORTED — portfolio |t| ${Math.abs(tPort).toFixed(2)}${monotone ? "" : ", and not monotone"}.`}`);
