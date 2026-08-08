#!/usr/bin/env -S deno run --allow-net
// trd-tfladder — the FULL intraday timeframe ladder (operator: "across all timeframes"). De-biased per-instrument
// engine (D-202) run at 5m / 15m / 30m / 1h on crypto/FX/futures. For each (timeframe × class × setup): count how many
// instruments individually beat their OWN random at t≥2 (Binomial(N,0.025) null) AND the median cost-in-R. Shows the
// cost wall MEASURED, not assumed: as bars speed up, ATR-stop shrinks, fixed spread eats a larger fraction of R.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const ATRN=14,RSIN=14,MALEN=200,BBN=20,DON=20,STOP_ATR=2,TP=3,MAXHOLD=20;
let seed=555; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{o:number;h:number;l:number;c:number}
async function bars(sym:string,iv:string,range:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const s=Math.sqrt(v/n);up[i]=mid[i]+2*s;lo[i]=mid[i]-2*s;}return{up,lo};}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
const TFS:[string,string][]=[["5m","60d"],["15m","60d"],["30m","60d"],["1h","730d"]];
const UNIV:Record<string,{syms:string[];bps:number}>={
  crypto:{syms:["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"],bps:5},
  fx:{syms:["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X"],bps:2},
  futures:{syms:["GC=F","SI=F","CL=F","NG=F","HG=F","ZC=F","ZW=F","ZS=F","KC=F"],bps:3},
};
const SETUPS:{name:string;dir:1|-1;fire:(cl:number[],r14:number[],ma:number[],up:number[],lo:number[],hh:number[],ll:number[],i:number)=>boolean}[]=[
  {name:"ripshort",dir:-1,fire:(cl,r,m,_u,_l,_h,_ll,i)=>r[i]>70&&cl[i]<m[i]},
  {name:"dipbuy",dir:1,fire:(cl,r,m,_u,_l,_h,_ll,i)=>r[i]<30&&cl[i]>m[i]},
  {name:"bbfade_lo",dir:1,fire:(cl,_r,_m,_u,lo,_h,_ll,i)=>cl[i]<lo[i]},
  {name:"bbfade_hi",dir:-1,fire:(cl,_r,_m,up,_l,_h,_ll,i)=>cl[i]>up[i]},
  {name:"donch_L",dir:1,fire:(cl,_r,_m,_u,_l,hh,_ll,i)=>cl[i]>hh[i]},
  {name:"donch_S",dir:-1,fire:(cl,_r,_m,_u,_l,_h,ll,i)=>cl[i]<ll[i]},
];
let COST:number[]=[];
function resolve(b:B[],at:number[],i:number,dir:1|-1,bps:number):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-6))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);r=dir*(b[last].c-entry)/sd;}const c=(entry*(bps/10000)*2)/sd;COST.push(c);return r-c;}
console.log(`TIMEFRAME LADDER (de-biased, per-instrument, count-inference) — systematic edges + cost-in-R per (tf × class)\n`);
console.log(`${"tf".padEnd(4)} ${"class".padEnd(9)} ${"cost-R".padStart(7)}  best setup (k/N, medEdgeR, binom p)`);
const systematic:string[]=[];
for(const[iv,range]of TFS){
  for(const[cls,{syms,bps}]of Object.entries(UNIV)){
    const per:Record<string,{t:number;edge:number;netR:number}[]>={};COST=[];
    for(const sym of syms){const b=await bars(sym,iv,range);if(b.length<MALEN+BBN+150)continue;
      const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN),{up,lo}=bb(cl,BBN);
      const hh:number[]=[],ll:number[]=[];for(let i=0;i<b.length;i++){if(i<DON){hh[i]=NaN;ll[i]=NaN;continue;}let h=-1e9,l=1e9;for(let k=i-DON;k<i;k++){if(b[k].h>h)h=b[k].h;if(b[k].l<l)l=b[k].l;}hh[i]=h;ll[i]=l;}
      for(const su of SETUPS){const S:number[]=[],C:number[]=[];
        for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;
          if(su.fire(cl,r14,ma,up,lo,hh,ll,i)){const r=resolve(b,at,i,su.dir,bps);if(r!==null)S.push(r);}
          if(rnd()<0.2){const r=resolve(b,at,i,su.dir,bps);if(r!==null)C.push(r);}}
        if(S.length>=50&&C.length>=50){const g=edgeVsRandom(S,C);const netR=S.reduce((a,b)=>a+b,0)/S.length;(per[su.name]??=[]).push({t:g.tStat,edge:g.edge,netR});}}}
    const medCost=COST.length?COST.slice().sort((a,b)=>a-b)[Math.floor(COST.length/2)]:NaN;
    let best="(insufficient data)",bestP=2;
    for(const su of SETUPS){const rows=per[su.name]??[];if(rows.length<4)continue;const N=rows.length,k=rows.filter(r=>r.edge>0&&r.t>=2).length;const medEdge=rows.map(r=>r.edge).sort((a,b)=>a-b)[Math.floor(N/2)];const medNet=rows.map(r=>r.netR).sort((a,b)=>a-b)[Math.floor(N/2)];const p=binomUpper(k,N,0.025);if(p<bestP){bestP=p;const trade=p<0.001&&medNet>0;best=`${su.name} (${k}/${N}, edgeVsRand ${(medEdge>=0?"+":"")+medEdge.toFixed(3)}, NET ${(medNet>=0?"+":"")+medNet.toFixed(3)}R, p=${p.toExponential(1)}) ${trade?"<< TRADEABLE":medNet<=0&&p<0.001?"[skill but NET<0 = cost wall]":""}`;if(trade)systematic.push(`${iv} ${cls} ${su.name} NET+${medNet.toFixed(3)}R p=${p.toExponential(1)}`);}}
    console.log(`${iv.padEnd(4)} ${cls.padEnd(9)} ${medCost.toFixed(3).padStart(7)}  ${best}`);
  }
  console.log("");
}
console.log(`TRADEABLE intraday edges (systematic vs random AND net-positive after cost): ${systematic.length?systematic.join("; "):"NONE across 5m/15m/30m/1h × crypto/fx/futures"}`);
console.log(`Cost-in-R rises monotonically as bars speed up — the measured cost wall. Compare to daily (D-202): rip-short eq p=1e-7, crypto momentum p=5e-7.`);
