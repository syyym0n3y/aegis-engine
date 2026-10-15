#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// basket-register.ts (D-987) — THE LONG-TERM BASKET: instruments we hold only because we can MEASURE what moves them.
//
// Operator directive 2026-10-15: "create a long term basket of instruments we will trade because we can understand
// everything that affects that instrument". This extends, and does not duplicate, two existing objects:
//   * `driver-register.ts` (D-716) asks per instrument CLASS whether a driver is HELD at all. This asks per HOLDABLE
//     INSTRUMENT whether each MATERIAL driver is MEASURED NOW — held AND fresh within a budget matched to how often its
//     source publishes (CONTINUITY LAW: a frozen feed answers plausibly from the past, so held-but-stale is NOT measured).
//   * the deployed blend's long/trend sleeves (tsmom-book.ts LONGONLY_RE, D-868/870/901) — which instruments the book
//     already trades is READ from that file at runtime, never re-typed here.
// understood = measured material drivers / material drivers. Basket membership requires understood >= 0.8 (operator
// floor). Materiality is fixed per instrument from the operator's own category list (macro releases, rates, earnings /
// revisions, flows / positioning, options / gamma, seasonality, FX, commodity links, liquidity / credit, the price
// itself) BEFORE any probe runs; a proxy counts only when it is the market-standard observable of the same force (the
// 2y Treasury yield for the expected policy path) and is labelled PROXY wherever it appears.
//
// INSTRUMENT LAW: every research series here is a US-listed proxy (SPY, TLT, GLD...). A UK retail investor cannot buy
// those (PRIIPs/KID) — the placeable vehicle is the named UCITS ETF/ETC, and its conversion (tracking, wrapper,
// currency line) is UNMEASURED: no UCITS price series is held. That is stated per row, never assumed.
// Not advice: research output for a single operator; vehicles are candidates to verify with the broker (ISA/SIPP
// eligibility, KID, TER, currency line).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("basket-register", [
  { name: "UNDERSTOOD_FLOOR", def: "0.8", note: "operator floor for basket membership" },
  { name: "JSON_OUT", def: "research/basket.json" },
  { name: "DOC_OUT", def: "docs/BASKET.md" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const REPO = new URL("..", import.meta.url).pathname;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bsk", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const tok = await jwt();
const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };

// ---------------------------------------------------------------------------------------------------- probes
type Cad = "daily" | "weekly" | "monthly" | "monthly3m";
// days. Monthly series are dated at period START and published up to ~7 weeks after period end (UK CPI: ~3rd week of
// the next month), so the newest value is legitimately up to ~82 days old the day before a release -> 85 (D-989; was 75,
// which would have flagged UK CPI STALE every month before its release — crying wolf). ONS labour-market series are
// rolling 3-month averages labelled at the period's FIRST month and published ~6 weeks after it ends: up to ~137 days.
const BUDGET: Record<Cad, number> = { daily: 6, weekly: 14, monthly: 85, monthly3m: 140 };
interface Probe { path: string; field: string; cad: Cad; epoch?: boolean }
const enc = encodeURIComponent;
const bar = (sym: string): Probe => ({ path: `trd_bars_deep?symbol=eq.${enc(sym)}&select=last_date&limit=1`, field: "last_date", cad: "daily" });
const ms = (series: string, cad: Cad): Probe => ({ path: `trd_macro_series?series=eq.${enc(series)}&select=d&order=d.desc&limit=1`, field: "d", cad });
const curve: Probe = { path: `trd_yield_curve?select=d&order=d.desc&limit=1`, field: "d", cad: "daily" };
const cotT = (code: string): Probe => ({ path: `trd_cot_tff?market_code=eq.${code}&select=report_date&order=report_date.desc&limit=1`, field: "report_date", cad: "weekly" });
const cotD = (code: string): Probe => ({ path: `trd_cot_disagg?market_code=eq.${code}&select=report_date&order=report_date.desc&limit=1`, field: "report_date", cad: "weekly" });
const cboe = (sym: string, interval: string): Probe => ({ path: `trd_perp_oi?venue=eq.cboe&symbol=eq.${enc(sym)}&interval=eq.${interval}&select=ts&order=ts.desc&limit=1`, field: "ts", cad: "daily", epoch: true });
const perp = (sym: string, interval: string): Probe => ({ path: `trd_perp_oi?venue=eq.binance&symbol=eq.${sym}&interval=eq.${interval}&select=ts&order=ts.desc&limit=1`, field: "ts", cad: "daily", epoch: true });
const earnings: Probe = { path: `trd_earnings?eps=not.is.null&select=report_date&order=report_date.desc&limit=1`, field: "report_date", cad: "daily" };

interface Driver { cat: string; name: string; material: boolean; probe?: Probe; proxy?: string; gap?: string; record?: string }
interface Instrument { key: string; name: string; vehicle: string; research_proxy: string; role: string; drivers: Driver[] }

// Shared US blocks — the same force measured the same way wherever it applies (one definition, many instruments).
const GBP: Driver = { cat: "FX", name: "GBPUSD (currency of account for a UK holder, unhedged line)", material: true, probe: bar("GBPUSD=X"), record: "currency-of-account worth ~1.3pp/yr to a GBP investor (D-731)" };
const CPI: Driver = { cat: "macro releases", name: "US CPI level + release calendar", material: true, probe: ms("cpi", "monthly"), record: "statistical CPI surprise: D-987-cpi-surprise-spx REJECTED (sign missed); release-hour reversal forward-only (D-987-release-reversal-forward)" };
const CLAIMS: Driver = { cat: "macro releases", name: "US weekly initial jobless claims", material: true, probe: ms("claims_initial_sa", "weekly"), record: "statistical claims surprise UNTESTED — failed its day-0 positive control (D-987-claims-surprise-spx)" };
const NFP: Driver = { cat: "macro releases", name: "US nonfarm payrolls (level; latest vintage)", material: true, probe: ms("payrolls_total", "monthly"), record: "held from D-987; first-print vintages NOT held (ALFRED) so payroll SURPRISE is untestable point-in-time" };
const ISM: Driver = { cat: "macro releases", name: "US activity surveys (ISM / PMI)", material: true, gap: "ISM/S&P Global PMIs are proprietary; no free keyless history held" };
const POLICY: Driver = { cat: "rates", name: "expected Fed policy path", material: true, probe: curve, proxy: "2y Treasury yield (trd_yield_curve y2) — the standard market-implied proxy; fed-funds futures/OIS not held (CME paid)" };
const CURVE: Driver = { cat: "rates", name: "Treasury curve (discount rate, term spread)", material: true, probe: curve, record: "orphaned 50 days then wired daily (D-982)" };
const REAL: Driver = { cat: "rates", name: "10y real yield (TIPS)", material: true, probe: ms("real_yield_10y", "daily"), record: "D-730: contemporaneous driver confirmed; forward change-conditioning null (t 0.16/-0.27/-0.13)" };
const BE: Driver = { cat: "rates", name: "10y breakeven inflation", material: true, probe: ms("breakeven_10y", "daily") };
const EARN: Driver = { cat: "earnings / revisions", name: "constituent earnings (reported vs consensus)", material: true, probe: earnings, record: "PEAD decayed post-2012 (D-225); holdout registered D-987-pead-holdout" };
const REV: Driver = { cat: "earnings / revisions", name: "consensus estimate revisions (~1,000 liquid names)", material: true, probe: ms("est_rev90_0q:AAPL", "daily"), record: "forward-only since 2026-09-07; D-987-revision-surprise accruing" };
const FLOWS_EQ: Driver = { cat: "flows / positioning", name: "fund / ETF flows (creations, redemptions)", material: true, gap: "no free keyless daily equity fund-flow history held (ICI is weekly aggregate, not ingested; issuer creation data not collected)" };
const BUYBACK: Driver = { cat: "flows / positioning", name: "corporate buybacks / blackout windows", material: true, gap: "no buyback-execution series held; only 8-K text (trd_raw_filings), not a flow measure" };
const VIX: Driver = { cat: "options / gamma", name: "implied volatility (VIX)", material: true, probe: bar("^VIX"), record: "fear-reversion near-miss (D-276); same-bar phantoms killed (D-498)" };
const GEX: Driver = { cat: "options / gamma", name: "SPX dealer gamma (SqueezeMetrics GEX)", material: true, probe: ms("sqm_gex", "daily"), record: "vol-damping validated 3 regimes, pooled t -17.3; sizing only, never direction (D-967/968)" };
const CREDIT: Driver = { cat: "liquidity / credit", name: "credit spread (BAA-10y)", material: true, probe: ms("credit_baa_10y", "daily") };
const NFCI: Driver = { cat: "liquidity / credit", name: "financial conditions (NFCI, weekly)", material: false, probe: ms("fin_conditions", "weekly") };
const BREADTH: Driver = { cat: "liquidity / credit", name: "equity breadth (% > 200dma, survivorship-biased level)", material: false, probe: ms("breadth_pct_gt_200dma_surv", "daily") };
const SEASON = (sym: string): Driver => ({ cat: "seasonality", name: "calendar seasonality (derived from the price series)", material: false, probe: bar(sym), record: "turn-of-month = drift wearing a calendar, killed by its benchmark (D-962)" });
const GPR: Driver = { cat: "macro releases", name: "geopolitical risk index (monthly)", material: false, probe: ms("gpr", "monthly") };
const OIL: Driver = { cat: "commodity links", name: "crude oil (CL=F)", material: false, probe: bar("CL=F") };
const FEDBS: Driver = { cat: "rates", name: "Fed balance sheet (QT/QE supply)", material: true, probe: ms("fed_balance_sheet", "weekly"), record: "held from D-987 (FRED WALCL, existing keyless feed)" };
const AUCTIONS: Driver = { cat: "flows / positioning", name: "Treasury auction supply and results", material: true, gap: "api.fiscaldata.treasury.gov auction results are free and keyless and the host IS allowlisted (D-989 corrects D-987, which said it was not) — not yet ingested" };
const TERMPREM: Driver = { cat: "rates", name: "term premium (ACM)", material: true, gap: "NY Fed ACM term-premium file is free but newyorkfed.org is NOT allowlisted" };
const BOE: Driver = { cat: "rates", name: "Bank Rate (BoE policy rate)", material: true, probe: ms("boe_bank_rate", "daily"), record: "BoE IADB IUDBEDR, daily from 1975 (D-989); the OECD 3m monthly series it replaces was 287 days stale" };
const BOEPATH: Driver = { cat: "rates", name: "expected BoE path", material: true, probe: ms("gilt_nom_zc_5y", "daily"), proxy: "5y nominal zero-coupon gilt yield (BoE IUDSNZC) — the short-dated curve is the market-implied path; SONIA OIS not held" };
const GILTS: Driver = { cat: "rates", name: "gilt curve (nominal zero-coupon 5/10/20y)", material: true, probe: ms("gilt_nom_zc_10y", "daily"), record: "BoE IADB fitted curve, ~1 business day publication lag (D-989)" };
const UKCPI: Driver = { cat: "macro releases", name: "UK CPI / CPIH + ONS first-release dates", material: true, probe: ms("ons_cpi_yoy", "monthly"), record: "ONS D7G7/L55O/D7BT; 130 first-release dates 2015+ (ons_release:cpi). UK CPI surprise: see D-989 / docs/SURPRISE_EFFECTS.md" };
const UKLAB: Driver = { cat: "macro releases", name: "UK labour market (unemployment, employment, AWE pay growth)", material: true, probe: ms("ons_unemp_rate", "monthly3m"), record: "ONS MGSX/LF24/KAC3 — LATEST VINTAGE (revised; no first-release dates recoverable), so a labour SURPRISE is not testable point-in-time" };

const price = (sym: string, note?: string): Driver => ({ cat: "price itself", name: `own price / trend / volatility (${sym})`, material: true, probe: bar(sym), record: note });
const TREND_NOTE = "the deployed blend's trend/long sleeves trade this price: ISA-ETF trend switch OOS Sharpe 0.62-0.76, maxDD -7..-11% (D-868/870); rates bucket worth 0.21 Sharpe as a CLASS (D-901)";

const INSTRUMENTS: Instrument[] = [
  { key: "us-large-cap", name: "S&P 500", vehicle: "CSPX / VUAG (UCITS, USD/GBP lines) — candidate", research_proxy: "SPY / ^GSPC", role: "core growth asset",
    drivers: [price("SPY", TREND_NOTE), CPI, CLAIMS, NFP, ISM, POLICY, CURVE, REAL, EARN, REV,
      { cat: "flows / positioning", name: "CFTC TFF positioning (E-mini S&P)", material: true, probe: cotT("13874A") }, FLOWS_EQ, BUYBACK, VIX, GEX, CREDIT, GBP,
      NFCI, BREADTH, SEASON("SPY"), GPR, OIL,
      { cat: "options / gamma", name: "CBOE SKEW / put-call", material: false, probe: ms("cboe_skew", "daily"), record: "options-regime conditioning null OOS (D-739)" }] },
  { key: "us-tech", name: "Nasdaq-100", vehicle: "EQQQ / CNX1 (UCITS) — candidate", research_proxy: "QQQ", role: "growth tilt (megacap concentration)",
    drivers: [price("QQQ", TREND_NOTE), CPI, CLAIMS, NFP, ISM, POLICY, CURVE, REAL, EARN, REV,
      { cat: "flows / positioning", name: "CFTC TFF positioning (E-mini Nasdaq)", material: true, probe: cotT("209742") }, FLOWS_EQ, BUYBACK,
      { cat: "options / gamma", name: "QQQ implied vol (CBOE ATM IV)", material: true, probe: cboe("QQQ", "atm_iv_near") },
      { cat: "options / gamma", name: "QQQ dealer gamma (naive GEX, forward-only)", material: true, probe: cboe("QQQ", "naive_gex_usd") }, CREDIT, GBP, SEASON("QQQ"), NFCI] },
  { key: "global-developed", name: "All-World / Developed World", vehicle: "VWRP / SWDA (UCITS) — candidate", research_proxy: "VT / ACWI (EFA for ex-US)", role: "one-fund equity core",
    drivers: [price("VT"), price("EFA"), CPI, CLAIMS, POLICY, REAL, EARN,
      { cat: "earnings / revisions", name: "NON-US constituent earnings and revisions (~40% weight)", material: true, gap: "earnings + revision feeds are US-listed names only" },
      { cat: "rates", name: "ECB / BoJ policy paths", material: true, probe: ms("rate_3m_eur", "monthly"), record: "OECD monthly 3m interbank only" },
      { cat: "macro releases", name: "non-US activity / inflation releases", material: true, gap: "no euro-area / Japan release calendar or values held" },
      { cat: "FX", name: "EURUSD / USDJPY", material: true, probe: bar("EURUSD=X") }, GBP, VIX, CREDIT, FLOWS_EQ] },
  { key: "uk-large-cap", name: "FTSE 100", vehicle: "ISF / VUKE (UCITS, GBP) — candidate", research_proxy: "^FTSE (EWU)", role: "home-currency equity",
    drivers: [price("^FTSE"), UKCPI, UKLAB, BOE, BOEPATH, GILTS,
      { cat: "earnings / revisions", name: "FTSE constituent earnings / revisions", material: true, gap: "earnings + revisions feeds cover US-listed names only" },
      { ...GBP, name: "GBPUSD (FTSE 100 earns ~75% of revenue abroad — inverse GBP exposure)" },
      { cat: "commodity links", name: "crude oil (energy weight)", material: true, probe: bar("CL=F") },
      { cat: "commodity links", name: "copper / miners", material: true, probe: bar("HG=F") },
      { cat: "flows / positioning", name: "UK fund flows / positioning", material: true, gap: "no FTSE futures COT equivalent or UK fund-flow series held" }, VIX, SEASON("^FTSE")] },
  { key: "em-equity", name: "Emerging-market equity", vehicle: "EIMI / VFEM (UCITS) — candidate", research_proxy: "EEM", role: "EM growth",
    drivers: [price("EEM", TREND_NOTE),
      { cat: "FX", name: "US dollar (UUP)", material: true, probe: bar("UUP") },
      { cat: "macro releases", name: "China activity / credit impulse", material: true, gap: "no China activity, PMI or credit series held" },
      { cat: "rates", name: "EM policy rates (CNY/KRW/INR/BRL)", material: true, probe: ms("rate_3m_cny", "monthly"), record: "OECD/IMF monthly series; EM carry = research-space risk premium (D-741)" },
      { cat: "earnings / revisions", name: "EM constituent earnings / revisions", material: true, gap: "earnings feeds cover US-listed names only" },
      { cat: "commodity links", name: "broad commodities (DBC)", material: true, probe: bar("DBC") },
      { cat: "options / gamma", name: "EEM dealer gamma / IV (CBOE, forward-only)", material: true, probe: cboe("EEM", "naive_gex_usd") },
      { cat: "flows / positioning", name: "EM fund flows", material: true, gap: "no EM fund-flow series held" }, REAL, GBP] },
  { key: "ust-long", name: "US Treasuries 20y+", vehicle: "IDTL / DTLA (UCITS; GBP-hedged line exists) — candidate", research_proxy: "TLT", role: "duration / deflation hedge",
    drivers: [price("TLT", TREND_NOTE), CURVE, REAL, BE, CPI, CLAIMS, NFP, POLICY, AUCTIONS, TERMPREM, FEDBS,
      { cat: "flows / positioning", name: "CFTC TFF positioning (UST bond futures)", material: true, probe: cotT("020601") },
      { cat: "options / gamma", name: "TLT dealer gamma (CBOE, forward-only)", material: true, probe: cboe("TLT", "naive_gex_usd") },
      { ...GBP, name: "GBPUSD (USD line unhedged; the GBP-hedged line removes it)" },
      { cat: "options / gamma", name: "rates volatility (MOVE)", material: false, gap: "MOVE index not held (ICE, not free history)" }] },
  { key: "us-tips", name: "US TIPS", vehicle: "ITPS / IDTP (UCITS) — candidate", research_proxy: "TIP", role: "inflation-protected duration",
    drivers: [price("TIP"), REAL, BE, CPI, CURVE, POLICY, GBP,
      { cat: "flows / positioning", name: "TIPS auction supply", material: true, gap: "fiscaldata.treasury.gov not allowlisted (same barrier as nominal auctions)" }] },
  { key: "usd-tbills", name: "US Treasury bills 0-1y", vehicle: "IB01 (UCITS, USD) — candidate", research_proxy: "SHY / 3m bill yield", role: "USD cash ballast (rates bucket, D-901)",
    drivers: [{ cat: "rates", name: "3m T-bill yield", material: true, probe: ms("ust_3m", "daily") }, POLICY, GBP, price("SHY", TREND_NOTE)] },
  { key: "gbp-cash", name: "GBP overnight money market", vehicle: "CSH2 / XSTR (UCITS, GBP) — candidate", research_proxy: "SONIA (BoE IADB) — a rate, not a fund price", role: "GBP cash ballast",
    drivers: [BOE, { cat: "rates", name: "SONIA fixing (what the fund earns)", material: true, probe: ms("boe_sonia", "daily") }, BOEPATH] },
  { key: "uk-gilts", name: "UK gilts (conventional)", vehicle: "IGLT / VGOV (UCITS) — candidate", research_proxy: "BoE nominal zero-coupon curve — yields, not a fund price", role: "GBP duration",
    drivers: [GILTS, UKCPI, UKLAB, BOE, BOEPATH, { cat: "flows / positioning", name: "DMO issuance / auction results", material: true, gap: "dmo.gov.uk not ingested or allowlisted" },
      { cat: "rates", name: "global duration (US 10y)", material: true, probe: curve }] },
  { key: "uk-linkers", name: "UK index-linked gilts", vehicle: "INXG (UCITS) — candidate", research_proxy: "BoE real zero-coupon curve — yields, not a fund price", role: "GBP inflation protection",
    drivers: [{ cat: "rates", name: "UK real yields (10y real zero-coupon)", material: true, probe: ms("gilt_real_zc_10y", "daily") }, UKCPI, BOE, BOEPATH,
      { cat: "rates", name: "UK breakeven inflation (10y implied, BoE)", material: true, probe: ms("gilt_infl_zc_10y", "daily"), record: "BoE implied inflation is RPI-based (linkers pay RPI; RPI is not ingested — the CPI/CPIH gap to RPI is a stated wedge)" },
      { cat: "flows / positioning", name: "DMO linker issuance", material: true, gap: "dmo.gov.uk not ingested or allowlisted" }, { cat: "rates", name: "global real yields (US 10y TIPS)", material: true, probe: ms("real_yield_10y", "daily") }] },
  { key: "gold", name: "Physical gold", vehicle: "SGLN / IGLN (physical ETC, GBP/USD lines) — candidate", research_proxy: "GLD / GC=F", role: "crisis / real-rate hedge",
    drivers: [price("GLD", TREND_NOTE), { ...REAL, record: "gold's stated #1 driver; contemporaneous confirmed, forward null (D-730)" },
      { cat: "FX", name: "US dollar (UUP)", material: true, probe: bar("UUP") }, BE, CPI, POLICY,
      { cat: "flows / positioning", name: "CFTC disaggregated positioning (gold)", material: true, probe: cotD("088691") },
      { cat: "flows / positioning", name: "ETF holdings (GLD tonnes)", material: true, probe: ms("gld_tonnes", "daily"), record: "'flows drive gold' REFUTED — flow follows price (D-745)" },
      { cat: "macro releases", name: "geopolitical risk (GPR)", material: true, probe: ms("gpr", "monthly") },
      { cat: "flows / positioning", name: "central-bank buying", material: true, gap: "IMF COFER / WGC reserve data is quarterly and lagged — EXPLAIN-only, cannot condition a position (D-716)" },
      { cat: "options / gamma", name: "GLD implied vol / dealer gamma (CBOE, forward-only)", material: true, probe: cboe("GLD", "naive_gex_usd") }, GBP, SEASON("GLD"),
      { cat: "commodity links", name: "gold/silver ratio", material: false, probe: bar("SI=F") }] },
  { key: "broad-commodities", name: "Broad commodities", vehicle: "CMOD (UCITS) — candidate", research_proxy: "DBC", role: "inflation / supply-shock hedge",
    drivers: [price("DBC"), { cat: "commodity links", name: "live futures curves / roll yield", material: true, probe: ms("eia_cl_c2", "daily"), record: "EIA curve mirror froze 2024-04; GC/ZC/ZW/ZS/HG/SI curves have no free source; roll yield null OOS (D-742)" },
      { cat: "commodity links", name: "inventories (EIA crude/gas weekly)", material: true, probe: ms("eia_crude_stocks_w", "weekly"), record: "change-conditioning null (D-743)" },
      { cat: "flows / positioning", name: "CFTC disaggregated positioning (crude as bellwether)", material: true, probe: cotD("067651") },
      { cat: "FX", name: "US dollar (UUP)", material: true, probe: bar("UUP") },
      { cat: "macro releases", name: "China demand / PMI", material: true, gap: "no China activity series held" },
      { cat: "commodity links", name: "agricultural supply (USDA WASDE / weather)", material: true, gap: "USDA reports not ingested" }, BE, GPR, GBP] },
  { key: "wti-crude", name: "WTI crude oil", vehicle: "CRUD (ETC) — candidate", research_proxy: "CL=F", role: "energy shock hedge",
    drivers: [price("CL=F"), { cat: "commodity links", name: "inventories (EIA weekly)", material: true, probe: ms("eia_crude_stocks_w", "weekly"), record: "change-conditioning null (D-743)" },
      { cat: "commodity links", name: "live futures curve / roll yield", material: true, probe: ms("eia_cl_c2", "daily"), record: "frozen 2024-04 (research history only, D-742)" },
      { cat: "flows / positioning", name: "CFTC disaggregated positioning (crude)", material: true, probe: cotD("067651") },
      { cat: "macro releases", name: "OPEC+ decisions", material: true, gap: "no OPEC decision calendar / quota series held" },
      { cat: "commodity links", name: "demand (EIA product supplied, refinery runs)", material: true, gap: "EIA weekly demand tables not ingested (the inventory ingest uses the same keyless host)" },
      { cat: "FX", name: "US dollar (UUP)", material: true, probe: bar("UUP") },
      { cat: "macro releases", name: "geopolitical risk (GPR)", material: true, probe: ms("gpr", "monthly") }, GBP] },
  { key: "bitcoin", name: "Bitcoin", vehicle: "physically-backed BTC ETP/ETN (UK retail since 2025-10; ISA eligibility — verify) — candidate", research_proxy: "BTC-USD / BTCUSDT", role: "convex growth (the deployed blend holds crypto via the cryptomom sleeve)",
    drivers: [price("BTC-USD", "spot-crypto trend switch Sharpe 0.69, -6% DD 2018-26 (D-871); ISA+crypto pair 1.29 OOS, 0.90 ex-2020-21 (D-873)"),
      { cat: "flows / positioning", name: "perp funding", material: true, probe: perp("BTCUSDT", "funding"), record: "pooling artefact retracted (D-415); profitable direction an unregistered flip (D-553/554)" },
      { cat: "flows / positioning", name: "top-trader long/short positioning", material: true, probe: perp("BTCUSDT", "ls_top") },
      { cat: "options / gamma", name: "implied vol (Deribit DVOL)", material: true, probe: ms("deribit_btc_dvol", "daily"), record: "BTC VRP measured NW t 4.39; return effect below bar (D-817)" },
      { cat: "flows / positioning", name: "on-chain activity / fees", material: true, probe: ms("onchain_btc_transaction_fees_usd", "daily"), record: "fee-momentum clock (D-928); breadth consumer registered (D-972)" },
      { cat: "flows / positioning", name: "CFTC TFF positioning (CME bitcoin)", material: true, probe: cotT("133741") },
      { cat: "flows / positioning", name: "spot-ETF flows", material: true, gap: "no free daily spot-ETF flow history held" },
      { cat: "liquidity / credit", name: "stablecoin supply (crypto liquidity)", material: true, gap: "no stablecoin supply series held (CoinGecko snapshot is one-off, D-964)" },
      { ...REAL, name: "10y real yield (global liquidity)" }, { cat: "price itself", name: "equity beta (SPY)", material: true, probe: bar("SPY") }, GBP,
      { cat: "macro releases", name: "regulatory / exchange events", material: true, gap: "no structured event feed; not measurable from free data" }] },
  { key: "us-high-yield", name: "US high-yield credit", vehicle: "IHYG / SHYG (UCITS) — candidate", research_proxy: "HYG", role: "credit carry",
    drivers: [price("HYG", TREND_NOTE), { ...CREDIT, name: "credit spread (BAA-10y; HY OAS not ingested)" }, CURVE, VIX, POLICY,
      { cat: "liquidity / credit", name: "default rates / distress", material: true, gap: "no default-rate series held (the distress SHORT sleeve uses going-concern filings, not a default rate)" }, FLOWS_EQ, GBP] },
  { key: "us-ig-credit", name: "US investment-grade credit", vehicle: "LQDE (UCITS) — candidate", research_proxy: "LQD", role: "duration + credit carry",
    drivers: [price("LQD", TREND_NOTE), CREDIT, CURVE, REAL, POLICY,
      { cat: "flows / positioning", name: "IG issuance supply", material: true, gap: "no issuance calendar held" }, FLOWS_EQ, GBP] },
];

// ---------------------------------------------------------------------------------------------------- measure
const TODAY = Date.now();
type State = "MEASURED" | "STALE" | "ABSENT" | "GAP";
const cache = new Map<string, { state: State; latest?: string; age_d?: number }>();
const broken: string[] = [];
async function measure(p: Probe): Promise<{ state: State; latest?: string; age_d?: number }> {
  if (cache.has(p.path)) return cache.get(p.path)!;
  let out: { state: State; latest?: string; age_d?: number };
  const r = await fetch(`${OWNED}/${p.path}`, { headers: hdr }).catch((e) => e as Error);
  if (r instanceof Error || !r.ok) {
    // A probe that ERRORS is a bug in this register, never a driver we lack (D-716b POSITIVE-CONTROL RULE).
    broken.push(`${p.path} -> ${r instanceof Error ? r.message : `HTTP ${r.status}`}`); out = { state: "ABSENT" };
  } else {
    const j = await r.json() as Record<string, unknown>[];
    if (!Array.isArray(j) || !j.length || j[0][p.field] == null) out = { state: "ABSENT" };
    else {
      const raw = j[0][p.field];
      const t = p.epoch ? Number(raw) * 1000 : Date.parse(String(raw).slice(0, 10) + "T00:00:00Z");
      const age = Math.floor((TODAY - t) / 86400e3);
      out = { state: age <= BUDGET[p.cad] ? "MEASURED" : "STALE", latest: new Date(t).toISOString().slice(0, 10), age_d: age };
    }
  }
  cache.set(p.path, out); return out;
}

// the deployed blend's trend universe, read from its source (never re-typed)
const tsmom = await Deno.readTextFile(`${REPO}scripts/tsmom-book.ts`);
const reSrc = /const LONGONLY_RE = \/(.+)\/;/.exec(tsmom)?.[1];
if (!reSrc) { console.error("!! RED: could not read LONGONLY_RE from tsmom-book.ts — the blend link would be invented"); Deno.exit(1); }
const LONGONLY = new RegExp(reSrc);

const FLOOR = Number(K.UNDERSTOOD_FLOOR);
const rows = [];
for (const ins of INSTRUMENTS) {
  const ds = [];
  for (const d of ins.drivers) {
    const m = d.probe ? await measure(d.probe) : { state: "GAP" as State };
    ds.push({ category: d.cat, driver: d.name, material: d.material, state: m.state, latest: m.latest ?? null, age_days: m.age_d ?? null,
      source: d.probe ? d.probe.path.split("?")[0] + (d.probe.path.match(/(symbol|series|market_code)=eq\.([^&]+)/)?.[2] ? ` ${decodeURIComponent(d.probe.path.match(/(symbol|series|market_code)=eq\.([^&]+)/)![2])}` : "") : null,
      budget_days: d.probe ? BUDGET[d.probe.cad] : null, proxy: d.proxy ?? null, gap: d.gap ?? null, record: d.record ?? null });
  }
  const mat = ds.filter((d) => d.material), meas = mat.filter((d) => d.state === "MEASURED");
  const score = mat.length ? meas.length / mat.length : 0;
  const proxies = ins.research_proxy.split(/[\s/(),]+/).filter((s) => /^[\^A-Z=.-]+$/.test(s));
  rows.push({ key: ins.key, name: ins.name, vehicle: ins.vehicle, research_proxy: ins.research_proxy, role: ins.role,
    in_deployed_trend_universe: proxies.some((s) => LONGONLY.test(s)),
    material_drivers: mat.length, measured_material: meas.length, understood: +score.toFixed(3), qualifies: score >= FLOOR - 1e-9,
    blocking_gaps: mat.filter((d) => d.state !== "MEASURED").map((d) => `${d.driver}: ${d.state}${d.state === "STALE" ? ` (latest ${d.latest}, ${d.age_days}d > ${d.budget_days}d budget)` : ""}${d.gap ? ` — ${d.gap}` : ""}`),
    vehicle_conversion: "UNMEASURED — no UCITS price series held; research proxy is US-listed (INSTRUMENT LAW)",
    drivers: ds });
}
if (broken.length) { console.error(`!! RED: ${broken.length} probe(s) ERRORED — register bugs, not market facts:\n   ${broken.join("\n   ")}`); Deno.exit(1); }
// POSITIVE CONTROL: the S&P 500 price probe must be MEASURED (the panel is refreshed daily); if it is not, the register
// is reading a dead node and every STALE below would be a statement about the node.
if (rows.find((r) => r.key === "us-large-cap")!.drivers[0].state !== "MEASURED") { console.error("!! RED: positive control — SPY bars are not fresh; the node or refresh is down, refusing to score"); Deno.exit(1); }

const basket = rows.filter((r) => r.qualifies), blocked = rows.filter((r) => !r.qualifies);
const out = { generated_at: new Date().toISOString(), generator: "scripts/basket-register.ts (D-987)", understood_floor: FLOOR,
  budgets_days: BUDGET, counts: { candidates: rows.length, understood: basket.length, blocked: blocked.length },
  basket: basket.map((r) => r.key), instruments: rows };
await Deno.writeTextFile(K.JSON_OUT.startsWith("/") ? K.JSON_OUT : `${REPO}${K.JSON_OUT}`, JSON.stringify(out, null, 2) + "\n");

// ---------------------------------------------------------------------------------------------------- document
const md: string[] = [];
md.push(`# THE LONG-TERM BASKET — instruments held only because we can measure what moves them (D-987)`);
md.push(``);
md.push(`> Regenerated every daily coverage-runner cycle by \`scripts/basket-register.ts\`; generated ${out.generated_at}. Machine-readable: \`research/basket.json\`. **Not advice** — single-operator research; every vehicle is a candidate to verify with the broker (ISA/SIPP eligibility, KID, TER, currency line).`);
md.push(``);
md.push(`**understood = measured material drivers ÷ material drivers.** A driver is MEASURED only if its feed is held AND fresh within a budget matched to how often its source publishes (daily ${BUDGET.daily}d · weekly ${BUDGET.weekly}d · monthly ${BUDGET.monthly}d, monthly series dated at period start). Held-but-stale is not measured (CONTINUITY LAW). Materiality was fixed per instrument from the operator's category list before any probe ran; non-material drivers are shown but never scored. Floor for membership: **${FLOOR}**.`);
md.push(``);
md.push(`**${basket.length} of ${rows.length} candidates qualify.** What this basket is and is not: it EXTENDS the deployed 5-sleeve blend (D-930..D-971) rather than duplicating it — the blend's trend/long sleeves already trade the price of every instrument marked "in trend universe" (read from \`tsmom-book.ts\` LONGONLY_RE at run time); its distress and IVOL sleeves are single-name SHORTS that no ISA can hold and are therefore not basket members. Understanding a driver is not an edge in it: most rows below carry the record's verdict that the driver is real and NOT forward-tradable — which is exactly why the basket is held through its drivers rather than timed on them (WEALTH_PATH: every timing overlay tested cost terminal wealth; the trend switch is the one admitted exception, measured as a drawdown result).`);
md.push(``);
md.push(`## Scoreboard`);
md.push(``);
md.push(`| instrument | candidate vehicle | research proxy | in trend universe | understood | basket | what blocks it |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const r of [...rows].sort((a, b) => b.understood - a.understood)) md.push(`| ${r.name} | ${r.vehicle} | ${r.research_proxy} | ${r.in_deployed_trend_universe ? "yes" : "no"} | **${r.understood.toFixed(2)}** (${r.measured_material}/${r.material_drivers}) | ${r.qualifies ? "**YES**" : "no"} | ${r.blocking_gaps.length ? r.blocking_gaps.map((g) => g.split(":")[0]).join("; ") : "—"} |`);
md.push(``);
md.push(`## Driver maps`);
for (const r of rows) {
  md.push(``);
  md.push(`### ${r.name} — understood ${r.understood.toFixed(2)} (${r.measured_material}/${r.material_drivers})${r.qualifies ? " — IN THE BASKET" : " — BLOCKED"}`);
  md.push(``);
  md.push(`Vehicle: ${r.vehicle}. Proxy: ${r.research_proxy}. Role: ${r.role}. Vehicle conversion: ${r.vehicle_conversion}.`);
  md.push(``);
  md.push(`| category | driver | material | state | feed (latest) | what the record says |`);
  md.push(`|---|---|---|---|---|---|`);
  for (const d of r.drivers) md.push(`| ${d.category} | ${d.driver}${d.proxy ? ` — PROXY: ${d.proxy}` : ""} | ${d.material ? "yes" : "no"} | ${d.state} | ${d.source ? `\`${d.source}\`${d.latest ? ` (${d.latest})` : ""}` : d.gap ?? "—"} | ${d.record ?? (d.state === "GAP" ? "named barrier — not a market finding" : "—")} |`);
}
md.push(``);
md.push(`## The gaps that would move instruments into the basket (free unless stated)`);
md.push(``);
const gapCount = new Map<string, string[]>();
for (const r of blocked) for (const d of r.drivers.filter((x) => x.material && x.state !== "MEASURED")) { const k = d.gap ?? `${d.driver} (${d.state}${d.latest ? `, latest ${d.latest}` : ""})`; (gapCount.get(k) ?? gapCount.set(k, []).get(k)!).push(r.name); }
for (const [g, who] of [...gapCount.entries()].sort((a, b) => b[1].length - a[1].length)) md.push(`- **${g}** — blocks: ${[...new Set(who)].join(", ")}`);
await Deno.writeTextFile(K.DOC_OUT.startsWith("/") ? K.DOC_OUT : `${REPO}${K.DOC_OUT}`, md.join("\n") + "\n");

console.log(`==> BASKET REGISTER: ${basket.length}/${rows.length} candidates understood >= ${FLOOR}`);
for (const r of [...rows].sort((a, b) => b.understood - a.understood)) console.log(`  ${r.qualifies ? "BASKET " : "blocked"} ${r.understood.toFixed(2)} (${r.measured_material}/${r.material_drivers})  ${r.name.padEnd(30)} ${r.blocking_gaps.map((g) => g.split(" — ")[0]).join(" | ").slice(0, 160)}`);
