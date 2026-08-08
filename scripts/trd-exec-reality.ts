#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-exec-reality — PLAYBOOK gap #1: does rip-short's thin +0.06..0.10R survive REALISTIC execution friction?
// Re-charge the daily rip-short signals across the basket at rising slippage tiers (per-side bps, ON TOP of the
// 8%/yr borrow) and re-test edge vs a matched random control. Find the breakeven slippage — the point where the
// edge dies. This is the honest fills stress that only a real broker fully settles, approximated pessimistically.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const U=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","NFLX","JPM","BAC","GS","XOM","CVX","JNJ","PFE","WMT","HD","NKE","KO","CAT","BA","GE","F","GM","SPY","QQQ","IWM","XLE","XLF","SMH","GLD","TLT"];
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20,BORROW_ANNUAL=0.08;
let seed=55; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
const data:{b:B[];at:number[];r14:number[];ma:number[]}[]=[];
for(const sym of U){const b=await daily(sym);if(b.length<600)continue;const cl=b.map(x=>x.c);data.push({b,at:atr(b,ATRN),r14:rsi(cl,RSIN),ma:sma(cl,MALEN)});}
function run(slipBps:number){const sig:number[]=[],ctrl:number[]=[];
  for(const{b,at,r14,ma}of data){const pool:number[]=[];for(let i=MALEN+1;i<b.length-MAXHOLD-1;i++)if(at[i]>0&&ma[i]>0)pool.push(i);
    const sim=(i:number)=>{const sd=STOP_ATR*at[i];if(!(sd>b[i].c*1e-4))return null;const entry=b[i+1].o,stop=entry+sd,tgt=entry-sd*TP;let g:number|null=null,held=0;for(let k=i+1;k<Math.min(i+1+MAXHOLD,b.length);k++){held=k-i;if(b[k].h>=stop){g=-1;break;}if(b[k].l<=tgt){g=TP;break;}}if(g===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;g=(entry-b[last].c)/sd;}const cost=(entry*(slipBps/10000)*2)/sd+(entry*BORROW_ANNUAL*(held/365))/sd;return g-cost;};
    for(const i of pool){if(r14[i]>70&&b[i].c<ma[i]){const t=sim(i);if(t!==null){sig.push(t);const j=pool[Math.floor(rnd()*pool.length)];const rc=sim(j);if(rc!==null)ctrl.push(rc);}}}}
  return edgeVsRandom(sig,ctrl);}
console.log(`EXECUTION-REALITY STRESS — rip-short daily, ${data.length} names, rising slippage (per-side bps) + 8%/yr borrow\n`);
console.log(`${"slip/side".padStart(9)} ${"setupR".padStart(8)} ${"vsRand".padStart(8)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
for(const slip of [2,5,10,15,20,30]){const g=run(slip);const ok=g.tStat>=2&&g.setupMean>0;
  console.log(`${(slip+"bp").padStart(9)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${(g.controlMean).toFixed(3).padStart(8)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${g.setupMean>0?(ok?"✓ net-positive edge":"edge but thin"):"✗ net-negative"}`);}
console.log(`\nREAD: real equity slippage on liquid names ~1-3bp/side; illiquid/HTB (where rip-short fires) can be 10-30bp.`);
console.log(`Where 'setupR' crosses <=0 is the slippage that KILLS rip-short. Combined with D-189's 32% DD, this bounds deployability.`);
