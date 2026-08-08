#!/usr/bin/env -S deno run
// trd-prop-sim — the honest economics of the PROP-FARMING model the operator described: buy cheap eval
// accounts, pass the profit target WITHOUT breaching the drawdown/daily-loss rules, collect payouts,
// reinvest. The key insight (operator, correct): on a prop account downside = the eval fee, not the
// balance → it's buying cheap optionality. And P(pass) is dominated by SIZING, not by the edge — so
// "the difference is risk-model optimization" is TRUE here. This finds the optimal risk-per-trade and
// the net EV of farming accounts, for a given edge and firm ruleset. No network; pure Monte-Carlo.

// ---- a representative prop challenge (FTMO/Topstep-ish $50k) ----
const ACCOUNT = 50000;
const TARGET = 0.08;        // +8% profit target to pass ($4,000)
const MAX_DD = 0.10;        // 10% max total drawdown ($5,000) — account dies below this
const DAILY_LOSS = 0.05;    // 5% daily loss limit ($2,500)
const MAX_DAYS = 40;        // must pass within 40 trading days
const TRADES_DAY = 6;
const EVAL_COST = 300;      // typical eval fee
const PAYOUT_ON_PASS = 4000; // first payout ~= the profit made, kept at ~80-100% split (simplified)

// ---- a MODEST, realistic edge (this is the honest lever — with NO edge the firm wins) ----
const WIN = 0.47, WIN_R = 2.0, LOSS_R = 1.0; // 47% win, 2:1 → expectancy +0.41R (a real but ordinary edge)

let seed = 20260804 >>> 0;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function simOne(riskFrac: number): "pass" | "dd" | "timeout" {
  let eq = ACCOUNT; const startPeakFloor = ACCOUNT * (1 - MAX_DD);
  for (let day = 0; day < MAX_DAYS; day++) {
    let dayStart = eq;
    for (let t = 0; t < TRADES_DAY; t++) {
      const risk = riskFrac * ACCOUNT;                 // fixed-fractional of starting balance (prop convention)
      eq += rnd() < WIN ? WIN_R * risk : -LOSS_R * risk;
      if (eq <= startPeakFloor) return "dd";           // breached total drawdown
      if (eq <= dayStart - DAILY_LOSS * ACCOUNT) return "dd"; // breached daily loss
      if (eq >= ACCOUNT * (1 + TARGET)) return "pass"; // hit profit target
    }
  }
  return "timeout";
}

const SPLIT = 0.8; // trader keeps 80% of funded-phase profit
function evalRisk(riskFrac: number, N = 20000) {
  let pass = 0, dd = 0, timeout = 0, paid = 0;
  for (let i = 0; i < N; i++) {
    const r = simOne(riskFrac); if (r === "pass") pass++; else if (r === "dd") dd++; else { timeout++; continue; }
    if (r !== "pass") continue;
    // TWO-HURDLE reality: pass eval → funded → must ALSO profit on the funded account to get paid
    if (simOne(riskFrac) === "pass") paid++;
  }
  const pPass = pass / N, pPaid = paid / N;
  const payout = SPLIT * PAYOUT_ON_PASS;                    // 80% of the profit made on the funded phase
  const evPerAccount = pPaid * payout - EVAL_COST;          // net $ per eval bought (both hurdles)
  return { riskFrac, pPass, pPaid, pDD: dd / N, pTimeout: timeout / N, evPerAccount };
}

const expectancyR = WIN * WIN_R - (1 - WIN) * LOSS_R;
console.log(`Prop challenge: $${ACCOUNT} · target +${TARGET * 100}% · maxDD ${MAX_DD * 100}% · dailyLoss ${DAILY_LOSS * 100}% · ${MAX_DAYS}d · ${TRADES_DAY} trades/day`);
console.log(`Trader edge: ${WIN * 100}% win, ${WIN_R}:${LOSS_R} RR → expectancy +${expectancyR.toFixed(2)}R/trade (a real but ordinary edge)`);
console.log(`Eval cost $${EVAL_COST}, payout-on-pass $${PAYOUT_ON_PASS}\n`);
console.log(`risk/trade   P(pass eval)  P(pass BOTH → paid)   EV per eval bought`);
let best = { evPerAccount: -1e9, riskFrac: 0, pPass: 0, pPaid: 0 };
for (const rf of [0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05]) {
  const r = evalRisk(rf);
  if (r.evPerAccount > best.evPerAccount) best = r;
  console.log(`  ${(rf * 100).toFixed(2)}%        ${(r.pPass * 100).toFixed(1)}%           ${(r.pPaid * 100).toFixed(1)}%              ${r.evPerAccount >= 0 ? "+" : ""}$${r.evPerAccount.toFixed(0)}`);
}
console.log(`\n★ OPTIMAL risk/trade ≈ ${(best.riskFrac * 100).toFixed(2)}% → P(paid) ${(best.pPaid * 100).toFixed(1)}%, EV +$${best.evPerAccount.toFixed(0)} per $${EVAL_COST} eval.`);
console.log(`  Same edge, WRONG size (5%/trade): P(paid) ${(evalRisk(0.05).pPaid * 100).toFixed(1)}% — the "itzjblair 23×" school mostly blows the account.`);

// zero-edge control: two hurdles, coinflip → this is the firm's real edge
function simCoin(riskFrac: number): boolean { let eq = ACCOUNT; const floor = ACCOUNT * (1 - MAX_DD); for (let d = 0; d < MAX_DAYS; d++) { let ds = eq; for (let t = 0; t < TRADES_DAY; t++) { const risk = riskFrac * ACCOUNT; eq += rnd() < 0.5 ? 1 * risk : -1 * risk; if (eq <= floor || eq <= ds - DAILY_LOSS * ACCOUNT) return false; if (eq >= ACCOUNT * (1 + TARGET)) return true; } } return false; }
let cp = 0; for (let i = 0; i < 20000; i++) if (simCoin(best.riskFrac) && simCoin(best.riskFrac)) cp++;
const coinEV = (cp / 20000) * SPLIT * PAYOUT_ON_PASS - EVAL_COST;
console.log(`  NO-edge control (coinflip, both hurdles) at optimal size: P(paid) ${(cp / 20000 * 100).toFixed(1)}% → EV ${coinEV >= 0 ? "+" : ""}$${coinEV.toFixed(0)}. Negative = why the FIRM profits (most buyers have no edge).`);
console.log(`\nVERDICT: prop-farming is +EV ONLY with (1) a real (even modest) edge AND (2) sizing optimized to pass.`);
console.log(`The edge gets you in the door; the RISK MODEL is what converts it to money — exactly the operator's point, made quantitative.`);
