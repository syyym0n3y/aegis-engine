// sizing.ts (D-365) — the EXECUTION-INTELLIGENCE layer. Turns a verified edge's statistics into the concrete trade plan:
// how much leverage (growth-optimal, de-risked), how many positions (breadth), how much equity at risk per trade, how many
// shares/lots, and how long to hold. Deterministic finance — NO LLM in this path (invariant). Every function is pure and
// unit-tested (deno test _shared). The GOLDEN RULE encoded here: size to the edge you can PROVE, fractionally, vol-targeted
// — never full-Kelly (parameter uncertainty ruins full-Kelly), never un-capped by liquidity.

// ---- growth-optimal leverage ---------------------------------------------------------------------------------------
// Full-Kelly leverage for a strategy with annualized Sharpe S and vol σ is f* = μ/σ² = S/σ. Full Kelly is too aggressive
// under parameter uncertainty (a mis-estimated edge blows up), so we ALWAYS apply a fraction (0.25–0.5 = "quarter/half Kelly").
export function kellyLeverage(annSharpe: number, annVol: number, kellyFraction = 0.25): number {
  if (!(annVol > 0) || !Number.isFinite(annSharpe)) return 0;
  return Math.max(0, (annSharpe / annVol) * kellyFraction);
}

// vol-target leverage: scale gross exposure so the portfolio realizes a target annual vol (e.g. 0.10). L = targetVol/σ.
export function volTargetLeverage(strategyAnnVol: number, targetAnnVol = 0.10, capLeverage = 3): number {
  if (!(strategyAnnVol > 0)) return 0;
  return Math.min(capLeverage, targetAnnVol / strategyAnnVol);
}

// The applied leverage is the MORE CONSERVATIVE of fractional-Kelly and vol-target — never exceed either guardrail.
export function appliedLeverage(annSharpe: number, annVol: number, opts?: { kellyFraction?: number; targetAnnVol?: number; capLeverage?: number }): number {
  const k = kellyLeverage(annSharpe, annVol, opts?.kellyFraction ?? 0.25);
  const v = volTargetLeverage(annVol, opts?.targetAnnVol ?? 0.10, opts?.capLeverage ?? 3);
  return +Math.min(k, v).toFixed(3);
}

// ---- per-trade position size (risk-based) --------------------------------------------------------------------------
// Given equity E, fractional risk-per-trade ρ (e.g. 0.005 = 0.5% of equity at risk if the stop is hit), and the entry/stop
// prices, the shares are sized so a stop-out loses exactly E·ρ. Returns whole shares + the resulting $ exposure and $ risk.
export function positionSize(equity: number, riskPerTrade: number, entryPx: number, stopPx: number): { shares: number; dollar_exposure: number; dollar_risk: number; risk_per_share: number } {
  const rps = Math.abs(entryPx - stopPx);
  if (!(equity > 0) || !(riskPerTrade > 0) || !(entryPx > 0) || !(rps > 0)) return { shares: 0, dollar_exposure: 0, dollar_risk: 0, risk_per_share: rps };
  const shares = Math.floor((equity * riskPerTrade) / rps);
  return { shares, dollar_exposure: +(shares * entryPx).toFixed(2), dollar_risk: +(shares * rps).toFixed(2), risk_per_share: +rps.toFixed(4) };
}

// ---- breadth: how many positions ----------------------------------------------------------------------------------
// Fundamental Law of Active Management: IR = IC · √breadth. To reach a target information ratio given the measured IC, you
// need breadth = (IR/IC)² independent bets. This is WHY a tiny IC still needs a wide book — and why thin universes can't pay.
export function breadthForIR(targetIR: number, ic: number): number {
  if (!(Math.abs(ic) > 0)) return Infinity;
  return Math.ceil((targetIR / ic) ** 2);
}

// portfolio vol of N equal-weight names each with vol σ and average pairwise correlation ρ:
//   σ_p = σ · √( (1 + (N-1)ρ) / N ). Diversification floor is σ·√ρ (can't diversify below the common factor).
export function portfolioVol(nameVol: number, n: number, avgCorr: number): number {
  if (!(n >= 1) || !(nameVol > 0)) return 0;
  return +(nameVol * Math.sqrt((1 + (n - 1) * avgCorr) / n)).toFixed(4);
}

// smallest N whose equal-weight portfolio vol ≤ targetVol (given name vol + correlation); Infinity if the corr floor is above target
export function positionsForTargetVol(nameVol: number, avgCorr: number, targetVol: number, cap = 500): number {
  if (nameVol * Math.sqrt(Math.max(0, avgCorr)) > targetVol) return Infinity; // correlation floor above target — unreachable
  for (let n = 1; n <= cap; n++) if (portfolioVol(nameVol, n, avgCorr) <= targetVol) return n;
  return cap;
}

// ---- hold period: match the signal's decay ------------------------------------------------------------------------
// Given the lag-1 autocorrelation φ of the signal (per period), the half-life is ln(0.5)/ln(φ). Hold ≈ the half-life: past
// it the edge has decayed and you are paying cost for nothing. φ→1 = slow factor (value, hold months); φ small = fast (reversal).
export function signalHalfLife(autocorrLag1: number): number {
  const phi = Math.min(0.999, Math.max(1e-6, autocorrLag1));
  return +(Math.log(0.5) / Math.log(phi)).toFixed(2);
}

// ---- the full plan ------------------------------------------------------------------------------------------------
// One call: from a verified edge's stats → the complete deployment plan. Only meaningful for an edge that CLEARED the gate;
// feeding it an unverified edge is the caller's error (garbage in, garbage out) — the honest contract is "size what you proved".
export interface EdgeStats { annSharpe: number; annVol: number; ic: number; nameVol: number; avgCorr: number; signalAutocorr: number; periodsPerYear: number; }
export interface SizingPlan { applied_leverage: number; target_positions: number; hold_periods: number; hold_note: string; per_trade: { risk_per_trade_pct: number; example_shares: number; example_dollar_risk: number } | null; caveat: string; }
export function deploymentPlan(edge: EdgeStats, equity: number, targetIR = 1.0, targetAnnVol = 0.10, riskPerTrade = 0.005, example?: { entryPx: number; stopPx: number }): SizingPlan {
  const lev = appliedLeverage(edge.annSharpe, edge.annVol, { targetAnnVol });
  const byIR = breadthForIR(targetIR, edge.ic);
  const byVol = positionsForTargetVol(edge.nameVol, edge.avgCorr, targetAnnVol);
  const positions = Number.isFinite(byIR) ? Math.max(byIR, Number.isFinite(byVol) ? byVol : 0) : (Number.isFinite(byVol) ? byVol : Infinity);
  const hl = signalHalfLife(edge.signalAutocorr);
  const per = example ? positionSize(equity, riskPerTrade, example.entryPx, example.stopPx) : null;
  return {
    applied_leverage: lev,
    target_positions: Number.isFinite(positions) ? positions : -1,
    hold_periods: hl,
    hold_note: `~${hl} periods (${(hl / edge.periodsPerYear).toFixed(2)} yr) to the signal half-life`,
    per_trade: per ? { risk_per_trade_pct: riskPerTrade * 100, example_shares: per.shares, example_dollar_risk: per.dollar_risk } : null,
    caveat: "Valid ONLY for an edge that cleared deflation+cost. Leverage is min(¼-Kelly, vol-target); positions from IR=IC·√breadth AND the vol target; sizing is deterministic (no LLM in the order path).",
  };
}
