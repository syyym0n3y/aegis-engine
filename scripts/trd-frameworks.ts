#!/usr/bin/env -S deno run --allow-net
// trd-frameworks — close the remaining timeframe gaps (operator): WEEKLY (1wk) + 4H (resampled from 1h) across
// commodities/futures + fx + crypto + equity-mega, de-biased per-instrument (D-202): each instrument on its own regime
// vs its own random control, population inference by COUNT (Binomial(N,0.025)), dual criterion skill+net. Combined with
// daily (D-201/202) and 5m/15m/30m/1h (D-204) this makes the framework grid complete: weekly→daily→4h→1h→30m→15m→5m.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=414; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{o:number;h:number;l:number;c:number}
async function fetchBars(sym:string,iv:string,range:string,period0=false):Promise<B[]>{try{const q=period0?`period1=0&period2=${Math.floor(Date.now()/1000)}`:`range=${range}`;const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&${q}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const c=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=c.open[i],h=c.high[i],l=c.low[i],cl=c.close[i];if([O,h,l,cl].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c:cl});}return o;}catch{return[];}}
function resample4h(b:B[]):B[]{const out:B[]=[];for(let i=0;i<b.length;i+=4){const g=b.slice(i,i+4);if(!g.length)break;out.push({o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g[g.length-1].c});}return out;}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const s=Math.sqrt(v/n);up[i]=mid[i]+2*s;lo[i]=mid[i]-2*s;}return{up,lo};}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
const UNIV:Record<string,{syms:string[];bps:number}>={
  "eq-mega":{syms:["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL"],bps:2},
  "commod":{syms:["GC=F","SI=F","CL=F","NG=F","HG=F","PL=F","PA=F","ZC=F","ZW=F","ZS=F","KC=F","CT=F","SB=F","CC=F"],bps:3},
  "fx":{syms:["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X"],bps:2},
  "crypto":{syms:["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"],bps:5},
};
const SETUPS:{name:string;dir:1|-1;fire:(cl:number[],r:number[],m:number[],up:number[],lo:number[],hh:number[],ll:number[],i:number)=>boolean}[]=[
  {name:"ripshort",dir:-1,fire:(cl,r,m,_u,_l,_h,_ll,i)=>r[i]>70&&cl[i]<m[i]},
  {name:"dipbuy",dir:1,fire:(cl,r,m,_u,_l,_h,_ll,i)=>r[i]<30&&cl[i]>m[i]},
  {name:"bbfade_lo",dir:1,fire:(cl,_r,_m,_u,lo,_h,_ll,i)=>cl[i]<lo[i]},
  {name:"donch_L",dir:1,fire:(cl,_r,_m,_u,_l,hh,_ll,i)=>cl[i]>hh[i]},
  {name:"donch_S",dir:-1,fire:(cl,_r,_m,_u,_l,_h,ll,i)=>cl[i]<ll[i]},
];
function run(b:B[],ML:number,BN:number,DN:number,MH:number,bps:number){const cl=b.map(x=>x.c);const at=atr(b,14),r14=rsi(cl,14),ma=sma(cl,ML),{up,lo}=bb(cl,BN);const hh:number[]=[],ll:number[]=[];for(let i=0;i<b.length;i++){if(i<DN){hh[i]=NaN;ll[i]=NaN;continue;}let h=-1e9,l=1e9;for(let k=i-DN;k<i;k++){if(b[k].h>h)h=b[k].h;if(b[k].l<l)l=b[k].l;}hh[i]=h;ll[i]=l;}
  const res:Record<string,{t:number;edge:number;net:number}>={};
  for(const su of SETUPS){const S:number[]=[],C:number[]=[];for(let i=ML+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;const fire=su.fire(cl,r14,ma,up,lo,hh,ll,i);
    const doTrade=(dir:1|-1)=>{const entry=b[i+1].o,sd=2*at[i];if(!(sd>entry*1e-6))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*3;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MH,b.length-1);k++){if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=3;break;}}if(r===null){const last=Math.min(i+MH,b.length-1);r=dir*(b[last].c-entry)/sd;}return r-(entry*(bps/10000)*2)/sd;};
    if(fire){const r=doTrade(su.dir);if(r!==null)S.push(r);}if(rnd()<0.3){const r=doTrade(su.dir);if(r!==null)C.push(r);}}
    if(S.length>=30&&C.length>=30){const g=edgeVsRandom(S,C);res[su.name]={t:g.tStat,edge:g.edge,net:S.reduce((a,b)=>a+b,0)/S.length};}}
  return res;}
console.log(`FRAMEWORK COMPLETION — weekly + 4h, de-biased per-instrument count-inference (dual: systematic vs random AND net>0)\n`);
console.log(`${"tf".padEnd(5)} ${"class".padEnd(9)} best setup (k/N systematic, medNet, binom p) — TRADEABLE only if p<1e-3 & net>0`);
for(const[tf,cfg]of [["weekly",{iv:"1wk",p0:true,ML:40,BN:20,DN:20,MH:20}],["4h",{iv:"1h",p0:false,ML:200,BN:20,DN:20,MH:20}]] as const){
  for(const[cls,{syms,bps}]of Object.entries(UNIV)){
    const per:Record<string,{t:number;edge:number;net:number}[]>={};
    for(const sym of syms){let b=await fetchBars(sym,cfg.iv,"730d",cfg.p0);if(tf==="4h")b=resample4h(b);if(b.length<cfg.ML+cfg.BN+40)continue;
      const r=run(b,cfg.ML,cfg.BN,cfg.DN,cfg.MH,bps);for(const[k,v]of Object.entries(r))(per[k]??=[]).push(v);}
    let best="(insufficient)",bp=2;for(const su of SETUPS){const rows=per[su.name]??[];if(rows.length<4)continue;const N=rows.length,k=rows.filter(r=>r.edge>0&&r.t>=2).length;const medNet=rows.map(r=>r.net).sort((a,b)=>a-b)[Math.floor(N/2)];const p=binomUpper(k,N,0.025);if(p<bp){bp=p;const trade=p<0.001&&medNet>0;best=`${su.name} (${k}/${N}, net ${(medNet>=0?"+":"")+medNet.toFixed(3)}R, p=${p.toExponential(1)})${trade?" << TRADEABLE":medNet<=0&&p<0.001?" [skill,net<0]":""}`;}}
    console.log(`${tf.padEnd(5)} ${cls.padEnd(9)} ${best}`);
  }
  console.log("");
}
