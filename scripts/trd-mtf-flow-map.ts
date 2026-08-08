#!/usr/bin/env -S deno run --allow-net
// trd-mtf-flow-map — "no stone unturned" probability map: which positions are HIGHLY FAVOURED, by
// multi-timeframe confluence + real order-flow (CVD) + positioning (funding), SHORTS AND LONGS both.
// Free + full-history on crypto perps (the one asset class where OI/CVD/funding are free & deep):
//   • Multi-TF: 4h trade TF filtered by the 1d trend (higher-TF confluence).
//   • CVD (real order flow): Binance klines carry taker-buy base vol (field 9) → per-bar delta =
//     2*takerBuy - vol. Cumulative + slope = genuine CVD, no tick pull needed.
//   • Funding (positioning/crowding, proxy for OI-side crowding): /fapi/v1/fundingRate, full history.
// Setups fire on 4h close i, enter i+1 open; forward 12 bars (48h), 1.5*ATR stop. Per ANALYSIS_CONTRACT:
// expectancy(R)+win%+N+OOS, small-N flagged, every cell is a measurement not a claim.
const SYMBOLS = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT"];
const HORIZON = 12, STOP_ATR = 1.5, ATRN = 14, RSI_N = 14, EMA_N = 50, COST_R = 0.06;

interface K { t:number; o:number; h:number; l:number; c:number; v:number; tb:number; }
async function klines(sym:string, interval:string, maxPages:number):Promise<K[]> {
  const out:any[] = []; let endTime = Date.now();
  for (let p=0;p<maxPages;p++){ const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=1000&endTime=${endTime}`,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)break; const k=await r.json(); if(!Array.isArray(k)||!k.length)break; out.unshift(...k); endTime=k[0][0]-1; if(k.length<1000)break; }
  const seen=new Set<number>(); const bars:K[]=[];
  for(const k of out){ if(seen.has(k[0]))continue; seen.add(k[0]); bars.push({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],tb:+k[9]}); }
  return bars.sort((a,b)=>a.t-b.t);
}
async function funding(sym:string):Promise<{t:number;r:number}[]>{
  const out:{t:number;r:number}[]=[]; let start=1514764800000; // 2018-01-01
  for(let p=0;p<40;p++){ const r=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000&startTime=${start}`,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)break; const j=await r.json(); if(!Array.isArray(j)||!j.length)break; for(const f of j)out.push({t:f.fundingTime,r:+f.fundingRate}); if(j.length<1000)break; start=j[j.length-1].fundingTime+1; }
  return out;
}
const ema=(cl:number[],n:number)=>{const k=2/(n+1);const e:number[]=[];let prev=cl[0];for(let i=0;i<cl.length;i++){prev=i===0?cl[0]:cl[i]*k+prev*(1-k);e.push(prev);}return e;};
function rsi(cl:number[],n:number):number[]{const out:number[]=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1];const g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;out[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;out[i]=100-100/(1+ag/(al||1e-9));}}return out;}
function atr(b:K[],n:number):number[]{const tr:number[]=[];for(let i=0;i<b.length;i++){if(i===0){tr.push(b[i].h-b[i].l);continue;}tr.push(Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));}const out:number[]=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)out[i]=s/n;}return out;}

interface T { r:number; is:boolean; setup:string; dir:1|-1; mtf:boolean; cvd:boolean; crowd:boolean; }
const trades:T[]=[];
for (const sym of SYMBOLS) {
  const b4=await klines(sym,"4h",30); const bd=await klines(sym,"1d",10); const fund=await funding(sym);
  if(b4.length<500||bd.length<100)continue;
  const cl=b4.map(x=>x.c); const e50=ema(cl,EMA_N); const r14=rsi(cl,RSI_N); const at=atr(b4,ATRN);
  // daily trend: 50d SMA, mapped by day
  const dcl=bd.map(x=>x.c); const dSMA:number[]=bd.map((_,i)=>{if(i<50)return NaN;let s=0;for(let k=i-50;k<i;k++)s+=dcl[k];return s/50;});
  const dTrend=new Map<string,number>(); bd.forEach((x,i)=>{ if(Number.isFinite(dSMA[i])) dTrend.set(new Date(x.t).toISOString().slice(0,10), dcl[i]>dSMA[i]?1:-1); });
  // cvd delta + slope
  const delta=b4.map(x=>2*x.tb-x.v); const cvd:number[]=[]; let acc=0; for(const d of delta){acc+=d;cvd.push(acc);}
  const cvdSlope=(i:number)=> i<6?0: cvd[i]-cvd[i-6];
  // funding: nearest prior funding rate + rolling percentile
  const fr=(t:number)=>{ let lo=0,hi=fund.length-1,ans=NaN; while(lo<=hi){const m=(lo+hi)>>1; if(fund[m].t<=t){ans=fund[m].r;lo=m+1;}else hi=m-1;} return ans; };
  const cut=Math.floor(b4.length*0.6);
  for(let i=EMA_N+6;i<b4.length-HORIZON-1;i++){
    if(!(at[i]>0)||!Number.isFinite(r14[i]))continue;
    const day=new Date(b4[i].t).toISOString().slice(0,10); const dt=dTrend.get(day)??0;
    const f=fr(b4[i].t); const slope=cvdSlope(i);
    const fireShort:[string,boolean]|null =
      (dt<0 && cl[i]<e50[i] && b4[i].c>b4[i-1].c) ? ["trend-pullback",true] :
      (r14[i]>75) ? ["meanrev-fade", dt<0] : null;
    const fireLong:[string,boolean]|null =
      (dt>0 && cl[i]>e50[i] && b4[i].c<b4[i-1].c) ? ["trend-pullback",true] :
      (r14[i]<25) ? ["meanrev-fade", dt>0] : null;
    for(const [side,fire] of [[-1,fireShort],[1,fireLong]] as const){ if(!fire)continue; const [setup,mtf]=fire; const dir=side as 1|-1;
      const entry=b4[i+1].o, stop=entry-dir*STOP_ATR*at[i]; let r:number|null=null;
      for(let k=i+1;k<=i+HORIZON;k++){ if(dir===1? b4[k].l<=stop : b4[k].h>=stop){r=-1;break;} }
      if(r===null) r=dir*(b4[i+HORIZON].c-entry)/(STOP_ATR*at[i]);
      const cvdConfirm = dir===1? slope>0 : slope<0;
      const crowd = Number.isFinite(f) ? (dir===-1? f>0.0001 : f<-0.0001) : false; // crowded AGAINST us = fade favoured
      trades.push({ r:r-COST_R, is:i<cut, setup, dir, mtf, cvd:cvdConfirm, crowd });
    }
  }
  console.log(`${sym}: ${b4.length} 4h bars ${new Date(b4[0].t).toISOString().slice(0,10)}→${new Date(b4[b4.length-1].t).toISOString().slice(0,10)}, ${fund.length} funding pts`);
}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const agg=(t:T[])=>t.length?`${(mean(t.map(x=>x.r))>=0?"+":"")}${mean(t.map(x=>x.r)).toFixed(3)}R/${(t.filter(x=>x.r>0).length/t.length*100).toFixed(0)}%/n=${t.length}${t.length<80?" [small-N]":""}`:"—";
const sub=(f:(x:T)=>boolean)=>trades.filter(f);
console.log(`\n════ MULTI-TF FLOW MAP — ${SYMBOLS.length} perps, 4h TF / 1d filter, real CVD + funding, SHORTS & LONGS ════`);
console.log(`ALL ${agg(trades)}   IS ${agg(sub(x=>x.is))} → OOS ${agg(sub(x=>!x.is))}\n`);
for(const dir of [-1,1] as const){ const dn=dir===-1?"SHORT":"LONG ";
  console.log(`── ${dn} ── all ${agg(sub(x=>x.dir===dir))}  OOS ${agg(sub(x=>x.dir===dir&&!x.is))}`);
  for(const setup of ["trend-pullback","meanrev-fade"]){
    const base=sub(x=>x.dir===dir&&x.setup===setup);
    console.log(`   ${setup.padEnd(15)} ${agg(base)}`);
    console.log(`      +MTF-align ${agg(base.filter(x=>x.mtf))}   +CVD-confirm ${agg(base.filter(x=>x.cvd))}   +crowd-fade ${agg(base.filter(x=>x.crowd))}`);
    console.log(`      +MTF&CVD ${agg(base.filter(x=>x.mtf&&x.cvd))}   +ALL3(MTF&CVD&crowd) ${agg(base.filter(x=>x.mtf&&x.cvd&&x.crowd))} → OOS ${agg(base.filter(x=>x.mtf&&x.cvd&&x.crowd&&!x.is))}`);
  }
}
console.log(`\nREAD: the "+ALL3" rows = the highly-favoured positions (multi-TF aligned + order-flow confirming + crowded against). OOS is the honest verdict; small-N flagged. CVD from taker-vol, funding real — all free, full history.`);

// ── DEFLATION GATE: was the standout SHORT crowd-fade cell just the best of many dredged cells? ──
const { sharpe, deflatedSharpe, sampleStd } = await import("../supabase/functions/_shared/trd-stats.ts");
const skewKurt=(a:number[])=>{const m=mean(a),s=sampleStd(a);if(!(s>0))return[0,3];let sk=0,ku=0;for(const x of a){const z=(x-m)/s;sk+=z**3;ku+=z**4;}return[sk/a.length,ku/a.length];};
// enumerate every cell I actually looked at (the multiple-testing set)
const cells:{name:string;t:T[]}[]=[];
for(const dir of [-1,1] as const) for(const setup of ["trend-pullback","meanrev-fade"]){
  const base=sub(x=>x.dir===dir&&x.setup===setup);
  cells.push({name:`${dir}-${setup}`,t:base});
  cells.push({name:`${dir}-${setup}+mtf`,t:base.filter(x=>x.mtf)});
  cells.push({name:`${dir}-${setup}+cvd`,t:base.filter(x=>x.cvd)});
  cells.push({name:`${dir}-${setup}+crowd`,t:base.filter(x=>x.crowd)});
  cells.push({name:`${dir}-${setup}+mtf&cvd`,t:base.filter(x=>x.mtf&&x.cvd)});
  cells.push({name:`${dir}-${setup}+ALL3`,t:base.filter(x=>x.mtf&&x.cvd&&x.crowd)});
}
const cellSharpes=cells.filter(c=>c.t.length>=30).map(c=>sharpe(c.t.map(x=>x.r)));
const varTrials=cellSharpes.length>1?sampleStd(cellSharpes)**2:0.25;
const shortALL3=sub(x=>x.dir===-1&&x.setup==="trend-pullback"&&x.mtf&&x.cvd&&x.crowd).map(x=>x.r);
const [sk,ku]=skewKurt(shortALL3); const srBest=sharpe(shortALL3);
const dsr=deflatedSharpe(srBest,shortALL3.length,sk,ku,cells.length,varTrials);
console.log(`\n════ DEFLATION GATE (standout = SHORT trend-pullback +ALL3) ════`);
console.log(`  cells scanned (trials): ${cells.length}   var(trial Sharpes): ${varTrials.toFixed(4)}`);
console.log(`  cell N=${shortALL3.length}, per-trade Sharpe ${srBest.toFixed(3)}, skew ${sk.toFixed(2)}, kurt ${ku.toFixed(1)}`);
console.log(`  → DEFLATED SHARPE PROB = ${(dsr*100).toFixed(1)}%   (gate: >95% to promote)`);
console.log(`  VERDICT: ${dsr>0.95?"SURVIVES — promote to forward test":"FAILS deflation — candidate only, not an edge"}`);
