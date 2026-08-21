#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-panel-funding.ts (D-440) — Binance funding history for EVERY perp in the order-flow panel.
// Needed because a cross-sectional perp book pays real funding: a long leg pays funding when it is positive and a short
// leg receives it. Ignoring that would flatter every long-short result, and funding in crypto is not a rounding error —
// it ran +24 to +32%/yr in 2021 (D-433). This makes the cross-sectional test the most realistically-costed in the program.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"pf2",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const have=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const done=new Set((await fetch(`${OWNED}/trd_perp_oi?interval=eq.funding&venue=eq.binance&select=symbol`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string}[]).map(r=>r.symbol));
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
let n=0;
for(const s of have){
  const base=s.symbol.replace(/USDT$/,"");
  if(done.has(base)||done.has(s.symbol))continue;          // already stored under the base ticker by D-436
  let start=Date.parse("2019-09-01T00:00:00Z"), got=0;
  for(let g=0;g<40;g++){
    const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${s.symbol}&startTime=${start}&limit=1000`).then(r=>r.json()).catch(()=>null);
    await sleep(130); if(!Array.isArray(j)||!j.length)break;
    for(const x of j as {fundingTime:number;fundingRate:string}[]){
      const r=Number(x.fundingRate); if(!Number.isFinite(r))continue;
      rows.push({symbol:s.symbol,venue:"binance",interval:"funding",ts:Math.floor(x.fundingTime/1000),open_interest:r}); got++;}
    if(j.length<1000)break; start=Number((j[j.length-1] as {fundingTime:number}).fundingTime)+1;
  }
  n++; console.log(`  ${s.symbol.padEnd(14)} ${String(got).padStart(6)} funding intervals`);
}
for(let i=0;i<rows.length;i+=3000){
  const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+3000))});
  if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,150)}`);Deno.exit(1);}
}
console.log(`==> ${rows.length.toLocaleString()} funding intervals for ${n} perps`);
