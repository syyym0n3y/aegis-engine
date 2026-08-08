#!/usr/bin/env -S deno run --allow-net
// trd-bbfade-verify — before crediting bbfade_lo/bear (D-194's one "new" conditional edge) it must clear the SAME bar
// the demand-bounce faced (D-196): is the +0.078R real, or the dip-buy survivorship mirage (PLAYBOOK #6: dip-buy
// t=5.63 biased → 1.15 free)? Cheap free proxies for the QC survivorship-free run: (a) both-time-halves sign
// stability (D-155 — curve-fit fails this), (b) a ROUGHER universe incl. names that suffered deep drawdowns /
// near-delisting (survivorship-biased sets exclude exactly these). If the edge is same-sign-positive in both halves
// AND holds on the rough set, it's a candidate; if it evaporates, it carries the dip-buy caveat and is NOT deployable.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
// CLEAN (D-194's 50 current large-cap survivors) vs ROUGH (add battered/near-death names: airlines, retail, meme,
// deep-drawdown — proxies for the delisted-tail a survivorship-biased set drops)
const CLEAN=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","XOM","CVX","COP","SLB","JNJ","PFE","MRK","LLY","UNH","WMT","COST","HD","LOW","MCD","NKE","KO","PEP","PG","CAT","DE","BA","GE","F","GM","UBER","DIS"];
const ROUGH=[...CLEAN,"CCL","NCLH","AAL","UAL","DAL","GME","AMC","BBBYQ","PLTR","COIN","RIVN","LCID","NKLA","SNAP","PARA","WBD","BABA","INTC","PYPL","SQ","HOOD","DKNG","CVNA","W","PTON","ZM","ROKU","BYND","SPCE","RIOT","MARA","T","VZ","WBA","KHC","BAX"];
const ATRN=14,MALEN=200,BBN=20,STOP_ATR=2,TP=3,MAXHOLD=20,SPREAD_BPS=2;
let seed=555; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function bbLo(cl:number[],n:number){const mid=sma(cl,n),lo=new Array(cl.length).fill(NaN);for(let i=n-1;i<cl.length;i++){let v=0;for(let k=i-n+1;k<=i;k++)v+=(cl[k]-mid[i])**2;lo[i]=mid[i]-2*Math.sqrt(v/n);}return lo;}
function resolveLong(b:B[],at:number[],i:number):number|null{if(!(at[i]>0)||i+1>=b.length)return null;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry-sd,tgt=entry+sd*TP;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){if(b[k].l<=stop){r=-1;break;}if(b[k].h>=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);r=(b[last].c-entry)/sd;}return r-(entry*(SPREAD_BPS/10000)*2)/sd;}

const spy=await daily("SPY");const spyma=sma(spy.map(x=>x.c),MALEN);const bear=new Map<string,boolean>();for(let i=0;i<spy.length;i++)if(spyma[i]>0)bear.set(spy[i].d,spy[i].c<spyma[i]);
async function run(univ:string[],label:string){
  const sig:{d:string;r:number}[]=[],ctrl:{d:string;r:number}[]=[];
  for(const sym of univ){const b=await daily(sym);if(b.length<MALEN+BBN+60)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),ma=sma(cl,MALEN),lo=bbLo(cl,BBN);
    for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0)||!Number.isFinite(lo[i]))continue;if(!bear.get(b[i].d))continue;
      if(cl[i]<lo[i]){const r=resolveLong(b,at,i);if(r!==null)sig.push({d:b[i].d,r});}
      if(rnd()<0.2){const r=resolveLong(b,at,i);if(r!==null)ctrl.push({d:b[i].d,r});}}}
  const mid=sig.map(x=>x.d).sort()[Math.floor(sig.length/2)];
  const h1=sig.filter(x=>x.d<mid).map(x=>x.r),h2=sig.filter(x=>x.d>=mid).map(x=>x.r);
  const c1=ctrl.filter(x=>x.d<mid).map(x=>x.r),c2=ctrl.filter(x=>x.d>=mid).map(x=>x.r);
  const g=edgeVsRandom(sig.map(x=>x.r),ctrl.map(x=>x.r));
  const g1=edgeVsRandom(h1,c1),g2=edgeVsRandom(h2,c2);
  const bothPos=g1.edge>0&&g2.edge>0;
  console.log(`${label.padEnd(22)} n=${String(sig.length).padStart(5)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)} t=${g.tStat.toFixed(2)}  | H1 edge ${(g1.edge>=0?"+":"")+g1.edge.toFixed(3)} t=${g1.tStat.toFixed(2)}  H2 edge ${(g2.edge>=0?"+":"")+g2.edge.toFixed(3)} t=${g2.tStat.toFixed(2)}  ${bothPos?"both-halves +":"⚠ SIGN FLIP"}`);
}
console.log(`bbfade_lo/BEAR survivorship + stability check (D-194's one 'new' edge) — is it real or the dip-buy mirage?\n`);
await run(CLEAN,"CLEAN (50 survivors)");
await run(ROUGH,"ROUGH (+38 battered)");
console.log(`\nREAD: if edge holds same-sign-positive across BOTH halves AND survives the ROUGH set ≈ candidate; if it`);
console.log(`shrinks toward 0 on ROUGH or flips sign in a half, it carries the dip-buy survivorship caveat (D-176/177) — NOT deployable.`);
