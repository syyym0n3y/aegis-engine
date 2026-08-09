#!/usr/bin/env -S deno run --allow-net
// trd-leadlag — untested (D-209): INTERMARKET LEAD-LAG (slow information diffusion) + CARRY (via carry ETFs).
// Lead-lag: does leader's return on day t predict follower's day t+1? Trade follower in the leader's direction next
// open, vs random. Carry: real carry-strategy ETFs (DBV FX-carry) vs their benchmark, risk-adjusted. Free (Yahoo).
import { mean, sampleStd, sharpe, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=77; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
async function dmap(sym:string):Promise<Map<string,{o:number;c:number}>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return new Map();const t=res.timestamp,q=res.indicators.quote[0],m=new Map();for(let i=0;i<t.length;i++){const o=q.open[i],c=q.close[i];if(o!=null&&c!=null&&Number.isFinite(o)&&Number.isFinite(c))m.set(new Date(t[i]*1000).toISOString().slice(0,10),{o,c});}return m;}catch{return new Map();}}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
const PAIRS:[string,string,string][]=[["TLT","SPY","bonds→stocks"],["HYG","SPY","credit→stocks"],["CL=F","XLE","oil→energy"],["HG=F","XLI","copper→industrials"],["SMH","QQQ","semis→tech"],["IWM","SPY","smallcap→large"],["^VIX","SPY","vol→stocks"],["CL=F","JETS","oil→airlines"],["DX-Y.NYB","GLD","dollar→gold"],["EEM","SPY","EM→US"],["XLF","SPY","banks→market"],["BTC-USD","COIN","btc→coinbase"],["GLD","GDX","gold→miners"],["TLT","XLU","rates→utilities"],["HG=F","CAT","copper→machinery"],["^TNX","XLF","yields→banks"]];
const SPREAD=3,COST=(SPREAD/10000)*2;
console.log(`INTERMARKET LEAD-LAG — leader[t] predicts follower[t+1]? Trade follower next open in leader's dir, vs random.\n`);
console.log(`${"leader→follower".padEnd(22)} ${"n".padStart(5)} ${"setupR%".padStart(8)} ${"randR%".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
const cache=new Map<string,Map<string,{o:number;c:number}>>();const get=async(s:string)=>{if(!cache.has(s))cache.set(s,await dmap(s));return cache.get(s)!;};
let good=0,tested=0;
for(const[L,F,lbl]of PAIRS){const ml=await get(L),mf=await get(F);const dates=[...ml.keys()].filter(d=>mf.has(d)).sort();if(dates.length<300)continue;
  const S:number[]=[],C:number[]=[];
  for(let i=1;i<dates.length-1;i++){const lret=ml.get(dates[i])!.c/ml.get(dates[i-1])!.c-1;const fo=mf.get(dates[i+1])?.o,fc=mf.get(dates[i+1])?.c;if(fo==null||fc==null)continue;
    const dir=lret>0?1:-1;const fret=dir*(fc/fo-1)-COST;S.push(fret*100);
    if(rnd()<0.5){const rd=rnd()<0.5?1:-1;C.push((rd*(fc/fo-1)-COST)*100);}}
  if(S.length>=50&&C.length>=50){tested++;const g=edgeVsRandom(S,C,2,50);const ok=g.passes&&g.setupMean>0;if(ok)good++;
    console.log(`${lbl.padEnd(22)} ${String(S.length).padStart(5)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(7)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${ok?"✓ predictive":g.setupMean>0?"pos":"✗"}`);}
}
const p=binomUpper(good,tested,0.05);
console.log(`\n${good}/${tested} intermarket links predictive at t≥2 → ${p<0.001?"SYSTEMATIC lead-lag":p<0.05?"leans":"NOT systematic (efficiently priced)"} (binom p=${p.toExponential(1)})\n`);
console.log(`=== CARRY (real carry-strategy ETFs vs benchmark) ===`);
console.log(`${"strategy".padEnd(26)} ${"yrs".padStart(4)} ${"CAGR%".padStart(6)} ${"vol%".padStart(6)} ${"Sharpe".padStart(7)} ${"maxDD%".padStart(7)}`);
for(const[sym,name]of [["DBV","FX carry (G10 harvest)"],["UUP","US dollar (bench)"],["SPY","SPY (bench)"]] as const){
  const m=await get(sym);const dates=[...m.keys()].sort();if(dates.length<400){console.log(`${name} — short/NA`);continue;}const cl=dates.map(d=>m.get(d)!.c);const rets:number[]=[];for(let i=1;i<cl.length;i++)rets.push(cl[i]/cl[i-1]-1);
  const yrs=(Date.parse(dates[dates.length-1])-Date.parse(dates[0]))/(365.25*864e5);const cagr=(Math.pow(cl[cl.length-1]/cl[0],1/yrs)-1)*100;
  console.log(`${name.padEnd(26)} ${yrs.toFixed(0).padStart(4)} ${cagr.toFixed(1).padStart(6)} ${(sampleStd(rets)*Math.sqrt(252)*100).toFixed(1).padStart(6)} ${(sharpe(rets)*Math.sqrt(252)).toFixed(2).padStart(7)} ${(maxDrawdown(rets)*100).toFixed(0).padStart(7)}`);
}
