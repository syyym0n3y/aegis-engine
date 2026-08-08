#!/usr/bin/env -S deno run --allow-net
// trd-augment — the AUGMENTATION engine. Not "does this setup work?" but "in WHICH regime / with WHICH confluence
// does it beat random?" For each family we slice by regime (SPY>200MA bull vs bear) × volatility (name 20d realized
// vol calm vs stress), gate EACH cell vs a matched same-direction random control (D-146), and test CONFLUENCE
// (two setups agreeing on the same name+bar). Deflated: Bonferroni across the cell count (searching for the winning
// condition is itself multiple testing — the exact trap that makes traders fool themselves). Free (Yahoo daily),
// no look-ahead (signal at close of d, enter next-day open, resolve forward).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const U=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","XOM","CVX","COP","SLB","JNJ","PFE","MRK","LLY","UNH","WMT","COST","HD","LOW","MCD","NKE","KO","PEP","PG","CAT","DE","BA","GE","F","GM","UBER","DIS"];
const ATRN=14,RSIN=14,MALEN=200,BBN=20,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08;
let seed=4242; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const sd=Math.sqrt(v/n);up[i]=mid[i]+2*sd;lo[i]=mid[i]-2*sd;}return{up,lo};}
function rvol(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);const r:number[]=[0];for(let i=1;i<cl.length;i++)r.push(Math.log(cl[i]/cl[i-1]));for(let i=n;i<cl.length;i++){let m=0;for(let k=i-n+1;k<=i;k++)m+=r[k];m/=n;let v=0;for(let k=i-n+1;k<=i;k++)v+=(r[k]-m)**2;o[i]=Math.sqrt(v/n)*Math.sqrt(252);}return o;}

// SPY regime series (bull = SPY>200MA at date)
const spy=await daily("SPY");const spycl=spy.map(x=>x.c);const spyma=sma(spycl,MALEN);const bull=new Map<string,boolean>();for(let i=0;i<spy.length;i++)if(spyma[i]>0)bull.set(spy[i].d,spycl[i]>spyma[i]);

// resolve a trade from signal bar i (dir +1 long / -1 short): enter next open, 2ATR stop, TP*R, maxhold, net cost
function resolve(b:B[],at:number[],i:number,dir:1|-1):number|null{
  if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;
  const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null,held=0;
  for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}
  if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=dir*(b[last].c-entry)/sd;}
  let cost=(entry*(SPREAD_BPS/10000)*2)/sd; if(dir===-1)cost+=(entry*BORROW*(held/365))/sd;
  return r-cost;
}

// collect per-signal rows tagged with regime + vol cell, plus a random-entry pool per (dir,regime,vol) cell
type Row={r:number;bull:boolean;stress:boolean};
const setups:Record<string,{dir:1|-1;rows:Row[]}> = {
  ripshort:{dir:-1,rows:[]}, dipbuy:{dir:1,rows:[]}, bbfade_hi:{dir:-1,rows:[]}, bbfade_lo:{dir:1,rows:[]},
  conf_short:{dir:-1,rows:[]},  // ripshort AND bbfade_hi (two bearish mean-rev setups agree)
  conf_long:{dir:1,rows:[]},    // dipbuy AND bbfade_lo (two bullish mean-rev setups agree)
};
// random pool: resolved random entries keyed by dir|regime|vol
const rpool:Record<string,number[]>={};
const key=(dir:number,bl:boolean,st:boolean)=>`${dir}|${bl?"bull":"bear"}|${st?"stress":"calm"}`;

for(const sym of U){const b=await daily(sym);if(b.length<MALEN+BBN+60)continue;
  const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN),{up,lo}=bb(cl,BBN),rv=rvol(cl,20);
  // median realized vol for this name (calm/stress split)
  const rvv=rv.filter(x=>Number.isFinite(x)).sort((a,c)=>a-c);const rvMed=rvv[Math.floor(rvv.length/2)]??0;
  for(let i=MALEN+1;i<b.length-1;i++){
    if(!(at[i]>0)||!(ma[i]>0)||!Number.isFinite(rv[i]))continue;
    const bl=bull.get(b[i].d);if(bl===undefined)continue;const st=rv[i]>rvMed;
    const rs=r14[i]>70&&cl[i]<ma[i], db=r14[i]<30&&cl[i]>ma[i], bh=cl[i]>up[i], blo=cl[i]<lo[i];
    if(rs){const r=resolve(b,at,i,-1);if(r!==null)setups.ripshort.rows.push({r,bull:bl,stress:st});}
    if(db){const r=resolve(b,at,i,1);if(r!==null)setups.dipbuy.rows.push({r,bull:bl,stress:st});}
    if(bh){const r=resolve(b,at,i,-1);if(r!==null)setups.bbfade_hi.rows.push({r,bull:bl,stress:st});}
    if(blo){const r=resolve(b,at,i,1);if(r!==null)setups.bbfade_lo.rows.push({r,bull:bl,stress:st});}
    if(rs&&bh){const r=resolve(b,at,i,-1);if(r!==null)setups.conf_short.rows.push({r,bull:bl,stress:st});}
    if(db&&blo){const r=resolve(b,at,i,1);if(r!==null)setups.conf_long.rows.push({r,bull:bl,stress:st});}
    // random control pool: fire a random-direction-matched entry at this bar for BOTH dirs (fills the cell)
    for(const dir of [1,-1] as const){const r=resolve(b,at,i,dir);if(r!==null){const kk=key(dir,bl,st);(rpool[kk]??=[]).push(r);}}
  }
}
// count cells for Bonferroni: setups × 5 slices (all,bull,bear,calm,stress) that have >=30 n
const SLICES:[string,(x:Row)=>boolean][]=[["ALL",()=>true],["bull",x=>x.bull],["bear",x=>!x.bull],["calm",x=>!x.stress],["stress",x=>x.stress]];
let ncells=0;for(const s of Object.values(setups))for(const[,f]of SLICES)if(s.rows.filter(f).length>=30)ncells++;
const zC=invNorm(1-0.025/Math.max(1,ncells)); // Bonferroni two-sided crit z for the search
console.log(`AUGMENTATION MAP — for each setup, WHICH regime/vol cell beats a matched random entry (D-146), deflated`);
console.log(`Bonferroni across ${ncells} searched cells → crit |t| ≈ ${zC.toFixed(2)} (raw t≥2 shown as ~, deflated-pass shown as ✓✓)\n`);
console.log(`${"setup".padEnd(11)} ${"dir".padEnd(4)} ${"cell".padEnd(7)} ${"n".padStart(5)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
function sampleCtrl(cellKey:string,n:number):number[]{const p=rpool[cellKey]??[];if(!p.length)return[];const o:number[]=[];for(let i=0;i<Math.max(n,200);i++)o.push(p[Math.floor(rnd()*p.length)]);return o;}
for(const[name,s]of Object.entries(setups)){
  for(const[slice,f]of SLICES){
    const rows=s.rows.filter(f);if(rows.length<30)continue;
    // matched random control from same dir + matching regime/vol pools
    let ck:string; if(slice==="ALL")ck=""; else ck="";
    // build control by pooling the relevant cell keys
    const ctrlPool:number[]=[];
    for(const bl of [true,false])for(const st of [true,false]){
      if(slice==="bull"&&!bl)continue; if(slice==="bear"&&bl)continue;
      if(slice==="calm"&&st)continue; if(slice==="stress"&&!st)continue;
      for(const v of (rpool[key(s.dir,bl,st)]??[]))ctrlPool.push(v);
    }
    if(ctrlPool.length<30)continue;
    const ctrl:number[]=[];for(let i=0;i<Math.max(rows.length,300);i++)ctrl.push(ctrlPool[Math.floor(rnd()*ctrlPool.length)]);
    const g=edgeVsRandom(rows.map(x=>x.r),ctrl);
    const raw=g.passes&&g.setupMean>0;const defl=Math.abs(g.tStat)>=zC&&g.setupMean>0&&g.edge>0;
    const v=defl?"✓✓ EDGE (deflated)":raw?"~ beats random (raw only)":g.edge>0?"pos, not sig":"✗ none";
    console.log(`${name.padEnd(11)} ${(s.dir===1?"long":"short").padEnd(4)} ${slice.padEnd(7)} ${String(rows.length).padStart(5)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(7)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${v}`);
  }
  console.log("");
}
