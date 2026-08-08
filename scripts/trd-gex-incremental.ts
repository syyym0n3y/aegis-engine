#!/usr/bin/env -S deno run --allow-net
// trd-gex-incremental — the honest gate on D-131(A): does GEX predict forward vol AFTER controlling for
// trailing realized vol (RV)? If GEX just restates vol-clustering, it adds nothing over the D-100 primitive.
// Two independent reads: (1) 3×3 double-sort RV-tercile × GEX-tercile → forward vol (does GEX separate
// WITHIN an RV row?); (2) OLS forwardVol ~ trailingRV + GEX with the GEX t-stat (incremental significance).
// PLUS #2: the pre-registered single-hypothesis dip-buy|low-gamma test (minimal trials → clean DSR).
import { mean, sampleStd, sharpe, deflatedSharpe } from "../supabase/functions/_shared/trd-stats.ts";

const r = await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
const rows = (await r.text()).trim().split("\n").slice(1).map((l) => { const p = l.split(","); return { d: p[0], px: +p[1], gex: +p[3] }; }).filter((x) => Number.isFinite(x.px) && Number.isFinite(x.gex));
const px = rows.map((x) => x.px), gex = rows.map((x) => x.gex);
const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
const H = 5;
const trailRV = (i: number) => { if (i < 21) return NaN; let s = 0; for (let k = i - 20; k <= i; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 21) * Math.sqrt(252); };
const fwdRV = (i: number) => { if (i + H >= px.length) return NaN; let s = 0; for (let k = i + 1; k <= i + H; k++) s += ret[k] * ret[k]; return Math.sqrt(s / H) * Math.sqrt(252); };

// assemble aligned samples (need trailing 252d for GEX tercile, 20d for RV)
interface S { fwd: number; rv: number; gex: number; }
const S: S[] = [];
for (let i = 252; i < px.length - H; i++) { const f = fwdRV(i), rv = trailRV(i); if (Number.isFinite(f) && Number.isFinite(rv)) S.push({ fwd: f, rv, gex: gex[i] }); }
const terc = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); return [s[Math.floor(s.length / 3)], s[Math.floor(s.length * 2 / 3)]]; };
const [rvLo, rvHi] = terc(S.map((x) => x.rv)); const [gLo, gHi] = terc(S.map((x) => x.gex));
const rvT = (x: S) => x.rv <= rvLo ? 0 : x.rv >= rvHi ? 2 : 1;
const gT = (x: S) => x.gex <= gLo ? 0 : x.gex >= gHi ? 2 : 1; // 0=low gamma, 2=high gamma

console.log(`GEX incremental-value gate — ${S.length} aligned days.\n`);
console.log("(1) 3×3 double-sort → mean forward 5d vol (%). Read ACROSS each RV row: does GEX still separate?");
console.log("            GEX-low   GEX-mid   GEX-high");
for (let ri = 0; ri < 3; ri++) {
  const cells = [0, 1, 2].map((gi) => { const sub = S.filter((x) => rvT(x) === ri && gT(x) === gi); return sub.length ? mean(sub.map((s) => s.fwd)) * 100 : NaN; });
  const label = ["RV-low ", "RV-mid ", "RV-high"][ri];
  console.log(`  ${label}   ${cells.map((c) => (Number.isFinite(c) ? c.toFixed(1) : "—").padStart(7)).join("   ")}   ← spread ${(cells[0] - cells[2]).toFixed(1)}pt`);
}
// (2) OLS forwardVol ~ trailingRV + GEX (centered) → GEX t-stat
const yc = S.map((x) => x.fwd), x1c = S.map((x) => x.rv), x2c = S.map((x) => x.gex);
const my = mean(yc), m1 = mean(x1c), m2 = mean(x2c);
let a = 0, b = 0, c = 0, s1y = 0, s2y = 0;
for (let i = 0; i < S.length; i++) { const u = x1c[i] - m1, v = x2c[i] - m2, w = yc[i] - my; a += u * u; b += u * v; c += v * v; s1y += u * w; s2y += v * w; }
const det = a * c - b * b; const beta1 = (c * s1y - b * s2y) / det, beta2 = (a * s2y - b * s1y) / det;
let ssr = 0; for (let i = 0; i < S.length; i++) { const yh = beta1 * (x1c[i] - m1) + beta2 * (x2c[i] - m2); ssr += (yc[i] - my - yh) ** 2; }
const s2 = ssr / (S.length - 3); const seBeta2 = Math.sqrt(s2 * a / det); const tGex = beta2 / seBeta2;
// scale-free: GEX beta per 1 std of GEX, in vol points
const betaPerStd = beta2 * sampleStd(x2c) * 100;
console.log(`\n(2) OLS forwardVol ~ trailingRV + GEX:  GEX coef t-stat = ${tGex.toFixed(2)}  (|t|>2 = significant)`);
console.log(`    GEX effect per +1σ = ${betaPerStd.toFixed(2)} vol-pts (negative = more gamma → lower fwd vol), controlling for trailing RV`);
console.log(`    → ${Math.abs(tGex) > 2 && beta2 < 0 ? "GEX ADDS incremental predictive value over trailing-RV — wire into sizing" : "GEX does NOT add over trailing-RV — it restates vol-clustering, do NOT add"}`);

// ── #2: PRE-REGISTERED dip-buy | low-gamma (single hypothesis) ──
const rsi = (n: number): number[] => { const out: number[] = new Array(px.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < px.length; i++) { const ch = px[i] - px[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; out[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return out; };
const rsi2 = rsi(2);
const gexTercLive = (i: number): number | null => { if (i < 252) return null; const w = gex.slice(i - 252, i).sort((x, y) => x - y); return gex[i] <= w[Math.floor(w.length / 3)] ? 0 : gex[i] >= w[Math.floor(w.length * 2 / 3)] ? 2 : 1; };
const trades: { r: number; is: boolean }[] = [];
for (let i = 252; i < px.length - H; i++) { const g = gexTercLive(i); const v = trailRV(i) / Math.sqrt(252); const fr = i + H < px.length ? (px[i + H] - px[i]) / px[i] : NaN; if (g === 0 && rsi2[i] < 10 && v > 0 && Number.isFinite(fr)) trades.push({ r: fr / (v * Math.sqrt(H)), is: i < px.length * 0.6 }); }
const agg = (t: { r: number }[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}` : "—";
const sk = (aa: number[]) => { const m = mean(aa), s = sampleStd(aa); if (!(s > 0)) return [0, 3]; let s3 = 0, s4 = 0; for (const x of aa) { const z = (x - m) / s; s3 += z ** 3; s4 += z ** 4; } return [s3 / aa.length, s4 / aa.length]; };
const rr = trades.map((x) => x.r); const [skk, kuu] = sk(rr);
const dsr = deflatedSharpe(sharpe(rr), rr.length, skk, kuu, 1, 0.25); // pre-registered → 1 trial
console.log(`\n#2 PRE-REGISTERED dip-buy | low-gamma (RSI2<10 & GEX bottom tercile), 1 trial:`);
console.log(`   ALL ${agg(trades)}   IS ${agg(trades.filter((x) => x.is))} → OOS ${agg(trades.filter((x) => !x.is))}`);
console.log(`   Sharpe ${sharpe(rr).toFixed(3)} → DSR ${(dsr * 100).toFixed(1)}%  ${dsr > 0.95 ? "SURVIVES — promote to forward test" : "FAILS (>95%)"}`);
