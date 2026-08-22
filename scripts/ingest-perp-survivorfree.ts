#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-perp-survivorfree.ts (D-442) — a SURVIVORSHIP-FREE perp universe, including contracts that were DELISTED.
// Why this matters more here than anywhere else in the program: D-441 found crypto cross-sectional MOMENTUM is
// market-neutral (beta -0.03) and survives realistic fees AND funding — the only signal to do so. But it was measured on
// 14 CURRENTLY-LISTED perps, and momentum books are uniquely exposed to survivorship: the universe excludes exactly the
// coins that pumped, got bought by a momentum rule, and then died. LUNA is the canonical case, and LUNA is absent.
// Binance keeps klines for delisted contracts (verified: LUNAUSDT ends 2022-05-13, SRMUSDT 2024-05-28), so the universe
// CAN be rebuilt honestly. Candidates come from CoinGecko's top coins (allowlisted) rather than from Binance's current
// listing, because asking the exchange what exists today is exactly what creates the bias.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// candidate tickers: CoinGecko top coins by market cap, several pages
const cands=new Set<string>();
// D-469: FULL=1 seeds from Binance exchangeInfo (every CURRENTLY listed perp, 698) in addition to CoinGecko — the
// authoritative current list; CoinGecko supplies the delisted-candidate names exchangeInfo can no longer show.
if(Deno.env.get("FULL")==="1"){
  const info=await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r=>r.json()).catch(()=>null) as {symbols?:{symbol:string;contractType?:string}[]}|null;
  for(const x of info?.symbols??[]) if(x.contractType==="PERPETUAL"&&x.symbol.endsWith("USDT")) cands.add(x.symbol.replace(/USDT$/,""));
  console.log(`  exchangeInfo seeded ${cands.size} current perps`);
}
for(let page=1;page<=4;page++){
  const j=await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`).then(r=>r.json()).catch(()=>null);
  await sleep(2500);                                    // CoinGecko free tier is rate-limited; be polite
  if(!Array.isArray(j)||!j.length){console.error(`  (coingecko page ${page} unavailable — continuing with what we have)`);break;}
  for(const c of j as {symbol:string}[]) if(c.symbol) cands.add(c.symbol.toUpperCase());
}
// plus the perps we already know about, plus known-delisted names CoinGecko may have dropped entirely
for(const x of ["LUNA","FTT","SRM","ANT","RAY","CVC","SC","BTS","TOMO","WAVES","HNT","AGIX","OCEAN","MATIC","FTM","REN","KEEP","BADGER","UNFI","DGB","AUDIO","COMBO","STMX","AMB","GLMR","CTK","MDT","NEBL"]) cands.add(x);
console.log(`==> SURVIVORSHIP-FREE PERP UNIVERSE — probing ${cands.size} candidate tickers on Binance futures`);
const NOW=Math.floor(Date.now()/1000);
let listed=0, delisted=0, stored=0;
const batch:{symbol:string;tf:string;first_ts:number;last_ts:number;n_bars:number;bars:number[][]}[]=[];
for(const t of cands){
  const sym=`${t}USDT`;
  const bars:number[][]=[]; let start=Date.parse("2019-09-01T00:00:00Z");
  for(let g=0;g<6;g++){
    const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1500`).then(x=>x.json()).catch(()=>null);
    await sleep(110);
    if(!Array.isArray(r)||!r.length)break;
    for(const k of r as (string|number)[][]){const ts=Math.floor(Number(k[0])/1000);
      if(bars.length&&ts<=bars[bars.length-1][0])continue;
      bars.push([ts,+k[1],+k[2],+k[3],+k[4],+k[5],+k[7],+k[9],+k[8]]);}
    if(r.length<1500)break; start=Number((r[r.length-1] as (string|number)[])[0])+1;
  }
  if(bars.length<400)continue;
  const last=bars[bars.length-1][0];
  const dead=(NOW-last)>10*86400;              // no bar in 10 days => the contract is gone
  if(dead)delisted++; else listed++;
  batch.push({symbol:sym,tf:"1dSF",first_ts:bars[0][0],last_ts:last,n_bars:bars.length,bars});
  stored++;
  if(dead)console.log(`  DELISTED ${sym.padEnd(13)} ${String(bars.length).padStart(5)} bars, ended ${new Date(last*1000).toISOString().slice(0,10)}`);
  if(batch.length>=15){
    const res=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch)});
    if(!res.ok)console.error(`!! write ${res.status}: ${(await res.text()).slice(0,120)}`);
    batch.length=0;
  }
}
if(batch.length){const res=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch)});
  if(!res.ok)console.error(`!! final write ${res.status}`);}
const back=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`\n==> ${stored} contracts with >=400 daily bars: ${listed} still listed, ${delisted} DELISTED (${(100*delisted/Math.max(1,stored)).toFixed(0)}% of the universe would be missing from a current-listings-only test)`);
console.log(`    DB re-read confirms ${cnt} rows at tf=1dSF`);
if(cnt<stored*0.9){console.error("!! writes did NOT land");Deno.exit(1);}
