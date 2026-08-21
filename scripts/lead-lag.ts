#!/usr/bin/env -S deno run --allow-net --allow-env
// lead-lag.ts (D-417) — CROSS-ASSET LEAD-LAG, a Tier-2 gap and a mechanism never tested here. Does one asset's move predict
// ANOTHER's? Documented candidates: credit (HYG/LQD) leads equity; copper/oil lead industrials/energy; the dollar leads EM;
// bonds lead equity in stress; big caps lead small. If a lead-lag exists at a horizon longer than a latency race, it is
// exactly the kind of edge retail CAN take.
// Discipline applied from this session's failures: (1) NO POOLING — every pair tested separately (D-415 died of pooling);
// (2) train/test split on every pair; (3) a multiple-testing bar, since scanning P pairs guarantees false positives —
// with ~N pairs tested, the honest bar is |t| > sqrt(2*ln(N)), not 2.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ll",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const WANT=["HYG","LQD","TLT","IEF","SPY","QQQ","IWM","GLD","SLV","USO","DBC","GDX","XLE","XLF","XLI","XLK","XLU","XLP","XLY","XLV","XLB","XLRE","EEM","EFA","FXI","EWJ","EWZ","VIX","^VIX","UUP","SMH","XBI","KRE","ITB","JETS","VNQ","AGG","TIP","SHY","HG=F","CL=F","GC=F","SI=F","^TNX","^GSPC","^IXIC","^RUT","^N225","^FTSE","^GDAXI"];
// fetch only the wanted symbols, in chunks — a single unbounded pull returned a non-array (payload too large)
const rows:{symbol:string;bars:number[][]}[]=[];
for(let i=0;i<WANT.length;i+=10){
  const part=WANT.slice(i,i+10).map(x=>`"${x}"`).join(",");
  const r=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]);
  if(Array.isArray(r)) rows.push(...r);
}
const px=new Map<string,Map<string,number>>();
for(const r of rows){ if(!WANT.includes(r.symbol))continue; const b=r.bars; if(!b||b.length<1500)continue;
  let mx=0; for(let i=1;i<b.length;i++) if(b[i-1][4]>0){const q=Math.abs(b[i][4]/b[i-1][4]-1); if(q>mx)mx=q;}
  if(mx>10)continue;
  px.set(r.symbol,new Map(b.map(x=>[new Date(x[0]*1000).toISOString().slice(0,10),x[4]] as [string,number])));}
const syms=[...px.keys()];
console.log(`==> CROSS-ASSET LEAD-LAG — ${syms.length} instruments`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const corr=(a:number[],b:number[])=>{const n=Math.min(a.length,b.length);const x=a.slice(0,n),y=b.slice(0,n);
  const mx=mean(x),my=mean(y);let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){sxy+=(x[i]-mx)*(y[i]-my);sx+=(x[i]-mx)**2;sy+=(y[i]-my)**2;}
  return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
// common daily grid
const dates=[...new Set(syms.flatMap(s=>[...px.get(s)!.keys()]))].sort().filter(d=>syms.filter(s=>px.get(s)!.has(d)).length>=syms.length*0.8);
console.log(`    common trading days: ${dates.length} (${dates[0]} .. ${dates[dates.length-1]})`);
const ret=new Map<string,number[]>();
for(const s of syms){const m=px.get(s)!;const r:number[]=[];
  for(let i=1;i<dates.length;i++){const p0=m.get(dates[i-1]),p1=m.get(dates[i]); r.push(p0&&p1&&p0>0?p1/p0-1:0);} ret.set(s,r);}
// scan every ordered pair at lags 1 and 5 days; NO pooling — each pair stands alone
type Hit={lead:string;lag:string;k:number;t:number;beta:number;tTest:number};
const hits:Hit[]=[]; let tested=0;
for(const A of syms) for(const B of syms){ if(A===B)continue;
  for(const k of [1,5]){
    const x:number[]=[],y:number[]=[];
    const ra=ret.get(A)!, rb=ret.get(B)!;
    for(let i=k;i<ra.length;i++){ if(!Number.isFinite(ra[i-k])||!Number.isFinite(rb[i]))continue; x.push(ra[i-k]); y.push(rb[i]); }
    if(x.length<800)continue; tested++;
    // regression slope of B_t on A_{t-k}, and its t-stat
    const mx=mean(x),my=mean(y); let sxy=0,sxx=0;
    for(let i=0;i<x.length;i++){sxy+=(x[i]-mx)*(y[i]-my);sxx+=(x[i]-mx)**2;}
    if(!(sxx>0))continue; const beta=sxy/sxx;
    const resid=y.map((v,i)=>v-(my+beta*(x[i]-mx)));
    const se=Math.sqrt(resid.reduce((s,v)=>s+v*v,0)/(x.length-2)/sxx);
    const t=se>0?beta/se:0;
    // TRAIN/TEST on the same pair
    const sp=Math.floor(x.length*0.6);
    const xt=x.slice(sp),yt=y.slice(sp);
    const mxt=mean(xt),myt=mean(yt); let sxyt=0,sxxt=0;
    for(let i=0;i<xt.length;i++){sxyt+=(xt[i]-mxt)*(yt[i]-myt);sxxt+=(xt[i]-mxt)**2;}
    const bt=sxxt>0?sxyt/sxxt:0;
    const rt=yt.map((v,i)=>v-(myt+bt*(xt[i]-mxt)));
    const set=Math.sqrt(rt.reduce((s,v)=>s+v*v,0)/(xt.length-2)/(sxxt||1));
    hits.push({lead:A,lag:B,k,t,beta,tTest:set>0?bt/set:0});
  }}
const BAR=Math.sqrt(2*Math.log(Math.max(2,tested)));
console.log(`    pairs tested: ${tested}  ->  multiple-testing bar |t| > ${BAR.toFixed(2)} (sqrt(2 ln N)), NOT 2`);
// TIMEZONE CONTAMINATION FILTER (caught pre-report): the top "survivors" were all US -> ^N225/^FTSE/^GDAXI. Those foreign
// index bars are stamped date D but CLOSE HOURS BEFORE the US bar stamped date D, so "US(t-1) predicts Nikkei(t)" is the
// textbook non-synchronous-trading artifact — the foreign market simply gaps to a move that already happened. Not tradable,
// not information. Restrict to SAME-SESSION (US-listed) instruments so any survivor is a genuine lead-lag.
// also exclude FUTURES: COMEX/NYMEX settle 13:30 ET vs equity 16:00 ET, so "equity(t-1) -> future(t)" is the SAME
// non-synchronous artifact in a different costume (it produced the XLB/XLE/SPY -> SI=F hits).
const FOREIGN=new Set(["^N225","^FTSE","^GDAXI","EWJ","EFA","FXI","EEM","EWZ","SI=F","GC=F","HG=F","CL=F","^TNX","^VIX"]);
const sameSession=hits.filter(h=>!FOREIGN.has(h.lead)&&!FOREIGN.has(h.lag));
console.log(`    excluding cross-timezone pairs: ${hits.length} -> ${sameSession.length} same-session pairs`);
const strong=sameSession.filter(h=>Math.abs(h.t)>BAR).sort((a,b)=>Math.abs(b.t)-Math.abs(a.t));
console.log(`    pairs clearing the bar IN-SAMPLE: ${strong.length}`);
const survive=strong.filter(h=>Math.abs(h.tTest)>2&&Math.sign(h.tTest)===Math.sign(h.t));
console.log(`    of those, ALSO |t|>2 OUT-OF-SAMPLE with the SAME SIGN: ${survive.length}\n`);
for(const h of survive.slice(0,12)) console.log(`      ${h.lead.padEnd(7)} -> ${h.lag.padEnd(7)} lag ${h.k}d  beta ${h.beta.toFixed(4)}  t_full ${h.t.toFixed(2)}  t_TEST ${h.tTest.toFixed(2)}`);
if(!survive.length) console.log(`      (none — every in-sample lead-lag failed out-of-sample)`);
// ECONOMICS: a significant beta is not a strategy. For the top survivors, trade the LAG asset on the sign of the LEAD's
// prior move, daily, and measure the NET return. Statistical significance without economic value has been this program's
// dominant failure mode (7 instances) — check it before claiming anything.
console.log(`\n    ECONOMICS of the top same-session survivors (trade lag-asset on sign of lead's prior move, daily):`);
for(const h of survive.slice(0,6)){
  const ra=ret.get(h.lead)!, rb=ret.get(h.lag)!;
  const pnl:number[]=[];
  for(let i=h.k;i<ra.length;i++){ const sig=Math.sign(h.beta)*Math.sign(ra[i-h.k]); if(!sig)continue; pnl.push(sig*rb[i]); }
  if(pnl.length<500)continue;
  const m=mean(pnl), sd=Math.sqrt(pnl.reduce((s2,x)=>s2+(x-m)**2,0)/(pnl.length-1));
  const sp2=Math.floor(pnl.length*0.6), te=pnl.slice(sp2);
  const mt=mean(te), st=Math.sqrt(te.reduce((s2,x)=>s2+(x-mt)**2,0)/(te.length-1));
  for(const bp of [0,5,10]){ const c=bp/1e4;
    if(bp===0) console.log(`      ${h.lead.padEnd(7)}->${h.lag.padEnd(7)}: GROSS ${(m*252*100).toFixed(1)}%/yr SR ${((m/sd)*Math.sqrt(252)).toFixed(2)} | TEST ${(mt*252*100).toFixed(1)}%/yr SR ${((mt/st)*Math.sqrt(252)).toFixed(2)}`);
    else console.log(`      ${" ".repeat(16)} @${bp}bp/day: ${((m-c)*252*100).toFixed(1)}%/yr  TEST ${((mt-c)*252*100).toFixed(1)}%/yr`);}
}
