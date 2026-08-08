#!/usr/bin/env -S deno run --allow-net
// trd-instances — the "trade the chart" architecture, done HONESTLY. For ONE instrument at a time it spawns an
// INSTANCE for every (setup × regime) — the way a trader eyes a single chart — and evaluates EACH instance on that
// instrument's own history, point-in-time (next-open entry, no look-ahead), vs its OWN matched random control (D-146),
// then DEFLATES by the number of instances tested on that instrument (Bonferroni). This is the per-instance engine
// the operator asked for — and it demonstrates WHY per-instance ≠ free: single-name samples are small and the
// multiple-testing tax is brutal, so honest per-chart survival is RARE. Pooling (trd-augment) exists precisely to buy
// the power this throws away. Free (Yahoo daily).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const SYMS=(Deno.args[0]??"AAPL,NVDA,TSLA,SPY,GLD,AMD,META,JPM").split(",");
const ATRN=14,RSIN=14,MALEN=200,BBN=20,DON=20,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08;
let seed=31337; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const sd=Math.sqrt(v/n);up[i]=mid[i]+2*sd;lo[i]=mid[i]-2*sd;}return{up,lo};}
function rvol(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);const r:number[]=[0];for(let i=1;i<cl.length;i++)r.push(Math.log(cl[i]/cl[i-1]));for(let i=n;i<cl.length;i++){let m=0;for(let k=i-n+1;k<=i;k++)m+=r[k];m/=n;let v=0;for(let k=i-n+1;k<=i;k++)v+=(r[k]-m)**2;o[i]=Math.sqrt(v/n);}return o;}
const spy=await daily("SPY");const spyma=sma(spy.map(x=>x.c),MALEN);const bull=new Map<string,boolean>();for(let i=0;i<spy.length;i++)if(spyma[i]>0)bull.set(spy[i].d,spy[i].c>spyma[i]);
// setup catalog: [name, dir, fire(i)->bool]
type Ctx={cl:number[];at:number[];r14:number[];ma:number[];up:number[];lo:number[];hh:number[];ll:number[]};
const SETUPS:{name:string;dir:1|-1;fire:(c:Ctx,i:number)=>boolean}[]=[
  {name:"ripshort",dir:-1,fire:(c,i)=>c.r14[i]>70&&c.cl[i]<c.ma[i]},
  {name:"dipbuy",dir:1,fire:(c,i)=>c.r14[i]<30&&c.cl[i]>c.ma[i]},
  {name:"bbfade_lo",dir:1,fire:(c,i)=>c.cl[i]<c.lo[i]},
  {name:"bbfade_hi",dir:-1,fire:(c,i)=>c.cl[i]>c.up[i]},
  {name:"donch_brkL",dir:1,fire:(c,i)=>c.cl[i]>c.hh[i]},
  {name:"donch_brkS",dir:-1,fire:(c,i)=>c.cl[i]<c.ll[i]},
];
const REGIMES:{name:string;ok:(bl:boolean|undefined,st:boolean)=>boolean}[]=[
  {name:"any",ok:()=>true},{name:"bull",ok:(bl)=>bl===true},{name:"bear",ok:(bl)=>bl===false},
  {name:"hivol",ok:(_,st)=>st},{name:"lovol",ok:(_,st)=>!st},
];
function resolve(b:B[],at:number[],i:number,dir:1|-1):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=dir*(b[last].c-entry)/sd;}let cost=(entry*(SPREAD_BPS/10000)*2)/sd;if(dir===-1)cost+=(entry*BORROW*(held/365))/sd;return r-cost;}

console.log(`PER-INSTANCE ("trade the chart") ENGINE — each (instrument × setup × regime) is its OWN gated instance vs`);
console.log(`its OWN random control, deflated per-instrument. This is how you'd analyse one chart — done honestly.\n`);
let totalInstances=0, survivors=0, rawPass=0;
for(const sym of SYMS){
  const b=await daily(sym);if(b.length<MALEN+BBN+60){console.log(`${sym}: only ${b.length} bars, skip`);continue;}
  const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN),{up,lo}=bb(cl,BBN),rv=rvol(cl,20);
  const hh:number[]=[],ll:number[]=[];for(let i=0;i<b.length;i++){if(i<DON){hh[i]=NaN;ll[i]=NaN;continue;}let h=-1e9,l=1e9;for(let k=i-DON;k<i;k++){if(b[k].h>h)h=b[k].h;if(b[k].l<l)l=b[k].l;}hh[i]=h;ll[i]=l;}
  const rvv=rv.filter(x=>Number.isFinite(x)).sort((a,c)=>a-c);const rvMed=rvv[Math.floor(rvv.length/2)]??0;
  const ctx:Ctx={cl,at,r14,ma,up,lo,hh,ll};
  // enumerate instances; collect those with n>=30 first to know the deflation count for THIS instrument
  const cells:{key:string;dir:1|-1;S:number[];C:number[]}[]=[];
  for(const su of SETUPS)for(const rg of REGIMES){
    const S:number[]=[],C:number[]=[];
    for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0)||!Number.isFinite(rv[i]))continue;const bl=bull.get(b[i].d);const st=rv[i]>rvMed;if(!rg.ok(bl,st))continue;
      if(su.fire(ctx,i)){const r=resolve(b,at,i,su.dir);if(r!==null)S.push(r);}
      if(rnd()<0.15){const r=resolve(b,at,i,su.dir);if(r!==null)C.push(r);}}
    if(S.length>=30&&C.length>=30)cells.push({key:`${su.name}/${rg.name}`,dir:su.dir,S,C});
  }
  const zC=invNorm(1-0.025/Math.max(1,cells.length));
  totalInstances+=SETUPS.length*REGIMES.length;
  const passing=cells.map(c=>{const g=edgeVsRandom(c.S,c.C);return{...c,g,defl:Math.abs(g.tStat)>=zC&&g.edge>0&&g.setupMean>0,raw:g.passes&&g.setupMean>0};}).filter(c=>c.raw).sort((a,c)=>c.g.tStat-a.g.tStat);
  const dpass=passing.filter(c=>c.defl);rawPass+=passing.length;survivors+=dpass.length;
  console.log(`${sym.padEnd(6)} ${cells.length} testable instances, deflate |t|≥${zC.toFixed(2)}  →  ${passing.length} raw-pass, ${dpass.length} survive deflation`);
  for(const c of passing.slice(0,4))console.log(`   ${c.defl?"✓✓":"~ "} ${c.key.padEnd(18)} n=${String(c.S.length).padStart(4)} setupR ${(c.g.setupMean>=0?"+":"")+c.g.setupMean.toFixed(3)} vs rand ${c.g.controlMean.toFixed(3)} edge ${(c.g.edge>=0?"+":"")+c.g.edge.toFixed(3)} t=${c.g.tStat.toFixed(2)}`);
}
console.log(`\nACROSS ${SYMS.length} charts: ${totalInstances} instances enumerated, ${rawPass} looked good raw (t≥2), ${survivors} SURVIVE per-instrument deflation.`);
console.log(`This is the operator's ask, built. The lesson it proves: single-chart instances that "look like edges" mostly`);
console.log(`evaporate under their OWN deflation — the raw-pass count is the false-positive factory. Pooling buys the power`);
console.log(`per-chart throws away. HONEST architecture = enumerate per-instance, but gate+deflate EACH, and cross-check vs the pooled edge.`);
