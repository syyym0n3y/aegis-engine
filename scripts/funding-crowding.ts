#!/usr/bin/env -S deno run --allow-net --allow-env
// funding-crowding.ts (D-410) — FULL TEST of the strongest new lead (D-409): funding-rate crowding. The quintile scan showed
// a monotone signal (most-negative funding -> +0.201%/8h, most-positive -> -0.023%) but on ~167 days with no train/test and
// no cost model. This is the proper test: deep history, cross-sectional (rank perps against each other each interval, so it
// is market-neutral and cannot be crypto beta), strict train/test, and net of realistic perp costs INCLUDING the funding
// actually paid/received — which for a funding-based signal is the whole economics, not a footnote.
// SURVIVORSHIP FIX (D-411): the first universe was 20 CURRENTLY-LISTED perps — the exact bias flagged as the biggest
// unresolved caveat. Binance exchangeInfo exposes 654 USDT perps of which 127 are DELISTED/SETTLED (OMG, WAVES, FTM, REN...).
// Build the universe from BOTH so failed coins — which had the most extreme funding — are included. SURV=0 reproduces the
// old biased universe for comparison.
const SURV=Deno.env.get("SURV")!=="0";
const NUNI=Number(Deno.env.get("NUNI")||60);
let SYMS:string[]=[];
try{
  const ei=await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r=>r.json());
  const all=(ei.symbols||[]).filter((x:{quoteAsset:string;contractType:string})=>x.quoteAsset==="USDT"&&x.contractType==="PERPETUAL");
  const live=all.filter((x:{status:string})=>x.status==="TRADING").map((x:{symbol:string})=>x.symbol);
  const dead=all.filter((x:{status:string})=>x.status!=="TRADING").map((x:{symbol:string})=>x.symbol);
  SYMS = SURV ? [...live.slice(0,NUNI-dead.length>0?NUNI-dead.length:NUNI), ...dead] : live.slice(0,20);
  console.log(`  universe: ${SYMS.length} perps (${SURV?`SURVIVORSHIP-FREE: includes ${dead.length} delisted`:"currently-listed only (BIASED)"})`);
}catch{ SYMS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"]; }
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<5)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
console.log("==> FUNDING CROWDING — full test (deep history, cross-sectional, train/test, funding-aware costs)");
type Rec={t:number;f:number;px:number};
const data=new Map<string,Map<number,Rec>>();
for(const s of SYMS){
  // PAGINATION FIX: endTime did not walk backward (every symbol returned exactly 500 — the endpoint's real page size).
  // Walk FORWARD with startTime from Binance perp inception instead; each page advances past the last stamp received.
  const fr:{t:number;f:number}[]=[]; let start=1568000000000;   // ~Sep 2019, before most perp listings
  for(let p=0;p<40;p++){
    try{const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${s}&startTime=${start}&limit=1000`).then(r=>r.json());
      if(!Array.isArray(j)||!j.length)break;
      for(const x of j) fr.push({t:x.fundingTime,f:+x.fundingRate});
      const lastT=j[j.length-1].fundingTime; if(lastT<=start)break; start=lastT+1;
      if(j.length<500)break;}catch{break;}
    await new Promise(r=>setTimeout(r,90));
  }
  if(fr.length<800){console.log(`  ${s}: thin (${fr.length}) — excluded`);continue;}
  // 8h klines aligned to funding stamps (paginate back)
  const px=new Map<number,number>(); let s2=fr.length?fr[0].t-9e6:1568000000000;
  for(let p=0;p<20;p++){
    try{const k=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=8h&startTime=${s2}&limit=1500`).then(r=>r.json());
      if(!Array.isArray(k)||!k.length)break;
      for(const b of k) px.set(b[0],+b[4]);
      const lt=k[k.length-1][0]; if(lt<=s2)break; s2=lt+1; if(k.length<1500)break;}catch{break;}
    await new Promise(r=>setTimeout(r,90));
  }
  const m=new Map<number,Rec>(); const times=[...px.keys()].sort((a,b)=>a-b);
  for(const x of fr){const near=times.find(t=>t>=x.t); if(near==null)continue; m.set(x.t,{t:x.t,f:x.f,px:px.get(near)!});}
  if(m.size>=800) data.set(s,m);
  await new Promise(r=>setTimeout(r,90));
}
console.log(`  perps with deep aligned history: ${data.size}`);
// build cross-sections per funding timestamp
const stamps=[...new Set([...data.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b);
const ics:number[]=[], lsG:number[]=[], lsN:number[]=[];
const legs:{t:number;tNext:number;lo:string[];hi:string[]}[]=[];
const COST=0.0004;   // 4bp round-trip per leg on major perps (taker, tight books)
for(let i=0;i<stamps.length-1;i++){
  const t=stamps[i], t1=stamps[i+1];
  const pts:{sym:string;f:number;fwd:number}[]=[];
  for(const [s,m] of data){const a=m.get(t),b=m.get(t1); if(!a||!b||!(a.px>0))continue;
    const fwd=b.px/a.px-1; if(!Number.isFinite(fwd))continue; pts.push({sym:s,f:a.f,fwd});}
  if(pts.length<8) continue;
  // signal = NEGATIVE funding (crowded shorts) -> expect positive return
  ics.push(rankIC(pts.map(p=>-p.f),pts.map(p=>p.fwd)));
  const srt=[...pts].sort((a,b)=>a.f-b.f); const q=Math.max(1,Math.floor(srt.length/3));
  const lo=srt.slice(0,q), hi=srt.slice(srt.length-q);
  const gross=mean(lo.map(p=>p.fwd))-mean(hi.map(p=>p.fwd));
  legs.push({t,tNext:t1,lo:lo.map(p=>p.sym),hi:hi.map(p=>p.sym)});
  // FUNDING-AWARE: long the low-funding leg RECEIVES |funding| if negative; short the high-funding leg RECEIVES funding.
  // same look-ahead fix here: credit the funding settled at t1, looked up per symbol, not the ranking signal f(t)
  const fAt=(sym:string)=>data.get(sym)?.get(t1)?.f ?? 0;
  const fundingPnl=mean(lo.map(p=>-fAt(p.sym)))+mean(hi.map(p=>fAt(p.sym)));
  lsG.push(gross); lsN.push(gross+fundingPnl-2*COST);
}
console.log(`  intervals: ${lsG.length} (${(lsG.length/3).toFixed(0)} days)`);
const sp=Math.floor(lsG.length*0.6), per=3*365;
const rep=(t:string,ic:number[],g:number[],n:number[])=>{
  const mg=mean(g), mn=mean(n); const sd=Math.sqrt(n.reduce((s,x)=>s+(x-mn)**2,0)/(n.length-1));
  console.log(`    ${t} n=${g.length}  IC ${mean(ic).toFixed(4)} (t ${tst(ic).toFixed(2)})  GROSS ${(mg*100).toFixed(3)}%/8h  NET(incl funding) ${(mn*100).toFixed(3)}%  ann ${(mn*per*100).toFixed(0)}%  SR ${(sd>0?(mn/sd)*Math.sqrt(per):0).toFixed(2)}`);};
console.log(`\n  === cross-sectional: LONG most-negative-funding / SHORT most-positive ===`);
rep("FULL      ",ics,lsG,lsN);
rep("TRAIN(60%)",ics.slice(0,sp),lsG.slice(0,sp),lsN.slice(0,sp));
rep("TEST (40%)",ics.slice(sp),lsG.slice(sp),lsN.slice(sp));
// The signal is OOS-significant (t 4.67) with a stable +4.6bp/8h gross; the question is purely whether it is HARVESTABLE.
// Two levers: (a) cost per leg — 4bp assumes TAKER; makers on major perps pay ~0-1bp; (b) TURNOVER — rebalancing every 8h
// pays cost 1095x/yr. Test both honestly, and report the break-even cost so the answer does not depend on my assumption.
console.log(`\n  === HARVESTABILITY: cost sensitivity (gross+funding edge is fixed; only the cost assumption moves) ===`);
const gAvg=mean(lsG), fAvg=mean(lsN)-mean(lsG)+2*COST;   // recover the pure funding component
console.log(`    gross ${(gAvg*100).toFixed(3)}%/8h + funding ${(fAvg*100).toFixed(3)}%/8h = combined edge ${((gAvg+fAvg)*100).toFixed(3)}%/8h`);
for(const bp of [0.5,1,2,4]){const c=bp/1e4; const net=gAvg+fAvg-2*c;
  console.log(`      @${bp}bp/leg: net ${(net*100).toFixed(3)}%/8h  ann ${(net*per*100).toFixed(0)}%  ${net>0?"POSITIVE":"negative"}`);}
console.log(`    BREAK-EVEN cost: ${(((gAvg+fAvg)/2)*1e4).toFixed(2)}bp per leg`);
// (b) lower turnover: rebalance every Nth interval (hold the book longer, pay cost less often)
console.log(`\n  === HARVESTABILITY: turnover reduction (REAL held book — the first version was WRONG) ===`);
// BUG FIXED: the first version summed returns from a book that RECONSTITUTED every 8h while charging cost only once per N.
// That is not a strategy. Here the book is CHOSEN at interval i and HELD unchanged for N intervals — its return is the
// actual return of those fixed legs, and the signal is allowed to decay exactly as it would in reality.
for(const N of [1,3,9,21]){
  const rets:number[]=[];
  for(let i=0;i+N<legs.length;i+=N){
    const L=legs[i].lo, Hh=legs[i].hi; let acc=0;
    for(let k=0;k<N;k++){
      const seg=legs[i+k]; if(!seg)break; const t0=seg.t, t1=seg.tNext;
      const legRet=(syms:string[])=>{const v:number[]=[];for(const sy of syms){const a=data.get(sy)?.get(t0),b=data.get(sy)?.get(t1);if(a&&b&&a.px>0)v.push(b.px/a.px-1);}return v.length?mean(v):0;};
      // LOOK-AHEAD FIX: funding is exchanged AT the timestamp you hold through, so a position opened at t0 and held to t1
      // earns f(t1), NOT f(t0). Using f(t0) credits the SIGNAL ITSELF as income — circular, and it inflated the result.
      const fundRet=(syms:string[],sign:number)=>{const v:number[]=[];for(const sy of syms){const b=data.get(sy)?.get(t1);if(b)v.push(sign*b.f);}return v.length?mean(v):0;};
      acc+=(legRet(L)-legRet(Hh))+(fundRet(L,-1)+fundRet(Hh,1));   // price spread + funding received on both legs
    }
    rets.push(acc-2*0.0001);   // cost ONCE per rebalance, 1bp/leg (maker)
  }
  if(rets.length<20){console.log(`      rebal every ${N}: thin`);continue;}
  const m=mean(rets); const sd=Math.sqrt(rets.reduce((s,x)=>s+(x-m)**2,0)/(rets.length-1));
  const perN=per/N;
  console.log(`      rebal every ${String(N).padStart(2)} intervals (${(N*8/24).toFixed(1)}d): net ${(m*100).toFixed(3)}%/period ann ${(m*perN*100).toFixed(0)}% SR ${(sd>0?(m/sd)*Math.sqrt(perN):0).toFixed(2)} n=${rets.length}`);
  // and the OOS half of the same held book
  const spN=Math.floor(rets.length*0.6), te=rets.slice(spN);
  if(te.length>20){const mt=mean(te);const st=Math.sqrt(te.reduce((s,x)=>s+(x-mt)**2,0)/(te.length-1));
    console.log(`         OOS: ann ${(mt*perN*100).toFixed(0)}% SR ${(st>0?(mt/st)*Math.sqrt(perN):0).toFixed(2)} n=${te.length}`);}
}
