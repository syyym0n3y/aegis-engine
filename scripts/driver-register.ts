#!/usr/bin/env -S deno run --allow-net --allow-env
// driver-register.ts (D-716) — the observable DRIVERS of every instrument class, and which of them we actually hold.
//
// WHY THIS IS A DIFFERENT REGISTER FROM D-697. `coverage-map.ts` asks which APPROACHES this programme has tested —
// momentum, carry, merger arb. This asks a question one level down and never asked before: for a given INSTRUMENT,
// what are the observable quantities that move it, and do we hold them? A programme can have tested every approach
// on a thin set of inputs and still be blind, and THE COVERAGE LAW says that blindness is a fact about us.
//
// THE EXTERNAL CHECK THAT PROMPTED IT. An outside list of ten gold drivers was supplied — CPI and inflation
// expectations, geopolitical risk premium, real yields, the dollar index, central-bank buying and de-dollarisation,
// the COT report, ETF flows, the gold/silver ratio, seasonality, and the World Gold Council's attribution
// framework. Checking our holdings against a list written by someone else is worth more than checking against one I
// wrote myself, because my list would inherit exactly the blind spots this is meant to find.
//
// THE DISTINCTION THAT MATTERS MOST, AND THAT THE SOURCE LIST DOES NOT MAKE. Item ten, the WGC framework, is an
// ATTRIBUTION model: it decomposes returns that have already happened. Attribution is not prediction, and a driver
// being real does not make it tradable — this programme has killed results at t 22 that were real and untradable.
// So each driver carries what it is FOR: explaining, conditioning, or predicting. Conflating them is how a list of
// true facts becomes a losing strategy.
//
// STATUS IS MEASURED, NOT ASSERTED: every driver names the table and filter that would hold it, and the script goes
// and looks.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

declareKnobs("driver-register", [{ name: "SHOW", def: "all", note: "all | missing" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "drv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

type Use = "predict" | "condition" | "explain";
interface Driver {
  cls: string; name: string; use: Use;
  probe?: string;          // a REST path that must return >=1 row if we hold it
  proxy?: string;          // what we hold instead, if anything
  blocked?: string;        // named barrier when it cannot be obtained
}

// GOLD first, because it is the class the external list covers and therefore the one where the register can be
// checked against something other than my own imagination.
const REG: Driver[] = [
  // ---- GOLD / precious metals ----------------------------------------------------------------------------------
  { cls: "gold", name: "price, daily", use: "predict", probe: "trd_bars_deep?symbol=eq.GC%3DF&select=symbol&limit=1" },
  { cls: "gold", name: "price, intraday", use: "predict", probe: "trd_fx_hourly?symbol=eq.XAUUSD&select=ts&limit=1" },
  { cls: "gold", name: "gold/silver ratio", use: "condition", probe: "trd_bars_deep?symbol=eq.SI%3DF&select=symbol&limit=1" },
  { cls: "gold", name: "dollar index / USD", use: "condition", probe: "trd_bars_deep?symbol=eq.EURUSD%3DX&select=symbol&limit=1" },
  { cls: "gold", name: "nominal yields (UST curve)", use: "condition", probe: "trd_yield_curve?select=d&limit=1" },
  { cls: "gold", name: "COT positioning", use: "condition", probe: "trd_cot_disagg?select=report_date&limit=1" },
  { cls: "gold", name: "seasonality", use: "condition", probe: "trd_bars_deep?symbol=eq.GC%3DF&select=symbol&limit=1" },
  { cls: "gold", name: "equity-vol regime (VIX)", use: "condition", probe: "trd_bars_deep?symbol=eq.%5EVIX&select=symbol&limit=1" },
  { cls: "gold", name: "REAL yields (TIPS)", use: "condition",
    proxy: "nominal curve held; the real leg is NOT — TIP/IEF spread would be a proxy and is not ingested",
    blocked: "FRED is credential-gated (gap register: fred-macro) and no TIPS series is held. The nominal curve is NOT a substitute: gold's stated driver is the REAL yield, and nominal minus an unheld inflation expectation is not computable." },
  { cls: "gold", name: "CPI / inflation expectations", use: "condition",
    blocked: "FRED credential-gated. No CPI, no breakeven, no survey expectations held anywhere in the stack." },
  { cls: "gold", name: "central-bank buying / reserves", use: "explain",
    blocked: "IMF COFER and World Gold Council reserve data are QUARTERLY and published with a long lag; neither is ingested. At quarterly frequency with a lag this is an EXPLANATORY variable, not a tradable one — it cannot condition a position at any horizon this programme trades." },
  { cls: "gold", name: "ETF flows (GLD/IAU shares outstanding)", use: "condition",
    proxy: "GLD price held; SHARES OUTSTANDING, which is what flow actually means, is not",
    blocked: "Not ingested. Obtainable free from the issuer's daily holdings file — this is a RESEARCH DEBT, not a barrier." },
  { cls: "gold", name: "geopolitical risk index", use: "condition",
    blocked: "The Caldara-Iacoviello GPR index is free and monthly/daily, and is NOT ingested. RESEARCH DEBT, not a barrier." },
  { cls: "gold", name: "options skew / implied vol", use: "condition",
    blocked: "No gold options surface held; options-history is a paid gap on the register." },
  // ---- EQUITY INDEX --------------------------------------------------------------------------------------------
  { cls: "equity-index", name: "price, daily", use: "predict", probe: "trd_bars_deep?symbol=eq.SPY&select=symbol&limit=1" },
  { cls: "equity-index", name: "price, intraday", use: "predict", probe: "trd_fx_hourly?symbol=eq.USA500IDXUSD&select=ts&limit=1" },
  { cls: "equity-index", name: "implied vol (VIX)", use: "condition", probe: "trd_bars_deep?symbol=eq.%5EVIX&select=symbol&limit=1" },
  { cls: "equity-index", name: "VIX term structure (VIX9D)", use: "condition", probe: "trd_perp_oi?symbol=eq.VIX9D&select=ts&limit=1" },
  { cls: "equity-index", name: "credit spread (HYG/LQD)", use: "condition", probe: "trd_bars_deep?symbol=eq.HYG&select=symbol&limit=1" },
  { cls: "equity-index", name: "yield curve slope", use: "condition", probe: "trd_yield_curve?select=d&limit=1" },
  { cls: "equity-index", name: "breadth (advance/decline)", use: "condition",
    blocked: "Not ingested. Computable from the 4,350-name equity panel we already hold — RESEARCH DEBT, not a barrier." },
  { cls: "equity-index", name: "dealer gamma / positioning", use: "condition",
    blocked: "trd_gex_state holds ONE row with every field NULL (D-704). The capability is advertised by the schema and does not exist." },
  { cls: "equity-index", name: "earnings revisions", use: "condition",
    proxy: "trd_earnings holds report dates", blocked: "Estimate REVISIONS need an analyst-estimate feed; none is held and the free sources are licensed." },
  // ---- FX ------------------------------------------------------------------------------------------------------
  { cls: "fx", name: "price, intraday", use: "predict", probe: "trd_fx_hourly?symbol=eq.EURUSD&select=ts&limit=1" },
  { cls: "fx", name: "COT positioning", use: "condition", probe: "trd_cot_tff?select=report_date&limit=1" },
  { cls: "fx", name: "US short rate", use: "condition", probe: "trd_yield_curve?select=m3&limit=1" },
  { cls: "fx", name: "FOREIGN short rates (the carry leg)", use: "condition",
    blocked: "Only the US curve is held. FX carry is a RATE DIFFERENTIAL and cannot be computed from one side — this is why 'carry' sits UNTESTED on the D-697 register rather than null." },
  // ---- COMMODITY -----------------------------------------------------------------------------------------------
  { cls: "commodity", name: "front-month price", use: "predict", probe: "trd_bars_deep?symbol=eq.CL%3DF&select=symbol&limit=1" },
  { cls: "commodity", name: "COT positioning", use: "condition", probe: "trd_cot_disagg?select=report_date&limit=1" },
  { cls: "commodity", name: "FUTURES CURVE (contango/backwardation)", use: "condition",
    proxy: "only a continuous front-month series is held",
    blocked: "No second contract, so roll yield and curve shape are not computable. This is why commodity carry is UNTESTED — the input does not exist here, which is a fact about our data." },
  { cls: "commodity", name: "inventories / storage", use: "explain",
    blocked: "EIA and USDA publish free, and neither is ingested. RESEARCH DEBT, not a barrier." },
  // ---- CRYPTO --------------------------------------------------------------------------------------------------
  { cls: "crypto", name: "price, hourly + daily SF panel", use: "predict", probe: "trd_bars_intraday?tf=eq.1dSF&select=symbol&limit=1" },
  { cls: "crypto", name: "perp funding", use: "condition", probe: "trd_perp_oi?interval=eq.funding&select=ts&limit=1" },
  { cls: "crypto", name: "open interest", use: "condition", probe: "trd_perp_oi?select=ts&limit=1" },
  { cls: "crypto", name: "on-chain activity", use: "condition", probe: "trd_perp_oi?venue=eq.blockchain.info&select=ts&limit=1" },
  { cls: "crypto", name: "order-book depth / aggressor flow", use: "predict",
    proxy: "taker-buy volume is held in the kline payload", blocked: "Full book depth is not stored; only the aggregated aggressor split." },
  { cls: "crypto", name: "options surface (Deribit DVOL/skew/IV)", use: "condition", probe: "trd_perp_oi?venue=eq.deribit&interval=eq.dvol&select=ts&limit=1" },
  // ---- SINGLE-NAME EQUITY --------------------------------------------------------------------------------------
  { cls: "equity-single", name: "price + volume panel", use: "predict", probe: "trd_bars_deep?asset_class=eq.equity&select=symbol&limit=1" },
  { cls: "equity-single", name: "fundamentals (point-in-time)", use: "predict", probe: "trd_fundamentals?select=ticker&limit=1" },
  { cls: "equity-single", name: "short interest", use: "condition", probe: "trd_short_interest?select=settlement&limit=1" },
  { cls: "equity-single", name: "short volume (daily)", use: "condition", probe: "trd_short_volume?select=d&limit=1" },
  { cls: "equity-single", name: "settlement fails", use: "condition", probe: "trd_ftd?select=settle_date&limit=1" },
  { cls: "equity-single", name: "dark-pool / ATS volume", use: "condition", probe: "trd_ats_weekly?select=week_start&limit=1" },
  { cls: "equity-single", name: "insider transactions", use: "condition", probe: "trd_form345?select=filed&limit=1" },
  { cls: "equity-single", name: "institutional ownership", use: "condition", probe: "trd_13f_ownership?select=cusip&limit=1" },
  { cls: "equity-single", name: "fund ownership (NPORT)", use: "condition", probe: "trd_nport_ownership?select=cusip&limit=1" },
  { cls: "equity-single", name: "8-K event text", use: "condition", probe: "trd_raw_filings?select=source_id&limit=1" },
  { cls: "equity-single", name: "earnings dates", use: "condition", probe: "trd_earnings?select=report_date&limit=1" },
  { cls: "equity-single", name: "DELISTED price history", use: "predict",
    blocked: "The largest hole in the stack. 51.6% of 8-K Item 3.01 delisting filers are absent from the price panel and 1,575 of 5,766 equity names (27.3%) are missing, ALL delisted. It has now blocked two research items (D-687, D-703). Stooq is closed by bot-challenge policy; Alpaca needs operator credentials." },
  { cls: "equity-single", name: "borrow cost / availability", use: "condition",
    blocked: "Paid. Every short-side result on this board therefore assumes a borrow cost rather than observing one." },
];

// THE POSITIVE CONTROL, built into the register itself (D-716b). The first run reported five MISSING rows —
// short interest, fails, ATS, 13F, NPORT — that were false: each table held millions of rows and my probe named a
// column that did not exist (`settlement_date` for `settlement`, `cik` for `cusip`), so PostgREST returned a 400
// and the old `if (!r.ok) return false` silently read that as absence. That is D-641 exactly, reproduced inside
// the tool meant to catch it. A probe that ERRORS is my bug, not the market's; it must be surfaced, never counted
// as MISSING. So held() returns three states, and a broken probe stops the register rather than skewing it.
type Probe = "held" | "empty" | "broken";
async function held(path: string): Promise<{ state: Probe; detail?: string }> {
  try {
    const r = await fetch(`${OWNED}/${path}`, { headers: hdr });
    if (r.status === 400 || r.status === 404) return { state: "broken", detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 140)}` };
    if (!r.ok) return { state: "broken", detail: `HTTP ${r.status}` };
    const j = await r.json();
    if (!Array.isArray(j)) return { state: "broken", detail: `non-array response` };
    if (j.length > 0) return { state: "held" };
    // EMPTY is the dangerous state (D-716c). A well-formed filter returning zero rows is indistinguishable from
    // genuine absence — the two crypto MISSING verdicts (`venue=eq.blockchain` for `blockchain.info`,
    // `symbol=like.*DVOL*` when DVOL is an INTERVAL) were both this: valid queries, wrong values, zero rows, read as
    // "we don't hold it" when the table held a million rows. THE POSITIVE-CONTROL RULE: pair the zero with a control
    // that MUST be non-zero. Here the control is the bare table — if the TABLE is populated but this FILTER is
    // empty, the filter is the suspect, not the market. Flag it AMBER for a human eye rather than scoring it MISSING.
    const table = path.split("?")[0];
    if (path.includes("?")) {
      const bareRows = await fetch(`${OWNED}/${table}?select=*&limit=1`, { headers: hdr }).then((x) => x.ok ? x.json() : []).catch(() => []);
      if (Array.isArray(bareRows) && bareRows.length > 0) return { state: "broken", detail: `filter returned 0 rows but ${table} is POPULATED — probe VALUE likely wrong, verify before scoring MISSING` };
    }
    return { state: "empty" };
  } catch (e) { return { state: "broken", detail: String(e).slice(0, 120) }; }
}

console.log(`==> DRIVER REGISTER — the observable inputs per instrument class, and which we actually hold\n`);
let cls = "", nHeld = 0, nDebt = 0, nBlocked = 0;
const debts: string[] = [], blocked: string[] = [], broken: string[] = [];
for (const d of REG) {
  if (d.cls !== cls) { cls = d.cls; console.log(`\n  ${cls.toUpperCase()}`); }
  const res = d.probe ? await held(d.probe) : { state: "empty" as Probe };
  const useTag = d.use === "predict" ? "PREDICT " : d.use === "condition" ? "CONDITION" : "EXPLAIN  ";
  if (res.state === "broken") {
    // A driver we EXPECTED to hold (has a probe, no named barrier) whose probe errors is a bug in the register,
    // and it is reported as such — loudly, and it fails the run so it cannot be ignored.
    if (!d.blocked) { broken.push(`${d.cls} / ${d.name}: ${res.detail}`); console.log(`    BROKEN   ${useTag} ${d.name}  <- PROBE ERROR, not a market finding: ${res.detail}`); continue; }
    // If a barrier is named, a broken probe just confirms it; fall through to the missing/debt path.
  }
  const ok = res.state === "held";
  if (ok) { nHeld++; console.log(`    HELD     ${useTag} ${d.name}`); continue; }
  // A driver with a named RESEARCH DEBT is actionable; one with a real barrier is not. Separating them is the point:
  // an unfetched free dataset is a research failure, and calling it a barrier is how it stays unfetched.
  const isDebt = !!d.blocked && /RESEARCH DEBT/.test(d.blocked);
  if (isDebt) { nDebt++; debts.push(`${d.cls} / ${d.name}`); console.log(`    DEBT     ${useTag} ${d.name}`); }
  else { nBlocked++; blocked.push(`${d.cls} / ${d.name}`); console.log(`    MISSING  ${useTag} ${d.name}`); }
  if (d.proxy) console.log(`             proxy: ${d.proxy}`);
  if (d.blocked) console.log(`             ${d.blocked}`);
}
assertNonEmpty("drivers checked", REG, 20);

if (broken.length) {
  console.log(`\n  !! ${broken.length} PROBE(S) BROKEN — these are register bugs, NOT market findings. Per THE POSITIVE-CONTROL`);
  console.log(`  RULE a probe that errors must never be read as a driver we lack. Fix the probe before trusting the run:`);
  for (const x of broken) console.log(`    · ${x}`);
}
console.log(`\n  ${nHeld} HELD  |  ${nDebt} RESEARCH DEBT (free and unfetched)  |  ${nBlocked} blocked with a named barrier`);
if (debts.length) {
  console.log(`\n  RESEARCH DEBT — free, obtainable, and nobody has fetched it. Per THE COVERAGE LAW an unfetched free`);
  console.log(`  dataset is a research failure, not a market finding:`);
  for (const x of debts) console.log(`    · ${x}`);
}
console.log(`\n  THE DISTINCTION THE SOURCE LIST DOES NOT MAKE: of the drivers above, those marked EXPLAIN decompose`);
console.log(`  returns that already happened. Central-bank reserve data is quarterly and lagged; it can explain a`);
console.log(`  move and cannot condition a position. A register of true facts is not a strategy, and this programme`);
console.log(`  has killed results at |t| over 20 that were real and untradable.`);
console.log(`\n  THIS REGISTER IS OPEN AND IS NOT A COMPLETENESS CLAIM. It was built partly from an EXTERNAL list`);
console.log(`  precisely because a list I wrote alone would inherit the blind spots it is meant to find. Add to it.`);

// The register fails RED if any probe is broken: a false MISSING is worse than a loud error, because it becomes a
// narrated market conclusion. This is the same self-verification every guard on the board carries.
if (broken.length) { console.log(`\n  RED: ${broken.length} broken probe(s) above must be fixed.`); Deno.exit(1); }
