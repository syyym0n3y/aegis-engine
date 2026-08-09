#!/usr/bin/env -S deno run --allow-net
// trd-factors — documented equity FACTORS in capturable form (D-213): real factor ETFs vs SPY, full history. Value,
// quality, size, min-vol, momentum, dividend. Risk-adjusted (Sharpe) + the long-short spread where a clean pair exists
// (value−growth, small−large). Tests whether each factor is a real, capturable premium on a BROAD basis (fixes the
// mega-cap-only low-vol artifact of D-212). Free (Yahoo).
import { sampleStd, sharpe, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
async function daily(sym:string):Promise<{d:string;c:number}[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o=[];for(let i=0;i<t.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c))o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),c});}return o;}catch{return[];}}
function stats(b:{d:string;c:number}[]){const cl=b.map(x=>x.c);const rets:number[]=[];for(let i=1;i<cl.length;i++)rets.push(cl[i]/cl[i-1]-1);const yrs=(Date.parse(b[b.length-1].d)-Date.parse(b[0].d))/(365.25*864e5);return{yrs,cagr:(Math.pow(cl[cl.length-1]/cl[0],1/yrs)-1)*100,vol:sampleStd(rets)*Math.sqrt(252)*100,sh:sharpe(rets)*Math.sqrt(252),dd:maxDrawdown(rets)*100};}
const cache=new Map();const get=async(s:string)=>{if(!cache.has(s))cache.set(s,await daily(s));return cache.get(s);};
console.log(`DOCUMENTED FACTORS (real ETFs vs SPY, full history) — is each a capturable, risk-adjusted premium?\n`);
console.log(`${"factor ETF".padEnd(28)} ${"yrs".padStart(4)} ${"CAGR%".padStart(6)} ${"vol%".padStart(5)} ${"Sharpe".padStart(7)} ${"vs SPY".padStart(7)}`);
const spy=stats(await get("SPY"));
for(const[s,n]of [["MTUM","momentum (MTUM)"],["QUAL","quality (QUAL)"],["USMV","min-volatility (USMV)"],["SPLV","low-vol (SPLV)"],["VTV","value large (VTV)"],["VUG","growth large (VUG)"],["IWN","small value (IWN)"],["IWM","small size (IWM)"],["SPHD","high-div low-vol (SPHD)"],["COWZ","cash-cows/quality-value"],["SPY","— SPY benchmark"]] as const){
  const b=await get(s);if(!b||b.length<400){console.log(`${n.padEnd(28)} short`);continue;}const x=stats(b);
  console.log(`${n.padEnd(28)} ${x.yrs.toFixed(0).padStart(4)} ${x.cagr.toFixed(1).padStart(6)} ${x.vol.toFixed(1).padStart(5)} ${x.sh.toFixed(2).padStart(7)} ${(x.sh-spy.sh>=0?"+":"")+(x.sh-spy.sh).toFixed(2).padStart(6)}`);
}
console.log(`\nLong-short factor spreads (annualized, full common history):`);
for(const[a,b,name]of [["VTV","VUG","value − growth (large)"],["IWN","IWO","value − growth (small)"],["IWM","SPY","size (small − large)"],["MTUM","SPY","momentum − market"],["USMV","SPY","min-vol − market"]] as const){
  const ba=await get(a),bb=await get(b);if(!ba||!bb)continue;const mb=new Map<string,number>(bb.map((x:{d:string;c:number})=>[x.d,x.c]));const A=ba.filter((x:{d:string;c:number})=>mb.has(x.d));if(A.length<400)continue;
  const yrs=(Date.parse(A[A.length-1].d)-Date.parse(A[0].d))/(365.25*864e5);
  const cbEnd=mb.get(A[A.length-1].d)!,cbStart=mb.get(A[0].d)!;const ca=A[A.length-1].c/A[0].c,cbv=cbEnd/cbStart;
  const spread=((Math.pow(ca,1/yrs)-1)-(Math.pow(cbv,1/yrs)-1))*100;
  console.log(`  ${name.padEnd(26)} ${(spread>=0?"+":"")+spread.toFixed(1)}%/yr  (${yrs.toFixed(0)}y)  ${spread>1?"✓ factor positive":spread<-1?"✗ negative":"~ flat"}`);
}
