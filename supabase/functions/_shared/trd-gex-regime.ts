// trd-gex-regime.ts — GEX as a forward-VOL / SIZING signal (pure, offline-testable). D-131/D-132: on 15y of
// free SqueezeMetrics GEX, low-gamma days run ~2× the forward realized vol of high-gamma days, and this
// SURVIVES controlling for trailing realized vol (OLS GEX t-stat −14.1) — so it adds information the D-100
// trailing-RV primitive does not. This maps the current GEX's percentile (vs its own trailing history) to an
// expected forward vol and a de-risk multiplier, EXACTLY like volRegimeDeRisk: shrink size when the regime
// predicts higher vol, never lever up. Direction-agnostic (GEX does NOT predict direction — D-131(B) failed).

export interface GexRegime {
  percentile: number; regime: "low-gamma" | "mid" | "high-gamma";
  expectedFwdVolPct: number; deRisk: number;
}

// Empirical fwd-5d realized-vol curve by GEX percentile, fitted on 15y (D-131): p=0→19.4%, 0.5→12.5%, 1→9.5%.
// refVolPct = the median regime's expected vol (12) → deRisk = min(1, ref/expected): ~0.62 in low-gamma, 1.0 high.
export function gexRegime(currentGex: number, trailingGex: number[], refVolPct = 12): GexRegime {
  const sorted = [...trailingGex].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let rank = 0; while (rank < sorted.length && sorted[rank] < currentGex) rank++;
  const p = sorted.length ? rank / sorted.length : 0.5;
  const expVol = p <= 0.5 ? 19.4 + (12.5 - 19.4) * (p / 0.5) : 12.5 + (9.5 - 12.5) * ((p - 0.5) / 0.5);
  const regime = p <= 1 / 3 ? "low-gamma" : p >= 2 / 3 ? "high-gamma" : "mid";
  const deRisk = Math.min(1, refVolPct / expVol);
  return { percentile: +p.toFixed(3), regime, expectedFwdVolPct: +expVol.toFixed(1), deRisk: +deRisk.toFixed(3) };
}
