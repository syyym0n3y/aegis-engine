#!/usr/bin/env -S deno run --allow-read
// trd-bot-paper-sim — the honest "can we keep and compound accounts" test. Drives the FULL
// live pipeline over real historical bars: detect setups → BOT allocates (learning live which
// setups work) → FIREWALL gates every order → PAPER BROKER fills with slippage+commission.
// Reports the equity curve, per-setup live performance, and whether the firewall kept the
// account ALIVE. Expected honest outcome per D-073..D-077: no signal edge, so it should NOT
// compound — but it must NOT blow up. Surviving-not-compounding IS the product's real claim.
//
//   BARS_FILE=/tmp/btc15m.json  deno run --allow-read scripts/trd-bot-paper-sim.ts

import { Bar, detectSetups } from "../supabase/functions/_shared/trd-setups.ts";
import { allocate, proposeOrder } from "../supabase/functions/_shared/trd-bot.ts";
import { evaluateOrder, RiskPolicy } from "../supabase/functions/_shared/trd-firewall.ts";
import { newAccount, onBar, openPosition, toFirewallState } from "../supabase/functions/_shared/trd-paper-broker.ts";
import { annualizedSharpe, maxDrawdown, mean } from "../supabase/functions/_shared/trd-stats.ts";

const raw = JSON.parse(await Deno.readTextFile(Deno.env.get("BARS_FILE")!)) as Record<string, Bar[]>;
const SYM = Object.keys(raw)[0];
const bars = [...raw[SYM]].sort((a, b) => a.ts.localeCompare(b.ts));
const START = 5000;
const POLICY: RiskPolicy = {
  maxRiskPerTradeFrac: 0.01, maxDailyLossFrac: 0.04, maxDrawdownFrac: 0.25,
  maxConcurrentPositions: 2, maxCorrelatedRiskFrac: 0.02, maxTradesPerDay: 6,
  cooldownAfterLosses: 3, cooldownMinutes: 120, requireStopLoss: true, maxLeverage: 10, noTradeHoursUtc: [],
};
const BOTCFG = { portfolioTargetVolAnnual: 0.20, maxRiskPerTradeFrac: 0.01, minTradesToTrust: 30, tradesPerYear: 35040, kellyFraction: 0.5 };

// precompute all candidate setups once, index by trigger timestamp
const setups = detectSetups(bars, { lookback: 20, rMult: 2 });
const byTs = new Map<string, typeof setups>();
for (const s of setups) (byTs.get(s.ts) ?? byTs.set(s.ts, []).get(s.ts)!).push(s);

const acct = newAccount(START);
let blocked = 0, fired = 0;
// rolling realized vol of the account's per-trade returns (for the bot's vol-target scaling)
function acctVol(): number { const r = acct.closed.slice(-40).map((c) => c.pnl / acct.startEquity); return r.length >= 8 ? Math.sqrt(mean(r.map((x) => x * x))) * Math.sqrt(BOTCFG.tradesPerYear) : BOTCFG.portfolioTargetVolAnnual; }

for (const bar of bars) {
  onBar(acct, SYM, bar, { commissionBps: 5, slippageBps: 3, barsPerYear: 35040 }); // resolve exits first
  const trig = byTs.get(bar.ts);
  if (!trig) continue;
  for (const s of trig) {
    const metrics = allocate(Object.entries(acct.perSetupR).map(([key, rHistory]) => ({ key, rHistory })), BOTCFG);
    const m = metrics.find((x) => x.key === s.kind) ?? { key: s.kind, trades: 0, expectancyR: 0, winRate: 0, volR: 1, confidence: 0, weight: 0 };
    // bootstrap: before a setup has history, give it a small exploratory allocation so it can prove itself
    const mm = m.trades < BOTCFG.minTradesToTrust ? { ...m, weight: Math.max(m.weight, 0.5), expectancyR: Math.max(m.expectancyR, 0.05), confidence: Math.max(m.confidence, 0.3) } : m;
    const order = proposeOrder({ key: s.kind, side: s.side, symbol: SYM, hasStopLoss: true, hasTakeProfit: true }, mm, acctVol(), BOTCFG);
    const fw = evaluateOrder(order, toFirewallState(acct, new Date(bar.ts).getUTCHours()), POLICY);
    if (fw.decision === "BLOCK") { blocked++; continue; }
    // REALISTIC FILL: enter at the price actually available now (this bar's close), NOT a stale
    // favourable structural level (that was look-ahead). Keep the structural stop; target = 2R.
    const entry = bar.close, dir = s.side === "long" ? 1 : -1, risk = Math.abs(entry - s.stop);
    if (!(risk > 0)) continue;
    if (s.side === "long" && s.stop >= entry) continue;
    if (s.side === "short" && s.stop <= entry) continue;
    if (openPosition(acct, { setupKey: s.kind, symbol: SYM, side: s.side, entry, stop: s.stop, target: entry + dir * 2 * risk }, fw.approvedRiskFrac, bar.ts)) fired++;
  }
}

const curve = acct.equityCurve;
const rets = curve.slice(1).map((v, i) => v / curve[i] - 1);
const finalMult = acct.equity / acct.startEquity;
const years = bars.length / BOTCFG.tradesPerYear;
console.log(`\n[bot-paper-sim] ${SYM}, ${bars.length} bars (~${years.toFixed(1)}y), ${setups.length} candidate setups.`);
console.log(`  trades fired: ${fired} | firewall blocks: ${blocked} | still open: ${acct.positions.length}`);
console.log(`  FINAL EQUITY: $${acct.equity.toFixed(0)} from $${START}  =>  ${finalMult.toFixed(2)}x  (${((finalMult - 1) * 100).toFixed(1)}% over ${years.toFixed(1)}y)`);
console.log(`  max drawdown: ${(maxDrawdown(rets) * 100).toFixed(0)}%  |  RUINED (lost >50%): ${acct.equity <= START * 0.5 ? "YES" : "no"}  |  ACCOUNT SURVIVED: ${acct.equity > START * 0.5 ? "YES" : "NO"}`);
console.log(`  per-setup (what the bot learned live):`);
for (const [k, r] of Object.entries(acct.perSetupR)) console.log(`    ${k.padEnd(6)} n=${String(r.length).padStart(4)}  expectancy=${mean(r).toFixed(3)}R  winRate=${(r.filter((x) => x > 0).length / r.length * 100).toFixed(0)}%`);
const verdict = finalMult > 1.15 ? "COMPOUNDED — investigate (rare; verify it's not a data/regime artifact)" : acct.equity > START * 0.5 ? "did NOT compound, but SURVIVED — the firewall did its job; no signal edge (as expected)" : "BLEW THROUGH the survival line — the firewall/policy needs tightening";
console.log(`\n  VERDICT: ${verdict}`);
