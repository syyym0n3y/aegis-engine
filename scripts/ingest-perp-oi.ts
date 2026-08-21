#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-perp-oi.ts (D-427) — open-interest history for perps, from Bybit (free, keyless, allowlisted).
// WHY OI: price alone cannot tell you whether a move is NEW money or OLD money leaving. OI can.
//   price up + OI up   = new longs opening      (fresh conviction)
//   price up + OI down = shorts covering        (a squeeze, not demand)
//   price down + OI up = new shorts opening
//   price down + OI down = longs capitulating   (unwind, often exhaustion)
// Equities have no free equivalent at this resolution. This is exactly the "positioning" data the program has wanted since
// the funding-flow work (D-361) and has never had for derivatives.
// Cursor-paginated backwards; the reachable span is MEASURED and reported, never assumed (COVERAGE LAW).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"oi",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const IV=Deno.env.get("OI_INTERVAL")||"1d";

// universe = the perps we already hold order-flow for, so OI and flow are testable on the SAME instruments
const have=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const universe=(Array.isArray(have)?have:[]).filter(x=>x.n_bars>=8000).map(x=>x.symbol);
console.log(`==> PERP OPEN-INTEREST INGEST (bybit, ${IV}) — ${universe.length} symbols`);
let total=0, ok=0;
for(const sym of universe){
  const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
  let cursor=""; let earliest=Infinity, latest=0;
  for(let page=0;page<40;page++){
    const url=`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=${IV}&limit=200${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`;
    const j=await fetch(url).then(r=>r.json()).catch(()=>null) as {retCode?:number;result?:{list?:{openInterest:string;timestamp:string}[];nextPageCursor?:string}}|null;
    await sleep(120);
    const list=j?.result?.list;
    if(!j||j.retCode!==0||!Array.isArray(list)||!list.length)break;
    for(const r of list){ const ts=Math.floor(Number(r.timestamp)/1000), v=Number(r.openInterest);
      if(!Number.isFinite(ts)||!Number.isFinite(v)||v<=0)continue;
      rows.push({symbol:sym,venue:"bybit",interval:IV,ts,open_interest:v});
      earliest=Math.min(earliest,ts); latest=Math.max(latest,ts); }
    cursor=j.result?.nextPageCursor||"";
    if(!cursor)break;
  }
  if(rows.length<180){console.log(`  skip ${sym}: only ${rows.length} points`);continue;}
  for(let i=0;i<rows.length;i+=2000){
    const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+2000))});
    if(!res.ok){console.error(`!! ${sym} write ${res.status}: ${(await res.text()).slice(0,140)}`);break;}
  }
  ok++; total+=rows.length;
  console.log(`  ${sym.padEnd(12)} ${String(rows.length).padStart(5)} pts  ${new Date(earliest*1000).toISOString().slice(0,10)} .. ${new Date(latest*1000).toISOString().slice(0,10)}`);
}
// VERIFY LANDED — re-read, do not trust the POST
const back=await fetch(`${OWNED}/trd_perp_oi?select=symbol&interval=eq.${IV}`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`\n==> ${total.toLocaleString()} OI points for ${ok} perps; DB re-read confirms ${cnt.toLocaleString()} rows`);
if(cnt<total*0.95){console.error("!! DB holds materially fewer rows than were sent — writes did NOT land");Deno.exit(1);}
