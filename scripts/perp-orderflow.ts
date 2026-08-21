#!/usr/bin/env -S deno run --allow-net --allow-env
// perp-orderflow.ts (D-426) — does exchange-side AGGRESSOR IMBALANCE predict perp returns?
// Why this is the right pivot: D-424 showed the equity cross-section is capacity-bound (edge only in liq:HIGH SR 0.04-0.26).
// Perps invert that -- BTCUSDT alone clears >$10B/day -- so a real edge here is one size can actually use.
//
// THE CONTROL THAT MAKES OR BREAKS THIS TEST: takerBuy/volume is MECHANICALLY correlated with the bar's own return (buyers
// crossing the spread is what moves price up). A raw "OFI predicts the next bar" result would therefore be nothing but the
// return's own autocorrelation wearing an order-flow costume -- the exact mistake D-418 caught in the lead-lag scan. So the
// signal tested here is the RESIDUAL of OFI after projecting out the contemporaneous return, with the projection fitted on
// TRAIN ONLY. Residual flow is information the price did not already tell us; raw flow is not.
//
// Discipline carried in from this session: no pooling (per-symbol), train/test on every symbol, multiple-testing bar
// sqrt(2 ln N), fee-aware at Binance futures taker cost, per-era, and a capacity statement.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"of",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const TF=Deno.env.get("TF")||"1h";
const TAKER=Number(Deno.env.get("TAKER_BP")||4.5)/1e4;   // Binance USDT-M futures taker fee, per side

const syms=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
if(!Array.isArray(syms)||!syms.length){console.error("!! no intraday rows — run ingest-perp-flow.ts first");Deno.exit(1);}
console.log(`==> PERP ORDER-FLOW (tf=${TF}) — ${syms.length} perps, taker fee ${(TAKER*1e4).toFixed(1)}bp/side`);

type Res={sym:string;h:number;icF:number;tF:number;icTe:number;tTe:number;n:number;qv:number};
const hits:Res[]=[];
const HOR=[1,4,24];
const capacity=new Map<string,number>();
for(const s of syms){
  const row=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(row)||!row[0])continue;
  const b=row[0].bars; if(!b||b.length<4000)continue;
  // [ts,o,h,l,c,vol,quoteVol,takerBuyBase,nTrades]
  const ofi:number[]=[], ret:number[]=[], qv:number[]=[];
  for(let i=1;i<b.length;i++){
    const v=b[i][5], tb=b[i][7];
    if(!(v>0)||!(b[i-1][4]>0)||!(b[i][4]>0))continue;
    ofi.push((2*tb-v)/v); ret.push(b[i][4]/b[i-1][4]-1); qv.push(b[i][6]);
  }
  if(ofi.length<4000)continue;
  capacity.set(s.symbol,mean(qv));
  const split=Math.floor(ofi.length*0.6);
  // project OFI on the CONTEMPORANEOUS return using TRAIN ONLY, then use the residual everywhere.
  const rT=ret.slice(0,split), oT=ofi.slice(0,split);
  const mr=mean(rT), mo=mean(oT);
  let cov=0,varr=0; for(let i=0;i<split;i++){cov+=(rT[i]-mr)*(oT[i]-mo);varr+=(rT[i]-mr)**2;}
  const beta=varr>0?cov/varr:0;
  const resid=ofi.map((o,i)=>o-mo-beta*(ret[i]-mr));
  for(const h of HOR){
    // forward h-bar return, NON-OVERLAPPING (step by h) so the t-stat is not inflated by overlap (D-416's trap)
    const xs:number[]=[], ys:number[]=[];
    for(let i=0;i+h<resid.length;i+=h){
      let f=1; for(let k=1;k<=h;k++)f*=1+ret[i+k];
      xs.push(resid[i]); ys.push(f-1);
    }
    if(xs.length<400)continue;
    const ic=(a:number[],c:number[])=>{const n=a.length;const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>c[i]-c[j]);
      const A=new Array(n),B=new Array(n);ra.forEach((i,r)=>A[i]=r);rb.forEach((i,r)=>B[i]=r);
      const m=(n-1)/2;let nu=0,da=0,db=0;for(let i=0;i<n;i++){nu+=(A[i]-m)*(B[i]-m);da+=(A[i]-m)**2;db+=(B[i]-m)**2;}
      return da&&db?nu/Math.sqrt(da*db):0;};
    const sp=Math.floor(xs.length*0.6);
    const icF=ic(xs,ys), icTe=ic(xs.slice(sp),ys.slice(sp));
    hits.push({sym:s.symbol,h,icF,tF:icF*Math.sqrt(xs.length-2)/Math.sqrt(Math.max(1e-9,1-icF*icF)),
      icTe,tTe:icTe*Math.sqrt(xs.length-sp-2)/Math.sqrt(Math.max(1e-9,1-icTe*icTe)),n:xs.length,qv:mean(qv)});
  }
}
const BAR=Math.sqrt(2*Math.log(Math.max(2,hits.length)));
console.log(`    tests run: ${hits.length}  ->  multiple-testing bar |t| > ${BAR.toFixed(2)}`);
const strong=hits.filter(x=>Math.abs(x.tF)>BAR).sort((a,b)=>Math.abs(b.tF)-Math.abs(a.tF));
const surv=strong.filter(x=>Math.abs(x.tTe)>2&&Math.sign(x.tTe)===Math.sign(x.icF));
console.log(`    clearing the bar in-sample: ${strong.length}   ALSO holding out-of-sample with same sign: ${surv.length}`);
console.log(`\n    ${"symbol".padEnd(12)}${"hor".padEnd(6)}${"IC full".padEnd(10)}${"t full".padEnd(9)}${"IC test".padEnd(10)}${"t test".padEnd(9)}${"$vol/bar".padEnd(12)}n`);
for(const x of surv.slice(0,18))
  console.log(`    ${x.sym.padEnd(12)}${(x.h+"b").padEnd(6)}${x.icF.toFixed(4).padEnd(10)}${x.tF.toFixed(2).padEnd(9)}${x.icTe.toFixed(4).padEnd(10)}${x.tTe.toFixed(2).padEnd(9)}${("$"+(x.qv/1e6).toFixed(1)+"M").padEnd(12)}${x.n}`);
if(!surv.length)console.log(`      (none survived)`);
// direction consistency: is the sign the SAME across symbols? A real mechanism has one sign; a data-mined one alternates.
for(const h of HOR){ const g=hits.filter(x=>x.h===h);
  if(!g.length)continue;
  const pos=g.filter(x=>x.icF>0).length;
  console.log(`    horizon ${h}b: mean IC ${mean(g.map(x=>x.icF)).toFixed(4)}, ${pos}/${g.length} symbols POSITIVE  ${pos>g.length*0.8||pos<g.length*0.2?"<- consistent sign across symbols":"<- sign is NOT consistent"}`);
}

// ============================================================================================================
// ECONOMICS. IC is not money, and this program has now found EIGHT statistically real, economically inaccessible signals.
// A 1h-horizon signal must pay for the fee EVERY HOUR, so the bar is brutal: Binance taker is 4.5bp/side (9bp round trip),
// maker is 2bp/side, and VIP/market-maker tiers reach ~0 or a rebate. The question is not "is the IC real" -- 0/20 sign
// consistency settles that -- but "how many bp per trade does it actually pay, and at which fee tier does it die".
// Trading rule: hold the LAG of the residual flow, sized by a TRAILING z-score (no full-sample normalisation, which would
// be look-ahead), and only when the flow is extreme enough to be worth crossing for.
console.log(`\n    ==> ECONOMICS: bp per trade vs fee tier (the only question that matters at a 1h horizon)`);
console.log(`    ${"symbol".padEnd(11)}${"|z|>".padEnd(6)}${"trades".padEnd(9)}${"bp/trade".padEnd(11)}${"gross bp/yr".padEnd(13)}${"@0bp".padEnd(10)}${"@2bp mkr".padEnd(11)}${"@4.5bp tkr".padEnd(12)}SR`);
const LOOK=720;   // trailing window for the z-score (30 days of hourly bars)
for(const s of syms.slice(0,8)){
  const row=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(row)||!row[0])continue;
  const b=row[0].bars; if(!b||b.length<8000)continue;
  const ofi:number[]=[], ret:number[]=[];
  for(let i=1;i<b.length;i++){const v=b[i][5],tb=b[i][7];
    if(!(v>0)||!(b[i-1][4]>0)||!(b[i][4]>0))continue;
    ofi.push((2*tb-v)/v); ret.push(b[i][4]/b[i-1][4]-1);}
  if(ofi.length<8000)continue;
  const split=Math.floor(ofi.length*0.6);
  const rT=ret.slice(0,split), oT=ofi.slice(0,split);
  const mr=mean(rT), mo=mean(oT);
  let cov=0,varr=0; for(let i=0;i<split;i++){cov+=(rT[i]-mr)*(oT[i]-mo);varr+=(rT[i]-mr)**2;}
  const beta=varr>0?cov/varr:0;
  const resid=ofi.map((o,i)=>o-mo-beta*(ret[i]-mr));
  for(const TH of [1.5,2.5]){
    const pnl:number[]=[]; let trades=0;
    for(let i=LOOK;i<resid.length-1;i++){
      const w=resid.slice(i-LOOK,i); const m=mean(w), sd2=sdv(w)||1e-9;
      const z=(resid[i]-m)/sd2;
      if(Math.abs(z)<TH)continue;
      trades++;
      pnl.push(-Math.sign(z)*ret[i+1]);      // fade the aggressor; position is one bar
    }
    if(trades<200)continue;
    const m=mean(pnl), sg=sdv(pnl)||1e-9;
    const bp=m*1e4;
    const perYr=trades/((resid.length)/8760);
    const net=(c:number)=>((m-c/1e4)*perYr*1e4/100).toFixed(1)+"%";
    console.log(`    ${s.symbol.padEnd(11)}${String(TH).padEnd(6)}${String(trades).padEnd(9)}${bp.toFixed(2).padEnd(11)}${((m*perYr*1e4/100).toFixed(1)+"%").padEnd(13)}${net(0).padEnd(9)}${net(4).padEnd(11)}${net(9).padEnd(12)}${((m/sg)*Math.sqrt(perYr)).toFixed(2)}`);
  }
}
console.log(`\n    (fee columns are ROUND TRIP: 0bp = rebate/maker-maker, 4bp = maker both sides, 9bp = taker both sides)`);

// ============================================================================================================
// THE TAIL INVERSION, MEASURED. The IC says fade the flow (0/20 symbols agree, t up to -4.9). The trading rule -- which
// only fires on |z| EXTREMES -- loses money even at ZERO fees. Both cannot be right about the same observations, and they
// are not: rank IC weights every observation equally, so it describes the MIDDLE of the distribution, while any tradable
// rule fires only in the TAILS. This program has now hit this same wall three times. So measure it instead of noting it:
// mean forward return by decile of the trailing z-score, per symbol. If the monotonic reversal in the middle deciles
// reverses again in decile 1 and 10, the effect is real AND structurally untradable, and that is the finding.
console.log(`\n    ==> TAIL PROFILE: mean next-bar return (bp) by decile of residual-flow z-score`);
console.log(`    ${"symbol".padEnd(11)}${[1,2,3,4,5,6,7,8,9,10].map(d=>("D"+d).padStart(7)).join("")}   monotone?`);
for(const s of syms.slice(0,8)){
  const row=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(row)||!row[0])continue;
  const b=row[0].bars; if(!b||b.length<8000)continue;
  const ofi:number[]=[], ret:number[]=[];
  for(let i=1;i<b.length;i++){const v=b[i][5],tb=b[i][7];
    if(!(v>0)||!(b[i-1][4]>0)||!(b[i][4]>0))continue;
    ofi.push((2*tb-v)/v); ret.push(b[i][4]/b[i-1][4]-1);}
  if(ofi.length<8000)continue;
  const split=Math.floor(ofi.length*0.6);
  const rT=ret.slice(0,split), oT=ofi.slice(0,split); const mr=mean(rT), mo=mean(oT);
  let cov=0,varr=0; for(let i=0;i<split;i++){cov+=(rT[i]-mr)*(oT[i]-mo);varr+=(rT[i]-mr)**2;}
  const beta=varr>0?cov/varr:0;
  const resid=ofi.map((o,i)=>o-mo-beta*(ret[i]-mr));
  const zs:{z:number;r:number}[]=[];
  for(let i=LOOK;i<resid.length-1;i++){const w=resid.slice(i-LOOK,i);const m=mean(w),sd2=sdv(w)||1e-9;
    zs.push({z:(resid[i]-m)/sd2,r:ret[i+1]});}
  zs.sort((a,c)=>a.z-c.z);
  const d=Math.floor(zs.length/10); const cells:number[]=[];
  for(let k=0;k<10;k++) cells.push(mean(zs.slice(k*d,(k+1)*d).map(x=>x.r))*1e4);
  // "monotone" = the middle six deciles trend one way. Reversal predicts D2..D9 sloping DOWN (buy flow -> lower return).
  const mid=cells.slice(2,8); let down=0; for(let k=1;k<mid.length;k++) if(mid[k]<mid[k-1])down++;
  const tails=`D1 ${cells[0].toFixed(1)} / D10 ${cells[9].toFixed(1)}`;
  console.log(`    ${s.symbol.padEnd(11)}${cells.map(c=>c.toFixed(1).padStart(7)).join("")}   mid-down ${down}/5  [${tails}]`);
}

// ============================================================================================================
// EFFECT SIZE IN BASIS POINTS. The rank IC is real (0/20 symbols agree in sign, |t| to 4.9) yet the decile profile is flat
// noise and the tail rule loses at zero fees. Those are reconcilable only one way: the effect is genuine but TINY, and
// crypto hourly returns are fat-tailed enough that a rank statistic and a mean statistic stop agreeing. So state the
// magnitude in the only unit that decides anything -- bp of expected return per 1 standard deviation of residual flow --
// next to the fee it has to beat. This is the number that should have been computed before any excitement.
console.log(`\n    ==> EFFECT SIZE: OLS slope of next-bar return on residual flow, in bp per 1sd of flow`);
console.log(`    ${"symbol".padEnd(11)}${"bp per 1sd".padEnd(13)}${"t".padEnd(9)}${"|effect| vs 4bp maker RT".padEnd(26)}n`);
for(const s of syms.slice(0,10)){
  const row=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(row)||!row[0])continue;
  const b=row[0].bars; if(!b||b.length<8000)continue;
  const ofi:number[]=[], ret:number[]=[];
  for(let i=1;i<b.length;i++){const v=b[i][5],tb=b[i][7];
    if(!(v>0)||!(b[i-1][4]>0)||!(b[i][4]>0))continue;
    ofi.push((2*tb-v)/v); ret.push(b[i][4]/b[i-1][4]-1);}
  if(ofi.length<8000)continue;
  const split=Math.floor(ofi.length*0.6);
  const rT=ret.slice(0,split), oT=ofi.slice(0,split); const mr=mean(rT), mo=mean(oT);
  let cov=0,varr=0; for(let i=0;i<split;i++){cov+=(rT[i]-mr)*(oT[i]-mo);varr+=(rT[i]-mr)**2;}
  const beta0=varr>0?cov/varr:0;
  const resid=ofi.map((o,i)=>o-mo-beta0*(ret[i]-mr));
  const x:number[]=[], y:number[]=[];
  for(let i=0;i<resid.length-1;i++){x.push(resid[i]);y.push(ret[i+1]);}
  const sx=sdv(x)||1e-9, mx=mean(x), my=mean(y);
  let c2=0,v2=0; for(let i=0;i<x.length;i++){c2+=(x[i]-mx)*(y[i]-my);v2+=(x[i]-mx)**2;}
  const slope=v2>0?c2/v2:0;                       // return per unit of residual flow
  const perSd=slope*sx*1e4;                       // bp of return per 1sd of flow
  // residual se of the slope
  let sse=0; for(let i=0;i<x.length;i++){const e=(y[i]-my)-slope*(x[i]-mx);sse+=e*e;}
  const se=Math.sqrt(sse/(x.length-2)/v2); const t=se>0?slope/se:0;
  console.log(`    ${s.symbol.padEnd(11)}${perSd.toFixed(3).padEnd(13)}${t.toFixed(2).padEnd(9)}${(Math.abs(perSd)/4).toFixed(3).concat("x the fee").padEnd(26)}${x.length}`);
}
console.log(`\n    A signal must move expected return by MORE than the round-trip fee to be tradable. Ratios below 1.0 mean the`);
console.log(`    effect is smaller than the cost of acting on it, at ANY size -- capacity is irrelevant when the edge is < fee.`);
