#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-finra-si.ts (D-475) — FINRA consolidated semi-monthly SHORT INTEREST, per symbol, via the public API.
// The dataset whose absence produced D-391's "underpowered, 26 settlements" — while this endpoint was allowlisted.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fsi",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// D-987: THIS INGEST WAS ORPHANED — nothing scheduled it, so trd_short_interest froze at settlement 2026-07-31 while
// the DEPLOYED distress sleeve's CROWD_DC filter (D-971, days-to-cover at SI_LAG_D=14) kept reading it: from 2026-09-23
// the "point-in-time" crowding it avoided was 2.5 months old. Found by the basket register's freshness probes. Now
// wired into the nightly runner and watched by continuity-guard. INCREMENTAL by default: only settlements on/after the
// newest one held (FINRA compareFilters GREATER, verified on 2026-10-15 to return 2026-08-14 rows past 2026-07-31);
// FULL=1 re-pulls the whole history (~3.9M rows) as before.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K=declareKnobs("ingest-finra-si",[{name:"FULL",def:"0",note:"1 = re-pull every settlement (the original behaviour)"}]);
const newest=await fetch(`${OWNED}/trd_short_interest?select=settlement&order=settlement.desc&limit=1`,{headers:hdr}).then(r=>r.ok?r.json():null).catch(()=>null);  // plumbing-ok: a null (failed read) is checked on the next line and exits RED — never read as "no rows"
if(!Array.isArray(newest)){console.error("!! cannot read trd_short_interest — refusing to guess the increment");Deno.exit(1);}
const since=K.FULL==="1"||!newest.length?null:new Date(Date.parse(newest[0].settlement+"T00:00:00Z")-86400e3).toISOString().slice(0,10);
console.log(`  mode: ${since?`incremental — settlements after ${since} (re-pulls the newest held settlement ${newest[0].settlement})`:"FULL history"}`);
let total=0, offset=0;
for(let page=0;page<3000;page++){
  const j=await fetch("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest",{method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify(since?{limit:5000,offset,compareFilters:[{compareType:"GREATER",fieldName:"settlementDate",fieldValue:since}]}:{limit:5000,offset})}).then(r=>r.ok?r.json():null).catch(()=>null);
  await sleep(250);
  if(!Array.isArray(j)||!j.length)break;
  const rows=j.map((r:Record<string,unknown>)=>({
    settlement:r.settlementDate, symbol:r.symbolCode,
    short_qty:Math.round(+(r.currentShortPositionQuantity as number)||0),
    adv_qty:r.averageDailyVolumeQuantity!=null?Math.round(+(r.averageDailyVolumeQuantity as number)):null,
    days_cover:r.daysToCoverQuantity!=null?+(r.daysToCoverQuantity as number):null,
  })).filter(r=>r.settlement&&r.symbol);
  const res=await fetch(`${OWNED}/trd_short_interest?on_conflict=settlement,symbol`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)}).catch(()=>null);
  if(!res||!res.ok){console.log(`WRITE-FAILED trd_short_interest ${res?res.status:"net"} @${offset}`);Deno.exit(1);}
  total+=rows.length; offset+=j.length;
  if(page%20===0)console.log(`  ..${total.toLocaleString()} rows (offset ${offset})`);
  if(j.length<5000)break;
}
const back=await fetch(`${OWNED}/trd_short_interest?select=symbol&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${total.toLocaleString()} sent; DB confirms ${cnt.toLocaleString()}`);
const span=await fetch(`${OWNED}/trd_short_interest?select=settlement&order=settlement&limit=1`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
const span2=await fetch(`${OWNED}/trd_short_interest?select=settlement&order=settlement.desc&limit=1`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
console.log(`    span: ${span[0]?.settlement} .. ${span2[0]?.settlement}`);
