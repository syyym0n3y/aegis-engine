#!/usr/bin/env -S deno run --allow-net --allow-env
// collect-binance-sentiment.ts (D-502b) — Binance futures sentiment (top-trader L/S position ratio, global L/S
// accounts, taker buy/sell ratio). The API serves only ~30 days, so this is a start-the-clock collector: daily rows
// into trd_perp_oi (venue=binance, intervals ls_top/ls_glob/taker_ratio).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bs",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const SYMS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT"];
const EPS:[string,string,(r:Record<string,string>)=>number][]=[
  ["topLongShortPositionRatio","ls_top",r=>+r.longShortRatio],
  ["globalLongShortAccountRatio","ls_glob",r=>+r.longShortRatio],
  ["takerlongshortRatio","taker_ratio",r=>+r.buySellRatio],
];
let total=0;
for(const sym of SYMS){
  for(const [ep,interval,val] of EPS){
    const rows=await fetch(`https://fapi.binance.com/futures/data/${ep}?symbol=${sym}&period=1d&limit=30`).then(r=>r.ok?r.json():[]).catch(()=>[]) as Record<string,string>[];
    if(!Array.isArray(rows)||!rows.length){console.log(`  ${sym} ${ep}: empty`);continue;}
    const out=rows.map(r=>({symbol:sym,venue:"binance",interval,ts:Math.floor(+r.timestamp/1000),open_interest:val(r)})).filter(r=>isFinite(r.open_interest));
    const w=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(out)}).catch(()=>null);
    if(!w||!w.ok){console.log(`WRITE-FAILED binance-sentiment ${w?w.status:"net"}`);Deno.exit(1);}
    total+=out.length;
    await new Promise(r=>setTimeout(r,300));                    // sequential + gentle
  }
}
console.log(`binance-sentiment: ${total} rows upserted (${SYMS.length} symbols x 3 series x <=30d)`);
