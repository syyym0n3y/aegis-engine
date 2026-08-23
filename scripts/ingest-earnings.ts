#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-earnings.ts (D-479) — Nasdaq earnings calendar, day by day, 2017->now: actual EPS + consensus + % surprise.
// The input D-393's PEAD test never had. Sequential, polite, landing-verified, WRITE-FAILED loud.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ern",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const num=(x:unknown)=>{if(x==null)return null;const v=parseFloat(String(x).replace(/[$,()]/g,m=>m==="("?"-":""));return Number.isFinite(v)?v:null;};
const FROM=Deno.env.get("FROM")||"2017-01-02";
let d=new Date(FROM+"T00:00:00Z"); const end=new Date();
let days=0,rows=0,misses=0;
while(d<=end){
  const dow=d.getUTCDay(); const ds=d.toISOString().slice(0,10);
  d=new Date(d.getTime()+86400000);
  if(dow===0||dow===6)continue;
  let j=null;
  for(let a=0;a<2;a++){
    j=await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${ds}`,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(j)break; await sleep(1200);
  }
  await sleep(320);
  const rs=(j?.data?.rows??[]) as Record<string,string>[];
  if(!rs.length){misses++;continue;}
  const out=rs.map(r=>({report_date:ds,symbol:(r.symbol||"").toUpperCase(),eps:num(r.eps),eps_forecast:num(r.epsForecast),
    surprise_pct:num(r.surprise),n_ests:num(r.noOfEsts)!=null?Math.round(num(r.noOfEsts)!):null,
    when_:(r.time||"").replace("time-",""),fiscal_q:r.fiscalQuarterEnding||null})).filter(r=>r.symbol);
  if(!out.length)continue;
  const res=await fetch(`${OWNED}/trd_earnings?on_conflict=report_date,symbol`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(out)}).catch(()=>null);
  if(!res||!res.ok){console.log(`WRITE-FAILED trd_earnings ${res?res.status:"net"} @${ds}`);continue;}
  days++; rows+=out.length;
  if(days%100===0)console.log(`  ..${ds}: ${rows.toLocaleString()} rows, ${days} days`);
}
const back=await fetch(`${OWNED}/trd_earnings?select=symbol&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
console.log(`==> ${rows.toLocaleString()} rows over ${days} days (${misses} empty days); DB confirms ${+((back.headers.get("content-range")||"").split("/")[1]||0)}`);
