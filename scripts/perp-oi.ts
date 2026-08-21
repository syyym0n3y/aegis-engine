#!/usr/bin/env -S deno run --allow-net --allow-env
// perp-oi.ts (D-430) — does OPEN-INTEREST positioning predict perp returns at a DAILY horizon?
// Why daily, deliberately: D-426 killed the hourly order-flow signal on EFFECT SIZE, not on significance — an hourly rule
// pays the round-trip fee every bar, so it needs an implausible per-bar edge. A daily signal held several days amortises
// the same fee over a move that is ~100x larger. If anything in derivatives is tradable, it is at this frequency.
// WHY OI IS DIFFERENT FROM PRICE: price alone cannot distinguish new money from old money leaving. OI can.
//   price up + OI up   = new longs opening       price up + OI down = shorts covering (squeeze, not demand)
//   price down + OI up = new shorts opening      price down + OI down = longs capitulating (unwind)
// Hypotheses stated IN ADVANCE: (H1) OI far above its own trailing norm = crowded positioning = LOWER forward returns
// (vulnerable to liquidation cascade). (H2) the four quadrants differ, with squeeze/capitulation (OI falling) marking
// exhaustion. Both are directional predictions made before looking.
// Complies with THE EFFECT-SIZE LAW by construction: every IC is reported beside bp-per-1sd and its multiple of the fee.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"oi2",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const spear=(a:number[],b:number[])=>{const n=a.length;const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>b[i]-b[j]);
  const A=new Array(n),B=new Array(n);ra.forEach((i,r)=>A[i]=r);rb.forEach((i,r)=>B[i]=r);
  const m=(n-1)/2;let nu=0,da=0,db=0;for(let i=0;i<n;i++){nu+=(A[i]-m)*(B[i]-m);da+=(A[i]-m)**2;db+=(B[i]-m)**2;}
  return da&&db?nu/Math.sqrt(da*db):0;};
// OLS slope of y on x, returned as bp of y per 1sd of x, with its t-stat. This is the number the EFFECT-SIZE LAW requires.
function effect(x:number[],y:number[]){const mx=mean(x),my=mean(y),sx=sdv(x)||1e-9;
  let c=0,v=0;for(let i=0;i<x.length;i++){c+=(x[i]-mx)*(y[i]-my);v+=(x[i]-mx)**2;}
  const b=v>0?c/v:0; let sse=0;for(let i=0;i<x.length;i++){const e=(y[i]-my)-b*(x[i]-mx);sse+=e*e;}
  const se=Math.sqrt(sse/Math.max(1,x.length-2)/Math.max(1e-12,v));
  return {bp:b*sx*1e4,t:se>0?b/se:0};}
const FEE_RT=Number(Deno.env.get("FEE_RT_BP")||9);   // taker both sides on Binance USDT-M; maker RT would be 4

const oi=await fetch(`${OWNED}/trd_perp_oi?interval=eq.1d&select=symbol,ts,open_interest&order=symbol,ts&limit=100000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;ts:number;open_interest:number}[];
if(!Array.isArray(oi)||!oi.length){console.error("!! no OI rows — run ingest-perp-oi.ts");Deno.exit(1);}
const bySym=new Map<string,{ts:number;v:number}[]>();
for(const r of oi)(bySym.get(r.symbol)??bySym.set(r.symbol,[]).get(r.symbol)!).push({ts:r.ts,v:r.open_interest});
console.log(`==> PERP OPEN INTEREST, DAILY (${bySym.size} symbols, fee round-trip ${FEE_RT}bp)`);

type R={sym:string;h:number;name:string;ic:number;t:number;icTe:number;bp:number;tOls:number;n:number};
const out:R[]=[];
for(const [sym,rowsOI] of bySym){
  if(rowsOI.length<500)continue;
  const bar=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${sym}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(bar)||!bar[0])continue;
  // resample hourly closes to UTC daily closes so price and OI share the same clock
  const px=new Map<string,number>();
  for(const b of bar[0].bars) px.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  const day:{d:string;p:number;o:number}[]=[];
  for(const r of rowsOI){const d=new Date(r.ts*1000).toISOString().slice(0,10); const p=px.get(d); if(p&&p>0)day.push({d,p,o:r.v});}
  if(day.length<500)continue;
  const ret:number[]=[],doi:number[]=[],crowd:number[]=[];
  for(let i=1;i<day.length;i++){
    ret.push(day[i].p/day[i-1].p-1);
    doi.push(day[i-1].o>0?day[i].o/day[i-1].o-1:0);
    const w=day.slice(Math.max(0,i-30),i).map(x=>x.o);
    const m=mean(w),s=sdv(w)||1e-9; crowd.push((day[i].o-m)/s);      // trailing z, no look-ahead
  }
  for(const h of [1,3,7]){
    const fwd:number[]=[],cr:number[]=[],dz:number[]=[],quad:number[]=[];
    for(let i=30;i+h<ret.length;i+=h){                                  // NON-OVERLAPPING steps
      let f=1;for(let k=1;k<=h;k++)f*=1+ret[i+k];
      fwd.push(f-1); cr.push(crowd[i]); dz.push(doi[i]);
      quad.push(Math.sign(ret[i])*Math.sign(doi[i]));                   // +1 = new positioning, -1 = unwind
    }
    if(fwd.length<80)continue;
    const sp=Math.floor(fwd.length*0.6);
    for(const [nm,sig] of [["OI crowding (H1)",cr],["dOI (raw)",dz],["quadrant (H2)",quad]] as [string,number[]][]){
      const ic=spear(sig,fwd), e=effect(sig,fwd);
      out.push({sym,h,name:nm,ic,t:ic*Math.sqrt(fwd.length-2)/Math.sqrt(Math.max(1e-9,1-ic*ic)),
        icTe:spear(sig.slice(sp),fwd.slice(sp)),bp:e.bp,tOls:e.t,n:fwd.length});
    }
  }
}
const BAR=Math.sqrt(2*Math.log(Math.max(2,out.length)));
console.log(`    tests: ${out.length}  ->  multiple-testing bar |t| > ${BAR.toFixed(2)}`);
// SIGN CONSISTENCY FIRST — D-426 showed this is the strongest evidence available, before economics decides anything.
for(const nm of ["OI crowding (H1)","dOI (raw)","quadrant (H2)"]) for(const h of [1,3,7]){
  const g=out.filter(x=>x.name===nm&&x.h===h); if(g.length<5)continue;
  const pos=g.filter(x=>x.ic>0).length;
  const mbp=mean(g.map(x=>x.bp)), mic=mean(g.map(x=>x.ic));
  const consistent=pos>=g.length*0.8||pos<=g.length*0.2;
  console.log(`    ${nm.padEnd(18)} h=${String(h).padEnd(2)} meanIC ${mic.toFixed(4).padStart(8)}  ${String(pos).padStart(2)}/${g.length} pos ${consistent?"CONSISTENT":"mixed     "}  mean effect ${mbp.toFixed(2).padStart(7)}bp/1sd = ${(Math.abs(mbp)/FEE_RT).toFixed(2)}x the fee`);
}
const surv=out.filter(x=>Math.abs(x.t)>BAR&&Math.abs(x.icTe)>0.05&&Math.sign(x.icTe)===Math.sign(x.ic)&&Math.abs(x.bp)>FEE_RT);
console.log(`\n    surviving BOTH the multiple-testing bar AND out-of-sample AND the fee (|effect| > ${FEE_RT}bp): ${surv.length}`);
for(const x of surv.sort((a,b)=>Math.abs(b.bp)-Math.abs(a.bp)).slice(0,15))
  console.log(`      ${x.sym.padEnd(13)}${x.name.padEnd(18)}h=${String(x.h).padEnd(2)} IC ${x.ic.toFixed(3)} t ${x.t.toFixed(2)} | OOS IC ${x.icTe.toFixed(3)} | ${x.bp.toFixed(1)}bp/1sd = ${(Math.abs(x.bp)/FEE_RT).toFixed(1)}x fee (n=${x.n})`);
if(!surv.length)console.log(`      (none)`);
