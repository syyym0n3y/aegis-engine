#!/usr/bin/env -S deno run --allow-net
// trd-sr-daily — statistically-powered version of the tradesbysci S/R test on FULL Yahoo daily history (decades).
// Demand-zone BOUNCE long (pullback to tested support after downtrend) + resistance BREAKOUT long, vs matched random
// long (D-146). Gold (GC=F) + broad universe for power. No look-ahead: level from past swings, enter next open.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const U=["GC=F","SI=F","CL=F","GLD","SLV","AAPL","MSFT","NVDA","AMZN","META","TSLA","JPM","XOM","SPY","QQQ","IWM","AMD","GOOGL","NFLX","WMT","HD","KO","CAT","BA","DIS","F","GE","INTC","MU","CSCO"];
const K=3,TOL=0.008,ATRN=14,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2;let seed=31;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
const bounce:number[]=[],brk:number[]=[],ctrl:number[]=[];
for(const sym of U){const b=await daily(sym);const N=b.length;if(N<400)continue;
 const tr:number[]=[];for(let i=0;i<N;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const atr=new Array(N).fill(NaN);{let s=0;for(let i=0;i<N;i++){s+=tr[i];if(i>=ATRN)s-=tr[i-ATRN];if(i>=ATRN-1)atr[i]=s/ATRN;}}
 const swLo:number[]=[],swHi:number[]=[];for(let i=K;i<N-K;i++){let lo=true,hi=true;for(let j=i-K;j<=i+K;j++){if(b[j].l<b[i].l)lo=false;if(b[j].h>b[i].h)hi=false;}if(lo)swLo.push(i);if(hi)swHi.push(i);}
 const longTrade=(ei:number,stop:number)=>{const entry=b[ei].o;const risk=entry-stop;if(!(risk>0))return null;const tgt=entry+risk*TP;for(let k=ei;k<Math.min(ei+MAXHOLD,N);k++){if(b[k].l<=stop)return -1;if(b[k].h>=tgt)return TP;}return (b[Math.min(ei+MAXHOLD,N-1)].c-entry)/risk;};
 const pool:number[]=[];for(let i=ATRN+1;i<N-MAXHOLD;i++)if(atr[i]>0)pool.push(i);
 for(let ii=0;ii<swLo.length;ii++){const li=swLo[ii],lvl=b[li].l;let tests=0;for(let jj=0;jj<ii;jj++)if(Math.abs(b[swLo[jj]].l-lvl)/lvl<TOL)tests++;if(tests<1)continue;if(!(li-20>=0&&b[li-20].c>lvl))continue;
   for(let k=li+1;k<Math.min(li+MAXHOLD*2,N-MAXHOLD);k++){if(!(atr[k]>0))continue;if(b[k].l<=lvl*(1+TOL)&&b[k].l>=lvl*(1-TOL*2)&&b[k].c>b[k].o){const stop=lvl-STOP_ATR*atr[k];const r=longTrade(k+1,stop);if(r!==null){const cost=(b[k+1].o*(SPREAD_BPS/10000)*2)/(b[k+1].o-stop);bounce.push(r-cost);for(let q=0;q<2;q++){const j=pool[Math.floor(rnd()*pool.length)];const rc=longTrade(j+1,b[j].o-STOP_ATR*atr[j]);if(rc!==null)ctrl.push(rc);}}break;}if(b[k].c<lvl*(1-TOL*2))break;}}
 for(let ii=0;ii<swHi.length;ii++){const hi=swHi[ii],lvl=b[hi].h;let tests=0;for(let jj=0;jj<ii;jj++)if(Math.abs(b[swHi[jj]].h-lvl)/lvl<TOL)tests++;if(tests<1)continue;
   for(let k=hi+1;k<Math.min(hi+MAXHOLD*2,N-MAXHOLD);k++){if(!(atr[k]>0))continue;if(b[k].c>lvl*(1+TOL/2)){const stop=b[k].c-STOP_ATR*atr[k];const r=longTrade(k+1,stop);if(r!==null){const cost=(b[k+1].o*(SPREAD_BPS/10000)*2)/(b[k+1].o-stop);brk.push(r-cost);}break;}}}
}
console.log(`tradesbysci S/R — FULL Yahoo daily, ${U.length} names, random-long control n=${ctrl.length}\n`);
for(const[tag,s]of[["demand-bounce",bounce],["resist-breakout",brk]] as const){const g=edgeVsRandom(s,ctrl);const ok=g.passes&&g.setupMean>0;
 console.log(`${tag.padEnd(16)} n=${String(s.length).padStart(5)}  setupR ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)}  randR ${g.controlMean.toFixed(3)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)}  t=${g.tStat.toFixed(2)}  ${ok?"✓ beats random":g.setupMean>0?"POSITIVE but = drift (no edge vs random)":"✗ REJECT"}`);}
