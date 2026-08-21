#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-dvol.ts (D-434) — Deribit DVOL, the crypto VIX. Newly reachable (operator allowlisted Deribit).
// WHY THIS IS THE RIGHT LAST TEST: the two things this program found that ever genuinely paid (D-431 basis, D-433 funding)
// were CARRY — structural premia requiring no forecast — and both were competed away. The VARIANCE RISK PREMIUM is the
// third member of that family and the largest untested one: option buyers systematically overpay for insurance, and the
// seller collects the difference between implied and subsequently-realised volatility. In equities this was the single
// strongest premium Aegis measured (D-404, t=48.8) — and it lost 83% in ONE DAY, which is the whole story of selling
// insurance. Crypto VRP is documented as substantially larger, which means the tail should be worse, not better.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"dv",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const D="https://www.deribit.com/api/v2/public";
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
for(const cur of ["BTC","ETH"]){
  const seen=new Map<number,number>();
  // walk backwards a year at a time; the reachable span is MEASURED, never assumed (COVERAGE LAW)
  let end=Date.now();
  for(let page=0;page<10;page++){
    const start=end-365*86400000;
    const j=await fetch(`${D}/get_volatility_index_data?currency=${cur}&start_timestamp=${start}&end_timestamp=${end}&resolution=43200`).then(r=>r.json()).catch(()=>null) as {result?:{data?:number[][]}}|null;
    await sleep(150);
    const data=j?.result?.data;
    if(!Array.isArray(data)||!data.length)break;
    for(const d of data){const ts=Math.floor(d[0]/1000), close=d[4];
      if(Number.isFinite(ts)&&Number.isFinite(close)&&close>0)seen.set(ts,close);}
    end=start;
  }
  for(const [ts,v] of seen) rows.push({symbol:cur,venue:"deribit",interval:"dvol",ts,open_interest:v});
  const t=[...seen.keys()];
  console.log(`  ${cur} DVOL: ${seen.size} points  ${t.length?new Date(Math.min(...t)*1000).toISOString().slice(0,10):"-"} .. ${t.length?new Date(Math.max(...t)*1000).toISOString().slice(0,10):"-"}`);
}
for(let i=0;i<rows.length;i+=2000){
  const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+2000))});
  if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,160)}`);Deno.exit(1);}
}
const back=await fetch(`${OWNED}/trd_perp_oi?interval=eq.dvol&select=symbol`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${rows.length.toLocaleString()} DVOL points sent; DB re-read confirms ${cnt.toLocaleString()}`);
if(cnt<rows.length*0.95){console.error("!! writes did NOT land");Deno.exit(1);}
