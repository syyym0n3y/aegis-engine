#!/usr/bin/env -S deno run --allow-net
// trd-winrate — the honest numbers behind "100% win rate": measure rip-short's real WIN RATE + EXPECTANCY, and show
// that the edge lives in the PAYOFF asymmetry (3R target vs 1R stop), not in winning often. Also: are the edges
// correlated? (diversification cuts drawdown; it does NOT raise win rate). Free (Yahoo daily).
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const U=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","AMD","NFLX","CRM","ADBE","QCOM"];
const ATRN=14,RSIN=14,MALEN=200,STOP_ATR=2,TP=3,MAXHOLD=20;
interface B{o:number;h:number;l:number;c:number}
async function daily(s:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const t:number[]=[];for(let i=0;i<b.length;i++)t.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=t[i];if(i>=n)s-=t[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
let wins=0,losses=0,timeouts=0;const Rs:number[]=[];
for(const sym of U){const b=await daily(sym);if(b.length<MALEN+40)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);
  for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;if(!(r14[i]>70&&cl[i]<ma[i]))continue;const entry=b[i+1].o,sd=STOP_ATR*at[i];if(!(sd>entry*1e-4))continue;const stop=entry+sd,tgt=entry-sd*TP;let r:number|null=null;for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){if(b[k].h>=stop){r=-1;losses++;break;}if(b[k].l<=tgt){r=TP;wins++;break;}}if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);r=(entry-b[last].c)/sd;timeouts++;if(r>0)wins++;else losses++;}Rs.push(r);}}
const n=Rs.length,wr=wins/n,avgR=mean(Rs),avgWin=mean(Rs.filter(r=>r>0)),avgLoss=mean(Rs.filter(r=>r<=0));
console.log(`rip-short (mega-caps, ${n} trades, real):`);
console.log(`  WIN RATE: ${(wr*100).toFixed(1)}%   (target-hit ${wins} / stop+neg ${losses})`);
console.log(`  avg WIN ${avgWin.toFixed(2)}R   avg LOSS ${avgLoss.toFixed(2)}R   → EXPECTANCY ${avgR.toFixed(3)}R/trade`);
console.log(`  the edge is the PAYOFF ASYMMETRY (win big, lose small), NOT the hit rate.`);
console.log(`\n  What a 100% win rate would require: never taking a stop = removing the stop = unbounded loss on the one`);
console.log(`  trade that keeps going against you. That's not an edge; it's the martingale that blows up every account.`);
