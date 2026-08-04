#!/usr/bin/env -S deno run --allow-net
// trd-netflow-backtest — the honest backtest of "track the whales" using FREE on-chain data.
//
// HARD CONSTRAINT (stated, not hidden): true exchange NETFLOW (coins moving to/from labelled exchange
// wallets) is PAID data (Glassnode/CryptoQuant/Nansen). What is free + historical is Blockchain.com's
// aggregate on-chain metrics, which proxy whale/holder BEHAVIOUR without isolating "coins → Binance":
//   active addresses, on-chain settled USD volume, output volume (BTC moved on-chain), tx count.
// This tests whether ANY of those aggregate whale-behaviour signals has a real, deflated edge on BTC.
//
// Method (honest core): each signal is causal (trailing only). Config = signal × direction-mode.
// We SELECT the best config on the first 70% (in-sample) and report its last-30% (HOLDOUT) result —
// the holdout is never used for selection. The in-sample winner's Sharpe is DEFLATED by the trial
// count (López de Prado DSR). A shuffle-null gives a p-value on the holdout. Buy&hold is the benchmark
// (the D-071 lesson: it usually wins). Costs are charged on every position change.

import { annualizedSharpe, sharpe, deflatedSharpe, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";

const COST = 0.0010;      // 10 bps per unit turnover (spot crypto, pessimistic-ish)
const ANN = 365;          // crypto trades daily
const MOM = 30;           // momentum lookback (days)
const ZWIN = 180;         // trailing window for z-scoring the signal (causal)
const SMOOTH = 90;        // NVT volume smoothing

async function chart(name: string): Promise<Map<string, number>> {
  const r = await fetch(`https://api.blockchain.info/charts/${name}?timespan=all&format=json&sampled=false`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const m = new Map<string, number>();
  for (const p of (j?.values ?? [])) { const d = new Date(p.x * 1000).toISOString().slice(0, 10); if (Number.isFinite(p.y) && p.y > 0) m.set(d, p.y); }
  return m;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
// causal trailing z-score of series x at each index (uses x[i-win..i-1]; NaN until enough history)
function trailingZ(x: number[], win: number): number[] {
  const z = new Array(x.length).fill(NaN);
  for (let i = win; i < x.length; i++) { const w = x.slice(i - win, i); const s = std(w); if (s > 0) z[i] = (x[i] - mean(w)) / s; }
  return z;
}
const logmom = (x: number[], k: number) => x.map((_, i) => i >= k && x[i] > 0 && x[i - k] > 0 ? Math.log(x[i] / x[i - k]) : NaN);
function smoothed(x: number[], k: number) { return x.map((_, i) => i >= k ? mean(x.slice(i - k, i)) : NaN); }

// ---- load + align ----
const [price, addr, volUsd, outBtc, ntx] = await Promise.all(
  ["market-price", "n-unique-addresses", "estimated-transaction-volume-usd", "output-volume", "n-transactions"].map(chart),
);
const dates = [...price.keys()].filter((d) => addr.has(d) && volUsd.has(d) && outBtc.has(d) && ntx.has(d)).sort();
const P = dates.map((d) => price.get(d)!), A = dates.map((d) => addr.get(d)!), V = dates.map((d) => volUsd.get(d)!), O = dates.map((d) => outBtc.get(d)!), N = dates.map((d) => ntx.get(d)!);
const ret: number[] = P.map((_, i) => i > 0 ? Math.log(P[i] / P[i - 1]) : 0);  // daily log return
const T = dates.length;
console.log(`Aligned ${T} daily rows, ${dates[0]} → ${dates[T - 1]}. Free aggregate on-chain proxies (NOT labelled exchange netflow — that is paid).`);

// ---- signals (each: value>0 = bullish tilt), all causal ----
const nvtRaw = P.map((p, i) => (V[i] > 0 ? Math.log(p) - Math.log(smoothed(V, SMOOTH)[i]) : NaN)); // price outrunning usage
const sigs: Record<string, number[]> = {
  "active-addr momentum": trailingZ(logmom(A, MOM), ZWIN),
  "onchain-USDvol momentum": trailingZ(logmom(V, MOM), ZWIN),
  "output(BTC) momentum": trailingZ(logmom(O, MOM), ZWIN),
  "tx-count momentum": trailingZ(logmom(N, MOM), ZWIN),
  "NVT (price vs usage, mean-revert)": trailingZ(nvtRaw, ZWIN).map((z) => -z), // low NVT = bullish
  "addr÷price divergence (accumulation)": trailingZ(logmom(A, MOM), ZWIN).map((z, i) => Number.isFinite(z) ? z - (trailingZ(logmom(P, MOM), ZWIN)[i] ?? 0) : NaN),
};

// ---- evaluate a config → per-day strategy returns (causal, cost-charged) ----
function stratReturns(sig: number[], mode: "longflat" | "longshort"): number[] {
  const out: number[] = []; let prevPos = 0;
  for (let i = 0; i < T - 1; i++) {
    let pos = 0;
    if (Number.isFinite(sig[i])) pos = mode === "longshort" ? Math.sign(sig[i]) : (sig[i] > 0 ? 1 : 0);
    const turn = Math.abs(pos - prevPos); prevPos = pos;
    out.push(pos * ret[i + 1] - COST * turn);
  }
  return out;
}
const IS_END = Math.floor(T * 0.7);                       // 70/30 split
const sliceIS = (a: number[]) => a.slice(0, IS_END), sliceHO = (a: number[]) => a.slice(IS_END);

interface Cfg { name: string; mode: string; isSh: number; hoSh: number; full: number[]; }
const cfgs: Cfg[] = [];
for (const [name, sig] of Object.entries(sigs)) for (const mode of ["longflat", "longshort"] as const) {
  const full = stratReturns(sig, mode);
  cfgs.push({ name, mode, isSh: sharpe(sliceIS(full)), hoSh: sharpe(sliceHO(full)), full });
}
const nTrials = cfgs.length;
const varTrialIS = std(cfgs.map((c) => c.isSh)) ** 2;

// ---- selection on IN-SAMPLE only ----
cfgs.sort((a, b) => b.isSh - a.isSh);
const win = cfgs[0];
const isRet = sliceIS(win.full), hoRet = sliceHO(win.full);
const dsr = deflatedSharpe(win.isSh, isRet.length, 0, 3, nTrials, varTrialIS);

// ---- shuffle-null on the HOLDOUT (break the signal→return link, keep return distribution) ----
let ge = 0; const SHUF = 2000; const hoActual = sharpe(hoRet);
// deterministic LCG (Math.random unavailable-by-doctrine-safe); seed varies the permutation
let seed = 20260804;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const hoR = ret.slice(IS_END + 1, IS_END + 1 + hoRet.length); // aligned realised returns for the holdout
for (let s = 0; s < SHUF; s++) {
  const perm = hoR.slice(); for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  // re-derive positions from the winner's holdout returns is not trivial post-cost; approximate the null
  // by correlating sign(strategy) with shuffled returns → Sharpe of (posSign × shuffled)
  const posSign = hoRet.map((x, i) => (hoR[i] !== 0 ? Math.sign(x / (hoR[i] || 1)) : 0));
  const nullRet = posSign.map((p, i) => p * perm[i] - 0); // cost-free null (conservative: real has costs)
  if (sharpe(nullRet) >= hoActual) ge++;
}
const pval = (ge + 1) / (SHUF + 1);

// ---- benchmark: buy & hold ----
const bhIS = sharpe(ret.slice(1, IS_END)), bhHO = sharpe(ret.slice(IS_END + 1));

console.log(`\n${"CONFIG".padEnd(40)} ${"mode".padEnd(10)} IS-Sharpe  HO-Sharpe`);
for (const c of cfgs) console.log(`${c.name.padEnd(40)} ${c.mode.padEnd(10)} ${(c.isSh * Math.sqrt(ANN)).toFixed(2).padStart(7)}   ${(c.hoSh * Math.sqrt(ANN)).toFixed(2).padStart(7)}`);

console.log(`\n════ SELECTED on in-sample: "${win.name}" (${win.mode}) ════`);
console.log(`  trials evaluated (deflation N):      ${nTrials}`);
console.log(`  in-sample  annualized Sharpe:        ${(win.isSh * Math.sqrt(ANN)).toFixed(2)}   (vs buy&hold ${(bhIS * Math.sqrt(ANN)).toFixed(2)})`);
console.log(`  HOLDOUT    annualized Sharpe:        ${(win.hoSh * Math.sqrt(ANN)).toFixed(2)}   (vs buy&hold ${(bhHO * Math.sqrt(ANN)).toFixed(2)})  ← the honest number`);
console.log(`  Deflated Sharpe (in-sample, N=${nTrials}):    ${(dsr * 100).toFixed(1)}%   ${dsr > 0.95 ? "✓ clears 0.95" : "✗ FAILS 0.95 gate"}`);
console.log(`  Shuffle-null p-value on holdout:     ${pval.toFixed(3)}   ${pval < 0.05 ? "✓ signal beats chance" : "✗ indistinguishable from chance"}`);
console.log(`  holdout max drawdown (strategy):     ${(maxDrawdown(hoRet) * 100).toFixed(1)}%   (buy&hold ${(maxDrawdown(ret.slice(IS_END + 1)) * 100).toFixed(1)}%)`);
console.log(`\nNOTE: aggregate on-chain proxies only — true labelled-exchange netflow is paid. Costs charged at ${(COST * 1e4).toFixed(0)}bps/turn.`);
console.log(`These signals are public and widely watched → any real edge is the first thing HFT front-runs. The gate decides, not the story.`);
