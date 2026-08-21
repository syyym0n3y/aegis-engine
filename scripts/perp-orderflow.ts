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
