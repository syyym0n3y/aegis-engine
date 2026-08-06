// trd-smile.ts — the two OPTIONS-based survivors of the 212-predictor test (D-159), implemented exactly as
// the papers define them, from FREE CBOE delayed chains (pure + testable).
//
//  • SmileSlope — Yan (2011, JFE), orig t=8.168, sign −1 (HIGH slope → LOW future returns).
//      "difference between put implied vol and call implied vol at delta = ±0.50, 30 days to expiration".
//      We interpolate to |delta|=0.50 and 30 DTE from the live chain.
//  • CPVolSpread — Bali & Hovakimian (2009), orig t=4.2, sign +1: ATM call vol − ATM put vol.
//      dCPVolSpread (An/Ang/Bali/Cakici 2014, t=6.77) is its MONTHLY CHANGE, so it needs two snapshots —
//      which is why history must be accumulated before it can be tested.
//
// Only 7 of 212 published predictors were still alive at t>3 since 2015 (D-159); these are 2 of those 7.
// They are UNTESTED BY US — no free historical chain exists, so the honest path is to compute them now and
// accumulate the series forward. Nothing here is a trading signal until it clears our gates.

export interface OptQuote { option: string; iv: number; delta: number; }
export interface SmileResult {
  smileSlope: number | null;   // putIV − callIV at |delta|≈0.5, ~30 DTE  (Yan)
  cpVolSpread: number | null;  // callIV − putIV at the same point       (Bali-Hovakimian)
  callIv: number | null; putIv: number | null; dteUsed: number | null; contracts: number;
}
function parseOcc(sym: string): { type: "C" | "P"; dte: number } | null {
  const m = sym.match(/^[A-Z]+?(\d{6})([CP])(\d{8})$/); if (!m) return null;
  const y = 2000 + +m[1].slice(0, 2), mo = +m[1].slice(2, 4) - 1, d = +m[1].slice(4, 6);
  return { type: m[2] as "C" | "P", dte: (Date.UTC(y, mo, d) - Date.now()) / 86400000 };
}
/** Interpolate the IV at |delta| = 0.50 within one expiry, then interpolate across the two expiries
 * bracketing 30 DTE. Falls back to the nearest available expiry when only one side is usable. */
export function smileSlope(quotes: OptQuote[], targetDte = 30, targetDelta = 0.5): SmileResult {
  const byExp = new Map<number, { calls: OptQuote[]; puts: OptQuote[] }>();
  let used = 0;
  for (const q of quotes) {
    const p = parseOcc(q.option); if (!p || !(p.dte > 1) || !(q.iv > 0) || q.delta == null) continue;
    const key = Math.round(p.dte); const e = byExp.get(key) ?? { calls: [], puts: [] }; byExp.set(key, e);
    (p.type === "C" ? e.calls : e.puts).push(q); used++;
  }
  // IV at |delta|=0.5 within one expiry, by linear interpolation on delta
  const ivAtDelta = (arr: OptQuote[], want: number): number | null => {
    const pts = arr.filter((q) => Number.isFinite(q.delta) && q.iv > 0).map((q) => ({ d: Math.abs(q.delta), iv: q.iv })).sort((a, b) => a.d - b.d);
    if (pts.length < 2) return null;
    if (want <= pts[0].d) return pts[0].iv;
    if (want >= pts[pts.length - 1].d) return pts[pts.length - 1].iv;
    for (let i = 1; i < pts.length; i++) if (want <= pts[i].d) { const a = pts[i - 1], b = pts[i]; return b.d > a.d ? a.iv + (b.iv - a.iv) * (want - a.d) / (b.d - a.d) : a.iv; }
    return null;
  };
  const exps = [...byExp.entries()].filter(([, v]) => v.calls.length >= 2 && v.puts.length >= 2).sort((a, b) => a[0] - b[0]);
  if (!exps.length) return { smileSlope: null, cpVolSpread: null, callIv: null, putIv: null, dteUsed: null, contracts: used };
  // pick the expiry closest to targetDte
  let best = exps[0]; for (const e of exps) if (Math.abs(e[0] - targetDte) < Math.abs(best[0] - targetDte)) best = e;
  const c = ivAtDelta(best[1].calls, targetDelta), p = ivAtDelta(best[1].puts, targetDelta);
  if (c == null || p == null) return { smileSlope: null, cpVolSpread: null, callIv: c, putIv: p, dteUsed: best[0], contracts: used };
  return { smileSlope: +(p - c).toFixed(5), cpVolSpread: +(c - p).toFixed(5), callIv: +c.toFixed(5), putIv: +p.toFixed(5), dteUsed: best[0], contracts: used };
}
