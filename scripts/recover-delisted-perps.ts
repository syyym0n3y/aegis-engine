#!/usr/bin/env -S deno run --allow-net --allow-env
// recover-delisted-perps.ts (D-562) — RECOVER THE MISSING DELISTED COHORT.
// D-561 found the panel holds 488 live + 10 dead contracts against 527 currently listed, i.e. contracts delisted
// before the original exchangeInfo seed are absent. Binance still serves klines for delisted perps if you know the
// symbol, so the missing names can be recovered systematically: take every USDT symbol Binance has ever listed on
// SPOT (a far larger set), remove those already in our panel and those currently listed as perps, and probe the
// futures kline endpoint. Anything that returns real history was a perp that has since died — exactly the cohort
// whose absence biases the broad-universe results.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"rd",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const have=new Set<string>();
{const r=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol&order=symbol&limit=2000`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {symbol:string}[];
 for(const x of (Array.isArray(r)?r:[]))have.add(x.symbol);}
const fut=await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r=>r.json()).catch(()=>null);
const futSyms=new Set<string>((fut?.symbols||[]).map((s:{symbol:string})=>s.symbol));
const spot=await fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).catch(()=>null);
// D-694: an explicit SYMBOLS list overrides the derived candidates. The derived list is built from SPOT-listed
// assets, and the residual delisted cohort is assets delisted from SPOT TOO — so that source can never contain them,
// which is why the first successful run of this script recovered 0 of 270. The probe was never the problem: klines
// serves delisted contracts by name (SRMUSDT 1362 bars, FTTUSDT 1500, BTSUSDT 1213). The problem is ENUMERATION, and
// a hand-supplied list is the one enumeration source that does not depend on the asset still being listed anywhere.
const OVERRIDE=(Deno.env.get("SYMBOLS")||"").split(/[,\s]+/).filter(Boolean);
const derived=[...new Set((spot?.symbols||[])
  .filter((s:{symbol:string;quoteAsset:string})=>s.quoteAsset==="USDT")
  .map((s:{symbol:string})=>s.symbol))]
  .filter(s=>!have.has(s as string)&&!futSyms.has(s as string)) as string[];
const cands:string[]=OVERRIDE.length?OVERRIDE:derived;
console.log(`==> DELISTED-PERP RECOVERY — ${have.size} in panel, ${futSyms.size} currently listed as futures, probing ${cands.length} candidate symbols${OVERRIDE.length?" (EXPLICIT list)":" (derived from spot listings)"}`);
let found=0,probed=0;
for(const sym of cands){
  probed++;
  // plumbing-ok: exchange kline endpoint returns newest-N by design; there is no order parameter and the full window
  // is what we want. D-693: this waiver used to sit INSIDE the fetch() argument list, which swallowed the closing
  // paren and the .then() into the comment — the file has not parsed since it was added, so a script written to
  // recover the delisted-perp cohort has been dead the whole time. A waiver that breaks the code it waives.
  const j=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1500`).then(r=>r.ok?r.json():null).catch(()=>null);
  await sleep(140);
  if(!Array.isArray(j)||j.length<200)continue;
  // [openTime,o,h,l,c,vol,closeTime,quoteVol,trades,takerBuyBase,takerBuyQuote,ignore]
  const bars=j.map((k:(string|number)[])=>[Math.floor(+k[0]/1000),+k[1],+k[2],+k[3],+k[4],+k[5],+k[7],+k[9],+k[8]])
              .filter((b:number[])=>b[4]>0);
  if(bars.length<200)continue;
  const lastAge=(Date.now()/1000-bars[bars.length-1][0])/86400;
  // D-694: THE CHECK WHOSE ABSENCE DESTROYED 1,313 DAILY BARS. This write REPLACES the stored array, and its source
  // is ONE klines call capped at 1500 bars, while 110 panel symbols hold more than that. Run with an explicit
  // SYMBOLS list the have-filter is skipped, so already-held symbols get overwritten with a shorter series:
  // RLCUSDT 2219->1500, DENTUSDT 1855->1500, OMGUSDT 1674->1500, FTMUSDT 1565->1500. Repaired by
  // `repair-truncated-perps.ts`, which pages on startTime. Never replace a stored array with a shorter one.
  {const cur=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.${sym}&select=n_bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {n_bars:number}[];
   const held=cur[0]?.n_bars??0;
   if(bars.length<held){console.log(`  SKIP ${sym.padEnd(14)} rebuilt ${bars.length} < held ${held} — refusing to truncate`);continue;}}
  const w=await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,tf:"1dSF",bars,n_bars:bars.length}])}).catch(()=>null);
  if(!w||!w.ok){console.log(`WRITE-FAILED ${sym} ${w?w.status:"net"}`);continue;}
  found++;
  console.log(`  RECOVERED ${sym.padEnd(14)} ${String(bars.length).padStart(5)} bars, last trade ${Math.round(lastAge)}d ago`);
  if(found%20===0)console.log(`  ..${found} recovered of ${probed} probed`);
}
console.log(`==> ${found} delisted perps recovered and merged into the 1dSF panel (${probed} probed)`);
