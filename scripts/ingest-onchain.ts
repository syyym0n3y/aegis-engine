#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-onchain.ts (D-438) — BITCOIN ON-CHAIN FUNDAMENTALS, 2009-2026, free and keyless (blockchain.info, allowlisted).
// This is the last genuinely large untested dataset in the stack, and it is a different KIND of data from everything tried
// so far: not price, not derivatives positioning, but the settlement layer itself — how much value actually moved, how many
// addresses transacted, what miners earned. It is the closest thing crypto has to a fundamental, and Aegis has never held it.
// ~6,400 daily observations per series back to 2009 (vs Yahoo crypto starting 2014).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"oc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const CHARTS=["market-price","market-cap","estimated-transaction-volume-usd","n-transactions","miners-revenue","hash-rate","n-unique-addresses"];
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
for(const c of CHARTS){
  const j=await fetch(`https://api.blockchain.info/charts/${c}?timespan=all&format=json&sampled=false`).then(r=>r.json()).catch(()=>null) as {values?:{x:number;y:number}[]}|null;
  await sleep(400);
  const v=j?.values;
  if(!Array.isArray(v)||!v.length){console.error(`!! ${c}: no data — recording nothing rather than a zero`);continue;}
  let n=0;
  for(const p of v){ if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
    rows.push({symbol:"BTC",venue:"blockchain.info",interval:c,ts:p.x,open_interest:p.y}); n++; }
  console.log(`  ${c.padEnd(34)} ${String(n).padStart(5)} pts  ${new Date(v[0].x*1000).toISOString().slice(0,10)} .. ${new Date(v[v.length-1].x*1000).toISOString().slice(0,10)}`);
}
for(let i=0;i<rows.length;i+=3000){
  const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+3000))});
  if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,160)}`);Deno.exit(1);}
}
const back=await fetch(`${OWNED}/trd_perp_oi?venue=eq.blockchain.info&select=symbol`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${rows.length.toLocaleString()} on-chain points sent; DB re-read confirms ${cnt.toLocaleString()}`);
if(cnt<rows.length*0.95){console.error("!! writes did NOT land");Deno.exit(1);}
