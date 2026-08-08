#!/usr/bin/env -S deno run --allow-net
// trd-overnight — a robust anomaly we never tested (operator D-207): decompose each day into OVERNIGHT (prev close→
// today open) and INTRADAY (open→close). The claim: equities earn their drift overnight; intraday is flat/negative.
// Per-instrument, de-biased: is overnight return systematically positive AND greater than intraday? Count how many
// instruments individually show it (Binomial null). Free (Yahoo daily OHLC). Costs: overnight-only = 1 round-trip/day
// at the open — realistic only for liquid names; we report gross and note the cost hurdle.
import { mean, sampleStd, sharpe } from "../supabase/functions/_shared/trd-stats.ts";
interface B{o:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],c=q.close[i];if(O==null||c==null||!Number.isFinite(O)||!Number.isFinite(c))continue;o.push({o:O,c});}return o;}catch{return[];}}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
function tstat(x:number[]){return mean(x)/(sampleStd(x)/Math.sqrt(x.length));}
const UNIV:Record<string,string[]>={
  "eq-mega":["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","ADBE","AMD","NFLX","DIS","NKE"],
  "etf":["SPY","QQQ","IWM","DIA","XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLU","SMH","EEM","EFA","TLT","HYG","GLD"],
  "crypto":["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"],
};
console.log(`OVERNIGHT vs INTRADAY drift — per-instrument, de-biased. Does the drift live overnight (close→open)?\n`);
console.log(`${"class".padEnd(9)} ${"N".padStart(3)} ${"onSig".padStart(5)} ${"on>day".padStart(7)} ${"medON".padStart(7)} ${"medDAY".padStart(7)} ${"medΔ".padStart(7)} ${"binom p".padStart(9)}  verdict`);
for(const[cls,syms]of Object.entries(UNIV)){
  const rows:{onT:number;onMean:number;dayMean:number;onSh:number}[]=[];
  for(const sym of syms){const b=await daily(sym);if(b.length<300)continue;const on:number[]=[],day:number[]=[];for(let i=1;i<b.length;i++){on.push(b[i].o/b[i-1].c-1);day.push(b[i].c/b[i].o-1);}
    rows.push({onT:tstat(on),onMean:mean(on)*252*100,dayMean:mean(day)*252*100,onSh:sharpe(on)*Math.sqrt(252)});}
  if(rows.length<4)continue;
  const N=rows.length,kSig=rows.filter(r=>r.onMean>0&&r.onT>=2).length,kBeat=rows.filter(r=>r.onMean>r.dayMean).length;
  const medON=rows.map(r=>r.onMean).sort((a,b)=>a-b)[Math.floor(N/2)],medDAY=rows.map(r=>r.dayMean).sort((a,b)=>a-b)[Math.floor(N/2)];
  const p=binomUpper(kSig,N,0.025);const v=p<0.001?"✓✓ SYSTEMATIC overnight drift":p<0.05?"~ leans":"✗ none";
  console.log(`${cls.padEnd(9)} ${String(N).padStart(3)} ${String(kSig).padStart(5)} ${(String(kBeat)+"/"+N).padStart(7)} ${(medON>=0?"+":"")+medON.toFixed(1)+"%"} ${(medDAY>=0?"+":"")+medDAY.toFixed(1)+"%"} ${(medON-medDAY>=0?"+":"")+(medON-medDAY).toFixed(1)+"%"} ${p.toExponential(1).padStart(9)}  ${v}`);
}
console.log(`\nmedON/medDAY = annualized overnight vs intraday return. If overnight >> intraday systematically, the drift is`);
console.log(`an overnight phenomenon (real anomaly) — but capturing it = daily round-trip at the open; cost hurdle is the test.`);
