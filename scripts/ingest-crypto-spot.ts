#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-crypto-spot.ts (D-580) — TRUE OUT-OF-SAMPLE: Binance SPOT daily bars back to 2017.
// Two mechanisms proposed for the crypto result and both failed testing (D-577 arbitrage-thinness, D-579 dispersion).
// The remaining live possibility is that a t of 2.84, after this much searching, is what a null looks like from the
// inside. The decisive test is data the strategy has NEVER seen. Our perp panel begins ~2019-2020; Binance SPOT runs
// from 2017, covering the ICO boom, the 2018 collapse and the 2019 recovery — three regimes untouched by any search
// in this programme.
// HONEST FRAMING: spot is a different INSTRUMENT (shorting was unavailable for most names then), so this tests whether
// the SIGNAL exists in an untouched period, NOT whether it was tradable there. Stated up front, not discovered later.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cs",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const info=await fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).catch(()=>null);
const syms=((info?.symbols||[]) as {symbol:string;quoteAsset:string;status:string}[])
  .filter(s=>s.quoteAsset==="USDT"&&s.status==="TRADING").map(s=>s.symbol);
console.log(`==> BINANCE SPOT — ${syms.length} live USDT pairs; fetching daily bars from 2017-01-01`);
const since=Date.parse("2017-01-01T00:00:00Z");
let ok=0,rows=0,skip=0;
for(const sym of syms){
  let start=since; const all:number[][]=[]; let guard=0;
  for(;;){
    if(guard++>30)break;
    const j=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1000`).then(r=>r.ok?r.json():null).catch(()=>null);
    await sleep(110);
    if(!Array.isArray(j)||!j.length)break;
    for(const k of j as (string|number)[][]){
      const c=+k[4]; if(!(c>0))continue;
      all.push([Math.floor(+k[0]/1000),+k[1],+k[2],+k[3],c,+k[5],+k[7],+k[9],+k[8]]);
    }
    const last=+((j as (string|number)[][])[j.length-1][0]);
    if(j.length<1000||last<=start)break;
    start=last+1;
  }
  // only keep names with genuine pre-2020 history — that is the whole point of this ingest
  const early=all.filter(b=>b[0]<Date.parse("2020-01-01T00:00:00Z")/1000).length;
  if(all.length<600||early<200){skip++;continue;}
  const seen=new Set<number>(); const bars=all.filter(b=>{if(seen.has(b[0]))return false;seen.add(b[0]);return true;});
  const w=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,tf:"1dSPOT",bars,n_bars:bars.length}])}).catch(()=>null);
  if(!w||!w.ok){console.log(`WRITE-FAILED ${sym} ${w?w.status:"net"}`);skip++;continue;}
  ok++; rows+=bars.length;
  if(ok%25===0)console.log(`  ..${ok} pairs with pre-2020 history, ${rows.toLocaleString()} bars`);
}
console.log(`==> ${ok} spot pairs landed as tf=1dSPOT (${rows.toLocaleString()} bars), ${skip} skipped for insufficient pre-2020 history`);
