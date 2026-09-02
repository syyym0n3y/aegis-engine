#!/usr/bin/env -S deno run --allow-net --allow-env
// market-odds-map.ts (D-736) — the single honest synthesis of WHAT WE KNOW about the odds, per instrument class, for
// a trader. It encapsulates the whole stack's understanding: the universe held, the driver coverage, every approach
// TESTED and its verdict, the surviving candidates on forward clocks, and — stated as loudly as everything else — the
// gaps we PROVABLY cannot see (gated data). It is NOT a claim to know everything (the COVERAGE LAW forbids that); it
// is the honest map of what we know, what we don't, and the odds where we have evidence.
//
// THE ODDS, STATED PLAINLY. The base rate is brutal and it is the headline, not a footnote: 0 of ~1.37M trials have
// cleared the gates; the liquid, retail-tradable universe is efficiently priced; every real effect found lives in
// illiquid names or needs paid borrow. So for MOST instruments the honest odds are "no edge — negative EV after
// costs", and that IS the answer, not a hole to fill. The few survivors are named, on forward clocks, with risk shown.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("market-odds-map", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mom", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);
const one = async (p: string) => { const r = await fetch(`${OWNED}/${p}`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } }); return +(r.headers.get("content-range")?.split("/")[1] ?? 0); };

// The base rate — the headline odds for any trader, from this programme's own ledger.
const trials = await one("trd_trial_counter?select=id");
const leads = await one("trd_lineage_roster?select=name");
const promoted = (await q("trd_lineage_roster?select=status") as { status: string }[]).filter((r) => /promot|micro|small|live/i.test(r.status)).length;
const clocks = await q("trd_forward_rules?select=id,spec,promote_if") as { id: string; spec: string; promote_if: string }[];

console.log(`==> MARKET ODDS MAP — what we know, per instrument, and the honest odds for a trader\n`);
console.log(`  THE BASE RATE (the headline, not a footnote):`);
console.log(`    ${trials.toLocaleString()} trials -> ${promoted} promoted of ${leads} leads. The liquid, retail-tradable universe is`);
console.log(`    EFFICIENTLY PRICED — this is why nothing cleared. For most instruments the honest odds are NEGATIVE EV`);
console.log(`    after costs. The engine's job is to KNOW this with confidence, not to pretend an edge exists.\n`);

// Per instrument class: universe, driver coverage (from the D-726 matrix, condensed), tested-approaches verdicts, and
// the honest odds verdict. Driver coverage is the count of canonical CONDITION drivers held for that class.
interface Cls { name: string; universeQ: string; drivers: string; tested: string; odds: string; conf: string; risk: string; gap: string }
const CLASSES: Cls[] = [
  { name: "US equity (single names)", universeQ: "trd_bars_deep?asset_class=eq.equity&select=symbol",
    drivers: "price/vol, fundamentals(PIT), short-interest, FTD, dark-pool, insider, 13F, NPORT, 8-K, earnings, breadth",
    tested: "momentum, value, quality, payout, PEAD, insider, 13F, dark-pool, short-interest, FTD, merger-arb, spin-off, IPO/lockup, de-SPAC, S&P-500 inclusion",
    odds: "MOSTLY NO EDGE. Cross-sectional factors: real in research space, DEAD as placeable long-shorts (borrow, thousands of names). Events: merger-arb/lockup NULL in liquid; S&P-500 inclusion post-effective NULL with prior MATCHED (D-740; the pre-effective pop is UNTESTED for want of announcement dates); de-SPAC underperf real but illiquid+borrow-gated. ONE survivor: SPIN-OFF premium (long-only, small-size-fits) on a forward clock.",
    conf: "near-zero to act, EXCEPT spin-offs (candidate, unproven forward)",
    risk: "97% of retail lose; single-name idiosyncratic + gap risk is total-loss-capable",
    gap: "borrow cost (paid), options/vol surface (paid), real-time L2 (paid), analyst revisions (licensed)" },
  { name: "Equity indices / ETFs", universeQ: "trd_bars_deep?asset_class=in.(etf,index,intl_index,sector)&select=symbol",
    drivers: "price, VIX + VIX9D term structure, breadth, credit(HYG/LQD), yield curve, real yields, CPI/breakevens, GPR, USD, ratios, seasonality",
    tested: "vol-timing, macro-regime conditioning, options-regime conditioning (SKEW/VVIX/term), breadth U-shape, trend de-risk (ladder)",
    odds: "NO TRADABLE TIMING EDGE. Vol-timing sign-FLIPPED on execution lag (D-498); macro-regime conditioning WASHED OUT under stationarity (D-730); options-regime extremity NULL OOS once window overlap is adjusted (D-739, |t| 0.28-0.88, naive t -5 was an artifact); trend de-risk COSTS 30-37% of wealth (D-735, drawdown tool not return tool). Breadth U-shape is CONTEXT only, OOS-confirmed but not tradable.",
    conf: "near-zero to time; HIGH confidence that buy-and-hold + deposits beats timing (D-680/735)",
    risk: "-52% peak drawdown, 3.4y underwater on buy-and-hold — survivable only by not panic-selling",
    gap: "full per-strike equity options surface (paid, UNTESTED); the free INDEX-level options regime is now TESTED and NULL (D-739)" },
  { name: "Crypto (perps + spot)", universeQ: "trd_bars_intraday?tf=eq.1dSF&select=symbol",
    drivers: "price(SF panel), perp funding, open interest, on-chain (hash/tx/addresses), Deribit dvol/skew, taker flow",
    tested: "funding carry, momentum, order-flow, variance premium, GBM/universe, cross-sectional factors",
    odds: "NO SURVIVING EDGE. Funding-crowding was a POOLING artifact (D-415 retracted); momentum breadth-collapsed (D-443); order-flow SUB-FEE (D-426, 0.02-0.14x); variance premium DIED as a straddle (D-574). Best candidate (GBM) NOT universe-identified (2.1x Sharpe spread, D-535).",
    conf: "near-zero; the strongest crypto results were all artifacts",
    risk: "extreme vol, 24/7 gaps, venue/counterparty risk, -80%+ drawdowns normal",
    gap: "full L2 order book depth (only aggregated taker split held)" },
  { name: "FX (majors)", universeQ: "trd_bars_deep?asset_class=eq.fx&select=symbol",
    drivers: "price(hourly+daily), COT positioning, US short rate; FOREIGN short rates NOT held",
    tested: "carry (partial), currency-of-account (structural)",
    odds: "DEVELOPED CARRY ABSENT (D-738: G6 Sharpe 0.22, t 1.06; reproduced at 0.29 / 1.39 in D-741). EM CARRY IS A RISK PREMIUM, NOT AN EDGE (D-741): EM-only Sharpe 0.59, gross t 2.79 — but that is the rate differential collected against a NEGATIVE spot leg (-3%/yr), far under the 5.46 deflation ceiling, breadth 14, Sharpe doubling across universes (NOT IDENTIFIED), and measured in research space not the NDF. Currency-of-account is a real STRUCTURAL effect (~1.3pp/yr for a GBP investor, D-731) but path-dependent, not a signal.",
    conf: "near-zero to time FX; EM carry is a known premium paid for holding EM risk (5.2y underwater, -35% DD) — not a forecast, not promotable",
    risk: "leverage-driven blowup risk; central-bank regime shifts; EM peso-problem (TRY at 47% policy rate with a collapsing spot); 5-18y underwater on carry books",
    gap: "EM carry measured in RESEARCH space — the placeable NDF/forward conversion is NOT measured (INSTRUMENT LAW); foreign LONG rates still partial" },
  { name: "Commodities", universeQ: "trd_bars_deep?asset_class=eq.commodity&select=symbol",
    drivers: "front-month price, COT positioning; FUTURES CURVE contracts 1-4 for CL + NG (EIA keyless, 1983+/1994+, ends 2024-04, D-742); EIA weekly INVENTORIES crude ex-SPR + gas storage (keyless, LIVE, D-743)",
    tested: "roll yield / backwardation (CL, NG — D-742), inventory-change conditioning post-release (CL, NG — D-743), gold ETF flow (D-745: REFUTED as a driver — gold rises MORE after outflows; flow FOLLOWS price at corr 0.33), seasonality (built), cross-asset ratios (built)",
    odds: "ROLL YIELD MEASURED: CL backwardation premium looks real full-sample (t 2.72, prior MATCHED) but is CARRIED BY 1985-2004 — post-2005 t 1.18, 6.3y underwater, -82% DD: NULL out-of-sample. NG: RUINED — a -25%/yr contango bleed no curve rule rescues. Seasonality + ratios are CONTEXT drivers, not standalone edges.",
    conf: "near-zero; the defining commodity edge is absent OOS where measurable (2 curves) and UNTESTED on the other 6",
    risk: "storage/delivery, contango bleed (NG -25%/yr unconditional), negative prices (WTI -37.63 on 2020-04-20), geopolitical shocks",
    gap: "curve for GC/ZC/ZW/ZS/HG/SI (no free historical source found — Yahoo lists only live contracts, Stooq bot-blocked, CHRIS deprecated); consensus inventory SURPRISE (analyst estimates, not held — the post-release CHANGE is NULL, D-743); USDA ag inventories (unfetched); a free EIA key would make the CL/NG curve live" },
  { name: "Rates / bonds", universeQ: "trd_bars_deep?asset_class=in.(rate)&select=symbol",
    drivers: "full nominal curve (FRED 1976+), real yields, breakevens, credit spread, NFCI, TLT/IEF/etc",
    tested: "bond carry / term premium (D-731b)",
    odds: "NO TRADABLE CARRY. Term-spread conditioning of TLT is INSIGNIFICANT (rolling-z t 1.29); the big change-t was a 2022 rate-shock era artifact.",
    conf: "near-zero to time bonds; the bond risk premium did not appear as a forward signal",
    risk: "duration/convexity, rate-shock (2022: TLT -30%+)",
    gap: "individual-bond / OIS data (paid)" },
];

for (const c of CLASSES) {
  const n = await one(c.universeQ);
  console.log(`  ${c.name}  (${n.toLocaleString()} instruments held)`);
  console.log(`    drivers held : ${c.drivers}`);
  console.log(`    tested       : ${c.tested}`);
  console.log(`    ODDS         : ${c.odds}`);
  console.log(`    confidence   : ${c.conf}`);
  console.log(`    RISK         : ${c.risk}`);
  console.log(`    data gap     : ${c.gap}\n`);
}
assertNonEmpty("classes", CLASSES, 5);

console.log(`  THE ONLY LIVE PATHS TO A CLAIM (forward clocks — verdict on data that does not exist yet):`);
for (const c of clocks) console.log(`    · ${c.id}`);
console.log(`\n  WHAT WE PROVABLY CANNOT KNOW (the honest edge of the map, per the COVERAGE LAW): options/vol surfaces,`);
console.log(`  borrow FEE in bps (IBKR-FTP-blocked; demand proxies held), full per-strike options surface, real-time L2 depth, commodity roll,`);
console.log(`  central-bank flows — all paid or non-EDGAR. A verdict in these spaces is UNTESTED, never NULL.`);
console.log(`\n  BOTTOM LINE: the best odds we have found for a low-budget trader are STRUCTURAL (compound + deposits +`);
console.log(`  don't-panic-sell, D-735) plus ONE unproven long-only candidate (spin-offs). The worst odds — and the`);
console.log(`  most common — are "an efficiently-priced liquid instrument": negative EV after costs. Both are shown.`);
