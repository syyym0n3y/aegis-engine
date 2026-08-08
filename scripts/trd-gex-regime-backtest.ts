#!/usr/bin/env -S deno run --allow-net
// trd-gex-regime-backtest — the test D-130 couldn't run: GEX-REGIME conditioning on 15y of FREE historical
// GEX (SqueezeMetrics releases all history free; only the live signal is paywalled). CSV: date,price,dix,gex
// (SPX close, dark-pool index, dealer gamma) 2011→now. Two honest questions:
//   (A) STRUCTURAL — is positive-GEX genuinely a LOWER-forward-vol regime? (a sizing signal, not direction)
//   (B) DIRECTIONAL — do mean-reversion / momentum / DIX predict returns, conditioned on GEX? (gated, DSR)
// Per ANALYSIS_CONTRACT: number+N+OOS; directional cells deflated over their trial count.
import { mean, sharpe, deflatedSharpe, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const r = await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
const rows = (await r.text()).trim().split("\n").slice(1).map((l) => { const p = l.split(","); return { d: p[0], px: +p[1], dix: +p[2], gex: +p[3] }; }).filter((x) => Number.isFinite(x.px) && Number.isFinite(x.gex));
console.log(`SqueezeMetrics GEX/DIX: ${rows.length} days, ${rows[0].d}→${rows[rows.length - 1].d}`);

const px = rows.map((x) => x.px), gex = rows.map((x) => x.gex), dix = rows.map((x) => x.dix);
const ret = px.map((p, i) => i === 0 ? 0 : (p - px[i - 1]) / px[i - 1]);
// rolling terciles of GEX (knowable: trailing 252d) → regime without look-ahead
function tercile(i: number): "low" | "mid" | "high" | null { if (i < 252) return null; const w = gex.slice(i - 252, i).sort((a, b) => a - b); const lo = w[Math.floor(w.length / 3)], hi = w[Math.floor(w.length * 2 / 3)]; return gex[i] <= lo ? "low" : gex[i] >= hi ? "high" : "mid"; }
function dixQ(i: number): number | null { if (i < 252) return null; const w = dix.slice(i - 252, i).sort((a, b) => a - b); return dix[i] >= w[Math.floor(w.length * 0.75)] ? 1 : dix[i] <= w[Math.floor(w.length * 0.25)] ? -1 : 0; }
function rsi(n: number): number[] { const out: number[] = new Array(px.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < px.length; i++) { const ch = px[i] - px[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; out[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return out; }
const rsi2 = rsi(2); const H = 5;
const fwdRet = (i: number) => i + H < px.length ? (px[i + H] - px[i]) / px[i] : NaN;
const fwdVol = (i: number) => { if (i + H >= px.length) return NaN; let s = 0; for (let k = i + 1; k <= i + H; k++) s += ret[k] * ret[k]; return Math.sqrt(s / H) * Math.sqrt(252); };

// (A) STRUCTURAL: forward realized vol by GEX regime
const volBy: Record<string, number[]> = { low: [], mid: [], high: [] };
for (let i = 252; i < px.length - H; i++) { const t = tercile(i); const v = fwdVol(i); if (t && Number.isFinite(v)) volBy[t].push(v); }
const avg = (a: number[]) => a.length ? mean(a) : NaN;
console.log(`\n════ (A) STRUCTURAL — forward ${H}d realized vol (annualized) by GEX regime ════`);
console.log(`  LOW-gamma  (bottom tercile): ${(avg(volBy.low) * 100).toFixed(1)}%   n=${volBy.low.length}`);
console.log(`  MID-gamma:                   ${(avg(volBy.mid) * 100).toFixed(1)}%   n=${volBy.mid.length}`);
console.log(`  HIGH-gamma (top tercile):    ${(avg(volBy.high) * 100).toFixed(1)}%   n=${volBy.high.length}`);
console.log(`  → ratio LOW/HIGH = ${(avg(volBy.low) / avg(volBy.high)).toFixed(2)}×  ${avg(volBy.low) > avg(volBy.high) ? "CONFIRMS positive-gamma = calmer (a real free SIZING signal)" : "does NOT confirm"}`);

// (B) DIRECTIONAL cells (each a trial): trade returns in R-ish units (fwdRet normalized by trailing daily vol)
function trailVol(i: number) { if (i < 21) return NaN; let s = 0; for (let k = i - 20; k <= i; k++) s += ret[k] * ret[k]; return Math.sqrt(s / 21); }
interface T { r: number; is: boolean; }
const cells: Record<string, T[]> = {};
const add = (key: string, i: number, dir: 1 | -1) => { const v = trailVol(i), fr = fwdRet(i); if (!(v > 0) || !Number.isFinite(fr)) return; (cells[key] ??= []).push({ r: dir * fr / (v * Math.sqrt(H)), is: i < px.length * 0.6 }); };
for (let i = 252; i < px.length - H; i++) {
  const t = tercile(i); const dq = dixQ(i); if (!t) continue;
  if (rsi2[i] < 10) add(`meanrev-long|gex-${t}`, i, 1);            // oversold dip-buy, by GEX regime
  if (rsi2[i] > 90) add(`meanrev-short|gex-${t}`, i, -1);          // overbought fade, by GEX regime
  if (px[i] >= Math.max(...px.slice(i - 20, i))) add(`breakout-long|gex-${t}`, i, 1); // 20d high, by GEX regime
  if (dq === 1) add(`dix-high-long|gex-${t}`, i, 1);              // dark-pool buying, by GEX regime
}
console.log(`\n════ (B) DIRECTIONAL — expectancy (R≈fwdRet/trailing-vol) by setup × GEX regime ════`);
const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}${t.length < 60 ? " [small-N]" : ""}` : "—";
const keys = Object.keys(cells).sort();
for (const k of keys) { const t = cells[k]; console.log(`  ${k.padEnd(28)} ALL ${agg(t)}   IS ${agg(t.filter((x) => x.is))} → OOS ${agg(t.filter((x) => !x.is))}`); }
const skewKurt = (a: number[]) => { const m = mean(a), s = sampleStd(a); if (!(s > 0)) return [0, 3]; let sk = 0, ku = 0; for (const x of a) { const z = (x - m) / s; sk += z ** 3; ku += z ** 4; } return [sk / a.length, ku / a.length]; };
const elig = keys.filter((k) => cells[k].length >= 50); const cs = elig.map((k) => sharpe(cells[k].map((x) => x.r)));
let best = elig[0]; for (const k of elig) if (sharpe(cells[k].map((x) => x.r)) > sharpe(cells[best].map((x) => x.r))) best = k;
const bt = cells[best].map((x) => x.r); const [sk, ku] = skewKurt(bt); const varT = cs.length > 1 ? sampleStd(cs) ** 2 : 0.25;
const dsr = deflatedSharpe(sharpe(bt), bt.length, sk, ku, keys.length, varT);
console.log(`\n════ GATE (best directional cell = ${best}, over ${keys.length} trials) ════`);
console.log(`  N=${bt.length}, Sharpe ${sharpe(bt).toFixed(3)} → DSR ${(dsr * 100).toFixed(1)}%  ${dsr > 0.95 ? "SURVIVES" : "FAILS (>95%)"}`);
console.log(`\nFREE GEX-history unlocked (SqueezeMetrics). (A) is the keeper if confirmed: a regime SIZING signal, not a direction call.`);
