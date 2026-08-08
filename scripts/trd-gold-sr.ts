#!/usr/bin/env -S deno run --allow-net
// trd-gold-sr — the tradesbysci "simple price action" method mechanized + gated. Decoded from the clips:
//   downtrend context → mark a SUPPORT/demand zone (recent swing low) → BUY the bounce off it → "no-trade until
//   price breaks above resistance" (an optional breakout-confirm variant) → stop below zone, target range high (or 3R).
// = counter-trend mean-reversion LONG at support. Strong prior it has CONDITIONAL life (D-194 bbfade_lo/bear deflated).
// Tested on GOLD (GC=F, SI=F, and GLD/SLV proxies) daily, vs a matched random LONG control (D-146). Also splits by
// regime (price<200MA = the "downtrend" the method requires) to check WHERE it beats random. No look-ahead: zone from
// data through d, enter next open, resolve forward. Free (Yahoo daily).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const SYMS=(Deno.args[0]??"GC=F,SI=F,GLD,SLV,HG=F,PL=F").split(",");
const ATRN=14,MALEN=200,SWING=20,TOL=0.005,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2;
let seed=1234; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function resolveLong(b:B[],at:number[],i:number):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-sd,tgt=entry+sd*TP;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){if(b[k].l<=stop){r=-1;break;}if(b[k].h>=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);r=(b[last].c-entry)/sd;}return r-(entry*(SPREAD_BPS/10000)*2)/sd;}

const zC=invNorm(1-0.025/6);
console.log(`tradesbysci S/R DEMAND-ZONE LONG (buy support bounce) vs RANDOM LONG — gold/metals daily, deflated |t|≥${zC.toFixed(2)}\n`);
console.log(`${"sym".padEnd(7)} ${"variant".padEnd(16)} ${"regime".padEnd(9)} ${"n".padStart(4)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
const agg:Record<string,{s:number[];c:number[]}>={};
for(const sym of SYMS){const b=await daily(sym);if(b.length<MALEN+SWING+60){console.log(`${sym.padEnd(7)} (only ${b.length} bars, skip)`);continue;}
  const cl=b.map(x=>x.c);const at=atr(b,ATRN),ma=sma(cl,MALEN);
  // variants: bounce = buy demand-zone touch ; breakconf = bounce THEN close breaks above prior 20-bar high ("no-trade until break above")
  for(const variant of ["bounce","breakconf"] as const){
    for(const regime of ["ALL","downtrend","uptrend"] as const){
      const S:number[]=[],C:number[]=[];
      for(let i=MALEN+SWING;i<b.length-1;i++){
        if(!(at[i]>0)||!(ma[i]>0))continue;
        const down=cl[i]<ma[i]; if(regime==="downtrend"&&!down)continue; if(regime==="uptrend"&&down)continue;
        let lo=Infinity,hi=-Infinity;for(let k=i-SWING;k<i;k++){if(b[k].l<lo)lo=b[k].l;if(b[k].h>hi)hi=b[k].h;} // support/resistance
        const touch=b[i].l<=lo*(1+TOL)&&b[i].c>lo;                    // wick into demand zone, close holds above
        let sig=touch;
        if(variant==="breakconf")sig=touch&&b[i].c>hi*(1-TOL);        // also broke above resistance (rare on same bar → mostly filters out)
        if(sig){const r=resolveLong(b,at,i);if(r!==null){S.push(r);(agg[variant+"|"+regime]??={s:[],c:[]}).s.push(r);}}
        // random long control in same regime
        if(rnd()<0.25){const rc=resolveLong(b,at,i);if(rc!==null){C.push(rc);(agg[variant+"|"+regime]??={s:[],c:[]}).c.push(rc);}}
      }
      if(S.length<30){continue;}
      const g=edgeVsRandom(S,C.length>=30?C:C.concat(C,C,C,C).slice(0,Math.max(30,S.length)));
      const defl=Math.abs(g.tStat)>=zC&&g.edge>0&&g.setupMean>0;
      console.log(`${sym.padEnd(7)} ${variant.padEnd(16)} ${regime.padEnd(9)} ${String(S.length).padStart(4)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(7)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${defl?"✓✓ EDGE":g.passes&&g.setupMean>0?"~ raw only":g.edge>0?"pos":"✗"}`);
    }
  }
}
console.log(`\nPOOLED across all metals (more power):`);
for(const[k,v]of Object.entries(agg)){if(v.s.length<40)continue;const g=edgeVsRandom(v.s,v.c);const defl=Math.abs(g.tStat)>=zC&&g.edge>0&&g.setupMean>0;
  console.log(`  ${k.padEnd(24)} n=${String(v.s.length).padStart(4)} setupR ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)} vs rand ${g.controlMean.toFixed(3)} edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)} t=${g.tStat.toFixed(2)}  ${defl?"✓✓ EDGE":g.passes&&g.setupMean>0?"~ raw":g.edge>0?"pos":"✗"}`);}
