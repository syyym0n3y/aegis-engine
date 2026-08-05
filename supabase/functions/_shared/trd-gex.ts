// trd-gex.ts — dealer Gamma-Exposure engine (pure, offline-testable). Reproduces SpotGamma's core outputs
// from any options chain carrying (strike, type, IV, OI, DTE): net-GEX regime, call/put walls, and a PROPER
// gamma flip computed by repricing gamma via Black-Scholes across candidate spots (not a cum-zero-cross
// approximation). Convention (SpotGamma baseline): dealers long calls / short puts →
// netGEX = Σcalls γ·OI·100·S²·0.01 − Σputs γ·OI·100·S²·0.01. GEX is AWARENESS context, not a backtested edge.

export interface OptContract { strike: number; type: "C" | "P"; iv: number; oi: number; dte: number; }
export interface GexProfile {
  spot: number; totalGEX: number; regime: "positive" | "negative";
  callWall: { strike: number; gex: number }; putWall: { strike: number; gex: number };
  gammaFlip: number | null; byStrike: { strike: number; gex: number }[];
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
export function normPdf(x: number): number { return Math.exp(-0.5 * x * x) / SQRT2PI; }

/** Black-Scholes gamma (same for calls & puts). Returns 0 on degenerate inputs. */
export function bsGamma(S: number, K: number, sigma: number, T: number, r = 0.04): number {
  if (!(S > 0 && K > 0 && sigma > 0 && T > 0)) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normPdf(d1) / (S * sigma * Math.sqrt(T));
}

/** Net dealer GEX at a candidate spot S (repricing every contract's gamma at S). */
export function netGexAt(contracts: OptContract[], S: number): number {
  let sum = 0;
  for (const c of contracts) {
    if (!(c.oi > 0) || !(c.iv > 0) || !(c.dte > 0)) continue;
    const g = bsGamma(S, c.strike, c.iv, c.dte / 365);
    sum += (c.type === "C" ? 1 : -1) * g * c.oi * 100 * S * S * 0.01;
  }
  return sum;
}

/** Build the full dealer-GEX profile. `flipSteps` samples spot in [0.8,1.2]·spot for the flip root. */
export function buildGexProfile(contracts: OptContract[], spot: number, flipSteps = 240): GexProfile {
  const byStrikeMap = new Map<number, number>();
  for (const c of contracts) {
    if (!(c.oi > 0) || !(c.iv > 0) || !(c.dte > 0)) continue;
    const g = bsGamma(spot, c.strike, c.iv, c.dte / 365);
    const gex = (c.type === "C" ? 1 : -1) * g * c.oi * 100 * spot * spot * 0.01;
    byStrikeMap.set(c.strike, (byStrikeMap.get(c.strike) ?? 0) + gex);
  }
  const byStrike = [...byStrikeMap.entries()].map(([strike, gex]) => ({ strike, gex })).sort((a, b) => a.strike - b.strike);
  const totalGEX = netGexAt(contracts, spot);
  let callWall = byStrike[0] ?? { strike: spot, gex: 0 };
  let putWall = byStrike[0] ?? { strike: spot, gex: 0 };
  for (const s of byStrike) { if (s.gex > callWall.gex) callWall = s; if (s.gex < putWall.gex) putWall = s; }
  // gamma flip: scan spot candidates, find the sign-change closest to current spot
  let gammaFlip: number | null = null, bestDist = Infinity, prevS = spot * 0.8, prevV = netGexAt(contracts, prevS);
  for (let i = 1; i <= flipSteps; i++) {
    const S = spot * 0.8 + (spot * 0.4) * (i / flipSteps); const V = netGexAt(contracts, S);
    if ((prevV < 0 && V >= 0) || (prevV > 0 && V <= 0)) {
      const cross = prevS + (S - prevS) * Math.abs(prevV) / (Math.abs(prevV) + Math.abs(V) || 1);
      const dist = Math.abs(cross - spot); if (dist < bestDist) { bestDist = dist; gammaFlip = +cross.toFixed(2); }
    }
    prevS = S; prevV = V;
  }
  return { spot, totalGEX, regime: totalGEX >= 0 ? "positive" : "negative", callWall, putWall, gammaFlip, byStrike };
}
