// trd-decision.ts — the BUY/SELL + HOW-MUCH-RISK engine (pure, tested). This is the honest synthesis of
// everything that survived: ONE signal cleared every gate incl. Rule 7 (dip-buy: RSI14<30 while price>200MA
// — +0.122R vs random −0.051R, t=5.63; OOS t=3.92; 16/21 instruments; beats random in calm/normal/stress),
// sized by the forward-vol engine. Everything else was regime drift and must NOT produce a BUY/SELL.
//
// HOUSE-MONEY (operator's rule): after the first profitable trade, risk is drawn from banked profit so the
// original deposit is never exposed again. We implement it as a two-tier risk budget:
//   • baseRisk on the ORIGINAL capital (conservative, survival-first)
//   • plus a share of BANKED PROFIT ("house money") that may be risked more freely
// Total risk still passes through the vol de-risk and can never exceed maxRiskPct of equity.

export type Action = "BUY" | "SELL" | "STAND_ASIDE";
export interface DecisionInput {
  rsi14: number; price: number; sma200: number;      // the survivor's signal inputs
  deRisk: number;                                     // forward-vol sizing multiplier (≤1) from the vol engine
  equity: number; originalDeposit: number;            // for house-money accounting
  stopDistancePct: number;                            // stop distance as % of price (from ATR)
  baseRiskPct?: number;                               // % of ORIGINAL capital per trade (default 0.5%)
  houseRiskPct?: number;                              // % of BANKED PROFIT per trade (default 2%)
  maxRiskPct?: number;                                // hard cap vs equity (default 2%)
}
export interface Decision {
  action: Action; reason: string;
  riskAmount: number; riskPctOfEquity: number; positionSize: number; positionNotional: number;
  bankedProfit: number; houseMoneyActive: boolean; capitalAtRisk: string;
  depositAtRisk: number; houseMoneyAtRisk: number;
  survivalNote: string;
}

export function decide(inp: DecisionInput): Decision {
  const baseRiskPct = inp.baseRiskPct ?? 0.005, houseRiskPct = inp.houseRiskPct ?? 0.02, maxRiskPct = inp.maxRiskPct ?? 0.02;
  const banked = Math.max(0, inp.equity - inp.originalDeposit);
  const houseActive = banked > 0;
  // ── SIGNAL: only the Rule-7 survivor may trigger. No other pattern produces a directional call. ──
  let action: Action = "STAND_ASIDE";
  let reason = "no verified setup — the only signal that beat a random-entry control is dip-buy (RSI14<30 while price>200MA); nothing else fires";
  const uptrend = inp.price > inp.sma200;
  if (uptrend && inp.rsi14 < 30) { action = "BUY"; reason = `dip-buy fired: RSI14 ${inp.rsi14.toFixed(1)}<30 within an uptrend (price>200MA). Verified vs random: +0.122R vs −0.051R, t=5.63; holds OOS and in all 3 VIX regimes.`; }
  else if (uptrend) reason = `uptrend but RSI14 ${inp.rsi14.toFixed(1)} not oversold (<30) — no verified entry`;
  else reason = `price below 200MA — the verified signal requires an uptrend. NOTE: no SHORT setup ever beat a random control (D-146), so this engine never issues SELL as an entry.`;

  // ── RISK: two-tier house-money budget, then vol de-risk, then hard cap ──
  const deRisk = Number.isFinite(inp.deRisk) ? Math.max(0, Math.min(1, inp.deRisk)) : 1;
  const rawRisk = inp.originalDeposit * baseRiskPct + banked * houseRiskPct;
  const capped = Math.min(rawRisk * deRisk, inp.equity * maxRiskPct);
  const riskAmount = action === "STAND_ASIDE" ? 0 : Math.max(0, capped);
  const stopFrac = Math.max(1e-6, inp.stopDistancePct / 100);
  const positionNotional = riskAmount / stopFrac;
  const positionSize = inp.price > 0 ? positionNotional / inp.price : 0;
  // split the (possibly capped) risk into its deposit-funded vs house-money-funded parts, pro-rata
  const depositPortionRaw = inp.originalDeposit * baseRiskPct, housePortionRaw = banked * houseRiskPct;
  const rawTotal = depositPortionRaw + housePortionRaw;
  const scale = rawTotal > 0 ? riskAmount / rawTotal : 0;
  const depositRisk = depositPortionRaw * scale, houseRisk = housePortionRaw * scale;
  const housePct = riskAmount > 0 ? houseRisk / riskAmount * 100 : 0;
  return {
    action, reason,
    riskAmount: +riskAmount.toFixed(2), riskPctOfEquity: +(inp.equity > 0 ? riskAmount / inp.equity * 100 : 0).toFixed(3),
    positionSize: +positionSize.toFixed(4), positionNotional: +positionNotional.toFixed(2),
    bankedProfit: +banked.toFixed(2), houseMoneyActive: houseActive,
    depositAtRisk: +depositRisk.toFixed(2), houseMoneyAtRisk: +houseRisk.toFixed(2),
    capitalAtRisk: houseActive
      ? `${housePct.toFixed(0)}% of this trade's risk ($${houseRisk.toFixed(2)}) is banked PROFIT (house money); only $${depositRisk.toFixed(2)} (${(depositRisk / inp.originalDeposit * 100).toFixed(2)}% of the original deposit) is deposit capital`
      : `no banked profit yet — 100% of risk ($${riskAmount.toFixed(2)}) is original deposit, held to ${(baseRiskPct * 100).toFixed(2)}% × de-risk`,
    survivalNote: `At ${(riskAmount / (inp.equity || 1) * 100).toFixed(2)}% risk/trade, ${Math.floor(Math.log(0.5) / Math.log(1 - (riskAmount / (inp.equity || 1)) || 1e-9))} consecutive full-stop losses would be needed to halve the account.`,
  };
}
