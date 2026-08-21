#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-funding.ts (D-409) — CRYPTO FUNDING / PERPETUAL BASIS, a Tier-1 gap from docs/RESEARCH_GAPS.md. Perpetual-swap
// funding is the crypto CARRY signal and is mechanically distinct from everything tested so far (it is a cash-flow between
// longs and shorts, not a price pattern). Documented claims: (a) funding is on average POSITIVE, so being short the perp /
// long spot earns carry; (b) extreme funding marks crowded positioning and precedes reversals.
// Free/keyless from Binance public market data. Tested with the standard controls: no look-ahead (funding at time t predicts
// the NEXT interval), train/test split, and — critically — the CARRY is measured against what it actually costs to harvest.
const SYMS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","LINKUSDT","AVAXUSDT","LTCUSDT"];
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
console.log("==> CRYPTO FUNDING / PERP BASIS (Tier-1 gap)");
type F={t:number;r:number};
const fund=new Map<string,F[]>(); const px=new Map<string,Map<number,number>>();
for(const s of SYMS){
  // funding history (paginated back in time)
  const all:F[]=[]; let end=Date.now();
  for(let p=0;p<12;p++){
    try{const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${s}&limit=1000&endTime=${end}`).then(r=>r.json());
      if(!Array.isArray(j)||!j.length)break;
      for(const x of j) all.push({t:x.fundingTime,r:+x.fundingRate});
      end=j[0].fundingTime-1; if(j.length<1000)break;
    }catch{break;}
    await new Promise(r=>setTimeout(r,120));
  }
  all.sort((a,b)=>a.t-b.t); if(all.length<500){console.log(`  ${s}: thin (${all.length})`);continue;}
  fund.set(s,all);
  // daily klines for the return side
  const m=new Map<number,number>();
  try{const k=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=8h&limit=1500`).then(r=>r.json());
    if(Array.isArray(k)) for(const b of k) m.set(b[0],+b[4]);}catch{/*skip*/}
  px.set(s,m);
  await new Promise(r=>setTimeout(r,120));
}
console.log(`  loaded funding for ${fund.size} perps`);
// 1. DOES CARRY EXIST? mean funding rate (per 8h) — positive means longs pay shorts
console.log(`\n  1. IS FUNDING SYSTEMATICALLY POSITIVE (i.e. is there carry to harvest)?`);
const allRates:number[]=[];
for(const [s,a] of fund){const r=a.map(x=>x.r); allRates.push(...r);
  const ann=mean(r)*3*365*100;   // 3 funding events/day
  console.log(`     ${s.padEnd(9)} mean ${(mean(r)*100).toFixed(4)}%/8h = ${ann.toFixed(1)}%/yr  positive ${(100*r.filter(x=>x>0).length/r.length).toFixed(0)}% of intervals  n=${r.length}`);}
console.log(`     ALL: mean ${(mean(allRates)*100).toFixed(4)}%/8h = ${(mean(allRates)*3*365*100).toFixed(1)}%/yr (t ${tst(allRates).toFixed(1)}), positive ${(100*allRates.filter(x=>x>0).length/allRates.length).toFixed(0)}%`);
console.log(`     -> that is the GROSS carry from being short perp / long spot (delta-neutral basis trade).`);
// 2. DOES EXTREME FUNDING PREDICT REVERSAL? (crowding signal)
console.log(`\n  2. DOES FUNDING PREDICT THE NEXT INTERVAL'S RETURN? (crowding -> reversal)`);
// FIX: fixed thresholds were ~10x too high (mean funding is 0.0017%, my "pos" cut was 0.02%) so 4 of 5 buckets were empty.
// Use PERCENTILES of the observed distribution — the correct way to define "extreme" for any signal.
const buckets:Record<string,number[]>={"p0-20 (most neg)":[],"p20-40":[],"p40-60":[],"p60-80":[],"p80-100 (most pos)":[]};
const allR:number[]=[]; for(const [,a] of fund) for(const x of a) allR.push(x.r);
const srt=[...allR].sort((x,y)=>x-y); const qt=(f:number)=>srt[Math.floor(srt.length*f)];
const c20=qt(0.2),c40=qt(0.4),c60=qt(0.6),c80=qt(0.8);
console.log(`     funding quintile cuts: ${(c20*100).toFixed(4)}% ${(c40*100).toFixed(4)}% ${(c60*100).toFixed(4)}% ${(c80*100).toFixed(4)}%`);
for(const [s,a] of fund){const m=px.get(s); if(!m||m.size<100)continue;
  const times=[...m.keys()].sort((x,y)=>x-y);
  for(let i=0;i<a.length-1;i++){
    const t=a[i].t; const near=times.filter(x=>x>=t).slice(0,2); if(near.length<2)continue;
    const p0=m.get(near[0])!,p1=m.get(near[1])!; if(!(p0>0))continue;
    const fwd=p1/p0-1; if(!Number.isFinite(fwd))continue;
    const r=a[i].r;
    const b=r<c20?"p0-20 (most neg)":r<c40?"p20-40":r<c60?"p40-60":r<c80?"p60-80":"p80-100 (most pos)";
    buckets[b].push(fwd);
  }}
for(const k of ["p0-20 (most neg)","p20-40","p40-60","p60-80","p80-100 (most pos)"]){const v=buckets[k];
  if(v.length<50){console.log(`     ${k.padEnd(20)}: n=${v.length} (thin)`);continue;}
  console.log(`     funding ${k.padEnd(20)}: next-8h return ${(mean(v)*100).toFixed(3)}% (t ${tst(v).toFixed(2)}) n=${v.length}`);}
console.log(`\n  (hypothesis: very POSITIVE funding = crowded longs -> negative forward return. Read the monotonicity.)`);
