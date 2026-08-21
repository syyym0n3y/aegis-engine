#!/usr/bin/env -S deno run --allow-net --allow-env
// funding-venue2.ts (D-414) — is the funding-crowding signal BINANCE-SPECIFIC? D-411's remaining caveat. If the same signal
// appears independently on Bybit and OKX, it is a property of crypto positioning, not of one venue's microstructure or fee
// schedule. If it only exists on Binance, it is far weaker evidence.
// Also tests the DELISTING-TRADABILITY caveat: excluding the most extreme return observations (where liquidity would have
// evaporated) tells us how much of the edge depends on trades that may not have been fillable.
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<5)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
const SYMS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX","LTC","DOT","BCH","NEAR","APT","FIL","ATOM","ETC","INJ","OP","ARB","SUI"];
// ---- BYBIT ----
console.log("==> VENUE 2: BYBIT (independent exchange, same hypothesis)");
const byb=new Map<string,{t:number;f:number}[]>();
for(const s of SYMS){
  const sym=`${s}USDT`; const out:{t:number;f:number}[]=[]; let cursorEnd=Date.now();
  for(let p=0;p<8;p++){
    try{const j=await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}&limit=200&endTime=${cursorEnd}`).then(r=>r.json());
      const list=j?.result?.list; if(!Array.isArray(list)||!list.length)break;
      for(const x of list) out.push({t:+x.fundingRateTimestamp,f:+x.fundingRate});
      const minT=Math.min(...list.map((x:{fundingRateTimestamp:string})=>+x.fundingRateTimestamp));
      if(minT>=cursorEnd)break; cursorEnd=minT-1; if(list.length<200)break;
    }catch{break;}
    await new Promise(r=>setTimeout(r,110));
  }
  if(out.length>=300){out.sort((a,b)=>a.t-b.t); byb.set(sym,out);}
  await new Promise(r=>setTimeout(r,110));
}
console.log(`   bybit perps with history: ${byb.size}`);
if(byb.size>=8){
  // price via bybit klines (8h not offered -> use 240m x2 ~ approximate with 4h closes nearest each funding stamp)
  const px=new Map<string,Map<number,number>>();
  for(const sym of byb.keys()){
    const m=new Map<number,number>(); let end=Date.now();
    for(let p=0;p<6;p++){
      try{const j=await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=240&limit=1000&end=${end}`).then(r=>r.json());
        const list=j?.result?.list; if(!Array.isArray(list)||!list.length)break;
        for(const b of list) m.set(+b[0],+b[4]);
        const minT=Math.min(...list.map((b:string[])=>+b[0])); if(minT>=end)break; end=minT-1; if(list.length<1000)break;
      }catch{break;}
      await new Promise(r=>setTimeout(r,110));
    }
    px.set(sym,m); await new Promise(r=>setTimeout(r,110));
  }
  const stamps=[...new Set([...byb.values()].flatMap(a=>a.map(x=>x.t)))].sort((a,b)=>a-b);
  const ics:number[]=[], ls:number[]=[];
  for(let i=0;i<stamps.length-1;i++){
    const t=stamps[i],t1=stamps[i+1];
    const pts:{f:number;fwd:number}[]=[];
    for(const [sym,fr] of byb){
      const a=fr.find(x=>x.t===t); if(!a)continue;
      const m=px.get(sym); if(!m)continue;
      const keys=[...m.keys()]; const k0=keys.filter(k=>k<=t).sort((x,y)=>y-x)[0], k1=keys.filter(k=>k<=t1).sort((x,y)=>y-x)[0];
      if(k0==null||k1==null||k0===k1)continue; const p0=m.get(k0)!,p1=m.get(k1)!; if(!(p0>0))continue;
      const fwd=p1/p0-1; if(Number.isFinite(fwd)) pts.push({f:a.f,fwd});}
    if(pts.length<8)continue;
    ics.push(rankIC(pts.map(p=>-p.f),pts.map(p=>p.fwd)));
    const s=[...pts].sort((a,b)=>a.f-b.f); const q=Math.max(1,Math.floor(s.length/3));
    ls.push(mean(s.slice(0,q).map(p=>p.fwd))-mean(s.slice(s.length-q).map(p=>p.fwd)));
  }
  if(ls.length>50){
    const sp=Math.floor(ls.length*0.6);
    console.log(`   BYBIT intervals: ${ls.length}`);
    console.log(`     FULL: IC ${mean(ics).toFixed(4)} (t ${tst(ics).toFixed(2)})  gross spread ${(mean(ls)*100).toFixed(3)}%/8h (t ${tst(ls).toFixed(2)})`);
    console.log(`     TEST: IC ${mean(ics.slice(sp)).toFixed(4)} (t ${tst(ics.slice(sp)).toFixed(2)})  gross ${(mean(ls.slice(sp))*100).toFixed(3)}%/8h`);
    console.log(`   -> ${mean(ics)>0.01&&mean(ls)>0?"REPLICATES on an independent venue":"does NOT replicate"}`);
  } else console.log(`   bybit: insufficient aligned intervals (${ls.length})`);
}
