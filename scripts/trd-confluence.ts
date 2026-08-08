#!/usr/bin/env -S deno run --allow-net
// trd-confluence — ORTHOGONAL confluence test. D-194 killed CORRELATED confluence (two overbought readings on the
// same name = redundant, shrinks n). This asks the open question: does stacking rip-short with a signal from a
// DIFFERENT information axis — market BREADTH, VIX percentile, or CROSS-SECTIONAL RSI rank — beat rip-short ALONE?
// We (1) PROVE orthogonality (Pearson corr of each confluence signal vs the name's own RSI — must be low, unlike
// bbfade), (2) test each filtered subset vs a matched random entry (D-146), and (3) test the INCREMENTAL lift:
// filtered-setupR vs UNFILTERED-setupR (Welch) — the real "does confluence add value" question. Deflated (Bonferroni
// across filters). Free (Yahoo daily), no look-ahead: signals at close d (breadth/VIX-pct trailing), enter next open.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, sampleStd, invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const U=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","XOM","CVX","COP","SLB","JNJ","PFE","MRK","LLY","UNH","WMT","COST","HD","LOW","MCD","NKE","KO","PEP","PG","CAT","DE","BA","GE","F","GM","UBER","DIS"];
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08,VIXWIN=252;
let seed=8080; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function pearson(x:number[],y:number[]){const n=x.length;if(n<3)return NaN;const mx=mean(x),my=mean(y);let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=x[i]-mx,dy=y[i]-my;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sxy/Math.sqrt(sx*sy);}

// SPY regime + ^VIX trailing percentile
const spy=await daily("SPY");const spyma=sma(spy.map(x=>x.c),MALEN);const bull=new Map<string,boolean>();for(let i=0;i<spy.length;i++)if(spyma[i]>0)bull.set(spy[i].d,spy[i].c>spyma[i]);
const vix=await daily("^VIX");const vixPctByDate=new Map<string,number>();for(let i=VIXWIN;i<vix.length;i++){const w=[];for(let k=i-VIXWIN+1;k<=i;k++)w.push(vix[k].c);const cur=vix[i].c;let below=0;for(const v of w)if(v<=cur)below++;vixPctByDate.set(vix[i].d,below/w.length);}

// load universe, compute per-name series, and a global above-200MA map for BREADTH
const store:Record<string,{b:B[];at:number[];r14:number[];ma:number[]}>={};
const above200=new Map<string,{above:number;total:number}>(); // date -> counts
for(const sym of U){const b=await daily(sym);if(b.length<MALEN+60)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);store[sym]={b,at,r14,ma};
  for(let i=MALEN;i<b.length;i++){if(!(ma[i]>0))continue;const e=above200.get(b[i].d)??{above:0,total:0};e.total++;if(cl[i]>ma[i])e.above++;above200.set(b[i].d,e);}}
const breadthByDate=new Map<string,number>();for(const[d,e]of above200)if(e.total>=U.length*0.7)breadthByDate.set(d,e.above/e.total);

function resolve(b:B[],at:number[],i:number,dir:1|-1):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=dir*(b[last].c-entry)/sd;}let cost=(entry*(SPREAD_BPS/10000)*2)/sd;if(dir===-1)cost+=(entry*BORROW*(held/365))/sd;return r-cost;}

// collect rip-short signals with orthogonal features; also build the random-short control pool (any bar, short)
interface Sig{d:string;r:number;nameRSI:number;breadth:number;vixPct:number;xsRank:number}
const raw:{d:string;r:number;nameRSI:number;breadth:number;vixPct:number}[]=[];
const byDateRSI=new Map<string,number[]>(); const rctrl:number[]=[];
for(const sym of Object.keys(store)){const{b,at,r14,ma}=store[sym];for(let i=MALEN+1;i<b.length-1;i++){
  if(!(at[i]>0)||!(ma[i]>0))continue;
  // random-short control pool (matched direction, any bar with valid ATR)
  if(rnd()<0.15){const rc=resolve(b,at,i,-1);if(rc!==null)rctrl.push(rc);}
  if(!(r14[i]>70&&b[i].c<ma[i]))continue;                 // rip-short signal
  const br=breadthByDate.get(b[i].d),vp=vixPctByDate.get(b[i].d);if(br===undefined||vp===undefined)continue;
  const r=resolve(b,at,i,-1);if(r===null)continue;
  raw.push({d:b[i].d,r,nameRSI:r14[i],breadth:br,vixPct:vp});
  (byDateRSI.get(b[i].d)??byDateRSI.set(b[i].d,[]).get(b[i].d)!).push(r14[i]);
}}
// cross-sectional RSI rank: percentile of this name's RSI among all rip-short signals that day
const sigs:Sig[]=raw.map(s=>{const arr=byDateRSI.get(s.d)!;let below=0;for(const v of arr)if(v<=s.nameRSI)below++;return{...s,xsRank:arr.length>1?below/arr.length:0.5};});

console.log(`ORTHOGONAL CONFLUENCE — rip-short (n=${sigs.length}) + a market-state axis vs rip-short ALONE, deflated`);
console.log(`random-short control pool n=${rctrl.length}, mean ${mean(rctrl).toFixed(3)}R\n`);
// orthogonality proof
const nameRSI=sigs.map(s=>s.nameRSI);
console.log(`ORTHOGONALITY (Pearson corr vs the name's own RSI — near 0 = truly a different axis, unlike bbfade):`);
console.log(`  breadth      corr ${pearson(nameRSI,sigs.map(s=>s.breadth)).toFixed(3)}`);
console.log(`  vixPct       corr ${pearson(nameRSI,sigs.map(s=>s.vixPct)).toFixed(3)}`);
console.log(`  xsRank       corr ${pearson(nameRSI,sigs.map(s=>s.xsRank)).toFixed(3)}`);
console.log(`  (corr vs bull-regime, for reference — high = the filter is just restating the regime, not a new axis):`);
const blNum=sigs.map(s=>bull.get(s.d)?1:0);
console.log(`  breadth~bull ${pearson(blNum,sigs.map(s=>s.breadth)).toFixed(3)}   vixPct~bull ${pearson(blNum,sigs.map(s=>s.vixPct)).toFixed(3)}   xsRank~bull ${pearson(blNum,sigs.map(s=>s.xsRank)).toFixed(3)}\n`);

const baseR=sigs.map(s=>s.r);const baseMean=mean(baseR);
// filters: for each axis, take the hypothesized-favourable tercile (breadth LOW, vix HIGH, xsRank HIGH) + its complement
type F={name:string;pick:(s:Sig)=>number;hiFav:boolean};
const FILTERS:F[]=[{name:"breadth",pick:s=>s.breadth,hiFav:false},{name:"vixPct",pick:s=>s.vixPct,hiFav:true},{name:"xsRank",pick:s=>s.xsRank,hiFav:true}];
const NTEST=FILTERS.length*2; const zC=invNorm(1-0.025/NTEST);
console.log(`INCREMENTAL LIFT — favourable tercile of each axis vs (a) random and (b) the UNFILTERED rip-short baseline`);
console.log(`baseline rip-short setupR = ${baseMean.toFixed(3)} (n=${sigs.length}).  Bonferroni z≈${zC.toFixed(2)} across ${NTEST} cells.\n`);
console.log(`${"filter".padEnd(16)} ${"n".padStart(5)} ${"setupR".padStart(8)} ${"vsRand_t".padStart(9)} ${"vsBase_t".padStart(9)}  verdict`);
function welch(a:number[],b:number[]){const ma=mean(a),mb=mean(b);const se=Math.sqrt(sampleStd(a)**2/a.length+sampleStd(b)**2/b.length);return se>0?(ma-mb)/se:0;}
for(const f of FILTERS){
  const vals=sigs.map(f.pick).slice().sort((a,b)=>a-b);const t1=vals[Math.floor(vals.length/3)],t2=vals[Math.floor(2*vals.length/3)];
  const favSet=sigs.filter(s=>f.hiFav?f.pick(s)>=t2:f.pick(s)<=t1);
  const favR=favSet.map(s=>s.r);
  const g=edgeVsRandom(favR,rctrl);
  const vb=welch(favR,baseR);
  const beatsRand=Math.abs(g.tStat)>=zC&&g.edge>0;const beatsBase=vb>=2;
  const v=beatsRand&&beatsBase?"✓✓ ORTHOGONAL EDGE (beats random+base)":beatsRand?"beats random, ~ base (no incremental lift)":vb>=2?"lifts base but not deflated-vs-random":"no lift";
  console.log(`${(f.name+(f.hiFav?" hi":" lo")).padEnd(16)} ${String(favR.length).padStart(5)} ${((mean(favR)>=0?"+":"")+mean(favR).toFixed(3)).padStart(8)} ${g.tStat.toFixed(2).padStart(9)} ${vb.toFixed(2).padStart(9)}  ${v}`);
}
// TRUE orthogonal stack: rip-short + the BEST single orthogonal filter, combined, vs baseline
console.log(`\nSTACK — rip-short ∩ (vixPct-hi ∩ breadth-lo): does a two-axis orthogonal stack beat one?`);
const vv=sigs.map(s=>s.vixPct).slice().sort((a,b)=>a-b);const bv=sigs.map(s=>s.breadth).slice().sort((a,b)=>a-b);
const vHi=vv[Math.floor(2*vv.length/3)],bLo=bv[Math.floor(bv.length/3)];
const stack=sigs.filter(s=>s.vixPct>=vHi&&s.breadth<=bLo).map(s=>s.r);
if(stack.length>=30){const g=edgeVsRandom(stack,rctrl);const vb=welch(stack,baseR);console.log(`  stack n=${stack.length}  setupR ${(mean(stack)>=0?"+":"")+mean(stack).toFixed(3)}  vsRand_t ${g.tStat.toFixed(2)}  vsBase_t ${vb.toFixed(2)}  ${vb>=2&&Math.abs(g.tStat)>=zC?"✓✓ stack adds value":"no incremental value over base"}`);}
else console.log(`  stack n=${stack.length} (<30, insufficient — the two orthogonal filters barely co-occur, itself informative)`);
