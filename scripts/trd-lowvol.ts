#!/usr/bin/env -S deno run --allow-net
// low-volatility anomaly (BAB): rank by trailing 6m realized vol, long low-vol quintile / short high-vol, monthly,
// market-neutral. Documented factor (Frazzini-Pedersen). vs random. Free (Yahoo daily).
import { mean, sampleStd, sharpe } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=55; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
async function daily(sym:string):Promise<Map<string,number>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return new Map();const t=res.timestamp,q=res.indicators.quote[0],m=new Map<string,number>();for(let i=0;i<t.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c)&&c>0)m.set(new Date(t[i]*1000).toISOString().slice(0,10),c);}return m;}catch{return new Map();}}
const EQ=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","DIS","NKE","CAT","GE","BA","AMD","NFLX","CRM","ADBE","QCOM","TXN","INTC","CSCO","PFE","T","VZ","WFC","GS","MS","C","COP","SLB","LOW","TGT","DE","MCD","SBUX","GILD","AMGN","BMY","GM","F","DUK","SO","NEE"];
const series:Record<string,Map<string,number>>={};for(const s of EQ){const m=await daily(s);if(m.size>400)series[s]=m;}
const names=Object.keys(series);const allD=new Set<string>();for(const s of names)for(const d of series[s].keys())allD.add(d);
const dates=[...allD].sort().filter((_,i)=>i%21===0);
const sig:number[]=[],ctrl:number[]=[];
for(let i=7;i<dates.length-1;i++){const d0=dates[i-6],dN=dates[i],dF=dates[i+1];const rows:{vol:number;fwd:number}[]=[];
  for(const s of names){const m=series[s];const win:number[]=[];let prev:number|undefined;let ok=true;
    for(let k=i-6;k<=i;k++){const p=m.get(dates[k]);if(p==null){ok=false;break;}if(prev!=null)win.push(Math.log(p/prev));prev=p;}
    const pN=m.get(dN),pF=m.get(dF);if(!ok||pN==null||pF==null||win.length<3)continue;rows.push({vol:sampleStd(win),fwd:pF/pN-1});}
  if(rows.length<20)continue;rows.sort((a,b)=>a.vol-b.vol);const q=Math.max(1,Math.floor(rows.length*0.2));
  const lo=rows.slice(0,q),hi=rows.slice(-q);const cost=(3/10000)*4;
  sig.push((mean(lo.map(r=>r.fwd))-mean(hi.map(r=>r.fwd))-cost)*100); // long low-vol short high-vol
  const sh=[...rows];for(let k=sh.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[sh[k],sh[j]]=[sh[j],sh[k]];}
  ctrl.push((mean(sh.slice(0,q).map(r=>r.fwd))-mean(sh.slice(q,2*q).map(r=>r.fwd))-cost)*100);}
const g=edgeVsRandom(sig,ctrl,2,20);
console.log(`LOW-VOLATILITY anomaly (long low-vol / short high-vol quintile, monthly, market-neutral)`);
console.log(`  n=${sig.length} months  spread ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)}%/mo  vsRand ${g.controlMean.toFixed(3)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)}  t=${g.tStat.toFixed(2)}  Sharpe≈${(sharpe(sig)*Math.sqrt(12)).toFixed(2)}  ${g.passes&&g.setupMean>0?"✓ real":"✗ not significant"}`);
