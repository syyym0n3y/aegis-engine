#!/usr/bin/env -S deno run --allow-net --allow-env
// budget-threshold-map.ts (D-746) — "at what BUDGET does extracting wealth from markets start working?" answered with
// the ledger's own numbers, not a feeling. Budget acts through exactly four channels, and each is measurable:
//   (1) DEPOSITS vs ALPHA — below a crossover capital, adding to deposits beats any realistic alpha (arithmetic);
//   (2) EXECUTION COST — a killed candidate has a round-trip cost at which its NET turns positive; account tiers map
//       to costs, so "works at what budget" = "works at what cost tier";
//   (3) INSTRUMENT ACCESS — some effects need borrow / NDFs / portfolio margin, i.e. a minimum account;
//   (4) CAPACITY — some effects exist only in illiquid names, so MORE budget makes them WORSE, not better.
// Every input below cites the decision that measured it. Cost-tier and minimum-account figures are ASSUMPTIONS
// (labelled) from public broker schedules, not measured by this stack — they set the map, they are not findings.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("budget-threshold-map", [{ name: "DEPOSIT_YR", def: "1800", note: "annual deposits, $ (default $150/mo)" }]);
const DEP = Number(Deno.env.get("DEPOSIT_YR") || "1800");

console.log(`==> BUDGET THRESHOLD MAP (D-746) — when, and at what budget, does "extracting wealth" start working?\n`);

// ---- (1) deposits vs alpha: alpha a on capital C beats deposits D when a*C > D  ->  C* = D/a
console.log(`  (1) DEPOSITS vs ALPHA — the crossover capital C* = annual deposits / alpha. Below C*, +deposits beats +alpha.`);
console.log(`      (alpha of 3%/yr is generous: this ledger holds ZERO promoted alpha at 2.9M trials; 1% is the realistic ceiling of a cleared spin-off clock at small size)`);
console.log(`      annual deposits    alpha 1%      alpha 3%      alpha 5%`);
for (const d of [DEP, 6000, 12000, 36000]) console.log(`      ${("$" + d.toLocaleString()).padStart(14)}  ${("$" + (d / 0.01).toLocaleString()).padStart(12)}  ${("$" + (d / 0.03).toLocaleString()).padStart(12)}  ${("$" + (d / 0.05).toLocaleString()).padStart(12)}`);
console.log(`      READ: at $${DEP.toLocaleString()}/yr of deposits, alpha would need to exist AND capital would need to exceed ~$${Math.round(DEP / 0.03).toLocaleString()} before a 3% edge`);
console.log(`      mattered more than the next $150/mo. Until then the budget lever IS the deposit, whatever the market does.\n`);

// ---- (2) cost break-even per killed/blocked candidate, mapped to cost tiers (ASSUMED tiers, labelled)
interface Tier { name: string; rtBp: number; note: string }
const TIERS: Tier[] = [
  { name: "retail small-cap / EM single names", rtBp: 80, note: "ASSUMED: spread+impact 40-100bp RT" },
  { name: "retail US large-cap / liquid ETF", rtBp: 12, note: "ASSUMED: commission-free, spread+impact 5-15bp RT" },
  { name: "IBKR Pro / algo execution", rtBp: 6, note: "ASSUMED: 1-5bp commission + spread" },
  { name: "institutional program trading", rtBp: 20, note: "ASSUMED: 10-30bp RT in EM large caps incl. impact" },
  { name: "crypto taker (retail)", rtBp: 8, note: "ASSUMED: 4bp each way" },
  { name: "crypto taker (VIP, ~$250M/30d volume)", rtBp: 4, note: "ASSUMED: Binance VIP4+ schedule" },
];
interface Cand { name: string; ref: string; grossPct: number; turnoverOneWayPerYr: number; tiers: string[]; access: string; capacity: string; verdictAtInfiniteBudget: string }
const CANDS: Cand[] = [
  { name: "EM large-cap momentum (the nearest miss)", ref: "D-653/654", grossPct: 4.2, turnoverOneWayPerYr: 0.335 * 12, tiers: ["retail small-cap / EM single names", "institutional program trading"],
    access: "long-only, no borrow — any account", capacity: "large caps: not the constraint",
    verdictAtInfiniteBudget: "works ONLY where round-trip cost is below break-even — institutional EM execution is not under 35bp, so this is a claim about a cost tier the operator does not have" },
  { name: "spin-off premium (the one live candidate)", ref: "D-733", grossPct: 22.8 / (500 / 252), turnoverOneWayPerYr: 2, tiers: ["retail US large-cap / liquid ETF", "IBKR Pro / algo execution"],
    access: "long-only — any account, fits SMALL size", capacity: "liquid tercile is where it holds (+22.8% vs SPY) — capacity is not the constraint",
    verdictAtInfiniteBudget: "budget-INDEPENDENT: the gate is TIME (forward clock, ~3-4y to accrue), not money" },
  { name: "de-SPAC underperformance (short)", ref: "D-734", grossPct: 40.7 / (500 / 252), turnoverOneWayPerYr: 2, tiers: ["retail small-cap / EM single names"],
    access: "SHORT — needs borrow (margin/prime); illiquid small caps are hard/expensive to borrow", capacity: "effect is ONLY in the illiquid tercile (liquid: -3.7%, t 0.08) — MORE money makes it WORSE",
    verdictAtInfiniteBudget: "budget cannot unlock it: past low five figures per name you ARE the market in these names, and the liquid names carry no effect" },
  { name: "EM FX carry", ref: "D-741", grossPct: 7.01, turnoverOneWayPerYr: 0.18 * 12, tiers: ["institutional program trading"],
    access: "NDF/forward — institutional FX (ISDA/prime), effectively $1M+ minimums", capacity: "deep",
    verdictAtInfiniteBudget: "budget unlocks the VEHICLE, not the answer: the NDF conversion is UNMEASURED (INSTRUMENT LAW), and the research number is a risk premium under the 5.46 ceiling with a -3%/yr spot leg" },
  { name: "equity factor long-shorts (research space)", ref: "D-530/556", grossPct: 5.6, turnoverOneWayPerYr: 6, tiers: ["retail small-cap / EM single names", "IBKR Pro / algo execution", "institutional program trading"],
    access: "thousands of names + borrow — prime broker / portfolio margin (ASSUMED: IBKR portfolio margin $110k min; true prime $1M+)", capacity: "fine at size",
    verdictAtInfiniteBudget: "budget unlocks the vehicle and the vehicle is DEAD: the placeable concentrated version measured t 0.35 with -93% drawdowns (D-556); ETF replicas capture ~20% (D-555)" },
  { name: "perp order-flow (the only intraday signal, 20/20 symbols)", ref: "D-426", grossPct: -0.64 * 24 * 365 / 100 / 100 * 100, turnoverOneWayPerYr: 24 * 365, tiers: ["crypto taker (retail)", "crypto taker (VIP, ~$250M/30d volume)"],
    access: "any crypto account", capacity: "$523M/hour — not the constraint",
    verdictAtInfiniteBudget: "NEVER at any budget: -0.64bp per trade at ZERO fees — the effect is negative before cost" },
  { name: "20:00-22:00 UTC perp window (best intraday candidate ever)", ref: "D-445/447", grossPct: 7.83 / 1e4 * 252 * 100, turnoverOneWayPerYr: 252, tiers: ["crypto taker (retail)", "crypto taker (VIP, ~$250M/30d volume)"],
    access: "any crypto account; needs TAKER execution (passive fills were the losing days)", capacity: "deep",
    verdictAtInfiniteBudget: "fee-viable only at VIP taker tiers (~$250M/30d volume) AND then needs forward confirmation; at retail taker it is 0.87x its cost" },
];
assertNonEmpty("candidates", CANDS, 5);
console.log(`  (2) COST BREAK-EVEN per real-but-blocked candidate: break-even RT cost = gross / (2 x one-way turnover). Which ASSUMED tier clears it:`);
for (const c of CANDS) {
  const be = c.turnoverOneWayPerYr > 0 ? (c.grossPct / (2 * c.turnoverOneWayPerYr)) * 100 : Infinity; // bp
  const app = TIERS.filter((t) => c.tiers.includes(t.name)); const ok = app.filter((t) => t.rtBp < be).map((t) => `${t.name} (${t.rtBp}bp)`); const no = app.filter((t) => t.rtBp >= be).map((t) => `${t.name} (${t.rtBp}bp)`);
  console.log(`\n    ${c.name}  [${c.ref}]`);
  console.log(`      gross ${c.grossPct.toFixed(2)}%/yr, one-way turnover ${c.turnoverOneWayPerYr.toFixed(1)}x/yr  ->  break-even round-trip cost ${Number.isFinite(be) ? be.toFixed(1) + "bp" : "n/a"}`);
  console.log(`      applicable tiers — CLEARS: ${be <= 0 ? "none (negative before cost)" : ok.length ? ok.join("; ") : "none"}   |   FAILS: ${no.length ? no.join("; ") : "none"}`);
  console.log(`      access: ${c.access}`);
  console.log(`      capacity: ${c.capacity}`);
  console.log(`      at INFINITE budget: ${c.verdictAtInfiniteBudget}`);
}

// ---- (3) hard regulatory / structural floors on "daily"
console.log(`\n  (3) STRUCTURAL FLOORS ON "DAILY" (ASSUMED from public rules, not measured here):`);
console.log(`      US pattern-day-trader rule: under $25,000 equity, more than 3 day-trades per 5 days is prohibited in US margin accounts.`);
console.log(`      A GBP-based operator using a UK broker has no PDT rule, but pays stamp duty 0.5% on UK shares (an 50bp one-way cost that`);
console.log(`      kills every turnover-heavy approach outright) and CFD/spread-bet financing on leveraged daily positions.`);
console.log(`      Crypto VIP fee tiers that make the one intraday candidate fee-viable start around $250M of 30-day volume.`);

// ---- (4) the bottom line
console.log(`\n  BOTTOM LINE — "when does it start working, at what budget":`);
console.log(`    - DAILY extraction: at NO budget on anything this stack has measured. The intraday effects are negative before cost (D-426)`);
console.log(`      or fee-viable only at institutional-volume tiers and still unconfirmed forward (D-445/447). Money lowers fees; it does`);
console.log(`      not create an effect where the mean effect is zero. The base rate (0 of 2.9M) is not a budget finding.`);
console.log(`    - MONTHLY factor-style extraction: budget unlocks the VEHICLE at roughly $110k (portfolio margin) to $1M+ (prime / NDF),`);
console.log(`      and every vehicle this stack measured after unlocking was dead or unmeasured (D-556, D-741). EM momentum needs an`);
console.log(`      execution cost under ~${((4.2 / (2 * 0.335 * 12)) * 100).toFixed(0)}bp round-trip that retail does not get.`);
console.log(`    - EVENT extraction (the spin-off candidate): budget-INDEPENDENT and fits small size; the gate is the forward clock.`);
console.log(`    - The illiquid effects (de-SPAC, factor tails): MORE budget makes them WORSE — they are capacity-bound, not budget-gated.`);
console.log(`    - STRUCTURAL compounding: works at EVERY budget from $150/mo, and below ~$${Math.round(DEP / 0.03).toLocaleString()} of capital the deposit`);
console.log(`      itself outweighs any alpha this programme could plausibly clear. That is the honest "start": it started at the first deposit.`);
console.log(`\n  WHAT WOULD CHANGE THIS MAP: a forward clock clearing (spin-off, ~2029-30); a measured NDF conversion for EM carry; an execution`);
console.log(`  tier under ~50bp in EM large caps; any new effect whose mean (not rank) survives cost. Nothing on it is "get more money".`);
