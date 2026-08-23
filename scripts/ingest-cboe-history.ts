#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-cboe-history.ts (D-475) — CBOE's published daily index histories: SKEW (tail-risk pricing), the VIX term
// structure family, VVIX (vol-of-vol). Decades of daily closes in clean CSVs, reachable the entire session, never taken.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cbh",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const IDX=["SKEW","VIX9D","VIX3M","VIX6M","VVIX","VXN","RVX","GVZ","OVX","VXAPL"];
let total=0;
for(const name of IDX){
  const txt=await fetch(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${name}_History.csv`).then(r=>r.ok?r.text():null).catch(()=>null);
  await sleep(300);
  if(!txt){console.log(`  ${name}: unavailable — recorded, not silent`);continue;}
  const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
  for(const line of txt.split("\n").slice(1)){
    const p=line.split(","); if(p.length<2)continue;
    const d=Date.parse(p[0]); const close=parseFloat(p[p.length-1]);
    if(!Number.isFinite(d)||!Number.isFinite(close)||close<=0)continue;
    rows.push({symbol:name,venue:"cboe",interval:"index_close",ts:Math.floor(d/1000),open_interest:close});
  }
  if(rows.length<100){console.log(`  ${name}: only ${rows.length} rows — skipped`);continue;}
  for(let i=0;i<rows.length;i+=3000){
    const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+3000))}).catch(()=>null);
    if(!res||!res.ok){console.log(`WRITE-FAILED ${name} ${res?res.status:"net"}`);Deno.exit(1);}
  }
  total+=rows.length;
  console.log(`  ${name.padEnd(7)} ${String(rows.length).padStart(6)} days  ${new Date(rows[0].ts*1000).toISOString().slice(0,10)} .. ${new Date(rows[rows.length-1].ts*1000).toISOString().slice(0,10)}`);
}
const back=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.index_close&select=symbol&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
console.log(`==> ${total.toLocaleString()} sent; DB confirms ${+((back.headers.get("content-range")||"").split("/")[1]||0)}`);
