#!/usr/bin/env -S deno run --allow-net --allow-env
// microstructure.ts (D-396) — INTRADAY MICROSTRUCTURE, the completely untouched frontier. This is where a large share of real
// daily trading profit actually lives (market making, gap fades, close-auction pressure) and Aegis had never looked.
// Free/keyless 5-minute bars from Yahoo (~60 days), liquid names only. Tests the documented intraday effects:
//   A. OVERNIGHT GAP FADE      — does a large gap mean-revert during the session? (the classic retail-flow reversal)
//   B. FIRST-30MIN REVERSAL    — does the opening move reverse over the rest of the day? (Heston-Korajczyk-Sadka periodicity)
//   C. LAST-HOUR MOMENTUM      — does the 14:00-15:00 move continue into the close? (close-auction / index-rebalance pressure)
// Intraday is COST-DOMINATED, so every effect is reported GROSS and NET at realistic spreads (5/10/20bp round-trip). An
// effect that only exists gross is not an effect. Cross-sectional AND time-series views; no look-ahead by construction
// (signal window strictly precedes the return window — the D-389 lesson).
const SPREADS=[0.0005,0.0010,0.0020];
const UA={"User-Agent":"Mozilla/5.0"};
// liquid universe: mega-cap equities + the most-traded ETFs (where intraday costs are lowest and effects are cleanest)
const SYMS=("AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO JPM V UNH XOM WMT MA JNJ PG HD COST ABBV MRK KO PEP BAC CVX AMD NFLX CRM ADBE TMO LIN "+
 "SPY QQQ IWM DIA XLK XLF XLE XLV XLI XLY XLP XLU XLB SMH ARKK TLT GLD SLV USO EEM EFA HYG LQD VXX SOXL TQQQ SQQQ").split(" ");
type Day={date:string;bars:{t:number;o:number;h:number;l:number;c:number;v:number}[]};
const bySym=new Map<string,Day[]>();
let okS=0;
for(const s of SYMS){
  await new Promise(r=>setTimeout(r,250));
  try{
    const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=5m&range=60d`,{headers:UA}).then(r=>r.json());
    const res=j?.chart?.result?.[0]; if(!res?.timestamp) continue;
    const q=res.indicators.quote[0], ts=res.timestamp as number[];
    const days=new Map<string,Day>();
    for(let i=0;i<ts.length;i++){
      const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume[i];
      if([o,h,l,c].some((x:number)=>x==null||!Number.isFinite(x))) continue;
      const d=new Date(ts[i]*1000).toISOString().slice(0,10);
      (days.get(d)??days.set(d,{date:d,bars:[]}).get(d)!).bars.push({t:ts[i],o,h,l,c,v:v??0});
    }
    const arr=[...days.values()].filter(d=>d.bars.length>=70).sort((a,b)=>a.date<b.date?-1:1);
    if(arr.length>=20){bySym.set(s,arr); okS++;}
  }catch{/*skip*/}
}
console.log(`==> MICROSTRUCTURE: ${okS} symbols with 5m intraday, ~${[...bySym.values()][0]?.length||0} sessions each`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
// build per (symbol,day) observations
type Obs={sym:string;date:string;gap:number;first30:number;restOfDay:number;afterFirst30:number;lastHourSig:number;closeMove:number};
const obs:Obs[]=[];
for(const [sym,days] of bySym){
  for(let i=1;i<days.length;i++){
    const d=days[i], p=days[i-1]; const b=d.bars;
    if(b.length<70||p.bars.length<70) continue;
    const prevClose=p.bars[p.bars.length-1].c, open=b[0].o, close=b[b.length-1].c;
    if(!(prevClose>0)||!(open>0)||!(close>0)) continue;
    const gap=open/prevClose-1;                                  // overnight gap (known at the open)
    const i30=Math.min(5,b.length-1);                            // first 30 min = 6 five-minute bars
    const first30=b[i30].c/open-1;                               // known at 10:00
    const restOfDay=close/b[i30].c-1;                            // 10:00 -> close  (strictly after the signal)
    const afterFirst30=close/open-1;                             // full session (for the gap test, signal known at open)
    const iL=Math.max(0,b.length-13);                            // ~last hour start
    const lastHourSig=b[iL].c/b[Math.max(0,iL-12)].c-1;          // the hour BEFORE the last hour (known at 14:00)
    const closeMove=close/b[iL].c-1;                             // last hour -> close (strictly after)
    if(![gap,first30,restOfDay,afterFirst30,lastHourSig,closeMove].every(Number.isFinite)) continue;
    obs.push({sym,date:d.date,gap,first30,restOfDay,afterFirst30,lastHourSig,closeMove});
  }
}
console.log(`observations: ${obs.length} symbol-days`);
const dates=[...new Set(obs.map(o=>o.date))].sort();
const tests:[string,(o:Obs)=>number,(o:Obs)=>number,string][]=[
  ["A. GAP FADE (signal: overnight gap @open -> return open->close)",(o)=>-o.gap,(o)=>o.afterFirst30,"short big gap-ups / long big gap-downs"],
  ["B. FIRST-30MIN REVERSAL (signal: 09:30-10:00 move -> return 10:00->close)",(o)=>-o.first30,(o)=>o.restOfDay,"fade the opening move"],
  ["C. LAST-HOUR MOMENTUM (signal: 13:00-14:00 move -> return 14:00->close)",(o)=>o.lastHourSig,(o)=>o.closeMove,"ride the afternoon move"],
];
for(const [nm,sig,ret,desc] of tests){
  // cross-sectional per day: long top quintile of the signal, short bottom
  const ics:number[]=[], ls:number[]=[];
  for(const d of dates){const a=obs.filter(o=>o.date===d); if(a.length<20)continue;
    ics.push(rankIC(a.map(sig),a.map(ret)));
    const s=[...a].sort((p,q)=>sig(p)-sig(q)); const q=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(s.length-q).map(ret))-mean(s.slice(0,q).map(ret)));}
  if(ls.length<15){console.log(`\n${nm}: thin`);continue;}
  console.log(`\n=== ${nm} ===  [${desc}]`);
  console.log(`  n=${ls.length} days  IC ${mean(ics).toFixed(4)} (t ${tstat(ics).toFixed(2)})  GROSS ${(mean(ls)*100).toFixed(3)}%/day  t ${tstat(ls).toFixed(2)}`);
  for(const sp of SPREADS){ const net=mean(ls)-2*sp;   // 2 legs
    console.log(`    NET @${(sp*1e4).toFixed(0)}bp/leg: ${(net*100).toFixed(3)}%/day  ann ${(net*252*100).toFixed(0)}%  ${net>0?"POSITIVE":"negative"}`);}
  const sp2=Math.floor(ls.length*0.6);
  console.log(`    TRAIN gross ${(mean(ls.slice(0,sp2))*100).toFixed(3)}%  |  TEST gross ${(mean(ls.slice(sp2))*100).toFixed(3)}%`);
}
