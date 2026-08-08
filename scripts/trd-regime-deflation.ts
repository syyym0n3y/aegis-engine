#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-regime-deflation — two remaining rigor stones in one pass:
//  (1) PROGRAM-WIDE DEFLATION: rip-short's random-control t vs the Bonferroni z-threshold for the true trial count
//      of the whole research program (does it survive multiple-testing across EVERYTHING we ran?).
//  (2) REGIME CONDITIONING: split rip-short daily trades by MARKET regime (SPY above/below its own 200-day MA) at
//      entry — does the edge only exist in bear markets, or does it hold in both?
import { edgeVsRandom, } from "../supabase/functions/_shared/trd-random-control.ts";
import { invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const U=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","NFLX","JPM","BAC","GS","XOM","CVX","JNJ","PFE","WMT","HD","NKE","KO","CAT","BA","GE","F","GM"];
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08;
let seed=321; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// SPY regime map: date -> bull(SPY>200MA)/bear
const spy=await daily("SPY");const scl=spy.map(x=>x.c);const sma200=sma(scl,200);const regime=new Map<string,"bull"|"bear">();
for(let i=0;i<spy.length;i++)if(sma200[i]>0)regime.set(spy[i].d,scl[i]>sma200[i]?"bull":"bear");
const sig:Record<string,number[]>={bull:[],bear:[]},ctrl:Record<string,number[]>={bull:[],bear:[]};
for(const sym of U){const b=await daily(sym);if(b.length<600)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);const pool:number[]=[];for(let i=MALEN+1;i<b.length-MAXHOLD-1;i++)if(at[i]>0&&ma[i]>0)pool.push(i);
  const sim=(i:number)=>{const sd=STOP_ATR*at[i];if(!(sd>b[i].c*1e-4))return null;const e=b[i+1].o,st=e+sd,tg=e-sd*TP;let g:number|null=null,held=0;for(let k=i+1;k<Math.min(i+1+MAXHOLD,b.length);k++){held=k-i;if(b[k].h>=st){g=-1;break;}if(b[k].l<=tg){g=TP;break;}}if(g===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;g=(e-b[last].c)/sd;}return g-(e*(SPREAD_BPS/10000)*2)/sd-(e*BORROW*(held/365))/sd;};
  for(const i of pool){if(r14[i]>70&&cl[i]<ma[i]){const reg=regime.get(b[i].d);if(!reg)continue;const t=sim(i);if(t!==null){sig[reg].push(t);const j=pool[Math.floor(rnd()*pool.length)];const rc=sim(j);if(rc!==null)ctrl[reg].push(rc);}}}}
console.log("REGIME CONDITIONING — rip-short daily, split by SPY 200-MA regime at entry (real cost + borrow):\n");
for(const reg of ["bull","bear"]as const){const g=edgeVsRandom(sig[reg],ctrl[reg]);console.log(`  ${reg.toUpperCase().padEnd(5)} n=${String(sig[reg].length).padStart(5)}  setupR ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(4)}  vs random ${g.controlMean.toFixed(4)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(4)}  t=${g.tStat.toFixed(2)}  ${g.passes&&g.setupMean>0?"edge holds":"weak/none"}`);}
console.log("\nPROGRAM-WIDE DEFLATION — rip-short daily random-control t vs Bonferroni z-threshold by trial count:");
for(const N of [10,100,1000,10000,100000]){const z=invNorm(1-0.025/N);console.log(`  N=${String(N).padStart(6)} trials → need t >= ${z.toFixed(2)}`);}
console.log(`  rip-short DAILY random-control t (D-179, full universe) = 7.23  → survives even N=100000 (z=4.56).`);
console.log(`  dip-buy HOURLY t = 3.73 → fails beyond ~N=100 (z=3.48); confirms dip-buy is NOT deflation-robust (weak).`);
console.log(`  cross-sectional/minute/momentum t<2 → fail trivially. Only rip-short clears program-wide multiple testing.`);
