#!/usr/bin/env -S deno run --allow-net --allow-env
// vrp.ts (D-404) — the VOLATILITY RISK PREMIUM, the one documented premium never tested here. Claim: implied vol (VIX)
// systematically exceeds subsequent realised vol, so SELLING volatility is paid. It is among the most robust premia in the
// literature — AND the one with the most famous catastrophic tail (XIV lost ~96% in a single day, 5 Feb 2018).
// So this test measures BOTH halves honestly:
//   1. Does the premium exist? VIX_t vs realised vol over [t, t+21]. Magnitude, hit rate, per-regime.
//   2. Is it harvestable? SVXY (short-vol ETF) returns INCLUDING Feb-2018 — mean, Sharpe, and the WORST DAY/drawdown.
// A premium with a -96% day is not a free lunch; the tail is the finding, not a footnote.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vrp",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const get=async(s:string)=>{const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(s)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]);return Array.isArray(r)&&r.length?r[0].bars as number[][]:null;};
const vix=await get("^VIX"), spy=await get("SPY");
if(!vix||!spy){console.log("missing VIX/SPY");Deno.exit(0);}
const vm=new Map<string,number>(vix.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]));
const sm=new Map<string,number>(spy.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]));
const dates=[...sm.keys()].filter(d=>vm.has(d)).sort();
console.log(`==> VOLATILITY RISK PREMIUM — ${dates.length} overlapping days (${dates[0]} .. ${dates[dates.length-1]})`);
// 1. THE PREMIUM: implied (VIX) vs subsequent 21d realised vol of SPY
const HZ=21; const prem:{d:string;iv:number;rv:number;vrp:number}[]=[];
for(let i=0;i<dates.length-HZ;i++){
  const iv=vm.get(dates[i])!; const rets:number[]=[];
  for(let k=i+1;k<=i+HZ;k++){const p0=sm.get(dates[k-1])!,p1=sm.get(dates[k])!; if(p0>0)rets.push(Math.log(p1/p0));}
  if(rets.length<HZ-2||!(iv>0))continue;
  const rv=Math.sqrt(rets.reduce((s,x)=>s+x*x,0)/rets.length*252)*100;
  prem.push({d:dates[i],iv,rv,vrp:iv-rv});
}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const v=prem.map(p=>p.vrp);
console.log(`\n  1. DOES THE PREMIUM EXIST?`);
console.log(`     mean VIX ${mean(prem.map(p=>p.iv)).toFixed(1)}  vs  mean subsequent 21d realised ${mean(prem.map(p=>p.rv)).toFixed(1)}`);
console.log(`     VRP = ${mean(v).toFixed(2)} vol points (t ${tst(v).toFixed(1)}), positive on ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}% of days, n=${v.length}`);
const sp=Math.floor(prem.length*0.6);
console.log(`     TRAIN ${mean(v.slice(0,sp)).toFixed(2)}  |  TEST ${mean(v.slice(sp)).toFixed(2)}  <- persists?`);
// by VIX regime — the premium is claimed to be regime-dependent
console.log(`\n     by VIX level (is the premium bigger when fear is high?):`);
const byLevel=[[0,15],[15,20],[20,30],[30,100]] as [number,number][];
for(const [lo,hi] of byLevel){const s=prem.filter(p=>p.iv>=lo&&p.iv<hi); if(s.length<100)continue;
  const sv=s.map(p=>p.vrp);
  console.log(`       VIX ${String(lo).padStart(2)}-${String(hi).padEnd(3)}: VRP ${mean(sv).toFixed(2)} pts (t ${tst(sv).toFixed(1)}), positive ${(100*sv.filter(x=>x>0).length/sv.length).toFixed(0)}%, n=${s.length}`);}
// 2. IS IT HARVESTABLE? SVXY (short-vol ETF), including Feb-2018
const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SVXY?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.json());
const res=j?.chart?.result?.[0]; const sv:number[][]=[];
if(res?.timestamp){const q=res.indicators.quote[0];
  for(let i=0;i<res.timestamp.length;i++){const c=q.close[i]; if(c!=null&&Number.isFinite(c)) sv.push([res.timestamp[i],c]);}}
console.log(`\n  2. IS IT HARVESTABLE? SVXY (short-vol ETF), ${sv.length} bars`);
if(sv.length>200){
  const r:number[]=[]; const rd:string[]=[];
  for(let i=1;i<sv.length;i++){if(sv[i-1][1]>0){const x=sv[i][1]/sv[i-1][1]-1; if(Number.isFinite(x)){r.push(x);rd.push(new Date(sv[i][0]*1000).toISOString().slice(0,10));}}}
  const m=mean(r), sd=Math.sqrt(r.reduce((s,x)=>s+(x-m)**2,0)/(r.length-1));
  let cum=1,peak=1,dd=0; for(const x of r){cum*=1+x;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  const worst=r.reduce((a,b,i)=>b<r[a]?i:a,0);
  const sk=r.reduce((s,x)=>s+((x-m)/sd)**3,0)/r.length;
  console.log(`     ann return ${(m*252*100).toFixed(1)}%  Sharpe ${((m/sd)*Math.sqrt(252)).toFixed(2)}  vol ${(sd*Math.sqrt(252)*100).toFixed(0)}%`);
  console.log(`     maxDD ${(dd*100).toFixed(1)}%   WORST DAY ${(r[worst]*100).toFixed(1)}% on ${rd[worst]}   skew ${sk.toFixed(2)}`);
  // the honest split: before vs after the Feb-2018 blowup (SVXY also cut leverage -1x -> -0.5x then, a structural break)
  const bi=rd.findIndex(d=>d>="2018-02-05");
  if(bi>50){const pre=r.slice(0,bi), post=r.slice(bi);
    const st=(a:number[])=>{const mm=mean(a);const ss=Math.sqrt(a.reduce((s,x)=>s+(x-mm)**2,0)/(a.length-1));let c=1,p=1,d2=0;for(const x of a){c*=1+x;p=Math.max(p,c);d2=Math.min(d2,c/p-1);}return `ann ${(mm*252*100).toFixed(0)}% SR ${((mm/ss)*Math.sqrt(252)).toFixed(2)} maxDD ${(d2*100).toFixed(0)}%`;};
    console.log(`     PRE-2018-02-05 : ${st(pre)}   (n=${pre.length})`);
    console.log(`     POST           : ${st(post)}   (n=${post.length})  [SVXY also cut leverage -1x -> -0.5x here: structural break]`);}
}
