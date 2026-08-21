#!/usr/bin/env -S deno run --allow-net --allow-env
// funding-fair-replication.ts (D-415) — a FAIR head-to-head. D-414's Bybit test was cruder than the Binance one (5x fewer
// intervals, 4h-kline alignment, 20 vs 180 symbols), so its failure was not conclusive. This runs BOTH venues through the
// IDENTICAL pipeline: same symbols, same date window, same alignment method, same construction. Then the comparison means
// something. If Binance still shows a large IC and Bybit does not, the effect is venue plumbing, not market positioning.
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<5)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
const CORE=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX","LTC","DOT","BCH","NEAR","APT","FIL","ATOM","ETC","INJ","OP","ARB","SUI"];
type Series={f:Map<number,number>;px:Map<number,number>};
async function binance(sym:string):Promise<Series|null>{
  const f=new Map<number,number>(); let start=1600000000000;
  for(let p=0;p<12;p++){try{const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}USDT&startTime=${start}&limit=1000`).then(r=>r.json());
    if(!Array.isArray(j)||!j.length)break; for(const x of j) f.set(x.fundingTime,+x.fundingRate);
    const lt=j[j.length-1].fundingTime; if(lt<=start)break; start=lt+1; if(j.length<500)break;}catch{break;} await new Promise(r=>setTimeout(r,80));}
  if(f.size<200)return null;
  const px=new Map<number,number>(); let s2=Math.min(...f.keys())-9e6;
  for(let p=0;p<10;p++){try{const k=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=8h&startTime=${s2}&limit=1500`).then(r=>r.json());
    if(!Array.isArray(k)||!k.length)break; for(const b of k) px.set(b[0],+b[4]);
    const lt=k[k.length-1][0]; if(lt<=s2)break; s2=lt+1; if(k.length<1500)break;}catch{break;} await new Promise(r=>setTimeout(r,80));}
  return {f,px};
}
async function bybit(sym:string):Promise<Series|null>{
  const f=new Map<number,number>(); let end=Date.now();
  for(let p=0;p<25;p++){try{const j=await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}USDT&limit=200&endTime=${end}`).then(r=>r.json());
    const l=j?.result?.list; if(!Array.isArray(l)||!l.length)break; for(const x of l) f.set(+x.fundingRateTimestamp,+x.fundingRate);
    const mn=Math.min(...l.map((x:{fundingRateTimestamp:string})=>+x.fundingRateTimestamp)); if(mn>=end)break; end=mn-1; if(l.length<200)break;}catch{break;} await new Promise(r=>setTimeout(r,80));}
  if(f.size<200)return null;
  // MATCHED ALIGNMENT: bybit 480m klines = exact 8h bars, same as the Binance path (D-414 used 4h — that was the asymmetry)
  const px=new Map<number,number>(); let e2=Date.now();
  for(let p=0;p<10;p++){try{const j=await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=480&limit=1000&end=${e2}`).then(r=>r.json());
    const l=j?.result?.list; if(!Array.isArray(l)||!l.length)break; for(const b of l) px.set(+b[0],+b[4]);
    const mn=Math.min(...l.map((b:string[])=>+b[0])); if(mn>=e2)break; e2=mn-1; if(l.length<1000)break;}catch{break;} await new Promise(r=>setTimeout(r,80));}
  return {f,px};
}
const B=new Map<string,Series>(), Y=new Map<string,Series>();
for(const s of CORE){const b=await binance(s); if(b)B.set(s,b); const y=await bybit(s); if(y)Y.set(s,y);}
const common=CORE.filter(s=>B.has(s)&&Y.has(s));
console.log(`==> FAIR REPLICATION — ${common.length} symbols present on BOTH venues`);
// MATCHED WINDOW: intersect the date ranges so both venues cover the same period
const bMin=Math.max(...common.map(s=>Math.min(...B.get(s)!.f.keys()))), yMin=Math.max(...common.map(s=>Math.min(...Y.get(s)!.f.keys())));
const lo=Math.max(bMin,yMin);
console.log(`    matched window starts ${new Date(lo).toISOString().slice(0,10)}`);
function run(M:Map<string,Series>,name:string){
  const stamps=[...new Set([...M.values()].flatMap(s=>[...s.f.keys()]))].filter(t=>t>=lo).sort((a,b)=>a-b);
  const ics:number[]=[],ls:number[]=[];
  for(let i=0;i<stamps.length-1;i++){
    const t=stamps[i],t1=stamps[i+1];
    const pts:{f:number;fwd:number}[]=[];
    for(const [,s] of M){const fr=s.f.get(t); if(fr==null)continue;
      const ks=[...s.px.keys()]; const k0=ks.filter(k=>k<=t).sort((a,b)=>b-a)[0], k1=ks.filter(k=>k<=t1).sort((a,b)=>b-a)[0];
      if(k0==null||k1==null||k0===k1)continue; const p0=s.px.get(k0)!,p1=s.px.get(k1)!; if(!(p0>0))continue;
      const fwd=p1/p0-1; if(Number.isFinite(fwd))pts.push({f:fr,fwd});}
    if(pts.length<8)continue;
    ics.push(rankIC(pts.map(p=>-p.f),pts.map(p=>p.fwd)));
    const sr=[...pts].sort((a,b)=>a.f-b.f); const q=Math.max(1,Math.floor(sr.length/3));
    ls.push(mean(sr.slice(0,q).map(p=>p.fwd))-mean(sr.slice(sr.length-q).map(p=>p.fwd)));}
  if(ls.length<50){console.log(`    ${name}: thin (${ls.length})`);return;}
  const sp=Math.floor(ls.length*0.6);
  console.log(`    ${name.padEnd(8)} n=${ls.length}  IC ${mean(ics).toFixed(4)} (t ${tst(ics).toFixed(2)})  gross ${(mean(ls)*100).toFixed(3)}%/8h (t ${tst(ls).toFixed(2)})  | TEST IC ${mean(ics.slice(sp)).toFixed(4)} (t ${tst(ics.slice(sp)).toFixed(2)}) gross ${(mean(ls.slice(sp))*100).toFixed(3)}%`);
}
const Bc=new Map([...B].filter(([s])=>common.includes(s))), Yc=new Map([...Y].filter(([s])=>common.includes(s)));
run(Bc,"BINANCE"); run(Yc,"BYBIT");
console.log(`\n    Same symbols, same window, same 8h alignment, same construction. If these disagree, the effect is venue-specific.`);
