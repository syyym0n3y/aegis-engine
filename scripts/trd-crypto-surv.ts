#!/usr/bin/env -S deno run --allow-net
// trd-crypto-surv — survivorship stress on the crypto edges (D-205). D-202 found crypto momentum (donch_L) systematic
// per-instrument (p=5e-7) but on 8 SURVIVOR coins. Test it on the BATTERED tail (coins that cratered 54–100%: LUNC,
// ICP, CRV, ALGO, EOS, FTT…) — the best free proxy for the delisted-to-zero coins a survivor set drops. D-197 logic:
// recovery-dependent momentum-long should COLLAPSE on cratered coins (repeated stop-outs as they bleed down); capped
// mean-reversion (bbfade_lo) should HOLD. Per-instrument, own random control, count-inference + net + both-halves.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const ATRN=14,RSIN=14,MALEN=200,BBN=20,DON=20,STOP_ATR=2,TP=3,MAXHOLD=20,BPS=5;
let seed=606; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bblo(cl:number[],n:number){const mid=sma(cl,n),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;lo[i]=mid[i]-2*Math.sqrt(v/n);}return lo;}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
const CLEAN=["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"];
const BATTERED=["FTT-USD","LUNC-USD","EOS-USD","WAVES-USD","XTZ-USD","BCH-USD","ETC-USD","ATOM-USD","ALGO-USD","NEO-USD","DASH-USD","FIL-USD","ICP-USD","APE-USD","CRV-USD","1INCH-USD"];
function resolve(b:B[],at:number[],i:number,dir:1|-1):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-6))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);r=dir*(b[last].c-entry)/sd;}return r-(entry*(BPS/10000)*2)/sd;}
type P={t:number;edge:number;net:number;e1:number;e2:number};
async function testSet(syms:readonly string[],setup:"donch_L"|"bbfade_lo"):Promise<P[]>{const out:P[]=[];
  for(const sym of syms){const b=await daily(sym);if(b.length<MALEN+BBN+120)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),ma=sma(cl,MALEN),lo=bblo(cl,BBN);
    const hh:number[]=[];for(let i=0;i<b.length;i++){if(i<DON){hh[i]=NaN;continue;}let h=-1e9;for(let k=i-DON;k<i;k++)if(b[k].h>h)h=b[k].h;hh[i]=h;}
    const S:{r:number;d:string}[]=[],C:number[]=[];
    for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;const fire=setup==="donch_L"?cl[i]>hh[i]:cl[i]<lo[i];
      if(fire){const r=resolve(b,at,i,1);if(r!==null)S.push({r,d:b[i].d});}if(rnd()<0.4){const r=resolve(b,at,i,1);if(r!==null)C.push(r);}}
    if(S.length>=30&&C.length>=30){const g=edgeVsRandom(S.map(x=>x.r),C);const mid=S.map(x=>x.d).sort()[Math.floor(S.length/2)];const s1=S.filter(x=>x.d<mid).map(x=>x.r),s2=S.filter(x=>x.d>=mid).map(x=>x.r);
      const g1=s1.length>=15?edgeVsRandom(s1,C):null,g2=s2.length>=15?edgeVsRandom(s2,C):null;out.push({t:g.tStat,edge:g.edge,net:S.reduce((a,b)=>a+b.r,0)/S.length,e1:g1?g1.edge:NaN,e2:g2?g2.edge:NaN});}}
  return out;}
function summ(rows:P[]){const N=rows.length,k=rows.filter(r=>r.edge>0&&r.t>=2).length,pos=rows.filter(r=>r.edge>0).length;const medNet=rows.map(r=>r.net).sort((a,b)=>a-b)[Math.floor(N/2)];const both=rows.filter(r=>Number.isFinite(r.e1)&&Number.isFinite(r.e2));const bothPos=both.filter(r=>r.e1>0&&r.e2>0).length;const p=binomUpper(k,N,0.025);return{N,k,pos,medNet,p,bothPos,bothN:both.length};}
console.log(`CRYPTO SURVIVORSHIP STRESS (D-205) — does the edge hold on the CRATERED tail (54–100% drawdown coins)?\n`);
console.log(`${"setup".padEnd(10)} ${"set".padEnd(9)} ${"N".padStart(3)} ${"k".padStart(3)} ${"%pos".padStart(5)} ${"medNet".padStart(8)} ${"binom p".padStart(9)} ${"bothH".padStart(7)}  read`);
for(const setup of ["donch_L","bbfade_lo"] as const){
  for(const[label,syms]of [["survivors",CLEAN],["battered",BATTERED],["combined",[...CLEAN,...BATTERED]]] as const){
    const rows=await testSet(syms,setup);if(rows.length<4){console.log(`${setup.padEnd(10)} ${label.padEnd(9)} (insufficient)`);continue;}
    const s=summ(rows);const verdict=s.p<0.001?"SYSTEMATIC":s.p<0.05?"leans":"none";
    console.log(`${setup.padEnd(10)} ${label.padEnd(9)} ${String(s.N).padStart(3)} ${String(s.k).padStart(3)} ${String(Math.round(s.pos/s.N*100)).padStart(4)}% ${((s.medNet>=0?"+":"")+s.medNet.toFixed(3)).padStart(8)} ${s.p.toExponential(1).padStart(9)} ${(s.bothPos+"/"+s.bothN).padStart(7)}  ${verdict}`);
  }
  console.log("");
}
console.log(`PREDICTION (D-197): momentum-long (donch_L, recovery-dependent) COLLAPSES on battered; bbfade_lo (capped mean-rev) HOLDS.`);
console.log(`If donch_L stays systematic + net>0 on battered too → momentum is robust, not a survivorship mirage. If it dies → mirage confirmed.`);
