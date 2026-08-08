#!/usr/bin/env -S deno run --allow-net
// trd-squeeze-oos-now — resolve the FROZEN btc-squeeze-v1 lead on deep DAILY history TODAY.
// Spec: low-vol regime (bottom-tercile 20d realized vol) + close breaks 20d high/low → enter, target
// +0.45*range, stop -0.225*range, hold ≤15d, cost 0.1R. Binance daily BTCUSDT back to 2017 (~2900 bars).
import { sharpe, mean, sampleStd, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";

const COST_R = 0.1, VOLW = 20, RANGEW = 20, TGT = 0.45, STOP = 0.225, HOLD = 15, PCTW = 252;

async function dailyBTC(): Promise<{ ts: string; o: number; h: number; l: number; c: number }[]> {
  const out: any[] = []; let endTime = Date.now();
  for (let p = 0; p < 6; p++) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    out.unshift(...k); endTime = k[0][0] - 1; if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const bars: any[] = [];
  for (const k of out) { if (seen.has(k[0])) continue; seen.add(k[0]); bars.push({ ts: new Date(k[0]).toISOString().slice(0, 10), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }); }
  return bars.sort((a, b) => a.ts < b.ts ? -1 : 1);
}
const std = (a: number[]) => sampleStd(a);

const b = await dailyBTC();
const ret = b.map((x, i) => i ? Math.log(x.c / b[i - 1].c) : 0);
console.log(`Deep daily BTC: ${b.length} bars, ${b[0]?.ts} → ${b[b.length - 1]?.ts}`);

// realized vol series + its trailing percentile (causal)
const rv = b.map((_, i) => i >= VOLW ? std(ret.slice(i - VOLW, i)) : NaN);
function lowVolRegime(i: number): boolean {
  if (!Number.isFinite(rv[i]) || i < PCTW) return false;
  const hist = rv.slice(i - PCTW, i).filter(Number.isFinite); if (hist.length < 100) return false;
  const rank = hist.filter((x) => x <= rv[i]).length / hist.length;
  return rank <= 1 / 3; // bottom tercile
}

const trades: number[] = []; let i = Math.max(VOLW, RANGEW, PCTW);
while (i < b.length - 1) {
  const priorHi = Math.max(...b.slice(i - RANGEW, i).map((x) => x.h));
  const priorLo = Math.min(...b.slice(i - RANGEW, i).map((x) => x.l));
  const range = priorHi - priorLo;
  if (range > 0 && lowVolRegime(i)) {
    let side = 0; if (b[i].c > priorHi) side = 1; else if (b[i].c < priorLo) side = -1;
    if (side !== 0) {
      const entry = b[i].c, tgt = entry + side * TGT * range, stp = entry - side * STOP * range;
      let r: number | null = null;
      for (let j = i + 1; j <= Math.min(i + HOLD, b.length - 1); j++) {
        const hitStop = side === 1 ? b[j].l <= stp : b[j].h >= stp;
        const hitTgt = side === 1 ? b[j].h >= tgt : b[j].l <= tgt;
        if (hitStop) { r = -1; break; }             // stop-first (pessimistic)
        if (hitTgt) { r = TGT / STOP; break; }       // = 2.0R
      }
      if (r === null) { const last = b[Math.min(i + HOLD, b.length - 1)].c; r = (side * (last - entry)) / (STOP * range); }
      trades.push(r - COST_R); i += 1; continue;
    }
  }
  i += 1;
}

const exp = trades.length ? mean(trades) : 0, sh = trades.length >= 2 ? sharpe(trades) : 0;
const wins = trades.filter((x) => x > 0).length;
console.log(`\n════ FROZEN LEAD  btc-squeeze-v1  (deep daily, ${b.length} bars) ════`);
console.log(`  trades (N):            ${trades.length}`);
console.log(`  win rate:             ${trades.length ? (wins / trades.length * 100).toFixed(0) : 0}%`);
console.log(`  per-trade expectancy: ${exp >= 0 ? "+" : ""}${exp.toFixed(3)}R`);
console.log(`  per-trade Sharpe:     ${sh.toFixed(3)}`);
console.log(`  total R:              ${trades.reduce((a, c) => a + c, 0).toFixed(1)}R`);
if (trades.length >= 10) {
  const h = Math.floor(trades.length / 2);
  console.log(`  walk-forward: first-half ${mean(trades.slice(0, h)) >= 0 ? "+" : ""}${mean(trades.slice(0, h)).toFixed(3)}R → last-half ${mean(trades.slice(h)) >= 0 ? "+" : ""}${mean(trades.slice(h)).toFixed(3)}R`);
}
console.log(`\nHonest note: single frozen spec (not a 4860-search) so no big deflation, but N is the real test. Cost ${COST_R}R/trade charged.`);
