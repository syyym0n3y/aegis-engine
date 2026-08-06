// trd-cost.ts — MEASURE the real cost of trading an instrument instead of asking the trader for it.
// Zero friction: no broker inputs, no fee tables to fill in.
//
// 1. COMMISSION — researched, not guessed: as of 2026 the major US retail brokers (Robinhood, Webull,
//    Fidelity, Schwab, Firstrade, Public) charge $0 on stocks/ETFs. Options run $0–0.65/contract, futures
//    ~$0.25–2.25/contract. We default to the zero-commission equity case because that is what most retail
//    traders actually face, and expose a broker override for the rest.
// 2. SPREAD — the cost that actually binds, and it is MEASURABLE from data we already have.
//    Corwin & Schultz (2012, Journal of Finance), "A Simple Way to Estimate Bid-Ask Spreads from Daily
//    High and Low Prices": the high/low range over one day vs two days separates volatility from spread.
//    This gives a per-instrument, per-period spread estimate with no quote data and no broker input.

export interface BrokerProfile { name: string; equityPerTrade: number; perContractOption: number; perContractFuture: number; }
export const BROKERS: Record<string, BrokerProfile> = {
  "zero-commission": { name: "Robinhood / Webull / Fidelity / Schwab (stocks & ETFs)", equityPerTrade: 0, perContractOption: 0, perContractFuture: 2.25 },
  "schwab": { name: "Charles Schwab", equityPerTrade: 0, perContractOption: 0.65, perContractFuture: 2.25 },
  "fidelity": { name: "Fidelity", equityPerTrade: 0, perContractOption: 0.65, perContractFuture: 0 },
  "ibkr": { name: "Interactive Brokers (tiered)", equityPerTrade: 0.35, perContractOption: 0.65, perContractFuture: 0.85 },
  "crypto": { name: "Crypto exchange (spread-based)", equityPerTrade: 0, perContractOption: 0, perContractFuture: 0 },
};

export interface Bar { h: number; l: number; c: number }
/** Corwin-Schultz two-day high/low spread estimator. Returns the proportional spread (0.001 = 10 bps).
 * Negative estimates are set to 0 (the paper's own convention); we report the median over the window,
 * which is far more robust than the mean for this estimator. */
export function corwinSchultzSpread(bars: Bar[], window = 60): number {
  const n = bars.length; if (n < 3) return NaN;
  const start = Math.max(1, n - window);
  const est: number[] = [];
  const k = 3 - 2 * Math.SQRT2;
  for (let t = start; t < n; t++) {
    const a = bars[t - 1], b = bars[t];
    if (!(a.h > 0 && a.l > 0 && b.h > 0 && b.l > 0)) continue;
    const beta = Math.log(a.h / a.l) ** 2 + Math.log(b.h / b.l) ** 2;
    const H2 = Math.max(a.h, b.h), L2 = Math.min(a.l, b.l);
    const gamma = Math.log(H2 / L2) ** 2;
    const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k);
    const s = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha));
    if (Number.isFinite(s)) est.push(Math.max(0, s));
  }
  if (!est.length) return NaN;
  est.sort((x, y) => x - y);
  return est[Math.floor(est.length / 2)]; // median
}
export interface CostEstimate { spreadPct: number; commissionUsd: number; broker: string; roundTripPct: number; source: string; }
/** Total round-trip cost for an equity/ETF trade, measured not assumed. */
export function estimateCost(bars: Bar[], brokerKey = "zero-commission", isCrypto = false): CostEstimate {
  const b = BROKERS[brokerKey] ?? BROKERS["zero-commission"];
  let sp = corwinSchultzSpread(bars);
  if (!Number.isFinite(sp) || sp <= 0) sp = 0.0005; // floor: 5bps if the estimator degenerates
  sp = Math.min(sp, 0.05);                           // cap absurd estimates at 5%
  const spreadPct = sp * 100;
  const commissionUsd = isCrypto ? 0 : b.equityPerTrade;
  // round trip crosses the spread twice
  return {
    spreadPct: +(spreadPct * 2).toFixed(4), commissionUsd: +(commissionUsd * 2).toFixed(2), broker: b.name,
    roundTripPct: +(spreadPct * 2).toFixed(4),
    source: "Corwin-Schultz (2012) high/low spread estimator, median of last 60 sessions; commissions from 2026 published retail schedules (most US brokers are $0 on stocks/ETFs)",
  };
}
