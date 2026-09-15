// D-920 Part B — the leverage-confidence frontier: at what point can we CONFIDENTLY lever, and what timeline does it buy?
// The decomposition (Part A) says timing the residual is hopeless (ACF~0), so the honest lever on the 149-year path is
// LEVERAGE x STAKE on a modest-but-real Sharpe, NOT a bigger edge. This Monte-Carlos levered lognormal wealth at a range
// of Sharpes and leverages, reporting geometric growth, the DRAWDOWN DISTRIBUTION (median + P95 worst), and the
// years-to-£1M distribution from realistic stakes. 'Confident' = the leverage whose P95 drawdown stays survivable.
// NOT a forward return claim — it maps an ASSUMED Sharpe to a timeline (DESCRIPTIVE).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("leverage-frontier", [
  { name: "VOL", def: "0.20", note: "annualized vol of the underlying book" },
  { name: "RF", def: "0.0175", note: "realized cash rate (D-913: avg 3m T-bill 1.75%)" },
  { name: "STAKES", def: "10000,100000,250000", note: "£ starting stakes" },
  { name: "TARGET", def: "1000000" }, { name: "PATHS", def: "4000" }, { name: "YEARS_CAP", def: "60" }, { name: "SEED", def: "20260915" },
  { name: "SHARPES", def: "0.40,0.83,1.00,1.30", note: "0.40 market, 0.83 best-measured-holdable (VIX overlay D-872), 1.0, 1.3" },
  { name: "RUN_ID", def: "D-920-driver-variance-decomposition" },
]);
let seed = +K.SEED >>> 0; const u = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const z = () => { let s = 0; for (let i = 0; i < 12; i++) s += u(); return s - 6; }; // ~N(0,1)
const VOL = +K.VOL, RF = +K.RF, TARGET = +K.TARGET, PATHS = +K.PATHS, D = 252, CAP = +K.YEARS_CAP * D;
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const med = (a: number[]) => pct(a, 50);
function sim(S: number, L: number, stake: number) {
  const muX = S * VOL; // excess arithmetic mean of the book
  const md = (RF + L * muX) / D, sd = L * VOL / Math.sqrt(D); // levered daily mean/sd (borrow at RF)
  const dds: number[] = [], yrs: number[] = []; let ruined = 0;
  for (let p = 0; p < PATHS; p++) {
    let w = stake, peak = stake, maxdd = 0, hit = -1;
    for (let t = 0; t < CAP; t++) {
      w *= Math.exp(md - sd * sd / 2 + sd * z());
      if (w > peak) peak = w; const dd = 1 - w / peak; if (dd > maxdd) maxdd = dd;
      if (w >= TARGET && hit < 0) hit = t;
      if (w < stake * 0.02) { ruined++; break; } // -98% = practical ruin
    }
    dds.push(maxdd); if (hit >= 0) yrs.push(hit / D);
  }
  const g = RF + L * muX - (L * VOL) ** 2 / 2; // theoretical geometric growth
  return { g, ddMed: med(dds), dd95: pct(dds, 95), yrMed: yrs.length ? med(yrs) : Infinity, yrP25: yrs.length ? pct(yrs, 25) : Infinity, yrP75: yrs.length ? pct(yrs, 75) : Infinity, reach: yrs.length / PATHS, ruin: ruined / PATHS };
}
console.log(`==> D-920 Part B — LEVERAGE-CONFIDENCE FRONTIER (DESCRIPTIVE; assumes the stated Sharpe, not a measured forward result)`);
console.log(`  book vol ${(VOL*100).toFixed(0)}%/yr, cash ${(RF*100).toFixed(2)}%, target £${(TARGET/1e6).toFixed(1)}M, ${PATHS} Monte-Carlo paths, ${K.YEARS_CAP}y cap\n`);
for (const S of K.SHARPES.split(",").map(Number)) {
  const Lfull = S / VOL; // full-Kelly leverage
  const levs: [string, number][] = [["1x (unlevered)", 1], ["2x", 2], [`½-Kelly ${(Lfull/2).toFixed(1)}x`, Lfull / 2], [`full-Kelly ${Lfull.toFixed(1)}x`, Lfull]];
  console.log(`  ── Sharpe ${S.toFixed(2)}  (full-Kelly = ${Lfull.toFixed(1)}x; growth peaks there then FALLS) ──`);
  console.log(`     ${"leverage".padEnd(16)} ${"g/yr".padStart(6)} ${"medDD".padStart(6)} ${"P95DD".padStart(6)} ${"reach%".padStart(6)}  ${"yrs→£1M (P25–med–P75) from £10k".padStart(34)}`);
  for (const [nm, L] of levs) {
    const r = sim(S, L, 10000);
    const yy = r.yrMed === Infinity ? "never" : `${r.yrP25.toFixed(0)}–${r.yrMed.toFixed(0)}–${r.yrP75.toFixed(0)}`;
    const flag = r.dd95 > 0.6 ? " ⚠DD" : ""; const ruin = r.ruin > 0.01 ? ` ruin${(r.ruin*100).toFixed(0)}%` : "";
    console.log(`     ${nm.padEnd(16)} ${(r.g*100).toFixed(1).padStart(5)}% ${(r.ddMed*100).toFixed(0).padStart(5)}% ${(r.dd95*100).toFixed(0).padStart(5)}% ${(r.reach*100).toFixed(0).padStart(5)}%  ${yy.padStart(20)}${flag}${ruin}`);
  }
  console.log();
}
// stake sensitivity at the CONFIDENT setting (½-Kelly on best-measured 0.83)
console.log(`  ── stake sensitivity: ½-Kelly on the best MEASURED holdable Sharpe (0.83) — the confident deployable setting ──`);
const S0 = 0.83, L0 = S0 / VOL / 2;
console.log(`     ${"stake".padStart(9)} ${"reach%".padStart(6)}  ${"yrs→£1M (P25–med–P75)".padStart(24)}`);
for (const st of K.STAKES.split(",").map(Number)) { const r = sim(S0, L0, st); const yy = r.yrMed === Infinity ? "never" : `${r.yrP25.toFixed(0)}–${r.yrMed.toFixed(0)}–${r.yrP75.toFixed(0)}`; console.log(`     £${st.toLocaleString("en-US").padStart(8)} ${(r.reach*100).toFixed(0).padStart(5)}%  ${yy.padStart(22)}`); }
console.log(`\n  READ: growth is a function of Sharpe (g=rf+S²/2 at full Kelly); leverage past full-Kelly REDUCES growth and explodes drawdown.`);
console.log(`  The confident lever is ½-Kelly (Sharpe-error + drawdown robust); the 149-year path collapses to human scale via LEVERAGE×STAKE on a real Sharpe, not a bigger edge.`);
