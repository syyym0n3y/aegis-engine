#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-force-instruments.ts (D-525) — the FORCES the attribution model could not even test. The residual-PC1
// diagnostic named a growth-vs-financials style axis, and CREDIT had ZERO overlap: HYG/LQD were absent from the
// universe entirely, so "credit is not a missing force" was never a finding about markets - it was a data gap.
// Adjusted from day one (D-478 lesson).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fi",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const UNIVERSE:[string,string][]=[
  ...["HYG","LQD","IEF","JNK"].map(s=>[s,"credit"] as [string,string]),
  ...["IWF","IWD","MTUM","QUAL","USMV","VLUE"].map(s=>[s,"style"] as [string,string]),
  ...["EEM","EFA","VGK","EWJ"].map(s=>[s,"intl_etf"] as [string,string]),
  ...["XLF","XLK","XLE","XLU","XLP","XLI","XLV","XLY"].map(s=>[s,"sector"] as [string,string]),
];
let ok=0,fail=0;
for(const [sym,cls] of UNIVERSE){
  const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.json()).catch(()=>null);
  await sleep(250);
  const res=j?.chart?.result?.[0], q=res?.indicators?.quote?.[0], adj=res?.indicators?.adjclose?.[0]?.adjclose, ts=res?.timestamp;
  if(!q?.close||!ts){console.log(`  ${sym}: unavailable`);fail++;continue;}
  const bars:number[][]=[];
  for(let i=0;i<ts.length;i++){const c=q.close[i];if(c==null||!Number.isFinite(c)||c<=0)continue;
    const a=adj?.[i];const f=(a!=null&&Number.isFinite(a)&&a>0)?a/c:1;
    bars.push([ts[i],+((q.open[i]??c)*f).toFixed(6),+((q.high[i]??c)*f).toFixed(6),+((q.low[i]??c)*f).toFixed(6),+(c*f).toFixed(6),q.volume[i]??0]);}
  if(bars.length<300){console.log(`  ${sym}: only ${bars.length} bars`);fail++;continue;}
  const r=await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify([{symbol:sym,asset_class:cls,bars}])}).catch(()=>null);
  if(!r||!r.ok){console.log(`WRITE-FAILED ${sym} ${r?r.status:"net"}`);fail++;continue;}
  ok++; console.log(`  ${sym.padEnd(12)} ${cls.padEnd(11)} ${bars.length} bars  ${new Date(bars[0][0]*1000).toISOString().slice(0,10)} ..`);
}
console.log(`==> ${ok} landed, ${fail} unavailable (recorded)`);
