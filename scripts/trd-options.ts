#!/usr/bin/env -S deno run --allow-net
// trd-options — OVERCOMES the "no free options data" wall (operator D-207). Two real, free, multi-horizon tests:
// (1) VARIANCE RISK PREMIUM — implied vol (^VIX/^GVZ/^OVX) vs the REALIZED vol that follows, over 5/21/63-day
//     horizons ("across timeframes"). If implied is systematically ABOVE realized, selling options is a real premium.
// (2) CBOE systematic option strategies (^PUT put-write, ^BXM buy-write) — real 30–38yr option-return series — gated
//     vs the underlying (SPY) and for tail risk. Free (Yahoo). Honest: VRP is a RISK premium (fat left tail), not a
//     free lunch — measured with its drawdown so the risk gate can size it.
import { mean, sampleStd, sharpe, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O??c,h:h??c,l:l??c,c});}return o;}catch{return[];}}
function align(a:B[],b:B[]){const m=new Map(b.map(x=>[x.d,x.c]));const out:{d:string;iv:number;px:number}[]=[];for(const x of a){const px=m.get(x.d);if(px!=null)out.push({d:x.d,iv:x.c,px});}return out;}
function fwdRV(px:number[],i:number,h:number){if(i+h>=px.length)return NaN;let s=0;const r:number[]=[];for(let k=i+1;k<=i+h;k++)r.push(Math.log(px[k]/px[k-1]));const m=r.reduce((a,b)=>a+b,0)/r.length;for(const x of r)s+=(x-m)**2;return Math.sqrt(s/r.length)*Math.sqrt(252)*100;}
function tstat(x:number[]){return mean(x)/(sampleStd(x)/Math.sqrt(x.length));}

console.log(`=== OPTIONS TEST 1: VARIANCE RISK PREMIUM (implied vs realized, multi-horizon) ===`);
console.log(`VRP = implied vol − the realized vol that FOLLOWS. Positive & significant = selling options is a real premium.\n`);
console.log(`${"asset".padEnd(10)} ${"horizon".padEnd(8)} ${"n".padStart(5)} ${"meanIV".padStart(7)} ${"meanRV".padStart(7)} ${"VRP".padStart(6)} ${"IV>RV%".padStart(7)} ${"t".padStart(6)}`);
for(const[under,ivsym,label]of [["SPY","^VIX","S&P"],["GLD","^GVZ","gold"],["USO","^OVX","oil"]] as const){
  const uv=await daily(under),iv=await daily(ivsym);if(!uv.length||!iv.length){console.log(`${label} — data missing`);continue;}
  const A=align(iv,uv);const px=A.map(x=>x.px);
  for(const h of [5,21,63]){const vrp:number[]=[];let hit=0,n=0;for(let i=0;i<A.length;i++){const rv=fwdRV(px,i,h);if(!Number.isFinite(rv))continue;const d=A[i].iv-rv;vrp.push(d);if(d>0)hit++;n++;}
    if(vrp.length<50)continue;console.log(`${label.padEnd(10)} ${(h+"d").padEnd(8)} ${String(n).padStart(5)} ${mean(A.map(x=>x.iv)).toFixed(1).padStart(7)} ${(mean(A.map(x=>x.iv))-mean(vrp)).toFixed(1).padStart(7)} ${(mean(vrp)>=0?"+":"")+mean(vrp).toFixed(2)} ${(hit/n*100).toFixed(0).padStart(6)}% ${tstat(vrp).toFixed(1).padStart(6)}`);}
  console.log("");
}
console.log(`=== OPTIONS TEST 2: CBOE systematic option strategies vs SPY (real 30-38yr option returns) ===`);
console.log(`${"index".padEnd(22)} ${"yrs".padStart(4)} ${"CAGR%".padStart(6)} ${"vol%".padStart(6)} ${"Sharpe".padStart(7)} ${"maxDD%".padStart(7)}`);
for(const[sym,name]of [["^PUT","PutWrite (sell puts)"],["^BXM","BuyWrite (covered call)"],["SPY","SPY (benchmark)"]] as const){
  const b=await daily(sym);if(b.length<500){console.log(`${name} — short`);continue;}const cl=b.map(x=>x.c);const rets:number[]=[];for(let i=1;i<cl.length;i++)rets.push(cl[i]/cl[i-1]-1);
  const yrs=(Date.parse(b[b.length-1].d)-Date.parse(b[0].d))/(365.25*864e5);const cagr=(Math.pow(cl[cl.length-1]/cl[0],1/yrs)-1)*100;
  console.log(`${name.padEnd(22)} ${yrs.toFixed(0).padStart(4)} ${cagr.toFixed(1).padStart(6)} ${(sampleStd(rets)*Math.sqrt(252)*100).toFixed(1).padStart(6)} ${(sharpe(rets)*Math.sqrt(252)).toFixed(2).padStart(7)} ${(maxDrawdown(rets)*100).toFixed(0).padStart(7)}`);
}
console.log(`\nREAD: positive significant VRP at every horizon = selling vol is a real premium (but a RISK premium — see maxDD).`);
console.log(`If PutWrite matches SPY return at LOWER vol/drawdown, the options premium is real risk-adjusted alpha (crash-exposed).`);
