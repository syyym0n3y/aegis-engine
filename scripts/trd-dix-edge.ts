#!/usr/bin/env -S deno run --allow-net
// trd-dix-edge — gate DIX as a DIRECTIONAL EDGE, not just assert "awareness". SqueezeMetrics' thesis: high
// DIX (dark-pool buying) → higher forward SPX returns. Test whether conditioning exposure on DIX beats
// buy-&-hold on a RISK-ADJUSTED basis, OOS, deflated. If the excess-return Sharpe clears DSR>95% it's a real
// edge to surface with conviction; if not, it's an awareness tilt (context), now PROVEN not asserted.
// Free SqueezeMetrics (date,price,dix,gex). Per ANALYSIS_CONTRACT: numbers, OOS, deflation over variants.
import { mean, sharpe, sampleStd, annualizedSharpe, maxDrawdown, deflatedSharpe } from "../supabase/functions/_shared/trd-stats.ts";

const rows = (await (await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } })).text()).trim().split("\n").slice(1).map((l) => { const p = l.split(","); return { d: p[0], px: +p[1], dix: +p[2] }; }).filter((x) => Number.isFinite(x.px) && Number.isFinite(x.dix));
const px = rows.map((r) => r.px), dix = rows.map((r) => r.dix);
const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
const W = 252; // trailing window for DIX percentile (causal)
const dixPct = (i: number) => { if (i < W) return NaN; const w = dix.slice(i - W, i).sort((a, b) => a - b); let r = 0; while (r < w.length && w[r] < dix[i]) r++; return r / w.length; };

const ann = (rr: number[]) => annualizedSharpe(rr, 252);
const cagr = (rr: number[]) => { const g = rr.reduce((a, r) => a * (1 + r), 1); return Math.pow(g, 252 / rr.length) - 1; };
function report(name: string, exposure: (i: number) => number) {
  const sr: number[] = [], bh: number[] = []; const idx: number[] = [];
  for (let i = W; i < px.length - 1; i++) { const e = exposure(i); if (!Number.isFinite(e)) continue; sr.push(e * ret[i + 1]); bh.push(ret[i + 1]); idx.push(i); }
  const cut = Math.floor(sr.length * 0.6);
  const excess = sr.map((r, k) => r - bh[k]);
  const line = (lbl: string, a: number[]) => `${lbl} CAGR ${(cagr(a) * 100).toFixed(1)}% / Sharpe ${ann(a).toFixed(2)} / maxDD ${(maxDrawdown(a) * 100).toFixed(0)}%`;
  console.log(`\n── ${name} ──`);
  console.log(`   ${line("strat  ", sr)}`);
  console.log(`   ${line("OOS    ", sr.slice(cut))}   (${line("IS", sr.slice(0, cut))})`);
  console.log(`   excess-vs-hold Sharpe: ALL ${ann(excess).toFixed(2)}  IS ${ann(excess.slice(0, cut)).toFixed(2)} → OOS ${ann(excess.slice(cut)).toFixed(2)}`);
  return excess;
}
console.log(`DIX directional-edge gate — ${rows.length} days ${rows[0].d}→${rows[rows.length - 1].d}. Buy-&-hold: ${(cagr(ret.slice(W)) * 100).toFixed(1)}% CAGR / Sharpe ${ann(ret.slice(W)).toFixed(2)}.`);

// variants (each a trial)
const exVariants: [string, (i: number) => number][] = [
  ["long/flat: DIX>median (top half)", (i) => { const p = dixPct(i); return Number.isFinite(p) ? (p >= 0.5 ? 1 : 0) : NaN; }],
  ["long/short: DIX>median ? +1 : -1", (i) => { const p = dixPct(i); return Number.isFinite(p) ? (p >= 0.5 ? 1 : -1) : NaN; }],
  ["scaled: exposure = DIX percentile", (i) => dixPct(i)],
  ["tilt: 1 + 0.5·(DIX%−0.5)·2", (i) => { const p = dixPct(i); return Number.isFinite(p) ? 1 + (p - 0.5) : NaN; }],
];
const excesses = exVariants.map(([n, f]) => report(n, f));
// deflate the best variant's excess Sharpe over the trial set
const srs = excesses.map((e) => sharpe(e));
let bi = 0; for (let i = 1; i < srs.length; i++) if (srs[i] > srs[bi]) bi = i;
const be = excesses[bi]; const m = mean(be), s = sampleStd(be); let sk = 0, ku = 0; for (const x of be) { const z = (x - m) / s; sk += z ** 3; ku += z ** 4; } sk /= be.length; ku /= be.length;
const varT = srs.length > 1 ? sampleStd(srs) ** 2 : 0.25;
const dsr = deflatedSharpe(sharpe(be), be.length, sk, ku, exVariants.length, varT);
console.log(`\n════ GATE (best variant "${exVariants[bi][0]}", excess-vs-hold, ${exVariants.length} trials) ════`);
console.log(`   per-day excess Sharpe ${sharpe(be).toFixed(4)} → DSR ${(dsr * 100).toFixed(1)}%  ${dsr > 0.95 ? "SURVIVES — DIX is a real directional EDGE, surface with conviction" : "FAILS — DIX is an AWARENESS tilt (context), not standalone alpha"}`);
