#!/usr/bin/env -S deno run --allow-net
// trd-bsp-backtest — RECONSTRUCT "Buy and Sell Power" (M. Engstermann, mql5 #133177) from its DOCUMENTED
// spec and gate it like any other lead. The .ex5 is encrypted; the LOGIC is public on the author's page:
// buy/sell volume % over N bars from (tick) volume + fixed regime thresholds 55/62/65/70%.
// Standard intrabar volume split (Chaikin/AD-style): buyVol=vol*(c-l)/(h-l), sellVol=vol*(h-c)/(h-l).
// BUY% = 100*ΣbuyVol / Σ(buyVol+sellVol) over trailing N. Long when BUY%>=thr; short when BUY%<=100-thr.
// Test as a directional signal, 5d horizon, uniform 2ATR stop, cost 0.05R, IS/OOS 60/40. Real Yahoo daily
// (REAL equity volume — a fairer feed than the tick-volume the indicator uses). Per ANALYSIS_CONTRACT:
// number+N+OOS, every threshold counts as a trial → deflated Sharpe over the trial set.
import { atr, type Bar } from "../supabase/functions/_shared/trd-meanrev.ts";
import { mean, sharpe, deflatedSharpe, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const UNIVERSE = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","EEM","EFA","FXI","EWZ","GLD","SLV","USO","TLT","HYG","AAPL","MSFT","NVDA","TSLA","AMZN","META","GOOGL","AMD"];
const N = 14, HORIZON = 5, STOP_ATR = 2, ATRP = 10, COST = 0.05;
const THRESHOLDS = [55, 62, 65, 70]; // the documented regime bands, each a separate trial

type XBar = Bar & { v: number };
async function bars(sym: string): Promise<XBar[]> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const q = res.indicators.quote[0]; const out: XBar[] = [];
  for (let i = 0; i < res.timestamp.length; i++) { const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume[i]; if ([o,h,l,c,v].some((x)=>x==null||!Number.isFinite(x))) continue; out.push({ d:new Date(res.timestamp[i]*1000).toISOString().slice(0,10), o,h,l,c,v }); }
  return out;
}
// BUY% series (documented Buy/Sell Power)
function buyPct(b: XBar[]): number[] {
  const bv: number[] = [], sv: number[] = [];
  for (const x of b) { const rng = x.h - x.l; if (rng > 0) { bv.push(x.v*(x.c-x.l)/rng); sv.push(x.v*(x.h-x.c)/rng); } else { bv.push(x.v/2); sv.push(x.v/2); } }
  const out: number[] = new Array(b.length).fill(NaN);
  for (let i = N; i < b.length; i++) { let sb=0,ss=0; for (let k=i-N;k<i;k++){sb+=bv[k];ss+=sv[k];} out[i] = (sb+ss)>0 ? 100*sb/(sb+ss) : 50; }
  return out;
}

// collect per-trade R for each threshold across the whole universe
const perThr: Record<number, { r: number; is: boolean }[]> = {}; for (const t of THRESHOLDS) perThr[t] = [];
for (const sym of UNIVERSE) {
  const b = await bars(sym); if (b.length < 260) continue;
  const bp = buyPct(b); const at = atr(b as Bar[], ATRP); const cut = Math.floor(b.length * 0.6);
  for (let i = N + 1; i < b.length - HORIZON - 1; i++) {
    if (!(at[i] > 0) || !Number.isFinite(bp[i])) continue;
    for (const thr of THRESHOLDS) {
      let side: 1 | -1 | null = null;
      if (bp[i] >= thr) side = 1; else if (bp[i] <= 100 - thr) side = -1; else continue;
      const entry = b[i+1].o, stop = entry - side*STOP_ATR*at[i]; let r: number | null = null;
      for (let k=i+1;k<=i+HORIZON;k++){ if (side===1? b[k].l<=stop : b[k].h>=stop){ r=-1; break; } }
      if (r===null) r = side*(b[i+HORIZON].c-entry)/(STOP_ATR*at[i]);
      perThr[thr].push({ r: r - COST, is: i < cut });
    }
  }
}
const agg = (t:{r:number}[]) => t.length ? `${(mean(t.map(x=>x.r))>=0?"+":"")}${mean(t.map(x=>x.r)).toFixed(3)}R/${(t.filter(x=>x.r>0).length/t.length*100).toFixed(0)}%/n=${t.length}` : "—";
const skewKurt = (a:number[]) => { const m=mean(a),s=sampleStd(a); if(!(s>0))return[0,3]; let sk=0,ku=0; for(const x of a){const z=(x-m)/s; sk+=z**3; ku+=z**4;} return [sk/a.length, ku/a.length]; };

console.log(`RECONSTRUCTED "Buy and Sell Power" (mql5 #133177) — documented tick-volume buy/sell %, N=${N}, ${UNIVERSE.length} instruments, FULL Yahoo history, ${HORIZON}d horizon, ${STOP_ATR}ATR stop, cost ${COST}R.\n`);
const trialSharpes: number[] = [];
for (const thr of THRESHOLDS) {
  const t = perThr[thr]; const is = t.filter(x=>x.is), oos = t.filter(x=>!x.is);
  const sr = t.length ? sharpe(t.map(x=>x.r)) : 0; trialSharpes.push(sr);
  console.log(`thr ${thr}%:  ALL ${agg(t)}   IS ${agg(is)} → OOS ${agg(oos)}   per-trade Sharpe ${sr>=0?"+":""}${sr.toFixed(3)}`);
}
// deflate the BEST threshold's Sharpe over the 4-trial set (the honest multiple-testing correction)
const varTrials = trialSharpes.length>1 ? sampleStd(trialSharpes)**2 : 0.25;
const best = THRESHOLDS[trialSharpes.indexOf(Math.max(...trialSharpes))]; const bt = perThr[best].map(x=>x.r);
const [sk,ku] = skewKurt(bt); const bestSr = sharpe(bt);
const dsr = deflatedSharpe(bestSr, bt.length, sk, ku, THRESHOLDS.length, varTrials);
console.log(`\nGATE (best thr ${best}%, deflated over ${THRESHOLDS.length} trials): observed Sharpe ${bestSr.toFixed(3)}, skew ${sk.toFixed(2)}, kurt ${ku.toFixed(1)} → Deflated Sharpe Prob = ${(dsr*100).toFixed(1)}%`);
console.log(`VERDICT RULE: DSR>95% AND OOS expectancy>0 to survive. Anything else = REJECT (consistent with D-070 gate).`);
