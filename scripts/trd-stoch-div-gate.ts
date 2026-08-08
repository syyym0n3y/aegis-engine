#!/usr/bin/env -S deno run --allow-net
// trd-stoch-div-gate — RECONSTRUCT "Stochastic Divergence AW" (mql5 #87097) from its documented spec and
// gate it. Spec: divergence between price and the Stochastic oscillator, REGULAR (reversal) + HIDDEN
// (continuation), non-repaint (signal confirmed at pivot). Both directions. No look-ahead: a swing pivot at
// bar i is only CONFIRMED w bars later; entry = confirm+1 open. 4 signal types = 4 trials → deflated Sharpe.
// Universe spans stocks + commodities + crypto; SHORTS included by construction (bearish divergences).
import { atr, type Bar } from "../supabase/functions/_shared/trd-meanrev.ts";
import { mean, sharpe, deflatedSharpe, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const UNIVERSE = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","SMH","XBI","EEM","FXI","EWZ","GLD","SLV","USO","DBC","TLT","HYG","AAPL","MSFT","NVDA","TSLA","AMZN","META","AMD","BTC-USD","ETH-USD"];
const STO_N = 14, STO_D = 3, PIV = 3, HORIZON = 5, STOP_ATR = 2, ATRP = 10, COST = 0.05;

async function bars(sym: string): Promise<Bar[]> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < res.timestamp.length; i++) { const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i]; if ([o,h,l,c].some((x)=>x==null||!Number.isFinite(x))) continue; out.push({ d:new Date(res.timestamp[i]*1000).toISOString().slice(0,10), o,h,l,c }); }
  return out;
}
function stoch(b: Bar[]): number[] {
  const k: number[] = new Array(b.length).fill(NaN);
  for (let i = STO_N - 1; i < b.length; i++) { let hh=-Infinity,ll=Infinity; for (let j=i-STO_N+1;j<=i;j++){ if(b[j].h>hh)hh=b[j].h; if(b[j].l<ll)ll=b[j].l; } k[i] = hh>ll ? 100*(b[i].c-ll)/(hh-ll) : 50; }
  const d: number[] = new Array(b.length).fill(NaN); // %D = SMA(%K,3)
  for (let i = STO_N - 1 + STO_D - 1; i < b.length; i++) { let s=0; for (let j=i-STO_D+1;j<=i;j++)s+=k[j]; d[i]=s/STO_D; }
  return d;
}
// confirmed swing pivots (no look-ahead): pivot at i confirmed at i+PIV
function pivots(b: Bar[], lowSide: boolean): number[] {
  const out: number[] = [];
  for (let i = PIV; i < b.length - PIV; i++) {
    let ok = true;
    for (let j = i - PIV; j <= i + PIV; j++) { if (j === i) continue; if (lowSide ? b[j].l <= b[i].l : b[j].h >= b[i].h) { ok = false; break; } }
    if (ok) out.push(i);
  }
  return out;
}
type Trade = { r: number; is: boolean };
const byType: Record<string, Trade[]> = { "reg-bull(long)":[], "reg-bear(short)":[], "hid-bull(long)":[], "hid-bear(short)":[] };

for (const sym of UNIVERSE) {
  const b = await bars(sym); if (b.length < 260) continue;
  const d = stoch(b); const at = atr(b, ATRP); const cut = Math.floor(b.length * 0.6);
  const pl = pivots(b, true), ph = pivots(b, false);
  const emit = (confirmIdx: number, side: 1 | -1, type: string) => {
    const entryIdx = confirmIdx + 1; if (entryIdx + HORIZON >= b.length || !(at[confirmIdx] > 0)) return;
    const entry = b[entryIdx].o, stop = entry - side*STOP_ATR*at[confirmIdx]; let r: number | null = null;
    for (let k=entryIdx;k<=entryIdx+HORIZON;k++){ if (side===1? b[k].l<=stop : b[k].h>=stop){ r=-1; break; } }
    if (r===null) r = side*(b[entryIdx+HORIZON].c-entry)/(STOP_ATR*at[confirmIdx]);
    byType[type].push({ r: r - COST, is: entryIdx < cut });
  };
  // bullish divergences from consecutive pivot LOWS
  for (let n = 1; n < pl.length; n++) { const a = pl[n-1], c = pl[n]; if (!Number.isFinite(d[a])||!Number.isFinite(d[c])) continue; const confirm = c + PIV; if (confirm >= b.length) continue;
    if (b[c].l < b[a].l && d[c] > d[a]) emit(confirm, 1, "reg-bull(long)");       // price LL, stoch HL
    else if (b[c].l > b[a].l && d[c] < d[a]) emit(confirm, 1, "hid-bull(long)");  // price HL, stoch LL
  }
  // bearish divergences from consecutive pivot HIGHS
  for (let n = 1; n < ph.length; n++) { const a = ph[n-1], c = ph[n]; if (!Number.isFinite(d[a])||!Number.isFinite(d[c])) continue; const confirm = c + PIV; if (confirm >= b.length) continue;
    if (b[c].h > b[a].h && d[c] < d[a]) emit(confirm, -1, "reg-bear(short)");      // price HH, stoch LH
    else if (b[c].h < b[a].h && d[c] > d[a]) emit(confirm, -1, "hid-bear(short)"); // price LH, stoch HH
  }
}
const agg = (t:Trade[]) => t.length ? `${(mean(t.map(x=>x.r))>=0?"+":"")}${mean(t.map(x=>x.r)).toFixed(3)}R/${(t.filter(x=>x.r>0).length/t.length*100).toFixed(0)}%/n=${t.length}` : "—";
const skewKurt = (a:number[]) => { const m=mean(a),s=sampleStd(a); if(!(s>0))return[0,3]; let sk=0,ku=0; for(const x of a){const z=(x-m)/s;sk+=z**3;ku+=z**4;} return [sk/a.length,ku/a.length]; };

console.log(`RECONSTRUCTED "Stochastic Divergence AW" (mql5 #87097) — %K${STO_N}/%D${STO_D}, pivots ±${PIV} (no look-ahead), ${UNIVERSE.length} instruments, FULL Yahoo hist, ${HORIZON}d/${STOP_ATR}ATR, cost ${COST}R.\n`);
const trialSharpes: number[] = []; const types = Object.keys(byType);
for (const ty of types) { const t = byType[ty]; const sr = t.length? sharpe(t.map(x=>x.r)):0; trialSharpes.push(sr);
  console.log(`${ty.padEnd(16)} ALL ${agg(t)}   IS ${agg(t.filter(x=>x.is))} → OOS ${agg(t.filter(x=>!x.is))}   Sharpe ${sr>=0?"+":""}${sr.toFixed(3)}`); }
const all = types.flatMap(ty=>byType[ty]); console.log(`${"COMBINED".padEnd(16)} ALL ${agg(all)}   IS ${agg(all.filter(x=>x.is))} → OOS ${agg(all.filter(x=>!x.is))}`);
const iBest = trialSharpes.indexOf(Math.max(...trialSharpes)); const bt = byType[types[iBest]].map(x=>x.r); const [sk,ku]=skewKurt(bt);
const varTrials = sampleStd(trialSharpes)**2 || 0.25; const dsr = deflatedSharpe(sharpe(bt), bt.length, sk, ku, types.length, varTrials);
console.log(`\nGATE (best type ${types[iBest]}, deflated over ${types.length} trials): Sharpe ${sharpe(bt).toFixed(3)} → Deflated Sharpe Prob = ${(dsr*100).toFixed(1)}%`);
console.log(`VERDICT RULE: DSR>95% AND OOS>0 to survive. Shorts (reg/hid-bear) reported separately — no long-only bias.`);
