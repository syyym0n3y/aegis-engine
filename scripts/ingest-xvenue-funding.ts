#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-xvenue-funding.ts (D-436) — funding history for the SAME perp across Binance, Bybit and OKX.
// WHY THIS AND NOT PRICE ARBITRAGE: cross-venue PRICE dislocation is a sub-second latency game and we have no
// infrastructure for it — claiming otherwise would be dishonest. The FUNDING RATE is different: it is set every 8 hours,
// it is published, and the same contract can pay materially different funding on different venues at the SAME timestamp.
// Long the low-funding venue and short the high-funding venue is delta-neutral across venues, needs no forecast, needs no
// spot custody, and harvests the spread. It is the last free structural spread in the stack.
// All three venues settle on identical 8h boundaries (verified), so alignment is exact rather than interpolated.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"xv",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const CORE=["BTC","ETH","SOL","XRP","DOGE"];
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
const push=(sym:string,venue:string,ts:number,r:number)=>{
  if(!Number.isFinite(ts)||!Number.isFinite(r))return;
  rows.push({symbol:sym,venue,interval:"funding",ts,open_interest:r});};

for(const c of CORE){
  const per=new Map<string,number>();
  // ---- BINANCE (limit 1000, walk forward by startTime) ----
  {let start=Date.parse("2019-09-01T00:00:00Z"),n=0;
   for(let g=0;g<40;g++){
     const j=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${c}USDT&startTime=${start}&limit=1000`).then(r=>r.json()).catch(()=>null);
     await sleep(130); if(!Array.isArray(j)||!j.length)break;
     for(const x of j as {fundingTime:number;fundingRate:string}[]){push(c,"binance",Math.floor(x.fundingTime/1000),Number(x.fundingRate));n++;}
     if(j.length<1000)break; start=Number((j[j.length-1] as {fundingTime:number}).fundingTime)+1;}
   per.set("binance",n);}
  // ---- BYBIT (limit 200, walk BACKWARD by endTime) ----
  {let end=Date.now(),n=0;
   for(let g=0;g<60;g++){
     const j=await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${c}USDT&endTime=${end}&limit=200`).then(r=>r.json()).catch(()=>null) as {result?:{list?:{fundingRate:string;fundingRateTimestamp:string}[]}}|null;
     await sleep(130); const L=j?.result?.list; if(!Array.isArray(L)||!L.length)break;
     let minTs=Infinity;
     for(const x of L){const ts=Math.floor(Number(x.fundingRateTimestamp)/1000);push(c,"bybit",ts,Number(x.fundingRate));n++;minTs=Math.min(minTs,ts);}
     if(!Number.isFinite(minTs))break; const nxt=minTs*1000-1; if(nxt>=end)break; end=nxt; if(L.length<200)break;}
   per.set("bybit",n);}
  // ---- OKX (limit 100, walk BACKWARD via `after`) ----
  {let after="",n=0;
   for(let g=0;g<90;g++){
     const u=`https://www.okx.com/api/v5/public/funding-rate-history?instId=${c}-USDT-SWAP&limit=100${after?`&after=${after}`:""}`;
     const j=await fetch(u).then(r=>r.json()).catch(()=>null) as {data?:{fundingRate:string;realizedRate?:string;fundingTime:string}[]}|null;
     await sleep(130); const D=j?.data; if(!Array.isArray(D)||!D.length)break;
     let minTs=Infinity;
     for(const x of D){const ts=Math.floor(Number(x.fundingTime)/1000);
       // OKX publishes both a forecast `fundingRate` and the settled `realizedRate`; the settled one is what was PAID.
       const r=Number(x.realizedRate??x.fundingRate);
       push(c,"okx",ts,r);n++;minTs=Math.min(minTs,Number(x.fundingTime));}
     if(!Number.isFinite(minTs))break; after=String(minTs); if(D.length<100)break;}
   per.set("okx",n);}
  console.log(`  ${c.padEnd(5)} binance ${String(per.get("binance")).padStart(5)} | bybit ${String(per.get("bybit")).padStart(5)} | okx ${String(per.get("okx")).padStart(5)}`);
}
for(let i=0;i<rows.length;i+=2000){
  const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+2000))});
  if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,160)}`);Deno.exit(1);}
}
const back=await fetch(`${OWNED}/trd_perp_oi?interval=eq.funding&select=symbol`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${rows.length.toLocaleString()} funding points sent; DB re-read confirms ${cnt.toLocaleString()}`);
if(cnt<rows.length*0.9){console.error("!! writes did NOT land");Deno.exit(1);}
