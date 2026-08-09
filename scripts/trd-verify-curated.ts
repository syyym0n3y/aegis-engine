import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,BORROW=0.08;
const spreadBps=(px:number)=>px<2?200:px<5?80:px<15?35:px<50?15:8;
interface B{o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
const CURATED=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","AMD","NFLX","CRM","ADBE","QCOM"];
const S:number[]=[],C:number[]=[];
for(const sym of CURATED){const b=await daily(sym);if(b.length<MALEN+40)continue;const cl=b.map(x=>x.c);const px=cl[cl.length-1];const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);const bps=spreadBps(px);
  const doT=(i:number)=>{const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))return null;const stop=entry+sd,tgt=entry-sd*TP;let r:number|null=null,held=0;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(b[k].h>=stop){r=-1;break;}if(b[k].l<=tgt){r=TP;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=(entry-b[last].c)/sd;}return r-((entry*(bps/10000)*2)/sd+(entry*BORROW*(held/365))/sd);};
  for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;if(r14[i]>70&&cl[i]<ma[i]){const r=doT(i);if(r!==null)S.push(r);}if(rnd()<0.2){const r=doT(i);if(r!==null)C.push(r);}}}
const g=edgeVsRandom(S,C,2,30);
console.log(`CURATED liquid mega-caps (30), SAME cost model as universe sweep (8bp+borrow):`);
console.log(`  n=${S.length} signals  setupR ${(g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)}  randR ${g.controlMean.toFixed(3)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)}  t=${g.tStat.toFixed(2)}  ${g.passes&&g.setupMean>0?"✓ edge holds → broad-universe negative is genuine NARROWNESS":"✗ negative here too → the sweep cost is too harsh, reconcile"}`);
