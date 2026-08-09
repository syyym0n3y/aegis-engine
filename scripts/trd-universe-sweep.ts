#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-universe-sweep — RESUMABLE full-universe coverage (D-216). rip-short is a BREADTH edge (rare per stock), so we
// POOL its signals across the whole SEC universe (~9,850) and gate the POOLED edge vs random by LIQUIDITY TIER, with
// realistic per-signal cost (price-tier spread + borrow). Answers the real question: does the edge survive across the
// full universe incl. small/micro caps, or die on the spread+borrow wall? Per stock we store running sums (mean+var
// reconstructable) → data/univ_pool.csv (resumable, skips done). Args: [stride=15] [maxThisRun=600].
import { erf } from "../supabase/functions/_shared/trd-stats.ts";
let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,BORROW=0.08;
const spreadBps=(px:number)=>px<2?200:px<5?80:px<15?35:px<50?15:8;
const tierOf=(px:number)=>px<5?"micro":px<20?"small":px<100?"mid":"large";
interface B{o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
const OUT="data/univ_pool.csv";
const done=new Set<string>();try{for(const ln of (await Deno.readTextFile(OUT)).split("\n"))if(ln)done.add(ln.split(",")[0]);}catch{await Deno.writeTextFile(OUT,"ticker,tier,nS,sumS,sqS,nC,sumC,sqC\n");}
const stride=Number(Deno.args[0]??15),maxRun=Number(Deno.args[1]??600);
const all=(await Deno.readTextFile("data/sec_tickers.txt")).split("\n").filter(Boolean);
const sample:string[]=[];for(let i=0;i<all.length;i+=stride)sample.push(all[i]);
let ran=0;
for(const sym of sample){if(done.has(sym))continue;if(ran>=maxRun)break;const b=await daily(sym);ran++;
  if(b.length<MALEN+40){await Deno.writeTextFile(OUT,`${sym},skip,0,0,0,0,0,0\n`,{append:true});continue;}
  const cl=b.map(x=>x.c);const px=cl[cl.length-1];const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);const bps=spreadBps(px);const tier=tierOf(px);
  let nS=0,sumS=0,sqS=0,nC=0,sumC=0,sqC=0;
  const doT=(i:number)=>{const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry+sd,tgt=entry-sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(b[k].h>=stop){r=-1;break;}if(b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=(entry-b[last].c)/sd;}return r-((entry*(bps/10000)*2)/sd+(entry*BORROW*(held/365))/sd);};
  for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;if(r14[i]>70&&cl[i]<ma[i]){const r=doT(i);if(r!==null){nS++;sumS+=r;sqS+=r*r;}}if(rnd()<0.1){const r=doT(i);if(r!==null){nC++;sumC+=r;sqC+=r*r;}}}
  await Deno.writeTextFile(OUT,`${sym},${tier},${nS},${sumS.toFixed(3)},${sqS.toFixed(3)},${nC},${sumC.toFixed(3)},${sqC.toFixed(3)}\n`,{append:true});
}
// aggregate POOLED by tier (Welch from sums)
const agg:Record<string,{nS:number;sumS:number;sqS:number;nC:number;sumC:number;sqC:number;stocks:number}>={};
for(const l of (await Deno.readTextFile(OUT)).split("\n").slice(1)){if(!l)continue;const p=l.split(",");if(p[1]==="skip"||+p[2]<1)continue;const t=p[1];(agg[t]??={nS:0,sumS:0,sqS:0,nC:0,sumC:0,sqC:0,stocks:0});const a=agg[t];a.nS+=+p[2];a.sumS+=+p[3];a.sqS+=+p[4];a.nC+=+p[5];a.sumC+=+p[6];a.sqC+=+p[7];a.stocks++;}
const norm=(z:number)=>0.5*(1+erf(z/Math.SQRT2));
console.log(`UNIVERSE SWEEP (rip-short, POOLED by liquidity tier, realistic cost+borrow) — this run +${ran} stocks\n`);
console.log(`${"tier".padEnd(7)} ${"stocks".padStart(6)} ${"signals".padStart(8)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(7)}  verdict`);
let totS=0;for(const tier of ["large","mid","small","micro"]){const a=agg[tier];if(!a||a.nS<30||a.nC<30)continue;totS+=a.stocks;
  const mS=a.sumS/a.nS,vS=a.sqS/a.nS-mS*mS,mC=a.sumC/a.nC,vC=a.sqC/a.nC-mC*mC;const se=Math.sqrt(vS/a.nS+vC/a.nC);const t=(mS-mC)/se;
  console.log(`${tier.padEnd(7)} ${String(a.stocks).padStart(6)} ${String(a.nS).padStart(8)} ${(mS>=0?"+":"")+mS.toFixed(3)} ${mC.toFixed(3).padStart(7)} ${((mS-mC)>=0?"+":"")+(mS-mC).toFixed(3)} ${t.toFixed(2).padStart(7)}  ${t>=2&&mS>mC?"✓ survives (net of cost+borrow)":mS-mC>0?"pos, weak":"✗ cost/borrow wall"}`);}
console.log(`\ntotal stocks pooled: ${totS}. RESUMABLE — re-run to add more (skips done). Full 9,850 US at stride=1; +intl for 50k.`);
