#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-earnings.ts (D-479) — Nasdaq earnings calendar, day by day, 2017->now: actual EPS + consensus + % surprise.
// The input D-393's PEAD test never had. Sequential, polite, landing-verified, WRITE-FAILED loud.
import { mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ern",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const num=(x:unknown)=>{if(x==null)return null;const v=parseFloat(String(x).replace(/[$,()]/g,m=>m==="("?"-":""));return Number.isFinite(v)?v:null;};
// D-793: INCREMENTAL by default. The original default FROM=2017-01-02 re-walked ~2,200 weekdays on EVERY daily run,
// which never finished inside a runner cycle (the 2026-09-03 detached run died at 2019-05 after HTTP 500s) — so the
// feed froze at 2026-08-21 while the runner reported nothing. Default start = newest report_date already held minus
// OVERLAP_DAYS (Nasdaq revises recent rows), so a daily run touches ~a week. FROM=YYYY-MM-DD still forces a backfill.
const OVERLAP_DAYS=Number(Deno.env.get("OVERLAP_DAYS")||"3");
// STRICT read (D-757): a silent-null read here would fall back to FROM=2017 and re-create the exact freeze this fix
// exists to end — quietly. mkStrictRead THROWS on any failed read; null now means the table is genuinely empty.
const {q:strictQ}=mkStrictRead(OWNED,hdr);
async function newestHeld():Promise<string|null>{
  const r=await strictQ(`trd_earnings?select=report_date&order=report_date.desc&limit=1`) as {report_date:string}[];
  return r?.[0]?.report_date??null;
}
let FROM=Deno.env.get("FROM")||"";
if(!FROM){
  const nh=await newestHeld();
  if(nh){const t=new Date(nh+"T00:00:00Z");t.setUTCDate(t.getUTCDate()-OVERLAP_DAYS);FROM=t.toISOString().slice(0,10);}
  else FROM="2017-01-02";
}
console.log(`  [ingest-earnings] FROM=${FROM} (${Deno.env.get("FROM")?"explicit":"incremental: newest held - "+OVERLAP_DAYS+"d"})`);
let d=new Date(FROM+"T00:00:00Z"); const end=new Date();
let days=0,rows=0,misses=0,writeFails=0;
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
  if(!res||!res.ok){writeFails++;console.log(`WRITE-FAILED trd_earnings ${res?res.status:"net"} @${ds}`);continue;}
  days++; rows+=out.length;
  if(days%100===0)console.log(`  ..${ds}: ${rows.toLocaleString()} rows, ${days} days`);
}
const back=await fetch(`${OWNED}/trd_earnings?select=symbol&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
console.log(`==> ${rows.toLocaleString()} rows over ${days} days (${misses} empty days, ${writeFails} write failures); DB confirms ${+((back.headers.get("content-range")||"").split("/")[1]||0)}`);
// D-793 POSITIVE CONTROL + loud exit (PRECONDITION LAW): the feed must actually ADVANCE. Newest held report_date must be
// within 7 days of today, and no write may have failed — otherwise exit non-zero so the runner's `|| echo FAILED` fires
// instead of a silent "success" that leaves the continuity guard to discover the freeze two weeks later (D-613).
const nowHeld=await newestHeld();
const ageDays=nowHeld?(Date.now()-Date.parse(nowHeld+"T00:00:00Z"))/86400000:Infinity;
if(writeFails>0){console.error(`!! ${writeFails} write failure(s) — the overlap window will re-cover them tomorrow, but this run is NOT a success.`);Deno.exit(1);}
if(!(ageDays<=7)){console.error(`!! newest held report_date ${nowHeld} is ${ageDays.toFixed(1)}d old after this run — feed did not advance.`);Deno.exit(1);}
console.log(`  newest held report_date ${nowHeld} (${ageDays.toFixed(1)}d old) — feed advanced.`);
