// trd-asset-vol.ts — HORIZONTAL forward-vol sizing: each asset class sized by its OWN implied-vol index,
// which the D-135 screen proved adds significant forward-vol value (often DOMINATING trailing RV — gold GVZ
// t=27.7 vs RV t=1.8). Per-asset OLS coefficients fitted on full free Yahoo history (fwdVol = b0 + bRV·RVann
// + bIV·IV). deRisk = min(1, ref/forecast): full size in calm, shrink as predicted vol rises, never levers.
// Direction-agnostic sizing. IV missing → caller should fall back to the plain vol-regime primitive.

export interface AssetVolModel { ivSymbol: string; b0: number; bRV: number; bIV: number; ref: number; }
// Fitted (D-135, scripts/trd-horizontal-vol.ts). Each entry's IV-index t-stat was > 13 (all KEEP).
export const ASSET_VOL_MODELS: Record<string, AssetVolModel> = {
  TLT: { ivSymbol: "^MOVE", b0: 0.0238, bRV: 0.5354, bIV: 0.038, ref: 0.1287 },
  GLD: { ivSymbol: "^GVZ", b0: -0.0064, bRV: 0.0477, bIV: 0.8065, ref: 0.1539 },
  USO: { ivSymbol: "^OVX", b0: 0.0035, bRV: 0.0953, bIV: 0.7208, ref: 0.3176 },
  QQQ: { ivSymbol: "^VXN", b0: -0.017, bRV: 0.154, bIV: 0.7424, ref: 0.2012 },
  SPY: { ivSymbol: "^VIX", b0: -0.0485, bRV: 0.0667, bIV: 0.9656, ref: 0.1506 },
};
const VOL_FLOOR = 0.03;

export interface AssetDeRisk { forecastVolPct: number; deRisk: number; model: string; }
/** asset ∈ ASSET_VOL_MODELS; trailingRVann = annualized trailing realized vol; ivLevel = the implied-vol
 * index as a FRACTION (e.g. GVZ 25.6 → 0.256). Returns deRisk≤1. Unknown asset or NaN inputs → no-op (1). */
export function assetFwdVolDeRisk(asset: string, trailingRVann: number, ivLevel: number): AssetDeRisk {
  const m = ASSET_VOL_MODELS[asset];
  if (!m || !Number.isFinite(ivLevel) || !Number.isFinite(trailingRVann)) return { forecastVolPct: NaN, deRisk: 1, model: "none" };
  const forecast = Math.max(VOL_FLOOR, m.b0 + m.bRV * trailingRVann + m.bIV * ivLevel);
  return { forecastVolPct: +(forecast * 100).toFixed(1), deRisk: +Math.min(1, m.ref / forecast).toFixed(3), model: m.ivSymbol };
}
