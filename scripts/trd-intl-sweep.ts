#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-intl-sweep — FX-NORMALIZED international rip-short sweep (D-220). Fixes D-219's currency confound: reads each
// ticker's meta.currency, converts price to USD (GBp/ZAc = pence/cents → /100), then assigns liquidity tier + spread
// on the USD price so a ¥3,000 stock isn't mislabeled "large". Pooled by USD tier. Resumable (data/intl_pool_fx.csv).
import { erf } from "../supabase/functions/_shared/trd-stats.ts";
let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,BORROW=0.08;
const spreadBps=(px:number)=>px<2?200:px<5?80:px<15?35:px<50?15:8;
const tierOf=(px:number)=>px<5?"micro":px<20?"small":px<100?"mid":"large";
interface B{o:number;h:number;l:number;c:number}
async function rate(pair:string):Promise<number>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=5d`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const c=j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x:number)=>x!=null);return c?.length?c[c.length-1]:NaN;}catch{return NaN;}}
async function dailyCur(sym:string):Promise<{b:B[];cur:string}>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return{b:[],cur:""};const cur=res.meta?.currency??"";const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return{b:o,cur};}catch{return{b:[],cur:""};}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// FX map: local currency → USD multiplier
const R:Record<string,number>={};
for(const p of ["GBPUSD=X","EURUSD=X","AUDUSD=X","USDCHF=X","USDSEK=X","USDJPY=X","USDHKD=X","USDCAD=X","USDINR=X","USDKRW=X","USDTWD=X","USDBRL=X","USDSGD=X","USDZAR=X"])R[p]=await rate(p);
function usdMult(cur:string):number{switch(cur){
  case "USD":return 1; case "GBp":return R["GBPUSD=X"]/100; case "GBP":return R["GBPUSD=X"];
  case "ZAc":return R["USDZAR=X"]?1/R["USDZAR=X"]/100:NaN; case "ZAR":return R["USDZAR=X"]?1/R["USDZAR=X"]:NaN;
  case "EUR":return R["EURUSD=X"]; case "AUD":return R["AUDUSD=X"];
  case "CHF":return 1/R["USDCHF=X"]; case "SEK":return 1/R["USDSEK=X"]; case "JPY":return 1/R["USDJPY=X"];
  case "HKD":return 1/R["USDHKD=X"]; case "CAD":return 1/R["USDCAD=X"]; case "INR":return 1/R["USDINR=X"];
  case "KRW":return 1/R["USDKRW=X"]; case "TWD":return 1/R["USDTWD=X"]; case "BRL":return 1/R["USDBRL=X"]; case "SGD":return 1/R["USDSGD=X"];
  default:return NaN;}}
const OUT="data/intl_pool_fx.csv";
const done=new Set<string>();try{for(const ln of (await Deno.readTextFile(OUT)).split("\n"))if(ln)done.add(ln.split(",")[0]);}catch{await Deno.writeTextFile(OUT,"ticker,cur,pxusd,tier,nS,sumS,sqS,nC,sumC,sqC\n");}
const all=(await Deno.readTextFile("data/intl_tickers.txt")).split("\n").filter(Boolean);
let ran=0;const maxRun=Number(Deno.args[0]??800);
for(const sym of all){if(done.has(sym))continue;if(ran>=maxRun)break;const {b,cur}=await dailyCur(sym);ran++;
  const mult=usdMult(cur);
  if(b.length<MALEN+40||!Number.isFinite(mult)){await Deno.writeTextFile(OUT,`${sym},${cur},,skip,0,0,0,0,0,0\n`,{append:true});continue;}
  const cl=b.map(x=>x.c);const pxUsd=cl[cl.length-1]*mult;const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);const bps=spreadBps(pxUsd);const tier=tierOf(pxUsd);
  let nS=0,sumS=0,sqS=0,nC=0,sumC=0,sqC=0;
  const doT=(i:number)=>{const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry+sd,tgt=entry-sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(b[k].h>=stop){r=-1;break;}if(b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=(entry-b[last].c)/sd;}return r-((entry*(bps/10000)*2)/sd+(entry*BORROW*(held/365))/sd);};
  for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;if(r14[i]>70&&cl[i]<ma[i]){const r=doT(i);if(r!==null){nS++;sumS+=r;sqS+=r*r;}}if(rnd()<0.1){const r=doT(i);if(r!==null){nC++;sumC+=r;sqC+=r*r;}}}
  await Deno.writeTextFile(OUT,`${sym},${cur},${pxUsd.toFixed(2)},${tier},${nS},${sumS.toFixed(3)},${sqS.toFixed(3)},${nC},${sumC.toFixed(3)},${sqC.toFixed(3)}\n`,{append:true});
}
const agg:Record<string,{nS:number;sumS:number;sqS:number;nC:number;sumC:number;sqC:number;stocks:number}>={};
for(const l of (await Deno.readTextFile(OUT)).split("\n").slice(1)){if(!l)continue;const p=l.split(",");if(p[3]==="skip"||+p[4]<1)continue;const t=p[3];(agg[t]??={nS:0,sumS:0,sqS:0,nC:0,sumC:0,sqC:0,stocks:0});const a=agg[t];a.nS+=+p[4];a.sumS+=+p[5];a.sqS+=+p[6];a.nC+=+p[7];a.sumC+=+p[8];a.sqC+=+p[9];a.stocks++;}
console.log(`FX-NORMALIZED INTERNATIONAL SWEEP (rip-short, USD tiers) — +${ran} this run\n`);
console.log(`${"tier".padEnd(7)} ${"stocks".padStart(6)} ${"signals".padStart(8)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(7)}  verdict`);
for(const tier of ["large","mid","small","micro"]){const a=agg[tier];if(!a||a.nS<30||a.nC<30)continue;
  const mS=a.sumS/a.nS,vS=a.sqS/a.nS-mS*mS,mC=a.sumC/a.nC,vC=a.sqC/a.nC-mC*mC;const t=(mS-mC)/Math.sqrt(vS/a.nS+vC/a.nC);
  console.log(`${tier.padEnd(7)} ${String(a.stocks).padStart(6)} ${String(a.nS).padStart(8)} ${(mS>=0?"+":"")+mS.toFixed(3)} ${mC.toFixed(3).padStart(7)} ${((mS-mC)>=0?"+":"")+(mS-mC).toFixed(3)} ${t.toFixed(2).padStart(7)}  ${t>=2&&mS>mC?"✓ survives":mS-mC>0?"pos, weak":"✗ fails"}`);}
console.log(`FX rates loaded: ${Object.entries(R).filter(([,v])=>Number.isFinite(v)).length}/14 pairs`);
