#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// check-dispersion-mechanism.ts (D-579) — IS DISPERSION THE MISSING MECHANISM?
// D-577 refuted arbitrage-thinness; D-578 showed the crypto result is distinctive to the asset class at equal breadth.
// The remaining candidate: every signal in the set (low-vol, anti-lottery, momentum, 52w-high) is a RANKING signal,
// and a ranking signal needs cross-sectional SPREAD between names to have anything to rank. Crypto runs 3-8x the
// volatility of the null asset classes.
// TWO TESTS: (a) ACROSS asset classes — does mean dispersion order with measured book Sharpe? (b) WITHIN crypto —
// do high-dispersion months produce higher book returns? Test (b) is the causal one; (a) can only be suggestive with
// four data points, and that limit is stated rather than glossed.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"dm",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const corr=(a:number[],b:number[])=>{const ma=mean(a),mb=mean(b);let nu=0,d1=0,d2=0;
  for(let i=0;i<a.length;i++){nu+=(a[i]-ma)*(b[i]-mb);d1+=(a[i]-ma)**2;d2+=(b[i]-mb)**2;}
  return d1&&d2?nu/Math.sqrt(d1*d2):0;};
const loadDeep=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[]))if(b[4]>0)m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const monthly=(px:Map<string,number>)=>{
  const out=new Map<string,number>(); const days=[...px.keys()].sort();
  let lastMo="",lastPx=0;
  for(const d of days){const mo=d.slice(0,7);
    if(mo!==lastMo){ if(lastMo&&lastPx>0) out.set(lastMo,px.get(days[days.indexOf(d)-1])!/lastPx-1); lastMo=mo; lastPx=px.get(d)!; }}
  return out;};
const disp=async(univ:string[],label:string)=>{
  const ms:Map<string,number>[]=[];
  for(const s of univ){const p=await loadDeep(s); if(p.size>400)ms.push(monthly(p));}
  const allMo=[...new Set(ms.flatMap(m=>[...m.keys()]))].sort();
  const d:number[]=[];
  for(const mo of allMo){
    const v=ms.map(m=>m.get(mo)).filter(x=>x!==undefined) as number[];
    if(v.length>=8)d.push(sdv(v));
  }
  return {label,n:ms.length,months:d.length,meanDisp:mean(d)};
};
console.log("==> (a) DISPERSION ACROSS ASSET CLASSES vs measured book Sharpe");
const rows=[
  {...await disp(["CL=F","NG=F","GC=F","SI=F","HG=F","PL=F","PA=F","ZC=F","ZW=F","ZS=F","KC=F","SB=F","CC=F","CT=F","LE=F","HE=F"],"commodities"),sr:0.02},
  {...await disp(["USDBRL=X","USDMXN=X","USDZAR=X","USDTRY=X","USDINR=X","USDKRW=X","USDCNY=X","AUDUSD=X","NZDUSD=X","GBPUSD=X","EURUSD=X","JPY=X","CAD=X","CHF=X"],"EM+major FX"),sr:0.05},
  {...await disp(["SPY","QQQ","IWM","DIA","EEM","EFA","VGK","EWJ","XLF","XLK","XLE","XLU","XLP","XLI","XLV","XLY","TLT","IEF","HYG","LQD","JNK","GLD"],"ETFs"),sr:-0.17},
];
// crypto dispersion from the hourly/daily panel
{const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,bars&order=symbol&limit=600`,{headers:hdr}).then(r=>r.json()) as {symbol:string;bars:number[][]}[];
 const ms:Map<string,number>[]=[];
 for(const m of meta.slice(0,60)){
   const p=new Map<string,number>();
   for(const b of (m.bars||[]))if(b[4]>0)p.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
   if(p.size>400)ms.push(monthly(p));
 }
 const allMo=[...new Set(ms.flatMap(m=>[...m.keys()]))].sort();
 const d:number[]=[];
 for(const mo of allMo){const v=ms.map(m=>m.get(mo)).filter(x=>x!==undefined) as number[]; if(v.length>=8)d.push(sdv(v));}
 rows.push({label:"crypto perps",n:ms.length,months:d.length,meanDisp:mean(d),sr:1.18});}
console.log(`    ${"asset class".padEnd(16)}${"names".padEnd(7)}${"months".padEnd(8)}${"mean monthly dispersion".padEnd(25)}measured book SR`);
for(const r of rows.sort((a,b)=>a.meanDisp-b.meanDisp))
  console.log(`    ${r.label.padEnd(16)}${String(r.n).padEnd(7)}${String(r.months).padEnd(8)}${(r.meanDisp*100).toFixed(1).padEnd(25)}%${r.sr.toFixed(2).padStart(6)}`);
const dd=rows.map(r=>r.meanDisp), ss=rows.map(r=>r.sr);
console.log(`    rank order of dispersion vs Sharpe: corr ${corr(dd,ss).toFixed(2)} across ${rows.length} classes — SUGGESTIVE ONLY, n=4`);
console.log("\n==> (b) WITHIN CRYPTO — do high-dispersion months pay more? (the causal test)");
const raw=await Deno.readTextFile("/Users/ona/aegis-data/crypto_books_1dSF_lit5_top50_lag1_hold5.tsv").catch(()=>"");
if(!raw){console.log("    book stream missing");Deno.exit(0);}
const byMo=new Map<string,number[]>();
for(const l of raw.trim().split("\n")){const f=l.split("\t"); const v=+f[5]; if(f[0]&&Number.isFinite(v))(byMo.get(f[0].slice(0,7))??byMo.set(f[0].slice(0,7),[]).get(f[0].slice(0,7))!).push(v);}
const meta2=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,bars&order=symbol&limit=600`,{headers:hdr}).then(r=>r.json()) as {symbol:string;bars:number[][]}[];
const mret:Map<string,number>[]=[];
for(const m of meta2.slice(0,60)){
  const p=new Map<string,number>();
  for(const b of (m.bars||[]))if(b[4]>0)p.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  if(p.size>400)mret.push(monthly(p));
}
const pairs:{d:number;r:number}[]=[];
for(const [mo,rs] of byMo){
  if(rs.length<15)continue;
  const v=mret.map(m=>m.get(mo)).filter(x=>x!==undefined) as number[];
  if(v.length<8)continue;
  pairs.push({d:sdv(v),r:rs.reduce((s,x)=>s+x,0)});
}
if(pairs.length<24){console.log(`    only ${pairs.length} months — UNTESTED`);Deno.exit(0);}
const c=corr(pairs.map(p=>p.d),pairs.map(p=>p.r));
const t=c*Math.sqrt((pairs.length-2)/(1-c*c));
const sorted=[...pairs].sort((a,b)=>a.d-b.d);
const lo=sorted.slice(0,Math.floor(sorted.length/3)), hi=sorted.slice(-Math.floor(sorted.length/3));
console.log(`    ${pairs.length} months. corr(dispersion, book return) = ${c.toFixed(3)}  t ${t.toFixed(2)}`);
console.log(`    LOW-dispersion third:  mean dispersion ${(mean(lo.map(p=>p.d))*100).toFixed(1)}%  ->  book ${(mean(lo.map(p=>p.r))*12*100/1).toFixed(1)}%/yr equivalent`);
console.log(`    HIGH-dispersion third: mean dispersion ${(mean(hi.map(p=>p.d))*100).toFixed(1)}%  ->  book ${(mean(hi.map(p=>p.r))*12*100/1).toFixed(1)}%/yr equivalent`);
console.log(`    -> ${t>2?"DISPERSION DRIVES THE EDGE — the mechanism is supported":t<-2?"INVERSE relationship — mechanism refuted in the opposite direction":"NO significant within-crypto relationship — dispersion is NOT the mechanism"}`);
