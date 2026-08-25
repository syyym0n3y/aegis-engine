#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-crypto-hourly.ts (D-568) — HOURLY bars for the liquid perp universe.
// Motivation is structural, not a search for a better signal: every candidate this programme has found spends YEARS
// underwater (equity 5.8y, crypto 3.7y) because a strategy making ~2,000 bets over five years cannot recover quickly.
// Recovery time scales with the number of INDEPENDENT bets, so frequency — not breadth, not a cleverer signal — is the
// lever on the binding constraint identified in D-565/567.
// Universe: the top-N by dollar volume from the daily panel (the only names where the daily book worked at all).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ch",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const TOPN=Number(Deno.env.get("TOPN")||100);
const YEARS=Number(Deno.env.get("YEARS")||3);
// rank the daily panel by recent dollar volume to pick the hourly universe
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,bars&order=symbol&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
const ranked=meta.map(m=>{
  const b=m.bars||[]; const tail=b.slice(-90).map(x=>x[6]).filter((x:number)=>Number.isFinite(x)&&x>0);
  return {symbol:m.symbol,dv:tail.length?tail.reduce((s,x)=>s+x,0)/tail.length:0};
}).filter(x=>x.dv>0).sort((a,b)=>b.dv-a.dv).slice(0,TOPN);
console.log(`==> HOURLY INGEST — top ${ranked.length} perps by 90d dollar volume, ${YEARS}y of 1h bars`);
const since=Date.now()-YEARS*365*86400000;
let ok=0,rows=0;
for(const {symbol} of ranked){
  const all:number[][]=[]; let start=since, guard=0;
  for(;;){
    if(guard++>60)break;
    const j=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&startTime=${Math.floor(start)}&limit=1500`).then(r=>r.ok?r.json():null).catch(()=>null);
    await sleep(130);
    if(!Array.isArray(j)||!j.length)break;
    for(const k of j as (string|number)[][]){
      const c=+k[4]; if(!(c>0))continue;
      all.push([Math.floor(+k[0]/1000),+k[1],+k[2],+k[3],c,+k[5],+k[7],+k[9],+k[8]]);
    }
    const last=+((j as (string|number)[][])[j.length-1][0]);
    if(j.length<1500||last<=start)break;
    start=last+1;
  }
  if(all.length<5000){console.log(`  ${symbol}: only ${all.length} bars, skipped`);continue;}
  const seen=new Set<number>(); const bars=all.filter(b=>{if(seen.has(b[0]))return false;seen.add(b[0]);return true;});
  const w=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol,tf:"1hSF",bars,n_bars:bars.length}])}).catch(()=>null);
  if(!w||!w.ok){console.log(`WRITE-FAILED ${symbol} ${w?w.status:"net"}`);continue;}
  ok++; rows+=bars.length;
  if(ok%20===0)console.log(`  ..${ok} symbols, ${rows.toLocaleString()} hourly bars`);
}
console.log(`==> ${ok} symbols landed as tf=1hSF, ${rows.toLocaleString()} hourly bars total`);
