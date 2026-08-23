#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-auctions.ts (D-502) — full Treasury auction history via fiscaldata (1979->). Idempotent upserts.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"au",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const BASE="https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
let page=1,total=0;
for(;;){
  const url=`${BASE}?fields=cusip,auction_date,security_type,security_term,bid_to_cover_ratio,high_yield,offering_amt&page%5Bsize%5D=1000&page%5Bnumber%5D=${page}`;
  const res=await fetch(url).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!res||!Array.isArray(res.data)||!res.data.length)break;
  const rows=res.data.map((r:Record<string,string>)=>({
    cusip:r.cusip,auction_date:r.auction_date,security_type:r.security_type,security_term:r.security_term,
    bid_to_cover:r.bid_to_cover_ratio==="null"||r.bid_to_cover_ratio==null?null:+r.bid_to_cover_ratio,
    high_yield:r.high_yield==="null"||r.high_yield==null?null:+r.high_yield,
    offering_amt:r.offering_amt==="null"||r.offering_amt==null?null:+r.offering_amt,
  })).filter((r:{cusip?:string;auction_date?:string})=>r.cusip&&r.auction_date);
  // dedupe within batch on the PK to avoid ON CONFLICT double-hit
  const seen=new Set<string>(); const uniq=rows.filter((r:{cusip:string;auction_date:string})=>{const k=r.cusip+r.auction_date;if(seen.has(k))return false;seen.add(k);return true;});
  const w=await fetch(`${OWNED}/trd_auctions?on_conflict=cusip,auction_date`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(uniq)}).catch(()=>null);
  if(!w||!w.ok){console.log(`WRITE-FAILED trd_auctions ${w?w.status:"net"} page ${page}`);Deno.exit(1);}
  total+=uniq.length; if(page%5===0)console.log(`  ..page ${page}: ${total.toLocaleString()}`);
  if(res.data.length<1000)break;
  page++;
}
const back=await fetch(`${OWNED}/trd_auctions?select=cusip&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
console.log(`==> ${total.toLocaleString()} sent; DB holds ${(back.headers.get("content-range")||"").split("/")[1]} auction rows`);
