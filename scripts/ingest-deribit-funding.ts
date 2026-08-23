#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-deribit-funding.ts (D-479) — Deribit perpetual funding (BTC/ETH), the THIRD venue for the funding family.
// interest_8h sampled at the 8h boundaries; achieved span MEASURED (2019 returns empty) and reported.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"dbf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
for(const inst of ["BTC-PERPETUAL","ETH-PERPETUAL"]){
  const sym=inst.split("-")[0];
  const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
  let t0=Date.parse("2020-01-01T00:00:00Z");
  while(t0<Date.now()){
    const t1=t0+30*86400000;
    const j=await fetch(`https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${inst}&start_timestamp=${t0}&end_timestamp=${t1}`).then(r=>r.json()).catch(()=>null) as {result?:{timestamp:number;interest_8h:number}[]}|null;
    await sleep(180);
    for(const r of j?.result??[]){
      const ts=Math.floor(r.timestamp/1000);
      if(ts%28800!==0)continue;                               // 8h boundaries only
      if(Number.isFinite(r.interest_8h)) rows.push({symbol:sym,venue:"deribit",interval:"funding",ts,open_interest:r.interest_8h});
    }
    t0=t1;
  }
  for(let i=0;i<rows.length;i+=2000){
    const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+2000))}).catch(()=>null);
    if(!res||!res.ok){console.log(`WRITE-FAILED deribit-funding ${res?res.status:"net"}`);Deno.exit(1);}
  }
  console.log(`  ${sym}: ${rows.length} settlements ${rows.length?new Date(rows[0].ts*1000).toISOString().slice(0,10):"-"} .. ${rows.length?new Date(rows[rows.length-1].ts*1000).toISOString().slice(0,10):"-"}`);
}
console.log("==> deribit funding landed");
