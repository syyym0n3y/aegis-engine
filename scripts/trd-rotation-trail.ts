#!/usr/bin/env -S deno run --allow-net
// trd-rotation-trail — the operator's model with a FAITHFUL exit. Not calendar rotation: you enter the
// strongest-trending charts and RIDE each on a trailing trend-stop (Chandelier: highest close since
// entry − mult×vol) until the swing rolls over into consolidation — then the capital is freed and
// redeployed to the next-best trend. "Don't leave too early, don't stay too late." Vol-targeted sizing,
// leverage capped, ruin-aware. Free Yahoo daily. Causal. IS(60%) selects, HO(40%) is the honest number.

import { sharpe, sampleStd, maxDrawdown, deflatedSharpe } from "../supabase/functions/_shared/trd-stats.ts";

const UNIVERSE = ["SPY", "QQQ", "IWM", "XLK", "XLE", "XLF", "XLV", "XLU", "XLI", "XLP", "XLY", "SMH", "XBI", "EEM", "EFA", "FXI", "EWZ", "EWJ", "INDA", "GLD", "SLV", "USO", "DBC", "TLT", "HYG", "UUP", "BTC-USD", "ETH-USD"];
const COST = 0.0010, ANN = 252, VOLTARGET = 0.15, MAXLEV = 3, MALEN = 100;

async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const std = (a: number[]) => sampleStd(a);

const data = new Map<string, Map<string, number>>();
for (const s of UNIVERSE) { const m = await daily(s); if (m.size > 300) data.set(s, m); }
const dates = [...new Set([...data.values()].flatMap((m) => [...m.keys()]))].sort();
const syms = [...data.keys()]; const T = dates.length;
const P = dates.map((d) => syms.map((s) => data.get(s)!.get(d) ?? NaN));
const R = P.map((row, i) => row.map((p, j) => (i > 0 && p > 0 && P[i - 1][j] > 0) ? Math.log(p / P[i - 1][j]) : NaN));
console.log(`${syms.length} instruments, ${T} dates, ${dates[0]} → ${dates[T - 1]}\n`);

const vol20 = (i: number, j: number) => { const w: number[] = []; for (let k = i - 20; k < i; k++) if (k >= 0 && Number.isFinite(R[k][j])) w.push(R[k][j]); return w.length >= 10 ? std(w) : NaN; };
function score(i: number, j: number): number {
  const p = P[i][j]; const v = vol20(i, j); if (!(p > 0) || !(v > 0)) return NaN;
  let s = 0, n = 0; for (const H of [21, 63, 126]) { const pk = i - H >= 0 ? P[i - H][j] : NaN; if (pk > 0) { s += (Math.log(p / pk) / H) / v; n++; } } return n === 3 ? s / n : NaN;
}
const ma = (i: number, j: number) => { let s = 0, n = 0; for (let k = i - MALEN; k < i; k++) if (k >= 0 && P[k][j] > 0) { s += P[k][j]; n++; } return n > MALEN * 0.8 ? s / n : NaN; };

function run(K: number, mult: number): number[] {
  const port = new Array(T).fill(0); const held = new Map<number, { max: number; w: number }>();
  const perPosVol = VOLTARGET / Math.sqrt(K);
  for (let i = 1; i < T; i++) {
    let day = 0; for (const [j, h] of held) if (Number.isFinite(R[i][j])) day += h.w * R[i][j];
    port[i] = day;
    for (const [j, h] of held) if (P[i][j] > h.max) h.max = P[i][j];        // ride the high
    for (const [j, h] of [...held]) {                                        // trailing trend-stop exit
      const v = vol20(i, j); const stop = h.max - mult * (Number.isFinite(v) ? v : 0.02) * P[i][j];
      if (!(P[i][j] > 0) || P[i][j] < stop || (score(i, j) ?? -1) < 0) { port[i] -= COST * h.w; held.delete(j); }
    }
    let gross = [...held.values()].reduce((a, h) => a + h.w, 0);
    while (held.size < K) {                                                  // redeploy freed capital to next-best trend
      let best = -1, bs = 0;
      for (let j = 0; j < syms.length; j++) { if (held.has(j)) continue; const s = score(i, j); const m = ma(i, j); if (Number.isFinite(s) && s > 0 && P[i][j] > (m || Infinity) && s > bs) { bs = s; best = j; } }
      if (best < 0) break;
      const v = vol20(i, best); const w = Math.min(MAXLEV - gross, (Number.isFinite(v) && v > 0) ? perPosVol / (v * Math.sqrt(ANN)) : 0);
      if (!(w > 0.01)) break;
      held.set(best, { max: P[i][best], w }); gross += w; port[i] -= COST * w;
    }
  }
  return port;
}

const IS = Math.floor(T * 0.6);
const isS = (r: number[]) => r.slice(1, IS), hoS = (r: number[]) => r.slice(IS);
const ann = (r: number[]) => sharpe(r) * Math.sqrt(ANN);
const cagr = (r: number[]) => { const g = r.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); return Math.exp(g * ANN / r.length) - 1; };
const spyJ = syms.indexOf("SPY"); const spy = R.map((row) => Number.isFinite(row[spyJ]) ? row[spyJ] : 0);

const cfgs: { name: string; full: number[]; isSh: number; hoSh: number }[] = [];
for (const K of [3, 5]) for (const mult of [2.5, 3.5, 5]) { const full = run(K, mult); cfgs.push({ name: `K=${K} trail=${mult}σ`, full, isSh: sharpe(isS(full)), hoSh: sharpe(hoS(full)) }); }
const nTrials = cfgs.length, varIS = std(cfgs.map((c) => c.isSh)) ** 2;
cfgs.sort((a, b) => b.isSh - a.isSh); const win = cfgs[0];

console.log(`${"CONFIG".padEnd(18)} IS-Sharpe  HO-Sharpe`);
for (const c of cfgs) console.log(`${c.name.padEnd(18)} ${ann([0, ...isS(c.full)]).toFixed(2).padStart(7)}   ${ann([0, ...hoS(c.full)]).toFixed(2).padStart(7)}`);
const dsr = deflatedSharpe(win.isSh, isS(win.full).length, 0, 3, nTrials, varIS);
console.log(`\n════ SELECTED in-sample: ${win.name} (trailing trend-stop exit) ════`);
console.log(`  IS annualized Sharpe:  ${ann([0, ...isS(win.full)]).toFixed(2)}   (SPY ${ann([0, ...isS(spy)]).toFixed(2)})`);
console.log(`  HO annualized Sharpe:  ${ann([0, ...hoS(win.full)]).toFixed(2)}   (SPY ${ann([0, ...hoS(spy)]).toFixed(2)})   ← honest`);
console.log(`  HO CAGR:               ${(cagr(hoS(win.full)) * 100).toFixed(1)}%   (SPY ${(cagr(hoS(spy)) * 100).toFixed(1)}%)`);
console.log(`  HO max drawdown:       ${(maxDrawdown(hoS(win.full)) * 100).toFixed(1)}%   (SPY ${(maxDrawdown(hoS(spy)) * 100).toFixed(1)}%)`);
console.log(`  Deflated Sharpe(N=${nTrials}): ${(dsr * 100).toFixed(1)}%   ${dsr > 0.95 ? "✓" : "✗ fails 0.95"}`);
console.log(`\nExit = Chandelier trailing stop (ride the high, cut on rollover) + trend-rank redeploy. THIS is "ride to consolidation".`);
