#!/usr/bin/env -S deno run --allow-net --allow-env
// coverage-map.ts (D-697) — the register of APPROACHES, not specifications.
//
// THE QUESTION IT ANSWERS. `coverage-guard.ts` asks whether the DATA behind a verdict was adequate. Nothing asks the
// prior question: of the documented ways people have actually made money in markets, which has this programme
// touched at all? 1,059 specs look like broad coverage until you notice they are drawn from perhaps a dozen ideas.
//
// HOW EACH ROW IS CLASSIFIED — measured, not asserted. Every approach carries a regex, and the script counts the
// lineage rows and factory families that match it. An approach with zero matching rows is UNTESTED, and the script
// says so whether or not I believe the approach is promising: THE COVERAGE LAW's point is that an absence in our
// record is a fact about our record.
//
// THE THREE STATUSES ARE DELIBERATELY ASYMMETRIC:
//   TESTED        — rows exist; the verdict lives in the ledger, and this map does not restate it
//   TESTABLE      — no rows, and the data to test it is held or free. This is a RESEARCH DEBT, not a finding.
//   BLOCKED       — no rows, and the barrier is named: paid data, capital, licence, latency, or legal status.
// A BLOCKED row must name its barrier. "Probably not worth it" is not a barrier and is not accepted here.
//
// WHAT THIS IS NOT. It is not a claim to be exhaustive — no completeness declaration is made or ever will be. It is
// an OPEN register that should grow every time anyone thinks of something it lacks. The value is that the untested
// list is written down instead of living in the gap between what we searched and what we assumed we searched.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

declareKnobs("coverage-map", [{ name: "SHOW", def: "all", note: "all | untested | blocked" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

interface Approach { group: string; name: string; re: RegExp; blocked?: string; note?: string }

// The register. Grouped by the MECHANISM that is supposed to produce the return, because that is the axis along
// which two approaches are genuinely different — "value" and "quality" share a mechanism family; "tax wrapper" and
// "momentum" do not share anything at all, and grouping by asset class would hide that.
const REG: Approach[] = [
  // ---- A. cross-sectional equity characteristics -------------------------------------------------------------
  { group: "A. equity cross-section", name: "value (E/P, B/M, CF/P)", re: /\bep\b|book.to.market|\bbm\b|value|cfo_yield|fcf_yield/i },
  { group: "A. equity cross-section", name: "size", re: /\bsize\b|small.cap|szbm|\bSMB\b/i },
  { group: "A. equity cross-section", name: "momentum / reversal", re: /momentum|\bmom\d|rev1m|reversal|ltrev|strev|hi52/i },
  { group: "A. equity cross-section", name: "quality / profitability", re: /quality|profitab|gross_prof|\broe\b|op_margin/i },
  { group: "A. equity cross-section", name: "investment / asset growth", re: /asset_growth|investment|\bCMA\b|noa\b/i },
  { group: "A. equity cross-section", name: "accruals / earnings quality", re: /accrual/i },
  { group: "A. equity cross-section", name: "payout / buyback / issuance", re: /buyback|payout|issuance|div_yield/i },
  { group: "A. equity cross-section", name: "low volatility / beta", re: /low.vol|vol12|vol30|betting.against|\bBAB\b|volatility/i },
  { group: "A. equity cross-section", name: "leverage / distress", re: /leverage|distress|int_burden|altman/i },
  { group: "A. equity cross-section", name: "R&D / intangibles", re: /rd_intensity|intangible|\bR&D\b/i },
  // ---- B. time series / macro --------------------------------------------------------------------------------
  { group: "B. time series & macro", name: "trend / managed futures", re: /trend|breakout|macross|managed.fut|time.series momentum/i },
  { group: "B. time series & macro", name: "carry (FX / commodity / bond)", re: /carry trade|\bcarry\b.*(fx|commodity|bond|futures)|roll.?down|contango|backwardation|cash.and.carry/i },
  { group: "B. time series & macro", name: "seasonality / calendar", re: /seasonal|turn.of.month|\btom\b|day.of.week|halloween|january/i },
  { group: "B. time series & macro", name: "volatility targeting / risk parity", re: /vol.target|volmanaged|risk.parity|moreira|voltiming/i },
  { group: "B. time series & macro", name: "cross-asset lead-lag", re: /lead.lag|xasset|cross.asset/i },
  { group: "B. time series & macro", name: "macro regime conditioning", re: /macro regime|regime.condition|recession indicator|inflation regime|business cycle/i },
  // ---- C. events ---------------------------------------------------------------------------------------------
  { group: "C. events", name: "earnings drift (PEAD)", re: /\bpead\b|earnings.drift|post.earnings/i },
  { group: "C. events", name: "insider transactions", re: /insider|form.?345|form 4/i },
  { group: "C. events", name: "institutional ownership (13F/NPORT)", re: /13f|nport|institutional own/i },
  { group: "C. events", name: "delisting / going concern", re: /delist|going.concern|3\.01|nonreliance/i },
  { group: "C. events", name: "auditor change / restatement", re: /auditor|restat|4\.0[12]/i },
  { group: "C. events", name: "executive departure", re: /resignation|exec.depart|5\.02/i },
  { group: "C. events", name: "index inclusion / deletion", re: /index.inclusion|index.deletion|index.rebal|russell.recon|s&p.add/i },
  { group: "C. events", name: "merger arbitrage", re: /merger|takeover|\barb\b.*deal|acquisition spread/i },
  { group: "C. events", name: "spin-offs / corporate separations", re: /spin.?off|carve.?out|demerger/i },
  { group: "C. events", name: "IPO / lockup expiry", re: /\bIPO\b|lock.?up|quiet period/i },
  { group: "C. events", name: "SPAC / de-SPAC", re: /\bSPAC\b|de.?spac|blank.cheque/i },
  { group: "C. events", name: "capital raises / dilution (Form D)", re: /form.?d\b|fundflow|capital raise|secondary offering/i },
  // ---- D. microstructure -------------------------------------------------------------------------------------
  { group: "D. microstructure", name: "order flow / aggressor imbalance", re: /order.flow|aggressor|imbalance|flow7/i },
  { group: "D. microstructure", name: "overnight vs intraday", re: /overnight|intraday|session/i },
  { group: "D. microstructure", name: "auction / close dynamics", re: /auction|\bMOC\b|closing.cross|opening cross/i },
  { group: "D. microstructure", name: "short interest / settlement fails", re: /short.interest|\bFTD\b|fails.to.deliver|shortside|short_volume/i },
  { group: "D. microstructure", name: "dark pool / ATS activity", re: /dark.?pool|\bATS\b/i },
  { group: "D. microstructure", name: "latency / co-location arbitrage", re: /latency|co.location|\bHFT\b/i,
    blocked: "CAPITAL + INFRASTRUCTURE: requires exchange colocation, direct feeds and a matching-engine-speed stack. Not reachable from a retail account at any rung of this ladder." },
  // ---- E. derivatives ----------------------------------------------------------------------------------------
  { group: "E. derivatives", name: "variance risk premium", re: /variance risk|\bVRP\b|vol premium|straddle/i },
  { group: "E. derivatives", name: "skew / smile", re: /\bskew\b|smile|risk.reversal|25d/i },
  { group: "E. derivatives", name: "term structure (VIX curve)", re: /vix.?9d|vx.curve|term.structure|contango.*vix/i },
  { group: "E. derivatives", name: "dealer gamma / positioning", re: /gamma|\bGEX\b|dealer position/i },
  { group: "E. derivatives", name: "covered calls / buy-write", re: /covered.call|buy.?write|\bBXM\b|call overwriting/i },
  { group: "E. derivatives", name: "cash-secured puts / put-write", re: /put.?write|cash.secured|\bPUT index\b|short put/i },
  // ---- F. credit & rates -------------------------------------------------------------------------------------
  { group: "F. credit & rates", name: "credit spread / HY-IG", re: /credit|\bHYG\b|\bLQD\b|spread.*credit|\bTRACE\b/i },
  { group: "F. credit & rates", name: "duration / curve positioning", re: /duration|yield.curve|steepen|flatten/i },
  { group: "F. credit & rates", name: "TIPS / breakeven inflation", re: /\bTIPS\b|breakeven|inflation.swap/i },
  // ---- G. crypto ---------------------------------------------------------------------------------------------
  { group: "G. crypto", name: "perp funding", re: /funding/i },
  { group: "G. crypto", name: "spot-futures basis", re: /basis|cash.and.carry/i },
  { group: "G. crypto", name: "on-chain fundamentals", re: /on.?chain|blockchain|active address|hash.?rate/i },
  { group: "G. crypto", name: "liquidation cascades", re: /liquidation|cascade|forced.selling/i },
  { group: "G. crypto", name: "cross-venue / DEX-CEX arbitrage", re: /xvenue|cross.venue|\bDEX\b|triangular/i },
  { group: "G. crypto", name: "staking / lending yield", re: /staking|lending yield|\bDeFi\b yield/i,
    blocked: "CUSTODY + PROTOCOL RISK, and it is not a market-timing question: staking yield is an operational income stream requiring on-chain custody this programme does not have and has not been authorised to obtain." },
  { group: "G. crypto", name: "airdrops / token distribution", re: /airdrop|token.distribution/i,
    blocked: "NOT A MEASURABLE STRATEGY from price data: eligibility depends on prior on-chain activity, and the historical record is not a panel anyone can backtest without reconstructing wallet-level state." },
  // ---- H. structural sources of terminal wealth ---------------------------------------------------------------
  // This group is the one an alpha-hunting programme systematically under-weights, and it is where the ladder
  // (D-679/680/688) says the money actually is below the crossover. Every item here has produced real terminal
  // wealth for real people, is capacity-unlimited, and requires no edge whatsoever.
  { group: "H. structural", name: "contribution rate", re: /contribution|deposit rate|savings rate/i },
  { group: "H. structural", name: "fee minimisation / expense ratio", re: /expense ratio|fee minim|\bER\b bp|cost model/i },
  { group: "H. structural", name: "tax drag & account wrapper", re: /\btax\b|account wrapper|\bISA\b|\bSIPP\b|\b401k\b|\bIRA\b|capital gains|withholding/i },
  { group: "H. structural", name: "tax-loss harvesting", re: /tax.loss harvest|wash.sale/i },
  { group: "H. structural", name: "rebalancing premium / vol harvesting", re: /rebalanc.*premium|vol.*harvest|diversification return/i },
  { group: "H. structural", name: "asset allocation choice", re: /allocation|60\/40|passive.*basket|portfolio choice/i },
  { group: "H. structural", name: "sequence-of-returns risk", re: /sequence.of.return|path dependen|entry timing/i },
  { group: "H. structural", name: "leverage cost & management", re: /leverage cost|margin rate|financing cost/i },
  { group: "H. structural", name: "securities lending revenue", re: /securities lending|stock loan|lending revenue/i },
  { group: "H. structural", name: "currency of account / FX exposure", re: /currency.*account|home.currency|\bFX\b hedg/i },
  { group: "H. structural", name: "behavioural error avoidance", re: /behavioural|behavioral bias|loss aversion|panic sell|investor discipline|drawdown toleran/i },
];

// ---- evidence -------------------------------------------------------------------------------------------------
async function all(path: string, key: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []; let after = "";
  for (;;) {
    const r = await fetch(`${OWNED}/${path}&order=${key}.asc&limit=1000${after ? `&${key}=gt.${encodeURIComponent(after)}` : ""}`, { headers: hdr });
    if (!r.ok) { console.error(`!! ${path} HTTP ${r.status} — cannot classify without evidence. RED.`); Deno.exit(1); }
    const j = await r.json() as Record<string, unknown>[];
    if (!j.length) break;
    out.push(...j); after = String(j[j.length - 1][key]);
    if (j.length < 1000) break;
  }
  return out;
}
const lineage = await all("trd_lineage?select=id,family,status,hypothesis,key_metric,verdict", "id");
const specs = await all("trd_factory?select=id,spec_key,family", "id");
assertNonEmpty("lineage rows", lineage, 50);
assertNonEmpty("factory specs", specs, 100);

// D-697b: CLASSIFY ON WHAT A ROW IS ABOUT, NOT ON EVERY WORD IN ITS DISCUSSION. The first version matched anywhere
// in the verdict prose and every suspicious hit was a false positive, verified one by one:
//   "tax drag & wrapper"  32 rows -> all matched "ETF WRAPPERs". The programme has never modelled tax at all.
//   "carry"               32 rows -> matched the VERB ("filings carry negative drift").
//   "behavioural"         54 rows -> matched "HOLDABILITY" and "discipline" in prose.
//   "covered calls"        2 rows -> matched "overWRITe" (a data overwrite).
//   "tax-loss harvesting"  5 rows -> matched "harvest" as in funding harvest.
//   "macro regime"        26 rows -> matched "inflation" inside "cost-INFLATION".
// An over-reporting classifier is the dangerous direction: it lets the programme believe it covered something it
// never touched, which is precisely the failure this map exists to prevent, reproduced inside the map.
// The id, family and hypothesis name the SUBJECT of a row; the verdict is discussion of it. Matching only the first
// three is the difference between "this row is about X" and "this row mentions X".
const lineText = lineage.map((r) => `${r.id} ${r.family} ${r.hypothesis ?? ""}`);
const specText = specs.map((r) => `${r.spec_key} ${r.family}`);

console.log(`==> COVERAGE MAP — documented approaches vs what this programme has actually touched`);
console.log(`    evidence: ${lineage.length} lineage rows, ${specs.length} factory specs\n`);

let tested = 0, untested = 0, blocked = 0;
const debts: string[] = [];
let group = "";
for (const a of REG) {
  if (a.group !== group) { group = a.group; console.log(`\n  ${group}`); }
  const nL = lineText.filter((t) => a.re.test(t)).length;
  const nS = specText.filter((t) => a.re.test(t)).length;
  const hit = nL + nS > 0;
  let tag: string;
  if (hit) { tag = "TESTED  "; tested++; }
  else if (a.blocked) { tag = "BLOCKED "; blocked++; }
  else { tag = "UNTESTED"; untested++; debts.push(`${a.group.slice(3)} / ${a.name}`); }
  console.log(`    ${tag} ${a.name.padEnd(38)} ${hit ? `${nL} row(s), ${nS} spec(s)` : (a.blocked ? "—" : "NO EVIDENCE IN THE LEDGER")}`);
  if (!hit && a.blocked) console.log(`             barrier: ${a.blocked}`);
}

console.log(`\n  ${tested} approach(es) with evidence  |  ${untested} UNTESTED and testable  |  ${blocked} blocked with a named barrier`);
if (debts.length) {
  console.log(`\n  RESEARCH DEBT — no evidence in the ledger, no barrier claimed, therefore actionable:`);
  for (const d of debts) console.log(`    · ${d}`);
}
console.log(`\n  THIS REGISTER IS OPEN AND IS NOT A COMPLETENESS CLAIM. Every approach absent from it is absent because`);
console.log(`  nobody has added it yet, which is exactly the failure mode it exists to make visible. Add to it.`);
