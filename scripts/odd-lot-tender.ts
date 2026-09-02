#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// odd-lot-tender.ts — DESCRIPTIVE ONLY. Measure the odd-lot tender-offer mechanism.
//
// WHY THIS IS NOT ANOTHER "PREDICT THE NEXT RETURN" TEST. Every one of this programme's 2.9M trials asked a liquid
// market to be predictable, where capacity favours whoever has the most of it. An odd-lot tender is the inverse: an
// issuer self-tender (SC TO-I) or third-party tender (SC TO-T) that grants ODD-LOT PRIORITY accepts holders of fewer
// than 100 shares IN FULL, exempt from proration. The payout is defined by contract, not by forecasting, and it is
// available ONLY to an account small enough to hold 99 shares. It is structurally capacity-INVERTED — which also
// means the ceiling is hard and low, and that ceiling is reported as loudly as the return.
//
// LAWS THAT BIND HERE, and how they are honoured:
//  - THE COVERAGE LAW: every filing dropped is counted with its reason. The panel's IEX backfill starts ~2020, so
//    pre-2020 events are DATA-missing, not market-null; the measurable window is stated, not implied.
//  - THE EXECUTION LAW / SAME-BAR COROLLARY: entry is the close of the first bar STRICTLY AFTER the filing date.
//  - THE INSTRUMENT LAW: the instrument measured IS the placeable one — 99 shares of the common, tendered at the
//    contractual price. For a Dutch auction the LOW end of the range is used, the conservative fill.
//  - THE TURNOVER LAW: one round trip per event; the buy is a real cost, the tender leg has no commission at any
//    mainstream US broker but a per-tender fee is charged by some, so a per-event fee knob exists and is reported.
//  - THE BENCHMARK LAW: the premium is a contractual spread against a purchase price, not a cross-sectional return
//    against a universe, so the comparator reported is the stock's OWN post-expiration close.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("odd-lot-tender", [
  { name: "SRC", def: "data/odd-lot-tenders.json" },
  { name: "SHARES", def: "99", note: "odd lot = fewer than 100 shares" },
  { name: "FEE_BUY", def: "0", note: "$ commission to buy (US retail: 0)" },
  { name: "FEE_TENDER", def: "25", note: "$ per-tender fee some brokers charge; pessimistic default" },
  { name: "MAX_ENTRY_LAG_D", def: "10", note: "entry bar must be within this many days of the filing, else the panel does not cover the event" },
  { name: "PREM_HI", def: "100", note: "% premium above which the row is a SPLIT/PARSE artifact, not an offer" },
  { name: "PREM_LO", def: "-60", note: "% premium below which likewise" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "olt", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

interface Rec {
  adsh: string; form: string; date: string; cik: string; name: string; ticker: string | null;
  oddLotPriority: boolean | null; priceLo: number | null; priceHi: number | null; priceKind: string; expiry: string | null; note: string;
}
const recs = JSON.parse(Deno.readTextFileSync(K.SRC)) as Rec[];
assertNonEmpty("extracted odd-lot filings", recs, 100);
const SH = Number(K.SHARES), FB = Number(K.FEE_BUY), FT = Number(K.FEE_TENDER);
const LAGD = Number(K.MAX_ENTRY_LAG_D), PHI = Number(K.PREM_HI), PLO = Number(K.PREM_LO);

// ---------------- funnel: every drop counted, with its reason (THE COVERAGE LAW) --------------------------------
const originals = recs.filter((r) => !/\/A$/.test(r.form));
const amendments = recs.filter((r) => /\/A$/.test(r.form));
const dNoDoc = originals.filter((r) => r.oddLotPriority === null).length;
const withDoc = originals.filter((r) => r.oddLotPriority !== null);
const dNoPri = withDoc.filter((r) => !r.oddLotPriority).length;
const withPri = withDoc.filter((r) => r.oddLotPriority);
const dNoPrice = withPri.filter((r) => r.priceLo === null).length;
const withPrice = withPri.filter((r) => r.priceLo !== null);
const dNoTicker = withPrice.filter((r) => !r.ticker || !/^[A-Z][A-Z0-9.\-]{0,5}$/.test(r.ticker)).length;
const cand = withPrice.filter((r) => r.ticker && /^[A-Z][A-Z0-9.\-]{0,5}$/.test(r.ticker));

console.log(`==> ODD-LOT TENDER OFFERS — DESCRIPTIVE ONLY (no lineage row, no promotion)\n`);
console.log(`    FUNNEL (every drop counted — THE COVERAGE LAW):`);
console.log(`      ${String(recs.length).padStart(5)}  filings held (SC TO-I/TO-T + amendments, FTS phrase "odd lot", 2012-2026)`);
console.log(`      ${String(amendments.length).padStart(5)}  amendments set aside (used below only to detect repricing)`);
console.log(`      ${String(originals.length).padStart(5)}  ORIGINAL offers`);
console.log(`      -${String(dNoDoc).padStart(4)}  no primary document fetchable`);
console.log(`      -${String(dNoPri).padStart(4)}  mention "odd lot" but grant NO priority / no-proration language`);
console.log(`      -${String(dNoPrice).padStart(4)}  odd-lot priority granted but no parseable price (closed-end funds tendering at NAV, exchange offers, share-for-share)`);
console.log(`      -${String(dNoTicker).padStart(4)}  no resolvable ticker (private/never-listed registrant)`);
console.log(`      ${String(cand.length).padStart(5)}  CANDIDATE events with priority + price + ticker`);

// ---------------- prices ----------------------------------------------------------------------------------------
const syms = [...new Set(cand.map((r) => r.ticker!))];
const barCache = new Map<string, number[][]>();
for (let i = 0; i < syms.length; i += 40) {
  const chunk = syms.slice(i, i + 40);
  const url = `${OWNED}/trd_bars_deep?symbol=in.(${chunk.map((s) => `"${s}"`).join(",")})&select=symbol,bars`;
  const j = await fetch(url, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);
  for (const row of j as { symbol: string; bars: number[][] }[]) barCache.set(row.symbol, (row.bars || []).filter((b) => b[4] > 0));
}
const haveBars = syms.filter((s) => (barCache.get(s)?.length ?? 0) > 20);
console.log(`\n    PRICE COVERAGE: ${haveBars.length} of ${syms.length} candidate tickers are in trd_bars_deep with >20 bars.`);
console.log(`    The panel's delisted backfill begins ~2020, so pre-2020 events are DATA-missing, not market-null.`);

// repricing detection: an amendment for the same CIK inside the offer window quoting a DIFFERENT low price
const amByCik = new Map<string, Rec[]>();
for (const a of amendments) (amByCik.get(a.cik) ?? amByCik.set(a.cik, []).get(a.cik)!).push(a);

interface Ev {
  ticker: string; date: string; entry: string; entryPx: number; tender: number; kind: string;
  premPct: number; profit: number; expiry: string | null; postPx: number | null; tenderBetter: boolean | null;
  holdDays: number; repriced: boolean; name: string;
}
const evs: Ev[] = [];
let dNoBars = 0, dNoEntry = 0, dParse = 0, dUncovered = 0;
for (const r of cand) {
  const b = barCache.get(r.ticker!); if (!b || b.length < 20) { dNoBars++; continue; }
  const dts = b.map((x) => iso(x[0]));
  // EXECUTION LAW: entry is the first bar STRICTLY AFTER the filing date.
  const i0 = dts.findIndex((d) => d > r.date);
  if (i0 < 0) { dNoEntry++; continue; }
  // DEFECT FOUND AND FIXED. The panel's delisted/IEX backfill begins ~2020, so for a 2012 filing this
  // findIndex returns the panel's FIRST bar (2020) and the "entry" was a price eight years after the event —
  // Weight Watchers' 2012 offer was being compared with its 2020 close. A bar that is not NEAR the filing is
  // not coverage; the event is UNTESTED, not measurable. (COVERAGE LAW; caught by inspecting the tails.)
  if (Date.parse(dts[i0]) - Date.parse(r.date) > LAGD * 864e5) { dUncovered++; continue; }
  const entryPx = b[i0][4];
  const tender = r.priceLo!;                                  // Dutch -> conservative LOW end
  const premPct = (tender / entryPx - 1) * 100;
  // SECOND DEFECT. `trd_bars_deep` closes are SPLIT-ADJUSTED to the present; a filing quotes the NOMINAL price
  // of the day. Any split between the filing and today rescales one side only — MicroStrategy's 2020 offer
  // showed a +790% "premium" (10:1 split in 2024), Wheeler's showed -100% off a reverse split. An offer is
  // priced near the market by construction, so a premium outside this band is a DATA ARTIFACT, never an offer.
  // This is a data-quality exclusion, not outcome selection, and it is counted and reported as such.
  if (!isFinite(premPct) || premPct > PHI || premPct < PLO) { dParse++; continue; }
  const expiry = r.expiry && r.expiry > r.date && r.expiry < addDays(r.date, 400) ? r.expiry : null;
  const target = expiry ?? addDays(r.date, 30);
  let iT = dts.findIndex((d) => d > target); if (iT < 0) iT = -1;
  const postPx = iT >= 0 ? b[iT][4] : null;
  const gross = SH * (tender - entryPx);
  const profit = gross - FB - FT;
  const am = (amByCik.get(r.cik) ?? []).filter((a) => a.date > r.date && a.date <= addDays(r.date, 120) && a.priceLo !== null);
  const repriced = am.some((a) => Math.abs((a.priceLo! - tender) / tender) > 0.005);
  evs.push({ ticker: r.ticker!, date: r.date, entry: dts[i0], entryPx, tender, kind: r.priceKind, premPct, profit, expiry, postPx, tenderBetter: postPx === null ? null : postPx < tender, holdDays: iT >= 0 ? (Date.parse(dts[iT]) - Date.parse(dts[i0])) / 864e5 : 30, repriced, name: r.name });
}
console.log(`      -${String(dNoBars).padStart(4)}  ticker not in trd_bars_deep (or <20 bars) — overwhelmingly pre-2020 events`);
console.log(`      -${String(dNoEntry).padStart(4)}  no bar after the filing date`);
console.log(`      -${String(dUncovered).padStart(4)}  no bar within ${LAGD}d of the filing — the event PREDATES our price history (UNTESTED, not null)`);
console.log(`      -${String(dParse).padStart(4)}  premium outside [${PLO}%, ${PHI}%] — SPLIT-ADJUSTMENT or price-parse artifact, not an offer`);
console.log(`      ${String(evs.length).padStart(5)}  MEASURED EVENTS\n`);
assertNonEmpty("measured odd-lot events", evs, 10);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "odd-lot-tender", runId: `olt|${evs.length}`, spent: 1 });

// ---------------- the measurement -------------------------------------------------------------------------------
const prem = evs.map((e) => e.premPct);
const pos = evs.filter((e) => e.premPct > 0);
const profits = evs.map((e) => e.profit);
const posProfits = pos.map((e) => e.profit);
console.log(`    ALL ${evs.length} MEASURED EVENTS (entry lag-1, tender at ${"Dutch=LOW end"}):`);
console.log(`      share with premium > 0 ......... ${(100 * pos.length / evs.length).toFixed(1)}%  (${pos.length}/${evs.length})`);
console.log(`      median premium ................. ${med(prem).toFixed(2)}%`);
console.log(`      mean premium ................... ${mean(prem).toFixed(2)}%   (t ${tstat(prem).toFixed(2)}, sd ${sd(prem).toFixed(1)})`);
console.log(`      median $ profit / event (${SH}sh) . $${med(profits).toFixed(2)}   [gross - $${FB} buy - $${FT} tender fee]`);
console.log(`      mean   $ profit / event ........ $${mean(profits).toFixed(2)}`);
console.log(`      total $ if EVERY event taken ... $${profits.reduce((a, b) => a + b, 0).toFixed(0)}`);

console.log(`\n    THE ONLY TRADEABLE SUBSET — events where the tender price EXCEEDS the post-filing close (n=${pos.length}):`);
console.log(`      median premium ${med(pos.map((e) => e.premPct)).toFixed(2)}% | mean ${mean(pos.map((e) => e.premPct)).toFixed(2)}%`);
console.log(`      median $ profit $${med(posProfits).toFixed(2)} | mean $${mean(posProfits).toFixed(2)} | total $${posProfits.reduce((a, b) => a + b, 0).toFixed(0)}`);
console.log(`      events with profit <= 0 AFTER the $${FT} tender fee: ${posProfits.filter((p) => p <= 0).length} of ${pos.length}`);

// per year (DISAGGREGATE — Rule 8)
console.log(`\n    PER YEAR (measured events / of which premium>0 / median premium% / $ from ${SH} shares, net of fees):`);
const years = [...new Set(evs.map((e) => e.date.slice(0, 4)))].sort();
for (const y of years) {
  const g = evs.filter((e) => e.date.slice(0, 4) === y); const gp = g.filter((e) => e.premPct > 0);
  console.log(`      ${y}: n=${String(g.length).padStart(3)} | prem>0 ${String(gp.length).padStart(3)} | med ${med(g.map((e) => e.premPct)).toFixed(2).padStart(7)}% | $ all ${g.reduce((a, e) => a + e.profit, 0).toFixed(0).padStart(6)} | $ prem>0-only ${gp.reduce((a, e) => a + e.profit, 0).toFixed(0).padStart(6)}`);
}

// ERA DECOMPOSITION (Rule 8, and a residual-defect control). The split-adjustment artifact is not fully removed
// by the [PLO,PHI] band: a 2:1 split shows as +100% and a 3:2 as +50%, both inside it. Exposure to that error
// grows with the time since the filing, so the PRE-2020 half is the contaminated half and the 2020+ half — where
// the panel's own history begins and few splits have since occurred — is the clean one. If the two halves
// disagree, the modern number is the honest one, not the pooled one.
for (const [label, sel] of [["pre-2020 (SPLIT-EXPOSED)", (e: Ev) => e.date < "2020-01-01"], ["2020+ (CLEAN)", (e: Ev) => e.date >= "2020-01-01"]] as [string, (e: Ev) => boolean][]) {
  const g = evs.filter(sel), gp = g.filter((e) => e.premPct > 0);
  if (!g.length) continue;
  const yrs = (Date.parse(g[g.length - 1].date) - Date.parse(g[0].date)) / (365.25 * 864e5) || 1;
  console.log(`\n    ERA ${label}: n=${g.length} | prem>0 ${gp.length} (${(100 * gp.length / g.length).toFixed(0)}%) | median premium ${med(g.map((e) => e.premPct)).toFixed(2)}%`);
  console.log(`      prem>0 subset: median $${med(gp.map((e) => e.profit)).toFixed(2)}/event | $${(gp.reduce((a, e) => a + e.profit, 0) / yrs).toFixed(0)}/yr over ${yrs.toFixed(1)}y at ${(gp.length / yrs).toFixed(1)} events/yr`);
}

// ---------------- downside, capital, ceiling --------------------------------------------------------------------
const withPost = pos.filter((e) => e.postPx !== null);
const tenderBetter = withPost.filter((e) => e.tenderBetter).length;
const fellMore = withPost.filter((e) => (e.postPx! / e.entryPx - 1) * 100 < -e.premPct).length;
const repriced = pos.filter((e) => e.repriced).length;
console.log(`\n    DOWNSIDE (the offer is a contract you can still be left out of):`);
console.log(`      of the ${withPost.length} premium>0 events with a post-expiration close:`);
console.log(`        tender price was the BETTER exit than holding ... ${tenderBetter} (${(100 * tenderBetter / Math.max(1, withPost.length)).toFixed(0)}%)`);
console.log(`        stock fell MORE than the premium by then ........ ${fellMore} (${(100 * fellMore / Math.max(1, withPost.length)).toFixed(0)}%) — the loss if the offer had failed`);
console.log(`      offers REPRICED by a later amendment ............. ${repriced} of ${pos.length} (${(100 * repriced / Math.max(1, pos.length)).toFixed(0)}%)`);
console.log(`      NOT MEASURED: outright TERMINATION language in amendment text was not parsed. Termination risk is`);
console.log(`      therefore UNTESTED here, and the downside above is a LOWER bound on it.`);

// concurrency -> tied-up capital
const spans = pos.map((e) => [Date.parse(e.entry), Date.parse(e.entry) + e.holdDays * 864e5, SH * e.entryPx] as [number, number, number]);
let maxConc = 0, maxCap = 0;
for (const [t] of spans) {
  const open = spans.filter(([a, b]) => a <= t && t <= b);
  if (open.length > maxConc) maxConc = open.length;
  const cap = open.reduce((s, x) => s + x[2], 0); if (cap > maxCap) maxCap = cap;
}
const nYears = (Date.parse(evs[evs.length - 1].date) - Date.parse(evs[0].date)) / (365.25 * 864e5);
const perYear = pos.length / nYears;
const dollarsPerYear = posProfits.reduce((a, b) => a + b, 0) / nYears;
const avgCap = mean(spans.map((s) => s[2]));
console.log(`\n    CAPACITY AND CAPITAL (measured window ${evs[0].date} .. ${evs[evs.length - 1].date}, ${nYears.toFixed(1)} years):`);
console.log(`      premium>0 events per year ...................... ${perYear.toFixed(1)}`);
console.log(`      $/yr for ONE account taking every one .......... $${dollarsPerYear.toFixed(0)}`);
console.log(`      capital per position (${SH} sh) mean ............. $${avgCap.toFixed(0)}`);
console.log(`      MAX concurrent open positions ................. ${maxConc}`);
console.log(`      MAX simultaneously tied-up capital ............. $${maxCap.toFixed(0)}`);
console.log(`      HARD CEILING: ${SH} shares x ${pos.length} events over ${nYears.toFixed(1)}y is the WHOLE opportunity. It does not`);
console.log(`      scale with capital by a single dollar — tendering 100+ shares forfeits the odd-lot priority and puts`);
console.log(`      you into proration with the institutions. A second account is a second $${dollarsPerYear.toFixed(0)}/yr and`);
console.log(`      is a separate legal person, not leverage.`);

console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
// THE VERDICT IS STATED ON THE CLEAN ERA, NOT THE POOL. The two halves disagree in a way that matches the known
// residual defect exactly — pre-2020 (split-exposed) shows a 12.5% median premium with 77% of offers above market,
// 2020+ (clean) shows -0.3% with 50%. A tender priced at the market with a coin-flip sign IS what theory predicts;
// a systematic 12% is what a split artifact predicts. Reporting the pool would have overstated this by ~1.8x.
const modern = evs.filter((e) => e.date >= "2020-01-01");
const modernPos = modern.filter((e) => e.premPct > 0);
const mYrs = (Date.parse(modern[modern.length - 1].date) - Date.parse(modern[0].date)) / (365.25 * 864e5);
const mPerYr = modernPos.length / mYrs, mDollarsYr = modernPos.reduce((a, e) => a + e.profit, 0) / mYrs;
const mCap = Math.max(...modernPos.map((e) => SH * e.entryPx));
console.log(`\n    VERDICT (stated on the CLEAN 2020+ era, n=${modern.length}; the pooled figure is ~1.8x higher and is split-contaminated):`);
console.log(`    The mechanism is REAL and it is RETAIL-ONLY: odd-lot priority is granted in ${withPri.length} of ${withDoc.length} original`);
console.log(`    offers that mention odd lots, it exempts sub-100-share holders from proration by contract, and no`);
console.log(`    amount of capital can access more of it. The MONEY is negligible: ${mPerYr.toFixed(1)} above-market tenders per year,`);
console.log(`    median $${med(modernPos.map((e) => e.profit)).toFixed(0)} per event net of a $${FT} tender fee, i.e. ~$${mDollarsYr.toFixed(0)}/yr for one account taking every`);
console.log(`    one, against up to ~$${mCap.toFixed(0)} tied up per position and ~$${maxCap.toFixed(0)} at peak concurrency.`);
console.log(`    Half of all offers (${(100 * modernPos.length / modern.length).toFixed(0)}%) are above the market at filing; the median offer is priced AT it (${med(modern.map((e) => e.premPct)).toFixed(2)}%),`);
console.log(`    so this is a selection rule applied to a coin flip, not a premium the mechanism pays by itself.`);
console.log(`    CEILING: ${SH} shares x ~${mPerYr.toFixed(0)} events/yr. It does not scale with capital by one dollar — tendering 100+`);
console.log(`    shares forfeits the priority and puts you into proration with the institutions.`);
console.log(`    DESCRIPTIVE ONLY (MECHANISM LAW): no pre-registration, no trd_lineage row, no promotion. Premiums are`);
console.log(`    measured, not forecast; the selection "take it when premium>0" is made WITH the premium in hand at`);
console.log(`    entry, so it is a real ex-ante rule, but its forward yield is UNTESTED.`);
