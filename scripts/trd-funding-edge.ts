#!/usr/bin/env -S deno run --allow-net
// trd-funding-edge — PRE-REGISTERED single-hypothesis test (avoids the 24-cell dredge that killed D-126b).
// H1: when funding is in its top decile (crowded LONGS paying up), forward SHORT return is positive.
// H2: when funding is in its bottom decile (crowded SHORTS), forward LONG return is positive.
// NO setup, NO CVD, NO multi-TF — funding percentile ALONE → forward return. Exactly 2 trials → honest
// deflation. Free full-history: Binance funding (8h) + 4h price. Per ANALYSIS_CONTRACT: number+N+OOS+DSR.
const SYMBOLS=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LTCUSDT","LINKUSDT"];
const HOLD_BARS=18, PCTL_WIN=540, HI=0.90, LO=0.10; // hold 3d (18*4h); percentile over trailing ~180d funding
import { mean, sharpe, deflatedSharpe, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

async function klines(sym:string):Promise<{t:number;o:number;c:number}[]>{
  const out:any[]=[]; let endTime=Date.now();
  for(let p=0;p<30;p++){ const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=1000&endTime=${endTime}`,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)break; const k=await r.json(); if(!Array.isArray(k)||!k.length)break; out.unshift(...k); endTime=k[0][0]-1; if(k.length<1000)break; }
  const seen=new Set<number>(); const b:{t:number;o:number;c:number}[]=[]; for(const k of out){if(seen.has(k[0]))continue;seen.add(k[0]);b.push({t:k[0],o:+k[1],c:+k[4]});} return b.sort((a,b)=>a.t-b.t);
}
async function funding(sym:string):Promise<{t:number;r:number}[]>{
  const out:{t:number;r:number}[]=[]; let start=1514764800000;
  for(let p=0;p<40;p++){ const r=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000&startTime=${start}`,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!r.ok)break; const j=await r.json(); if(!Array.isArray(j)||!j.length)break; for(const f of j)out.push({t:f.fundingTime,r:+f.fundingRate}); if(j.length<1000)break; start=j[j.length-1].fundingTime+1; } return out;
}
interface T{ ret:number; is:boolean; }
const shortT:T[]=[], longT:T[]=[];
for(const sym of SYMBOLS){
  const b=await klines(sym); const f=await funding(sym); if(b.length<600||f.length<PCTL_WIN+50)continue;
  const cut=b[Math.floor(b.length*0.6)].t;
  // index 4h bars by time for entry lookup
  const barAt=(t:number)=>{ let lo=0,hi=b.length-1,ans=-1; while(lo<=hi){const m=(lo+hi)>>1; if(b[m].t>=t){ans=m;hi=m-1;}else lo=m+1;} return ans; };
  for(let i=PCTL_WIN;i<f.length;i++){
    const window=f.slice(i-PCTL_WIN,i).map(x=>x.r).sort((a,b)=>a-b);
    const cur=f[i].r; let rank=0; while(rank<window.length&&window[rank]<cur)rank++; const pct=rank/window.length;
    let dir:1|-1|null=null; if(pct>=HI)dir=-1; else if(pct<=LO)dir=1; if(!dir)continue;
    const ei=barAt(f[i].t); if(ei<0||ei+HOLD_BARS>=b.length)continue;
    const ret=dir*(b[ei+HOLD_BARS].c-b[ei].o)/b[ei].o; const is=f[i].t<cut;
    (dir===-1?shortT:longT).push({ret,is});
  }
  console.log(`${sym}: ${b.length} 4h bars, ${f.length} funding pts`);
}
const agg=(t:T[])=>t.length?`${(mean(t.map(x=>x.ret))>=0?"+":"")}${(mean(t.map(x=>x.ret))*100).toFixed(2)}%/${(t.filter(x=>x.ret>0).length/t.length*100).toFixed(0)}%win/n=${t.length}`:"—";
const skewKurt=(a:number[])=>{const m=mean(a),s=sampleStd(a);if(!(s>0))return[0,3];let sk=0,ku=0;for(const x of a){const z=(x-m)/s;sk+=z**3;ku+=z**4;}return[sk/a.length,ku/a.length];};
console.log(`\n════ PRE-REGISTERED FUNDING-CROWDING TEST (2 trials) — ${SYMBOLS.length} perps, hold ${HOLD_BARS}×4h=${HOLD_BARS*4/24}d ════`);
const both=[["H1 SHORT when crowded-long (funding top decile)",shortT],["H2 LONG when crowded-short (funding bottom decile)",longT]] as const;
const srs=both.map(([_,t])=>t.length?sharpe(t.map(x=>x.ret)):0);
for(const [name,t] of both){ console.log(`${name}\n   ALL ${agg(t)}   IS ${agg(t.filter(x=>x.is))} → OOS ${agg(t.filter(x=>!x.is))}   Sharpe/trade ${sharpe(t.map(x=>x.ret)).toFixed(3)}`); }
const varT=srs.length>1?sampleStd(srs)**2:0.25; const iB=srs.indexOf(Math.max(...srs)); const bt=both[iB][1].map(x=>x.ret); const [sk,ku]=skewKurt(bt);
const dsr=deflatedSharpe(sharpe(bt),bt.length,sk,ku,2,varT);
console.log(`\nGATE (best of 2, deflated): Sharpe ${sharpe(bt).toFixed(3)} skew ${sk.toFixed(2)} kurt ${ku.toFixed(1)} → DSR ${(dsr*100).toFixed(1)}%  ${dsr>0.95?"SURVIVES":"FAILS (>95% to promote)"}`);
console.log(`Pre-registered = only 2 trials, so a real crowding effect is NOT masked by dredge (unlike D-126b's 24). Honest verdict either way.`);
