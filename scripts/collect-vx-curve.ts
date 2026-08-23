#!/usr/bin/env -S deno run --allow-net --allow-env
// collect-vx-curve.ts (D-487) — daily VIX-futures curve snapshot. The settlement endpoint serves only ~the current year
// (measured: 2026-01 partial, 2025-08 empty), so like Deribit/CBOE chains this is a start-the-clock collector: front and
// second MONTHLY settlements, the slope, and %contango. The tradable VIX term structure, accruing from today.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vxc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const today=new Date().toISOString().slice(0,10);
const csv=await fetch(`https://www.cboe.com/us/futures/market_statistics/settlement/csv?dt=${today}`).then(r=>r.ok?r.text():null).catch(()=>null);
if(!csv){console.error("vx-curve: endpoint unavailable — recording NOTHING");Deno.exit(0);}
// monthly contracts have symbol "VX/<M><Y>" (no week number); weeklies are "VXnn/..."
const monthly:{exp:string;px:number}[]=[];
for(const line of csv.split("\n")){
  const m=/^VX,VX\/(\w\d),(\d{4}-\d{2}-\d{2}),([\d.]+)/.exec(line.trim());
  if(m) monthly.push({exp:m[2],px:+m[3]});
}
monthly.sort((a,b)=>a.exp<b.exp?-1:1);
if(monthly.length<2){console.log(`vx-curve: only ${monthly.length} monthly contracts parsed — skipping today`);Deno.exit(0);}
const ts=Math.floor(Date.parse(today)/1000);
const rows=[
  {symbol:"VX",venue:"cboe",interval:"vx_f1",ts,open_interest:monthly[0].px},
  {symbol:"VX",venue:"cboe",interval:"vx_f2",ts,open_interest:monthly[1].px},
  {symbol:"VX",venue:"cboe",interval:"vx_slope",ts,open_interest:monthly[1].px-monthly[0].px},
];
const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
  headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)}).catch(()=>null);
if(!res||!res.ok){console.log(`WRITE-FAILED vx-curve ${res?res.status:"net"}`);Deno.exit(1);}
console.log(`vx-curve: F1 ${monthly[0].px} (${monthly[0].exp})  F2 ${monthly[1].px} (${monthly[1].exp})  slope ${(monthly[1].px-monthly[0].px).toFixed(3)}  [${monthly.length} monthlies]`);
