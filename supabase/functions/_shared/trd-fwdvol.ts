// trd-fwdvol.ts — UNIFIED forward-vol forecast → one de-risk, replacing the triple-counting of multiplying
// separate vol/GEX/VIX-term reducers (D-134). Fitted OLS on 15y aligned SqueezeMetrics ∩ VIX ∩ VIX3M
// (n=3568): each predictor is jointly significant (trailingRV t=26.9, GEXpctile t=−6.6, VIXterm t=20.3), so
// all three carry independent forward-vol information — but they CORRELATE in stress, so the honest way to
// size is one combined forecast, not a product of three. deRisk = min(1, medianFwdVol / forecast): full size
// in calm, shrink proportionally as predicted vol rises, never levers up. SIZING only, direction-agnostic.

// Coefficients (annualized vol; trailingRV annualized, gexPct∈[0,1], vixTerm = VIX/VIX3M):
const B0 = -0.3347, B_RV = 0.4288, B_GEX = -0.0342, B_VIX = 0.4776;
const MEDIAN_FWD_VOL = 0.1338; // the de-risk reference (calm baseline)
const VOL_FLOOR = 0.03;

export function forwardVolForecast(trailingRVann: number, gexPct: number, vixTerm: number): number {
  const f = B0 + B_RV * trailingRVann + B_GEX * gexPct + B_VIX * vixTerm;
  return Math.max(VOL_FLOOR, f);
}

export interface FwdVolDeRisk { forecastVolPct: number; deRisk: number; }
/** trailingRVann = annualized trailing realized vol; gexPct∈[0,1] (1=high-gamma/calm); vixTerm=VIX/VIX3M
 * (>1 = backwardation/stress). Any input NaN → that term drops to a neutral default (fail-open, never <). */
export function fwdVolDeRisk(trailingRVann: number, gexPct: number, vixTerm: number, ref = MEDIAN_FWD_VOL): FwdVolDeRisk {
  const rv = Number.isFinite(trailingRVann) ? trailingRVann : ref;
  const gp = Number.isFinite(gexPct) ? gexPct : 0.5;
  const vt = Number.isFinite(vixTerm) ? vixTerm : 0.9;
  const forecast = forwardVolForecast(rv, gp, vt);
  return { forecastVolPct: +(forecast * 100).toFixed(1), deRisk: +Math.min(1, ref / forecast).toFixed(3) };
}
