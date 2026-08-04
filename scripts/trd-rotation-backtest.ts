#!/usr/bin/env -S deno run --allow-net
// trd-rotation-backtest — the operator's ACTUAL thesis, tested honestly: scan the whole market, hold only
// the few charts with the strongest trend RIGHT NOW, ride each until its trend decays (consolidation),
// rotate the capital to the next-best. Cross-sectional momentum rotation + trend-decay exit + vol-target
// sizing (risk management, scaled). This is NOT "does setup X work on instrument Y" (falsified) — it's
// "does continuously rotating into the best-trending markets beat holding, out of sample, after costs".
//
// Free Yahoo daily. Causal signals only. In-sample (first 60%) picks K + lookback; holdout (last 40%) is
// the honest number. Deflated by the config count. Benchmarks: SPY buy&hold + equal-weight universe.

import { sharpe, mean, sampleStd, maxDrawdown, deflatedSharpe } from "../supabase/functions/_shared/trd-stats.ts";

const UNIVERSE = [
  "SPY", "QQQ", "IWM", "XLK", "XLE", "XLF", "XLV", "XLU", "XLI", "XLP", "XLY", "SMH", "XBI",
  "EEM", "EFA", "FXI", "EWZ", "EWJ", "INDA", "GLD", "SLV", "USO", "DBC", "TLT", "HYG", "UUP",
  "BTC-USD", "ETH-USD",
];
const COST = 0.0010;          // 10 bps per unit turnover on rotation
const ANN = 252;
const REBAL = 5;              // rotate weekly
const VOLTARGET = 0.15;       // annualized portfolio vol target (risk scaling)

async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const std = (a: number[]) => sampleStd(a);

console.log(`Pulling ${UNIVERSE.length} instruments…`);
const data = new Map<string, Map<string, number>>();
for (const s of UNIVERSE) { const m = await daily(s); if (m.size > 300) data.set(s, m); }
// union of dates, sorted
const allDates = [...new Set([...data.values()].flatMap((m) => [...m.keys()]))].sort();
const syms = [...data.keys()];
// price matrix [date][sym] with NaN where missing
const P = allDates.map((d) => syms.map((s) => data.get(s)!.get(d) ?? NaN));
const T = allDates.length;
console.log(`${syms.length} instruments, ${T} dates, ${allDates[0]} → ${allDates[T - 1]}\n`);

// per-instrument daily log returns (NaN-aware)
const R = P.map((row, i) => row.map((p, j) => (i > 0 && p > 0 && P[i - 1][j] > 0) ? Math.log(p / P[i - 1][j]) : NaN));

// causal trend score for sym j at date i: risk-adjusted blended momentum over 3 horizons
function score(i: number, j: number, horizons: number[]): number {
  const p = P[i][j]; if (!(p > 0)) return NaN;
  const volWin: number[] = []; for (let k = i - 20; k < i; k++) if (k >= 0 && Number.isFinite(R[k][j])) volWin.push(R[k][j]);
  const v = volWin.length >= 10 ? std(volWin) : NaN; if (!(v > 0)) return NaN;
  let s = 0, n = 0; for (const H of horizons) { const pk = i - H >= 0 ? P[i - H][j] : NaN; if (pk > 0) { s += (Math.log(p / pk) / H) / v; n++; } }
  return n === horizons.length ? s / n : NaN;   // require all horizons available (enough history)
}

// run the rotation strategy → daily portfolio returns
function runRotation(K: number, horizons: number[]): number[] {
  const port: number[] = new Array(T).fill(0); let w = new Array(syms.length).fill(0);
  for (let i = 1; i < T; i++) {
    // apply yesterday's weights to today's returns
    let day = 0; for (let j = 0; j < syms.length; j++) if (w[j] !== 0 && Number.isFinite(R[i][j])) day += w[j] * R[i][j];
    port[i] = day;
    if (i % REBAL === 0) {
      const scored = syms.map((_, j) => ({ j, s: score(i, j, horizons) })).filter((x) => Number.isFinite(x.s) && x.s > 0);
      scored.sort((a, b) => b.s - a.s);
      const pick = scored.slice(0, K);
      const neu = new Array(syms.length).fill(0);
      if (pick.length) {
        // inverse-vol weight the picks, then scale the whole book to the vol target
        const ivol = pick.map((x) => { const vw: number[] = []; for (let k = i - 20; k < i; k++) if (k >= 0 && Number.isFinite(R[k][x.j])) vw.push(R[k][x.j]); const v = std(vw); return v > 0 ? 1 / v : 0; });
        const iv = ivol.reduce((a, b) => a + b, 0) || 1;
        pick.forEach((x, m) => neu[x.j] = ivol[m] / iv);
        // portfolio realized vol estimate from last 20d of the equal-ish book → scale to target
        const recent: number[] = []; for (let k = i - 20; k < i; k++) { if (k < 1) continue; let d = 0; for (let m = 0; m < pick.length; m++) if (Number.isFinite(R[k][pick[m].j])) d += neu[pick[m].j] * R[k][pick[m].j]; recent.push(d); }
        const pv = std(recent) * Math.sqrt(ANN); const scale = pv > 0 ? Math.min(3, VOLTARGET / pv) : 1; // cap leverage at 3x
        for (let j = 0; j < syms.length; j++) neu[j] *= scale;
      }
      const turn = neu.reduce((a, b, j) => a + Math.abs(b - w[j]), 0);
      port[i] -= COST * turn;
      w = neu;
    }
  }
  return port;
}

// benchmark: SPY buy&hold + equal-weight universe (daily)
const spyJ = syms.indexOf("SPY");
const spy = R.map((row) => Number.isFinite(row[spyJ]) ? row[spyJ] : 0);
const ann = (r: number[]) => sharpe(r) * Math.sqrt(ANN);
const cagr = (r: number[]) => { const g = r.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); return Math.exp(g * ANN / r.length) - 1; };

const IS = Math.floor(T * 0.6);
const isS = (r: number[]) => r.slice(1, IS), hoS = (r: number[]) => r.slice(IS);

// grid: K × horizon-set
const KS = [3, 5, 8], HSETS: number[][] = [[21, 63, 126], [63, 126, 252], [21, 42, 63]];
const cfgs: { name: string; full: number[]; isSh: number; hoSh: number }[] = [];
for (const K of KS) for (const H of HSETS) { const full = runRotation(K, H); cfgs.push({ name: `K=${K} mom=[${H.join(",")}]`, full, isSh: sharpe(isS(full)), hoSh: sharpe(hoS(full)) }); }
const nTrials = cfgs.length; const varIS = std(cfgs.map((c) => c.isSh)) ** 2;
cfgs.sort((a, b) => b.isSh - a.isSh);
const win = cfgs[0];

console.log(`${"CONFIG".padEnd(24)} IS-Sharpe  HO-Sharpe`);
for (const c of cfgs) console.log(`${c.name.padEnd(24)} ${ann([0, ...isS(c.full)]).toFixed(2).padStart(7)}   ${ann([0, ...hoS(c.full)]).toFixed(2).padStart(7)}`);

const dsr = deflatedSharpe(win.isSh, isS(win.full).length, 0, 3, nTrials, varIS);
console.log(`\n════ SELECTED in-sample: ${win.name} ════`);
console.log(`  IS  annualized Sharpe:  ${ann([0, ...isS(win.full)]).toFixed(2)}   (SPY ${ann([0, ...isS(spy)]).toFixed(2)})`);
console.log(`  HO  annualized Sharpe:  ${ann([0, ...hoS(win.full)]).toFixed(2)}   (SPY ${ann([0, ...hoS(spy)]).toFixed(2)})   ← honest number`);
console.log(`  HO  CAGR:               ${(cagr(hoS(win.full)) * 100).toFixed(1)}%   (SPY ${(cagr(hoS(spy)) * 100).toFixed(1)}%)`);
console.log(`  HO  max drawdown:       ${(maxDrawdown(hoS(win.full)) * 100).toFixed(1)}%   (SPY ${(maxDrawdown(hoS(spy)) * 100).toFixed(1)}%)`);
console.log(`  Deflated Sharpe (N=${nTrials}):  ${(dsr * 100).toFixed(1)}%   ${dsr > 0.95 ? "✓ clears 0.95" : "✗ fails 0.95"}`);
console.log(`\nStrategy = rotate weekly into top-K risk-adjusted trend leaders (long-only, positive-trend only,`);
console.log(`inverse-vol weighted, vol-targeted ${(VOLTARGET * 100).toFixed(0)}% capped 3x). Rotation IS the exit — a chart that loses`);
console.log(`its trend rank is dropped and capital redeployed. Costs ${(COST * 1e4).toFixed(0)}bp/turn. This is the operator's model.`);
