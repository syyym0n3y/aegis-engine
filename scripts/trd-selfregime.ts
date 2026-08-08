#!/usr/bin/env -S deno run --allow-net
// trd-selfregime — DE-BIASED engine (operator D-202): judge each instrument on ITS OWN terms. NO market-wide (SPY)
// regime imposed; NO pooling of returns into one number. For each instrument we test each setup against ITS OWN
// matched random control (same instrument, same direction, same mechanics) using the instrument's OWN 200MA trend +
// OWN volatility as the only regime. Then we infer at the POPULATION level not by averaging returns but by COUNTING:
// of N instruments, how many INDIVIDUALLY beat their own random (edge>0 & |t|≥2)? Under the no-edge null that count
// is Binomial(N, ~0.025); if the observed count is far into the tail, the setup has a systematic per-instrument edge —
// without any instrument's behavior being dictated by the aggregate. Free (Yahoo daily).
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const ATRN=14,RSIN=14,MALEN=200,BBN=20,DON=20,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08;
let seed=909; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const s=Math.sqrt(v/n);up[i]=mid[i]+2*s;lo[i]=mid[i]-2*s;}return{up,lo};}
// binomial upper tail P(X>=k | N,p) exact
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}

const UNIV:Record<string,string[]>={
  "eq-mega":["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","BRK-B","JPM","V","MA","UNH","LLY","XOM","JNJ","WMT","PG","HD","COST","ORCL","NFLX","CRM","BAC","KO","PEP","CVX","MRK","ADBE","AMD"],
  "eq-mid":["ROKU","DKNG","RBLX","U","AFRM","UPST","SOFI","PLTR","SNAP","PINS","ETSY","CHWY","DDOG","NET","SNOW","CRWD","ZS","OKTA","TWLO","DOCU","ABNB","UBER","LYFT","SQ","PYPL","SHOP","COIN","HOOD","CVNA","W"],
  "eq-battered":["CCL","NCLH","AAL","UAL","DAL","GME","AMC","RIVN","LCID","PARA","WBD","BABA","INTC","WBA","F","GM","T","VZ","BYND","PTON","ZM","BAX","KHC","MMM","BA","GE","DIS","NKE"],
  "commod":["GC=F","SI=F","CL=F","NG=F","HG=F","PL=F","PA=F","ZC=F","ZW=F","ZS=F","KC=F","CT=F","SB=F","CC=F"],
  "fx":["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X","EURJPY=X","EURGBP=X"],
  "crypto":["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"],
};
const SETUPS:{name:string;dir:1|-1;fire:(cl:number[],r14:number[],ma:number[],up:number[],lo:number[],hh:number[],ll:number[],i:number)=>boolean}[]=[
  {name:"ripshort",dir:-1,fire:(cl,r14,ma,_u,_l,_h,_ll,i)=>r14[i]>70&&cl[i]<ma[i]},
  {name:"dipbuy",dir:1,fire:(cl,r14,ma,_u,_l,_h,_ll,i)=>r14[i]<30&&cl[i]>ma[i]},
  {name:"bbfade_lo",dir:1,fire:(cl,_r,_m,_u,lo,_h,_ll,i)=>cl[i]<lo[i]},
  {name:"donch_L",dir:1,fire:(cl,_r,_m,_u,_l,hh,_ll,i)=>cl[i]>hh[i]},
];
function resolve(b:B[],at:number[],i:number,dir:1|-1,eqShort:boolean):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=dir*(b[last].c-entry)/sd;}let cost=(entry*(SPREAD_BPS/10000)*2)/sd;if(dir===-1&&eqShort)cost+=(entry*BORROW*(held/365))/sd;return r-cost;}

console.log(`DE-BIASED — each instrument judged on ITS OWN regime vs ITS OWN random control; population inference by COUNT`);
console.log(`(how many instruments INDIVIDUALLY beat their own random, vs the Binomial(N,0.025) chance null). No SPY, no pooling.\n`);
console.log(`${"class".padEnd(12)} ${"setup".padEnd(10)} ${"N".padStart(3)} ${"k>rand".padStart(7)} ${"%pos".padStart(5)} ${"medEdge".padStart(8)} ${"binom p".padStart(9)}  verdict`);
type Per={sym:string;t:number;edge:number;n:number};
for(const[cls,syms]of Object.entries(UNIV)){
  const eqShort=cls.startsWith("eq");
  const per:Record<string,Per[]>={};
  for(const sym of syms){const b=await daily(sym);if(b.length<MALEN+BBN+60)continue;
    const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN),{up,lo}=bb(cl,BBN);
    const hh:number[]=[],ll:number[]=[];for(let i=0;i<b.length;i++){if(i<DON){hh[i]=NaN;ll[i]=NaN;continue;}let h=-1e9,l=1e9;for(let k=i-DON;k<i;k++){if(b[k].h>h)h=b[k].h;if(b[k].l<l)l=b[k].l;}hh[i]=h;ll[i]=l;}
    for(const su of SETUPS){const S:number[]=[],C:number[]=[];
      for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;
        if(su.fire(cl,r14,ma,up,lo,hh,ll,i)){const r=resolve(b,at,i,su.dir,eqShort);if(r!==null)S.push(r);}
        if(rnd()<0.5){const r=resolve(b,at,i,su.dir,eqShort);if(r!==null)C.push(r);}}
      if(S.length>=30&&C.length>=30){const g=edgeVsRandom(S,C);(per[su.name]??=[]).push({sym,t:g.tStat,edge:g.edge,n:S.length});}
    }
  }
  for(const su of SETUPS){const rows=per[su.name]??[];if(rows.length<4)continue;
    const N=rows.length,k=rows.filter(r=>r.edge>0&&r.t>=2).length,pos=rows.filter(r=>r.edge>0).length;
    const medEdge=rows.map(r=>r.edge).sort((a,b)=>a-b)[Math.floor(N/2)];
    const p=binomUpper(k,N,0.025);
    const v=p<0.001?"✓✓ SYSTEMATIC per-instrument edge":p<0.05?"~ leans real":pos/N>0.6?"drift-suspect (many pos, few significant)":"✗ no per-instrument edge";
    console.log(`${cls.padEnd(12)} ${su.name.padEnd(10)} ${String(N).padStart(3)} ${String(k).padStart(7)} ${String(Math.round(pos/N*100)).padStart(4)}% ${((medEdge>=0?"+":"")+medEdge.toFixed(3)).padStart(8)} ${p.toExponential(1).padStart(9)}  ${v}`);
  }
  console.log("");
}
console.log(`READ: k = #instruments whose setup individually beats its OWN random at t≥2 (expected ≈2.5% of N by chance).`);
console.log(`Binom p = probability that many-or-more clear by luck. p<0.001 = the edge is systematic ACROSS individual`);
console.log(`instruments, each on its own terms — no aggregate imposed. %pos high but k low + p large = drift, not edge.`);
