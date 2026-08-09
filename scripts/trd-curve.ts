#!/usr/bin/env -S deno run --allow-net
// trd-curve — commodity TERM-STRUCTURE / roll-yield (D-210). Dated Yahoo contracts are unavailable, so test the edge
// in its CAPTURABLE form via real ETFs: (1) roll-OPTIMIZED indices that hold backwardated contracts (USCI, DBC, COMT)
// vs NAIVE front-month indices (GSG, DJP, USO) — if roll-selection wins risk-adjusted, the term-structure premium is
// real; (2) front vs 12-month-laddered single commodities (USO/USL, UNG/UNL) — the direct roll-drag. Free (Yahoo full).
import { mean, sampleStd, sharpe, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
async function daily(sym:string):Promise<{d:string;c:number}[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o=[];for(let i=0;i<t.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c))o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),c});}return o;}catch{return[];}}
function stats(b:{d:string;c:number}[]){const cl=b.map(x=>x.c);const rets:number[]=[];for(let i=1;i<cl.length;i++)rets.push(cl[i]/cl[i-1]-1);const yrs=(Date.parse(b[b.length-1].d)-Date.parse(b[0].d))/(365.25*864e5);return{yrs,cagr:(Math.pow(cl[cl.length-1]/cl[0],1/yrs)-1)*100,vol:sampleStd(rets)*Math.sqrt(252)*100,sh:sharpe(rets)*Math.sqrt(252),dd:maxDrawdown(rets)*100,rets};}
function alignRet(a:{d:string;c:number}[],b:{d:string;c:number}[]){const mb=new Map(b.map(x=>[x.d,x.c]));const A=a.filter(x=>mb.has(x.d));const ra:number[]=[],rb:number[]=[];for(let i=1;i<A.length;i++){ra.push(A[i].c/A[i-1].c-1);rb.push(mb.get(A[i].d)!/mb.get(A[i-1].d)!-1);}return{ra,rb,n:ra.length,d0:A[0]?.d,d1:A.at(-1)?.d};}
console.log(`=== TERM-STRUCTURE test 1: roll-OPTIMIZED vs NAIVE front-month commodity indices (full history) ===`);
console.log(`${"index".padEnd(30)} ${"yrs".padStart(4)} ${"CAGR%".padStart(6)} ${"vol%".padStart(5)} ${"Sharpe".padStart(7)} ${"maxDD%".padStart(7)}`);
for(const[s,n]of [["USCI","USCI — holds backwardated (roll-opt)"],["DBC","DBC — optimum-yield roll"],["COMT","COMT — roll-aware"],["GSG","GSG — S&P GSCI (naive front)"],["DJP","DJP — Bloomberg (front sched)"],["USO","USO — front-month oil (naive)"]] as const){
  const b=await daily(s);if(b.length<400){console.log(`${n.padEnd(30)} short`);continue;}const x=stats(b);
  console.log(`${n.padEnd(30)} ${x.yrs.toFixed(0).padStart(4)} ${x.cagr.toFixed(1).padStart(6)} ${x.vol.toFixed(1).padStart(5)} ${x.sh.toFixed(2).padStart(7)} ${x.dd.toFixed(0).padStart(7)}`);
}
console.log(`\n=== TERM-STRUCTURE test 2: front vs 12-month-LADDERED (direct roll drag, same commodity) ===`);
for(const[f,l,name]of [["USO","USL","oil"],["UNG","UNL","natgas"]] as const){
  const bf=await daily(f),bl=await daily(l);const {ra,rb,n,d0,d1}=alignRet(bf,bl);if(n<300)continue;
  const cumF=ra.reduce((a,b)=>a*(1+b),1),cumL=rb.reduce((a,b)=>a*(1+b),1);const yrs=(Date.parse(d1!)-Date.parse(d0!))/(365.25*864e5);
  const rollDrag=((Math.pow(cumL,1/yrs)-1)-(Math.pow(cumF,1/yrs)-1))*100;
  console.log(`${name.padEnd(8)} front ${f} CAGR ${((Math.pow(cumF,1/yrs)-1)*100).toFixed(1)}%  vs laddered ${l} CAGR ${((Math.pow(cumL,1/yrs)-1)*100).toFixed(1)}%  → roll drag on front ≈ ${rollDrag>=0?"+":""}${rollDrag.toFixed(1)}%/yr`);
}
console.log(`\nREAD: if roll-optimized (USCI/DBC) Sharpe > naive (GSG/DJP/USO), the term-structure roll premium is REAL &`);
console.log(`capturable. If laddered beats front by a big +%/yr, front-month rolling bleeds that to contango (the roll cost).`);
