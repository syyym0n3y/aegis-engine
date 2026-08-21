#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-perp-flow.ts (D-425) — THE ORDER-FLOW PIVOT. D-424 established that the binding constraint on the equity
// cross-section is LIQUIDITY: the edge lives only where size cannot go (liq:HIGH SR 0.04-0.26). Perpetual futures invert
// that constraint -- BTC/ETH perps clear $10-30B/day -- and they expose a data class equities simply do not have.
//
// Binance futures klines carry, in EVERY bar and for the FULL history, free and keyless:
//   [5] volume  [7] quoteVolume  [8] numberOfTrades  [9] takerBuyBaseVolume
// takerBuy vs total is the AGGRESSOR IMBALANCE -- who crossed the spread, buyers or sellers. That is exchange-side order
// flow, not a price-derived proxy for it. Nothing in this program has ever tested it.
// Stored to trd_bars_intraday (tf='1h') as [ts,o,h,l,c,vol,quoteVol,takerBuyBase,nTrades]. Strictly sequential.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"pf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const FAPI="https://fapi.binance.com/fapi/v1";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const TF=Deno.env.get("TF")||"1h";
const NSYM=Number(Deno.env.get("NSYM")||30);

// universe: the most liquid USDT perps. SURVIVORSHIP NOTE recorded honestly -- ticker/24hr lists only CURRENTLY listed
// contracts, so delisted perps are absent. For a capacity study that is the correct universe (we care about where size can
// go today), but it means any cross-sectional claim here is an upper bound and is labelled as such.
const tick=await fetch(`${FAPI}/ticker/24hr`).then(r=>r.json()).catch(()=>[]) as {symbol:string;quoteVolume:string}[];
if(!Array.isArray(tick)||!tick.length){console.error("!! ticker/24hr returned no array — aborting rather than guessing");Deno.exit(1);}
const universe=tick.filter(t=>t.symbol.endsWith("USDT")&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
  .sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume)).slice(0,NSYM).map(t=>t.symbol);
console.log(`==> PERP ORDER-FLOW INGEST — ${universe.length} perps, tf=${TF}`);
console.log(`    top by 24h quote volume: ${universe.slice(0,8).join(", ")}`);

let totalBars=0, stored=0;
for(const sym of universe){
  const bars:number[][]=[]; let start=Date.parse("2019-09-01T00:00:00Z");
  for(let guard=0;guard<200;guard++){
    const url=`${FAPI}/klines?symbol=${sym}&interval=${TF}&startTime=${start}&limit=1500`;
    const r=await fetch(url).then(x=>x.json()).catch(()=>null);
    await sleep(120);                                   // strictly sequential, rate-respecting
    if(!Array.isArray(r)||!r.length)break;
    for(const k of r as (string|number)[][]){
      const ts=Math.floor(Number(k[0])/1000);
      if(bars.length&&ts<=bars[bars.length-1][0])continue;
      bars.push([ts,+k[1],+k[2],+k[3],+k[4],+k[5],+k[7],+k[9],+k[8]]);
    }
    const last=Number((r[r.length-1] as (string|number)[])[0]);
    if(r.length<1500)break;
    start=last+1;
  }
  if(bars.length<2000){console.log(`  skip ${sym}: only ${bars.length} bars`);continue;}
  // sanity: takerBuy can never exceed total volume. A violation means the field mapping is wrong, and a wrong mapping would
  // silently invert the entire signal -- so it fails loudly here rather than producing a confident wrong answer downstream.
  const bad=bars.filter(b=>b[7]>b[5]*1.0001).length;
  if(bad>0){console.error(`!! ${sym}: ${bad} bars with takerBuy > volume — field mapping is WRONG. Aborting.`);Deno.exit(1);}
  const res=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,tf:TF,first_ts:bars[0][0],last_ts:bars[bars.length-1][0],n_bars:bars.length,bars}])});
  if(!res.ok){console.error(`!! ${sym}: write failed ${res.status} ${await res.text()}`);continue;}
  stored++; totalBars+=bars.length;
  console.log(`  ${sym.padEnd(12)} ${String(bars.length).padStart(6)} bars  ${new Date(bars[0][0]*1000).toISOString().slice(0,10)} .. ${new Date(bars[bars.length-1][0]*1000).toISOString().slice(0,10)}`);
}
// VERIFY THE WRITES LANDED — re-read from the DB rather than trusting the POST status.
const back=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&select=symbol,n_bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
const n=Array.isArray(back)?back.length:0;
console.log(`\n==> ingested ${totalBars.toLocaleString()} bars for ${stored} perps; DB re-read confirms ${n} rows at tf=${TF}`);
if(n<stored){console.error("!! fewer rows in DB than we stored — writes did NOT land");Deno.exit(1);}
