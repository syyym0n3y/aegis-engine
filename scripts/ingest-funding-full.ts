#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-funding-full.ts (D-549) — funding-rate history for the FULL perp universe, not the 25 symbols we happened to
// hold. Funding is the defining economic feature of perpetual futures (the mechanism that tethers them to spot) and
// the clearest carry signal in the asset class; testing it on 25 of ~500 contracts would be a Coverage Law violation
// dressed as a market finding. Binance /fapi/v1/fundingRate, paginated backwards, sequential, allowlisted.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fu",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// universe = the survivorship-free panel we actually model on
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=600`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const have=new Set<string>();
{const r=await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&select=symbol`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {symbol:string}[];
 for(const x of (Array.isArray(r)?r:[]))have.add(x.symbol);}
console.log(`==> FUNDING BACKFILL — ${meta.length} modelled contracts, ${have.size} already held`);
const SINCE=Date.parse("2021-01-01T00:00:00Z");
let done=0,rowsTotal=0,skipped=0;
for(const m of meta){
  const sym=m.symbol;
  let start=SINCE, all:{ts:number;rate:number}[]=[], guard=0;
  for(;;){
    if(guard++>40)break;
    const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${start}&limit=1000`).then(r=>r.ok?r.json():null).catch(()=>null);
    await sleep(160);
    if(!Array.isArray(j)||!j.length)break;
    for(const x of j as {fundingTime:number;fundingRate:string}[]){
      const v=+x.fundingRate; if(!Number.isFinite(v))continue;
      all.push({ts:Math.floor(x.fundingTime/1000),rate:v});
    }
    const last=(j as {fundingTime:number}[])[j.length-1].fundingTime;
    if(j.length<1000||last<=start)break;
    start=last+1;
  }
  if(all.length<200){skipped++;continue;}
  // dedupe by ts, then write in chunks
  const seen=new Set<number>(); const rows=all.filter(r=>{if(seen.has(r.ts))return false;seen.add(r.ts);return true;})
    .map(r=>({symbol:sym,venue:"binance",interval:"funding",ts:r.ts,open_interest:r.rate}));
  for(let i=0;i<rows.length;i+=5000){
    const w=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+5000))}).catch(()=>null);
    if(!w||!w.ok){console.log(`WRITE-FAILED ${sym} ${w?w.status:"net"}`);break;}
  }
  rowsTotal+=rows.length; done++;
  if(done%25===0)console.log(`  ..${done} symbols, ${rowsTotal.toLocaleString()} funding rows`);
}
console.log(`==> ${done} symbols backfilled (${rowsTotal.toLocaleString()} rows), ${skipped} skipped (<200 records)`);
