#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-pead-deep — the DEFINITIVE PEAD test (D-225). Real earnings surprises (AlphaVantage EARNINGS, 30yr) × Yahoo
// prices. For each announcement: standardized-unexpected-earnings SUE = surprise / stddev(stock's surprises); enter
// the trading day AFTER reportedDate (skip the jump, capture the DRIFT); MARKET-ADJUSTED drift over 20/60 days
// (stock return − SPY return, removes the beta/drift confound); PEAD contribution = sign(surprise)×marketAdjDrift.
// Tests: pooled t, magnitude signature (does drift scale with |SUE|? — the decisive tell), both-halves. Key from env.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const K=Deno.env.get("AV_KEY"); if(!K){console.error("set AV_KEY");Deno.exit(1);}
let seed=13; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const U=["AAPL","MSFT","JPM","XOM","JNJ","PG","KO","WMT","HD","CVX","MRK","PFE","CSCO","INTC","IBM","ORCL","CAT","BA","GE","MMM","DIS","T"];
async function earnings(sym:string){try{const r=await fetch(`https://www.alphavantage.co/query?function=EARNINGS&symbol=${sym}&apikey=${K}`);const j=await r.json();const q=j.quarterlyEarnings;if(!q)return[];return q.map((x:any)=>({d:x.reportedDate,sur:parseFloat(x.reportedEPS)-parseFloat(x.estimatedEPS)})).filter((x:any)=>Number.isFinite(x.sur)&&x.d);}catch{return[];}}
async function px(sym:string):Promise<Map<string,number>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return new Map();const t=res.timestamp,c=res.indicators.quote[0].close,m=new Map<string,number>();for(let i=0;i<t.length;i++)if(c[i]!=null)m.set(new Date(t[i]*1000).toISOString().slice(0,10),c[i]);return m;}catch{return new Map();}}
const spy=await px("SPY");const spyDates=[...spy.keys()].sort();
const idxOnOrAfter=(m:string[],d:string)=>{let lo=0,hi=m.length;while(lo<hi){const mid=(lo+hi)>>1;if(m[mid]<d)lo=mid+1;else hi=mid;}return lo;};
interface Ev{sue:number;absSue:number;adj20:number;adj60:number;d:string}
const evs:Ev[]=[];let nStocks=0;
for(const sym of U){
  const es=await earnings(sym); await sleep(13000); // 5 req/min free-tier pacing
  if(!es.length)continue;const pm=await px(sym);const pd=[...pm.keys()].sort();if(pd.length<300)continue;nStocks++;
  const sd=sampleStd(es.map((e:any)=>e.sur))||1; // per-stock surprise stddev → SUE
  for(const e of es){const sue=e.sur/sd;const dir=e.sur>0?1:e.sur<0?-1:0;if(!dir)continue;
    const ei=idxOnOrAfter(pd,e.d)+1; if(ei+60>=pd.length||ei<=0)continue;const entry=pd[ei];
    const si=idxOnOrAfter(spyDates,entry); if(si+60>=spyDates.length)continue;
    const p0=pm.get(pd[ei])!,p20=pm.get(pd[Math.min(ei+20,pd.length-1)])!,p60=pm.get(pd[Math.min(ei+60,pd.length-1)])!;
    const s0=spy.get(spyDates[si])!,s20=spy.get(spyDates[Math.min(si+20,spyDates.length-1)])!,s60=spy.get(spyDates[Math.min(si+60,spyDates.length-1)])!;
    const adj20=dir*((p20/p0-1)-(s20/s0-1))*100, adj60=dir*((p60/p0-1)-(s60/s0-1))*100;
    evs.push({sue,absSue:Math.abs(sue),adj20,adj60,d:e.d});}
}
console.log(`DEEP PEAD — ${nStocks} stocks, ${evs.length} real earnings events (AlphaVantage 30yr × Yahoo), market-adjusted drift\n`);
function t1(a:number[]){return mean(a)/(sampleStd(a)/Math.sqrt(a.length));}
for(const[k,lab]of [["adj20","20-day"],["adj60","60-day"]] as const){const S=evs.map(e=>e[k]);
  const C:number[]=[];for(const e of evs){const rd=rnd()<0.5?1:-1;C.push((rd/(e.sue>0?1:-1))*e[k]);} // random-direction control
  const g=edgeVsRandom(S,C,2,30);console.log(`  ${lab}: mkt-adj drift ${(mean(S)>=0?"+":"")+mean(S).toFixed(3)}%  t=${t1(S).toFixed(2)}  vs-rand edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)} t=${g.tStat.toFixed(2)}  ${t1(S)>=2&&g.passes?"✓":""}`);}
// magnitude signature (the decisive test) — 20d drift by |SUE| tercile
const byAbs=[...evs].sort((a,b)=>a.absSue-b.absSue);const t3=Math.floor(byAbs.length/3);
console.log(`\n  MAGNITUDE SIGNATURE (genuine PEAD ⇒ bigger surprise drifts MORE):`);
for(const[lab,sl]of [["small |SUE|",byAbs.slice(0,t3)],["mid |SUE|",byAbs.slice(t3,2*t3)],["large |SUE|",byAbs.slice(-t3)]] as const){
  const a=sl.map(e=>e.adj20);console.log(`    ${lab.padEnd(12)} 20d ${(mean(a)>=0?"+":"")+mean(a).toFixed(3)}%  t=${t1(a).toFixed(2)}  (median |SUE| ${sl[Math.floor(sl.length/2)].absSue.toFixed(2)})`);}
// both-halves
const byDate=[...evs].sort((a,b)=>a.d<b.d?-1:1);const mid=byDate[Math.floor(byDate.length/2)].d;
const h1=byDate.filter(e=>e.d<mid).map(e=>e.adj20),h2=byDate.filter(e=>e.d>=mid).map(e=>e.adj20);
console.log(`\n  BOTH-HALVES (20d): H1(<${mid}) ${(mean(h1)>=0?"+":"")+mean(h1).toFixed(3)}% t=${t1(h1).toFixed(2)}  H2 ${(mean(h2)>=0?"+":"")+mean(h2).toFixed(3)}% t=${t1(h2).toFixed(2)}  ${mean(h1)>0&&mean(h2)>0?"both + ✓":"⚠ sign flip"}`);
console.log(`\n  VERDICT: PEAD is REAL iff drift is positive+significant, SCALES with |SUE|, and holds both halves.`);
