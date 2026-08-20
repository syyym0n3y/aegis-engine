#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-alpaca.ts (D-397) — EXCHANGE-QUALITY crypto history. Yahoo's aggregated crypto series cost us a false positive
// (D-395: ARB-USD 297,915% single-day move, OP 200,020% — ticker reuse) and forced a partial retraction. Alpaca's crypto
// bars are exchange-sourced with trade counts (n) and VWAP — real market data, already allowlisted, no key required.
// Ingests daily bars into trd_bars_deep as asset_class 'crypto_ex' so the two sources can be compared rather than conflated.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ca",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const SYMS=["BTC/USD","ETH/USD","LTC/USD","BCH/USD","LINK/USD","UNI/USD","AAVE/USD","AVAX/USD","DOT/USD","SOL/USD","DOGE/USD",
 "SHIB/USD","MKR/USD","SUSHI/USD","YFI/USD","GRT/USD","XTZ/USD","BAT/USD","CRV/USD","MATIC/USD","USDT/USD","PEPE/USD","TRUMP/USD"];
let ok=0, skip=0; const summary:string[]=[];
for(const s of SYMS){
  await new Promise(r=>setTimeout(r,150));
  const bars:number[][]=[]; let pageToken="";
  try{
    for(let page=0;page<12;page++){
      const u=new URL("https://data.alpaca.markets/v1beta3/crypto/us/bars");
      u.searchParams.set("symbols",s); u.searchParams.set("timeframe","1Day");
      u.searchParams.set("start","2015-01-01"); u.searchParams.set("limit","10000");
      if(pageToken) u.searchParams.set("page_token",pageToken);
      const j=await fetch(u).then(r=>r.json());
      const arr=j?.bars?.[s]; if(!Array.isArray(arr)||!arr.length) break;
      for(const b of arr){const t=Math.floor(new Date(b.t).getTime()/1000);
        if([b.o,b.h,b.l,b.c].some((x:number)=>x==null||!Number.isFinite(x)))continue;
        bars.push([t,b.o,b.h,b.l,b.c,b.v??0]);}
      pageToken=j?.next_page_token||""; if(!pageToken) break;
    }
  }catch{/*skip*/}
  if(bars.length<400){skip++;continue;}
  // sanity: report the worst single-day move so data quality is VISIBLE, not assumed
  let mx=0; for(let i=1;i<bars.length;i++) if(bars[i-1][4]>0){const r=Math.abs(bars[i][4]/bars[i-1][4]-1); if(r>mx)mx=r;}
  const sym=s.replace("/","")+"-EX";
  await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`,{method:"POST",headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,asset_class:"crypto_ex",bars,updated_at:new Date().toISOString()}])});
  ok++; summary.push(`${sym}:${bars.length}b/max${(mx*100).toFixed(0)}%`);
}
console.log(`==> ALPACA EXCHANGE-QUALITY CRYPTO: ${ok} stored, ${skip} skipped`);
console.log(`  ${summary.join("  ")}`);
