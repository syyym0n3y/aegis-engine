#!/usr/bin/env -S deno run --allow-net
// trd-momentum — the momentum families we HADN'T tested with the current method (D-211): (1) CROSS-SECTIONAL momentum
// (Jegadeesh-Titman 12-1m relative strength: long top-quintile past-return, short bottom, market-neutral, monthly) —
// the most documented factor; we only tested cross-sectional REVERSAL (D-188) before. (2) TIME-SERIES momentum
// (managed-futures trend: long if past-12m>0 else short, per asset). vs random. Free (Yahoo daily). Market-neutral
// XS cancels drift (PLAYBOOK #2).
import { mean, sampleStd, sharpe } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=321; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
async function daily(sym:string):Promise<Map<string,number>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return new Map();const t=res.timestamp,q=res.indicators.quote[0],m=new Map<string,number>();for(let i=0;i<t.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c)&&c>0)m.set(new Date(t[i]*1000).toISOString().slice(0,10),c);}return m;}catch{return new Map();}}
const EQ=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","DIS","NKE","CAT","GE","BA","AMD","NFLX","CRM","ADBE","QCOM","TXN","INTC","CSCO","PFE","T","VZ","WFC","GS","MS","C","COP","SLB","LOW","TGT","DE","UPS","FDX","MCD","SBUX","GILD","AMGN","BMY","GM","F","UBER"];
const cache=new Map<string,Map<string,number>>();const get=async(s:string)=>{if(!cache.has(s))cache.set(s,await daily(s));return cache.get(s)!;};
// ---- (1) cross-sectional momentum ----
console.log(`(1) CROSS-SECTIONAL MOMENTUM (12-1m relative strength, long top / short bottom quintile, monthly, market-neutral)\n`);
const series:Record<string,Map<string,number>>={};for(const s of EQ){const m=await get(s);if(m.size>400)series[s]=m;}
const names=Object.keys(series);const allDates=new Set<string>();for(const s of names)for(const d of series[s].keys())allDates.add(d);
const dates=[...allDates].sort().filter((_,i)=>i%21===0); // ~monthly grid
const px=(s:string,d:string)=>series[s].get(d);
function nearest(s:string,d:string){const m=series[s];if(m.has(d))return m.get(d);return undefined;}
const sig:number[]=[],ctrl:number[]=[];
for(let i=13;i<dates.length-1;i++){const dNow=dates[i],dSkip=dates[i-1],d12=dates[i-13],dFwd=dates[i+1];
  const rows:{s:string;mom:number;fwd:number}[]=[];
  for(const s of names){const p12=nearest(s,d12),pSkip=nearest(s,dSkip),pNow=nearest(s,dNow),pFwd=nearest(s,dFwd);if(p12==null||pSkip==null||pNow==null||pFwd==null)continue;
    rows.push({s,mom:pSkip/p12-1,fwd:pFwd/pNow-1});}
  if(rows.length<20)continue;rows.sort((a,b)=>a.mom-b.mom);const q=Math.max(1,Math.floor(rows.length*0.2));
  const losers=rows.slice(0,q),winners=rows.slice(-q);const cost=(3/10000)*2*2;
  sig.push((mean(winners.map(r=>r.fwd))-mean(losers.map(r=>r.fwd))-cost)*100); // long winners short losers
  const sh=[...rows];for(let k=sh.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[sh[k],sh[j]]=[sh[j],sh[k]];}
  ctrl.push((mean(sh.slice(0,q).map(r=>r.fwd))-mean(sh.slice(q,2*q).map(r=>r.fwd))-cost)*100);}
{const g=edgeVsRandom(sig,ctrl,2,20);const yrs=dates.length*21/252;console.log(`  n=${sig.length} months (${yrs.toFixed(0)}y)  spread ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)}%/mo  vsRand ${g.controlMean.toFixed(3)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)}  t=${g.tStat.toFixed(2)}  ${g.passes&&g.setupMean>0?"✓ MOMENTUM FACTOR real":"✗ not significant"}`);
 const shp=sharpe(sig)*Math.sqrt(12);console.log(`  long-short annualized Sharpe ≈ ${shp.toFixed(2)}`);}
// ---- (2) time-series momentum ----
console.log(`\n(2) TIME-SERIES MOMENTUM (trend: long if past-12m return>0 else short, per asset) — multi-asset\n`);
const TS=["SPY","QQQ","IWM","EEM","EFA","TLT","IEF","HYG","GLD","SLV","DBC","USO","UNG","BTC-USD","ETH-USD","UUP","FXE","XLE","XLF","XLK"];
let tsSig=0,tsN=0;const perAsset:number[]=[];
for(const s of TS){const m=await get(s);if(m.size<400)continue;const ds=[...m.keys()].sort();const rr:number[]=[];
  for(let i=252;i<ds.length-21;i+=21){const p0=m.get(ds[i-252])!,pn=m.get(ds[i])!,pf=m.get(ds[i+21])!;const dir=pn>p0?1:-1;rr.push(dir*(pf/pn-1));}
  if(rr.length<20)continue;const t=mean(rr)/(sampleStd(rr)/Math.sqrt(rr.length));perAsset.push(t);tsN++;if(t>=2&&mean(rr)>0)tsSig++;}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
console.log(`  ${tsSig}/${tsN} assets show significant time-series-momentum (t≥2). binom p=${binomUpper(tsSig,tsN,0.025).toExponential(1)} → ${binomUpper(tsSig,tsN,0.025)<0.001?"SYSTEMATIC trend":binomUpper(tsSig,tsN,0.025)<0.05?"leans":"NOT systematic"}`);
