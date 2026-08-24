#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-bybit-perps.ts (D-546) — daily bars for Bybit LINEAR perps, to attempt an INDEPENDENT CROSS-EXCHANGE
// replication of the lit5 book. Different exchange, different universe composition, different price series, identical
// rules. STATED CAVEAT, load-bearing: Bybit's instruments-info returns LISTED contracts only, so this universe is
// SURVIVORSHIP-BIASED, unlike the Binance panel (498 contracts including delisted ones). D-443 showed survivorship can
// flatter crypto cross-sections, so a pass here is weaker evidence than the Binance result and a FAIL is stronger.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bb",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const inst=await fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000").then(r=>r.json()).catch(()=>null);
const syms=(inst?.result?.list||[]).filter((x:{symbol:string;quoteCoin:string;status:string})=>x.quoteCoin==="USDT"&&x.status==="Trading").map((x:{symbol:string})=>x.symbol);
console.log(`==> BYBIT LINEAR PERPS — ${syms.length} live USDT contracts (SURVIVORSHIP-BIASED: delisted contracts are absent)`);
let ok=0,skip=0;
for(const sym of syms){
  const j=await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=D&limit=1000`).then(r=>r.json()).catch(()=>null);
  await sleep(120);
  const list=j?.result?.list;
  if(!Array.isArray(list)||list.length<200){skip++;continue;}
  // bybit returns newest-first: [start, open, high, low, close, volume, turnover]
  const bars=list.slice().reverse().map((k:string[])=>{
    const ts=Math.floor(+k[0]/1000), o=+k[1],h=+k[2],l=+k[3],c=+k[4],v=+k[5],q=+k[6];
    return [ts,o,h,l,c,v,q,0,0];                       // pad to the 1dSF shape: [ts,o,h,l,c,vol,quoteVol,takerBuy,nTrades]
  }).filter((b:number[])=>b[4]>0);
  if(bars.length<200){skip++;continue;}
  const r=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,tf:"1dBYBIT",bars,n_bars:bars.length}])}).catch(()=>null);
  if(!r||!r.ok){console.log(`WRITE-FAILED ${sym} ${r?r.status:"net"}`);skip++;continue;}
  ok++;
  if(ok%50===0)console.log(`  ..${ok} landed`);
}
console.log(`==> ${ok} contracts landed as tf=1dBYBIT, ${skip} skipped (short history or write failure)`);
