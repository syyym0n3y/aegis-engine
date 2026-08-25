#!/usr/bin/env -S deno run --allow-net --allow-env
// check-crypto-vrp.ts (D-572) — THE VARIANCE RISK PREMIUM IN CRYPTO.
// Why this is worth a trial when I have just warned about search inflation: VRP is the ONE premium this programme has
// ever confirmed (equities, corrected t 12.6, D-427) and it is the only candidate with a mechanism that explains why
// it should persist — it is compensation for crash risk, not an inefficiency that arbitrage removes. Testing a
// confirmed mechanism in a second asset class is replication, not a new search.
// PRE-REGISTERED SIGN (from the equity literature and D-427): implied variance EXCEEDS subsequent realised variance,
// so selling volatility pays. A negative result would be as informative as a positive one.
// Data: Deribit DVOL (crypto's VIX analogue) 2021-03 -> 2026-08 for BTC and ETH, against realised variance of the
// underlying over the FOLLOWING 30 days. Non-overlapping monthly windows only — overlapping windows would inflate n
// ~30x and the t with it (pseudo-replication law).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vr",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const dv=await fetch(`${OWNED}/trd_perp_oi?venue=eq.deribit&interval=eq.dvol&select=symbol,ts,open_interest&order=symbol,ts&limit=20000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;ts:number;open_interest:number}[];
const iv=new Map<string,Map<string,number>>();
for(const r of dv){
  const d=new Date(r.ts*1000).toISOString().slice(0,10);
  (iv.get(r.symbol)??iv.set(r.symbol,new Map()).get(r.symbol)!).set(d,+r.open_interest);
}
console.log(`==> CRYPTO VARIANCE RISK PREMIUM (D-572) — DVOL series: ${[...iv.entries()].map(([k,v])=>`${k} ${v.size}d`).join(", ")}`);
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.${sym}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[]))if(b[4]>0)m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const MAP:[string,string][]=[["BTC","BTCUSDT"],["ETH","ETHUSDT"]];
for(const [dvolSym,perp] of MAP){
  const ivm=iv.get(dvolSym); if(!ivm){console.log(`    ${dvolSym}: no DVOL`);continue;}
  const px=await load(perp);
  const days=[...px.keys()].sort();
  const idx=new Map(days.map((d,i)=>[d,i]));
  // NON-OVERLAPPING 30-day windows
  const prem:number[]=[]; const dates:string[]=[];
  for(let i=0;i+30<days.length;i+=30){
    const d0=days[i];
    const ivv=ivm.get(d0); if(ivv===undefined||!(ivv>0))continue;
    const impliedVar=Math.pow(ivv/100,2)*(30/365);              // 30-day implied variance
    let rv=0,n=0;
    for(let k=i+1;k<=i+30;k++){
      const a=px.get(days[k]),b=px.get(days[k-1]);
      if(a===undefined||b===undefined)continue;
      const r=Math.log(a/b); rv+=r*r; n++;
    }
    if(n<20)continue;
    const realisedVar=rv;                                        // sum of squared log returns over the window
    prem.push(impliedVar-realisedVar); dates.push(d0);
  }
  if(prem.length<20){console.log(`    ${dvolSym}: only ${prem.length} non-overlapping windows — UNTESTED`);continue;}
  const m=mean(prem),sd=sdv(prem)||1e-9,t=m/(sd/Math.sqrt(prem.length));
  const win=prem.filter(x=>x>0).length;
  // express as an annualised return on a variance-swap notional (stated approximation)
  const annPct=m*(365/30)*100;
  console.log(`    ${dvolSym}: ${prem.length} non-overlapping 30d windows (${dates[0]} .. ${dates.at(-1)})`);
  console.log(`      mean premium ${(m*1e4).toFixed(1)} var-points  t ${t.toFixed(2)}  positive in ${win}/${prem.length} (${(100*win/prem.length).toFixed(0)}%)  ~${annPct.toFixed(1)}%/yr on variance notional`);
  console.log(`      -> ${t>=2?"PREMIUM PRESENT with the pre-registered sign":t<=-2?"PREMIUM INVERTED (prereg MISS)":"no significant premium at this power"}`);
}
console.log(`\n    POWER NOTE: only 2 instruments and ~${Math.floor(2000/30)} non-overlapping windows each. Overlapping windows would`);
console.log(`    inflate n ~30x and are forbidden. This is a THIN test by construction — a null here is weak evidence.`);
