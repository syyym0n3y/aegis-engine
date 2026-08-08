#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-portfolio-sim — PLAYBOOK gap #2: rip-short measured per-trade in isolation; real deployment holds many
// CONCURRENT correlated shorts that CLUSTER in selloffs (many names overbought-in-downtrend at once). This walks
// the rip-short daily signals across a basket in true chronological order, applies the D-154 6% portfolio HEAT
// cap (sum of open risk ≤ 6% of equity), sizes each at 0.5% risk, real cost (2bp + 8%/yr borrow), and measures the
// ACTUAL portfolio equity curve, max drawdown, worst concurrent heat, and signal clustering — i.e. whether
// concurrent risk >> per-trade risk. No look-ahead: entry next-day open, resolved forward.
import { maxDrawdown, mean } from "../supabase/functions/_shared/trd-stats.ts";
const U = ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","NFLX","JPM","BAC","GS","XOM","CVX","JNJ","PFE","WMT","HD","NKE","KO","CAT","BA","GE","F","GM","SPY","QQQ","IWM","XLE","XLF","SMH","GLD","TLT"];
const ATRN=14, RSIN=14, MALEN=200, STOP_ATR=2, TP=3, MAXHOLD=20, SPREAD_BPS=2, BORROW_ANNUAL=0.08;
const RISK_PER=0.005, MAX_HEAT=0.06, DEPOSIT=100000;
interface B{d:string;o:number;h:number;l:number;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// generate all rip-short signals as {entryDate, exitDate, r} across the basket
interface Sig{entry:string;exit:string;r:number}
const sigs:Sig[]=[]; const bydate=new Map<string,number>();
for(const sym of U){const b=await daily(sym);if(b.length<600)continue;const cl=b.map(x=>x.c);const at=atr(b,ATRN),r14=rsi(cl,RSIN),ma=sma(cl,MALEN);
  for(let i=MALEN+1;i<b.length-1;i++){if(!(at[i]>0)||!(ma[i]>0))continue;if(!(r14[i]>70&&cl[i]<ma[i]))continue;const sd=STOP_ATR*at[i];if(!(sd>b[i].c*1e-4))continue;const entry=b[i+1].o,stop=entry+sd,tgt=entry-sd*TP;let r:number|null=null,held=0,exd=b[Math.min(i+MAXHOLD,b.length-1)].d;
    for(let k=i+1;k<=Math.min(i+MAXHOLD,b.length-1);k++){held=k-i;if(b[k].h>=stop){r=-1;exd=b[k].d;break;}if(b[k].l<=tgt){r=TP;exd=b[k].d;break;}}
    if(r===null){const last=Math.min(i+MAXHOLD,b.length-1);held=last-i;r=(entry-b[last].c)/sd;}
    const cost=(entry*(SPREAD_BPS/10000)*2)/sd+(entry*BORROW_ANNUAL*(held/365))/sd;
    sigs.push({entry:b[i+1].d,exit:exd,r:r-cost});bydate.set(b[i+1].d,(bydate.get(b[i+1].d)??0)+1);}}
sigs.sort((a,b)=>a.entry<b.entry?-1:1);
const yrs=(Date.parse(sigs.at(-1)!.entry)-Date.parse(sigs[0].entry))/(365.25*864e5);
const maxCluster=Math.max(...bydate.values());
console.log(`PORTFOLIO / CONCURRENCY SIM — rip-short daily, ${U.length} names, ${sigs.length} signals over ${yrs.toFixed(1)}y (${(sigs.length/yrs).toFixed(0)}/yr)`);
console.log(`per-trade mean net R: ${mean(sigs.map(s=>s.r)).toFixed(4)}  | worst single-day signal cluster: ${maxCluster} simultaneous entries\n`);
// walk portfolio with heat cap
function run(cap:number){let eq=DEPOSIT;const open:{exit:string;risk:number;r:number}[]=[];const curve:number[]=[];let minEq=DEPOSIT,skipped=0,maxHeat=0,maxOpen=0;
  for(const s of sigs){for(let i=open.length-1;i>=0;i--)if(open[i].exit<=s.entry){eq+=open[i].risk*open[i].r;open.splice(i,1);}
    const heat=open.reduce((a,o)=>a+o.risk,0);let risk=Math.min(eq*RISK_PER,Math.max(0,eq*cap-heat));
    if(risk<=0){skipped++;continue;}open.push({exit:s.exit,risk,r:s.r});
    const h=open.reduce((a,o)=>a+o.risk,0)/eq;if(h>maxHeat)maxHeat=h;if(open.length>maxOpen)maxOpen=open.length;
    if(eq<minEq)minEq=eq;curve.push(eq);}
  for(const o of open)eq+=o.risk*o.r;curve.push(eq);
  const rets:number[]=[];for(let i=1;i<curve.length;i++)rets.push(curve[i]/curve[i-1]-1);
  return{end:eq,mult:eq/DEPOSIT,dd:maxDrawdown(rets)*100,minEq,skipped,maxHeat:maxHeat*100,maxOpen};}
for(const cap of [MAX_HEAT, 0.03, 0.12]){const r=run(cap);
  console.log(`heat cap ${(cap*100).toFixed(0)}%:  final $${r.end.toFixed(0)} (${r.mult.toFixed(2)}x)  maxDD ${r.dd.toFixed(1)}%  min eq $${r.minEq.toFixed(0)}  peak concurrent ${r.maxOpen} pos / ${r.maxHeat.toFixed(1)}% heat  skipped-by-cap ${r.skipped}`);}
console.log(`\nREAD: if maxDD stays modest and the heat cap rarely binds (low skipped), per-trade≈portfolio risk. If DD`);
console.log(`balloons or the cap skips many clustered selloff signals, CONCURRENCY is the real risk — size to the cap, not the trade.`);
