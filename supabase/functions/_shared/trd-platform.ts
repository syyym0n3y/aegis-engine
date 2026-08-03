// trd-platform.ts — the unified moat. Takes a normalized account (any broker) and runs
// all three layers into ONE verdict: VERIFY (is the edge real?) + PROTECT (will it blow
// up?) + ALLOCATE (how does a disciplined benchmark compare?) → a composite grade and a
// ranked, plain-English action list. This is the platform's core intelligence call.
// PURE, deterministic. No order routing.

import { NormalizedAccount } from "./trd-normalize.ts";
import { verifyTrackRecord, VerifyReport } from "./trd-verify.ts";
import { riskXray, RiskReport } from "./trd-protect.ts";

export interface PlatformReport {
  account: { source: string; trades: number; spanDays: number; startEquity: number; winRate: number; winLossRatio: number };
  verify: VerifyReport;
  protect: RiskReport;
  /** benchmark: the disciplined global multi-factor book's realized Sharpe (ALLOCATE) */
  benchmark: { name: string; annualSharpe: number; note: string };
  /** composite platform grade A–F and headline */
  grade: "A" | "B" | "C" | "D" | "F";
  headline: string;
  recommendations: string[];
}

// the live ALLOCATE benchmark (from the global-factor book, D-077): what disciplined
// diversified capital earns — the honest bar an active account is really competing with.
const ALLOCATE_BENCHMARK = { name: "Global multi-factor book (value+quality+momentum, US+intl+EM)", annualSharpe: 1.0, retailNetSharpe: 0.6 };

export function analyzeAccount(acct: NormalizedAccount, opts: { claimedTrials?: number; costPerTradeBps?: number } = {}): PlatformReport {
  const verify = verifyTrackRecord({ returns: acct.returns, periodsPerYear: acct.tradesPerYear, claimedTrials: opts.claimedTrials, benchmarkAnnualSharpe: ALLOCATE_BENCHMARK.retailNetSharpe });
  const protect = riskXray({ equity: acct.startEquity, riskPerTradeFrac: acct.avgRiskFrac, winRate: acct.winRate, winLossRatio: acct.winLossRatio === Infinity ? 5 : acct.winLossRatio, tradesPerYear: Math.round(acct.tradesPerYear), costPerTradeBps: opts.costPerTradeBps });

  // composite grade: an account must be BOTH real AND survivable to grade well, AND it
  // is measured against the disciplined benchmark it could passively earn instead.
  const real = verify.verdict === "LIKELY REAL";
  const unproven = verify.verdict === "UNPROVEN";
  const survivable = protect.verdict === "SURVIVABLE";
  const beatsBench = verify.annualSharpe > ALLOCATE_BENCHMARK.retailNetSharpe;

  let grade: PlatformReport["grade"];
  if (protect.verdict === "RUIN-LIKELY") grade = "F"; // ruin trumps everything
  else if (real && survivable && beatsBench) grade = "A";
  else if (real && survivable) grade = "B";
  else if ((real || unproven) && survivable) grade = "C";
  else if (unproven) grade = "D";
  else grade = "F";

  const headline = grade === "A" ? "Real, survivable, and beating the passive benchmark — rare. Verify live-forward before scaling."
    : grade === "B" ? "Real and survivable, but not beating what a disciplined passive book earns — the effort may not be worth it."
    : grade === "C" ? "Survivable, but the edge isn't proven — you're trading a lead, not an edge."
    : grade === "D" ? "Unproven and fragile — this is closer to gambling than investing."
    : protect.verdict === "RUIN-LIKELY" ? "On this sizing you are statistically likely to blow up, regardless of any edge." : "No demonstrable edge — the record is indistinguishable from luck.";

  const recs: string[] = [];
  if (protect.verdict === "RUIN-LIKELY" && protect.expectancyR > 0) recs.push(`CUT RISK FIRST: at ${(acct.avgRiskFrac * 100).toFixed(1)}% per trade you have a ${(protect.probRuin * 100).toFixed(0)}% chance of losing half your account this year. Drop to ~${(Math.max(0, protect.kellyFraction / 2) * 100).toFixed(1)}% and the same edge survives.`);
  if (protect.expectancyR <= 0) recs.push(`STOP: your expectancy is ${protect.expectancyR.toFixed(2)}R — negative. No sizing fixes a negative edge; the issue is the strategy, not the risk.`);
  if (!real) recs.push(`Don't scale yet: the edge is ${verify.verdict.toLowerCase()} (DSR ${verify.deflatedSharpe.toFixed(2)}). ${verify.flags[0] ?? ""}`);
  if (real && !beatsBench) recs.push(`Reality check: a passive global factor book earns ~${ALLOCATE_BENCHMARK.retailNetSharpe} Sharpe net for zero screen-time. Your active Sharpe is ${verify.annualSharpe.toFixed(2)} — make sure the edge is worth the hours and stress.`);
  if (grade === "A") recs.push(`Proceed carefully: prove it forward on live data it hasn't seen, keep risk at half-Kelly, and treat any single good month as noise.`);
  recs.push(`Diversifier: pair any active edge with the disciplined global factor book (ALLOCATE) — it made money in the 2008 crisis where discretionary trading bled.`);

  return {
    account: { source: acct.source, trades: acct.trades.length, spanDays: Math.round(acct.spanDays), startEquity: acct.startEquity, winRate: acct.winRate, winLossRatio: acct.winLossRatio },
    verify, protect,
    benchmark: { name: ALLOCATE_BENCHMARK.name, annualSharpe: ALLOCATE_BENCHMARK.retailNetSharpe, note: "realistic retail net Sharpe of a diversified global factor ETF book" },
    grade, headline, recommendations: recs,
  };
}
