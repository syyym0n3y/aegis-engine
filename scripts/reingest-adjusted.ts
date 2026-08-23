#!/usr/bin/env -S deno run --allow-net --allow-env
// reingest-adjusted.ts (D-478) — REPLACE every Yahoo-sourced bar series with DIVIDEND/SPLIT-ADJUSTED prices.
// The finding: ingestion always parsed indicators.quote.close (raw) while indicators.adjclose sat in the same response,
// unused. Verified on KO 2020-01-02: stored 54.99 (raw) vs 45.14 (adjusted). Every equity/ETF return in the program has
// excluded dividends — value/payout longs (high-yield) understated most, TLT's coupon return absent, and the div_yield
// spec's kill INVALID (its long leg was denied its own yield). Direction of the bias: our results were CONSERVATIVE.
// Method: total-return series via adjclose; O/H/L scaled by the same per-day factor so bars stay internally coherent.
// Volume untouched. Crypto/untouched classes excluded (no distributions).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"adj",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const CLASSES=(Deno.env.get("CLASSES")||"equity,etf,sector,index,commodity,fx,rate").split(",");
const meta:{symbol:string;asset_class:string}[]=[];
for(const cls of CLASSES) for(let off=0;;off+=1000){
  const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol,asset_class&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break; meta.push(...p); if(p.length<1000)break;
}
console.log(`==> ADJUSTED RE-INGEST — ${meta.length} symbols across ${CLASSES.join(",")}`);
let ok=0,fail=0,identical=0;
for(const m of meta){
  const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.symbol)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.json()).catch(()=>null);
  await sleep(180);
  const res=j?.chart?.result?.[0];
  const q=res?.indicators?.quote?.[0], adj=res?.indicators?.adjclose?.[0]?.adjclose, ts=res?.timestamp;
  if(!q?.close||!ts){fail++;continue;}
  const bars:number[][]=[];
  let anyDiff=false;
  for(let i=0;i<ts.length;i++){
    const c=q.close[i]; if(c==null||!Number.isFinite(c)||c<=0)continue;
    const a=adj?.[i];
    const f=(a!=null&&Number.isFinite(a)&&a>0)?a/c:1;
    if(Math.abs(f-1)>1e-6)anyDiff=true;
    bars.push([ts[i],+( (q.open[i]??c)*f ).toFixed(6),+((q.high[i]??c)*f).toFixed(6),+((q.low[i]??c)*f).toFixed(6),+(c*f).toFixed(6),q.volume[i]??0]);
  }
  if(bars.length<50){fail++;continue;}
  if(!anyDiff)identical++;
  const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(m.symbol)}`,{method:"PATCH",
    headers:{...hdr,Prefer:"return=minimal"},body:JSON.stringify({bars})}).catch(()=>null);
  if(!r||!r.ok){console.log(`WRITE-FAILED ${m.symbol} ${r?r.status:"net"}`);fail++;continue;}
  ok++;
  if(ok%250===0)console.log(`  ..${ok}/${meta.length} (identical so far: ${identical})`);
}
console.log(`==> re-ingested ${ok}, failed ${fail}, series with NO adjustment difference ${identical}`);
// landing verification on the known case
const ko=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.KO&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
const b0=ko[0]?.bars?.find(b=>b[0]>=1577836800&&b[0]<1578100000);
console.log(`  VERIFY KO 2020-01-02: stored close now ${b0?.[4]} (raw was 54.99, adjusted target ~45.14)`);
