#!/usr/bin/env -S deno run --allow-net
// trd-complete — the COMPLETE PICTURE. Pool every setup across a broad MULTI-ASSET universe (US equities large/mid/
// small + battered tail, sector & intl ETFs, commodity futures, FX majors, crypto, rates), gate each
// (assetClass × setup × marketRegime) cell vs its matched random control (D-146), and DEFLATE program-wide by the
// total cell count (Bonferroni). Regime = US market risk-on/off (SPY vs its 200MA), applied across all assets — the
// augmentation thesis extended to the whole tested universe. No look-ahead (next-open entry). Free (Yahoo daily).
// HONEST CAVEAT: Yahoo current-constituent lists are survivorship-BIASED; capped-stop mean-reversion is robust to it
// (D-197), recovery-dependent longs (dip-buy) are inflated by it (D-176/177) — read long-edges with that discount.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean, invNorm } from "../supabase/functions/_shared/trd-stats.ts";
const ATRN=14,RSIN=14,MALEN=200,BBN=20,DON=20,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2,BORROW=0.08;
let seed=2027; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bb(cl:number[],n:number){const mid=sma(cl,n),up=new Array(cl.length).fill(NaN),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;const s=Math.sqrt(v/n);up[i]=mid[i]+2*s;lo[i]=mid[i]-2*s;}return{up,lo};}

const UNIV:Record<string,string[]>={
  "eq-mega":["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","BRK-B","JPM","V","MA","UNH","LLY","XOM","JNJ","WMT","PG","HD","COST","ORCL","NFLX","CRM","BAC","KO","PEP","CVX","MRK","ADBE","AMD"],
  "eq-mid":["ROKU","DKNG","RBLX","U","AFRM","UPST","SOFI","PLTR","SNAP","PINS","ETSY","CHWY","DDOG","NET","SNOW","CRWD","ZS","OKTA","TWLO","DOCU","ABNB","UBER","LYFT","SQ","PYPL","SHOP","COIN","HOOD","CVNA","W"],
  "eq-battered":["CCL","NCLH","AAL","UAL","DAL","GME","AMC","RIVN","LCID","NKLA","PARA","WBD","BABA","INTC","WBA","F","GM","T","VZ","BYND","SPCE","PTON","ZM","BAX","KHC","MMM","BA","GE","DIS","NKE"],
  "etf-sector":["XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLU","XLB","XLRE","XLC","SMH","IWM","DIA","SPY","QQQ","KRE","XBI","XOP","JETS"],
  "etf-intl":["EEM","EFA","FXI","EWZ","EWJ","INDA","EWG","EWU","RSX","EWY","EWT","EWH"],
  "commod":["GC=F","SI=F","CL=F","NG=F","HG=F","PL=F","PA=F","ZC=F","ZW=F","ZS=F","KC=F","CT=F","SB=F","CC=F"],
  "fx":["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X","EURJPY=X","EURGBP=X"],
  "crypto":["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"],
  "rates":["TLT","IEF","SHY","HYG","LQD","TIP","BND"],
};
const SETUPS:{name:string;dir:1|-1;fire:(cl:number[],r14:number[],ma:number[],up:number[],lo:number[],hh:number[],ll:number[],i:number)=>boolean}[]=[
  {name:"ripshort",dir:-1,fire:(cl,r14,ma,_u,_l,_h,_ll,i)=>r14[i]>70&&cl[i]<ma[i]},
  {name:"dipbuy",dir:1,fire:(cl,r14,ma,_u,_l,_h,_ll,i)=>r14[i]<30&&cl[i]>ma[i]},
  {name:"bbfade_lo",dir:1,fire:(cl,_r,_m,_u,lo,_h,_ll,i)=>cl[i]<lo[i]},
  {name:"bbfade_hi",dir:-1,fire:(cl,_r,_m,up,_l,_h,_ll,i)=>cl[i]>up[i]},
  {name:"donch_L",dir:1,fire:(cl,_r,_m,_u,_l,hh,_ll,i)=>cl[i]>hh[i]},
  {name:"donch_S",dir:-1,fire:(cl,_r,_m,_u,_l,_h,ll,i)=>cl[i]<ll[i]},
];
function resolve(b:B[],at:number[],i:number,dir:1|-1,eqShort:boolean):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-dir*sd,tgt=entry+dir*sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(dir===1?b[k].l<=stop:b[k].h>=stop){r=-1;break;}if(dir===1?b[k].h>=tgt:b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=dir*(b[last].c-entry)/sd;}let cost=(entry*(SPREAD_BPS/10000)*2)/sd;if(dir===-1&&eqShort)cost+=(entry*BORROW*(held/365))/sd;return r-cost;}

// SPY market regime
const spy=await daily("SPY");const spyma=sma(spy.map(x=>x.c),MALEN);const bull=new Map<string,boolean>();for(let i=0;i<spy.length;i++)if(spyma[i]>0)bull.set(spy[i].d,spy[i].c>spyma[i]);

type RD={r:number;d:string};
type Cell={S:RD[];C:RD[]};
const cells:Record<string,Cell>={};   // key = class|setup|regime
const key=(a:string,s:string,r:string)=>`${a}|${s}|${r}`;
let pulled=0,failed=0;
const t0=Date.now();
for(const[cls,syms]of Object.entries(UNIV)){
  const eqShort=cls.startsWith("eq")||cls==="etf-sector"||cls==="etf-intl";
  for(const sym of syms){
    const b=await daily(sym);if(b.length<MALEN+BBN+60){failed++;continue;}pulled++;
    const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN),{up,lo}=bb(cl,BBN);
    const hh:number[]=[],ll:number[]=[];for(let i=0;i<b.length;i++){if(i<DON){hh[i]=NaN;ll[i]=NaN;continue;}let h=-1e9,l=1e9;for(let k=i-DON;k<i;k++){if(b[k].h>h)h=b[k].h;if(b[k].l<l)l=b[k].l;}hh[i]=h;ll[i]=l;}
    for(const su of SETUPS){
      for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;const bl=bull.get(b[i].d);const rg=bl===undefined?null:(bl?"bull":"bear");
        if(su.fire(cl,r14,ma,up,lo,hh,ll,i)){const r=resolve(b,at,i,su.dir,eqShort);if(r!==null){for(const R of ["all",rg].filter(Boolean)as string[]){(cells[key(cls,su.name,R)]??={S:[],C:[]}).S.push({r,d:b[i].d});}}}
        if(rnd()<0.08){const r=resolve(b,at,i,su.dir,eqShort);if(r!==null){for(const R of ["all",rg].filter(Boolean)as string[]){(cells[key(cls,su.name,R)]??={S:[],C:[]}).C.push({r,d:b[i].d});}}}
      }
    }
  }
  Deno.stderr.writeSync(new TextEncoder().encode(`  ${cls} done (${pulled} pulled, ${((Date.now()-t0)/1000).toFixed(0)}s)\n`));
}
// deflation: count cells with n>=100 and control>=100
const testable=Object.entries(cells).filter(([,v])=>v.S.length>=100&&v.C.length>=100);
const allDates=testable.flatMap(([,v])=>v.S.map(x=>x.d)).sort();const midDate=allDates[Math.floor(allDates.length/2)];
const zC=invNorm(1-0.025/Math.max(1,testable.length));
console.log(`\n=== COMPLETE PICTURE — ${pulled} instruments pulled (${failed} too-short), ${Object.keys(UNIV).length} asset classes, ${SETUPS.length} setups ===`);
console.log(`${testable.length} testable cells (n≥100). PROGRAM-WIDE deflation |t|≥${zC.toFixed(2)} (Bonferroni over all cells).\n`);
const rows=testable.map(([k,v])=>{const[a,s,r]=k.split("|");const g=edgeVsRandom(v.S.map(x=>x.r),v.C.map(x=>x.r));const s1=v.S.filter(x=>x.d<midDate).map(x=>x.r),s2=v.S.filter(x=>x.d>=midDate).map(x=>x.r),c1=v.C.filter(x=>x.d<midDate).map(x=>x.r),c2=v.C.filter(x=>x.d>=midDate).map(x=>x.r);const g1=s1.length>=30&&c1.length>=30?edgeVsRandom(s1,c1):null,g2=s2.length>=30&&c2.length>=30?edgeVsRandom(s2,c2):null;const both=!!(g1&&g2&&g1.edge>0&&g2.edge>0);return{a,s,r,n:v.S.length,g,g1,g2,both,defl:Math.abs(g.tStat)>=zC&&g.edge>0&&g.setupMean>0};});
const surv=rows.filter(x=>x.defl).sort((a,b)=>b.g.tStat-a.g.tStat);
const rawpos=rows.filter(x=>x.g.passes&&x.g.setupMean>0).length;
console.log(`RESULT: ${rows.length} cells tested → ${rawpos} raw-positive (t≥2) → ${surv.length} SURVIVE program-wide deflation.\n`);
console.log(`${"class".padEnd(12)} ${"setup".padEnd(10)} ${"regime".padEnd(5)} ${"n".padStart(6)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  ✓`);
const shortRobust=(x:{s:string})=>x.s==="ripshort"||x.s==="bbfade_hi"||x.s==="donch_S";const recoveryDep=(x:{s:string})=>x.s==="donch_L"||x.s==="dipbuy";console.log(`${"class".padEnd(12)} ${"setup".padEnd(10)} ${"reg".padEnd(4)} ${"n".padStart(6)} ${"edge".padStart(7)} ${"t".padStart(6)}  bothH   survivorship-read`);for(const x of surv){const h=x.both?"H1+H2 ✓":"⚠ half-flip";const sv=recoveryDep(x)?((x.a==="crypto")?"SUSPECT (crypto=worst delisting bias)":"SUSPECT (recovery-dep long, biased universe)"):(shortRobust(x)||x.a.startsWith("etf")?"ROBUST (capped/ETF, D-197)":"check");console.log(`${x.a.padEnd(12)} ${x.s.padEnd(10)} ${x.r.padEnd(4)} ${String(x.n).padStart(6)} ${((x.g.edge>=0?"+":"")+x.g.edge.toFixed(3)).padStart(7)} ${x.g.tStat.toFixed(2).padStart(6)}  ${h.padEnd(9)} ${sv}`);}
console.log(`\n--- near-misses (raw t≥2 but killed by deflation — the false-positive tail) ---`);
for(const x of rows.filter(x=>!x.defl&&x.g.passes&&x.g.setupMean>0).sort((a,b)=>b.g.tStat-a.g.tStat).slice(0,10))
  console.log(`${x.a.padEnd(12)} ${x.s.padEnd(10)} ${x.r.padEnd(5)} n=${String(x.n).padStart(6)} edge ${(x.g.edge>=0?"+":"")+x.g.edge.toFixed(3)} t=${x.g.tStat.toFixed(2)}`);
