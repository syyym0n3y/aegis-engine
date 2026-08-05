#!/usr/bin/env -S deno run --allow-net
// trd-gex-levels — FREE reproduction of SpotGamma's core outputs: dealer gamma-exposure (GEX) levels from
// the CBOE free delayed options chain (gamma+OI+IV provided directly — no Black-Scholes, no paid feed).
// Surfaces the levels the operator asked for: total-GEX regime (vol-suppression vs amplification), the
// GAMMA FLIP (where dealers switch from dampening to amplifying), the CALL WALL (dealer resistance) and
// PUT WALL (dealer support). Convention (SpotGamma baseline): dealers long calls / short puts →
// netGEX_strike = Σcalls γ·OI·100·S²·0.01 − Σputs γ·OI·100·S²·0.01. Per ANALYSIS_CONTRACT: this is an
// AWARENESS level engine (context, not a backtested edge) — labelled as such; OI is EOD-lagged (stated).
const SYMS = ["SPY", "_SPX"];
const MAX_DTE = 45; // nearby expirations carry the dealer-hedging weight

function parse(sym: string): { type: "C" | "P"; strike: number; exp: string } | null {
  const m = sym.match(/^[A-Z]+?(\d{6})([CP])(\d{8})$/); if (!m) return null;
  return { exp: m[1], type: m[2] as "C" | "P", strike: +m[3] / 1000 };
}
function dte(exp: string): number { const y = 2000 + +exp.slice(0,2), mo = +exp.slice(2,4)-1, d = +exp.slice(4,6); return (Date.UTC(y,mo,d) - Date.now()) / 86400000; }

for (const sym of SYMS) {
  const r = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) { console.log(`${sym}: HTTP ${r.status}`); continue; }
  const j = await r.json(); const d = j.data; const S = d?.current_price ?? d?.close; const opts = d?.options ?? [];
  const byStrike = new Map<number, number>(); let total = 0, callOI = 0, putOI = 0;
  const scale = S * S * 0.01 * 100;
  for (const o of opts) {
    const p = parse(o.option); if (!p) continue; const dt = dte(p.exp); if (dt < 0 || dt > MAX_DTE) continue;
    const oi = o.open_interest ?? 0, g = o.gamma ?? 0; if (!(oi > 0) || !(g > 0)) continue;
    const gex = (p.type === "C" ? 1 : -1) * g * oi * scale;
    byStrike.set(p.strike, (byStrike.get(p.strike) ?? 0) + gex); total += gex;
    if (p.type === "C") callOI += oi; else putOI += oi;
  }
  const strikes = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  // call wall = max positive net GEX; put wall = min (most negative)
  const callWall = strikes.reduce((m, x) => x[1] > m[1] ? x : m, strikes[0]);
  const putWall = strikes.reduce((m, x) => x[1] < m[1] ? x : m, strikes[0]);
  // gamma flip: spot level where cumulative net GEX (from low strikes up) crosses zero — the regime boundary
  let cum = 0, flip = NaN, prev = 0;
  for (const [k, v] of strikes) { cum += v; if (prev < 0 && cum >= 0 || prev > 0 && cum <= 0) { flip = k; } prev = cum; }
  const name = sym.replace("_", "");
  console.log(`\n════ ${name} — dealer GEX levels (CBOE free, ≤${MAX_DTE}DTE, spot ${S}) ════`);
  console.log(`  REGIME: net GEX ${(total/1e9).toFixed(2)}B → ${total >= 0 ? "POSITIVE (dealers dampen moves — vol suppressed, mean-revert to POC)" : "NEGATIVE (dealers amplify — vol expansion, trend/breakout risk)"}`);
  console.log(`  CALL WALL (dealer resistance / pin up): ${callWall[0]}   (net GEX ${(callWall[1]/1e9).toFixed(2)}B)`);
  console.log(`  PUT WALL  (dealer support / pin down):  ${putWall[0]}   (net GEX ${(putWall[1]/1e9).toFixed(2)}B)`);
  console.log(`  GAMMA FLIP (regime boundary): ${Number.isFinite(flip) ? flip : "n/a"}   ${Number.isFinite(flip) ? (S > flip ? "spot ABOVE flip = positive-gamma/stable" : "spot BELOW flip = negative-gamma/unstable") : ""}`);
  console.log(`  put/call OI ratio: ${(putOI/callOI).toFixed(2)}`);
}
console.log(`\nAWARENESS layer (not a backtested edge): reproduces SpotGamma's daily levels FREE. Caveat: OI is EOD-lagged (OCC); dealer-side is the standard long-call/short-put assumption. These are the "where market makers hedge" levels for the co-pilot's auction-market context.`);
