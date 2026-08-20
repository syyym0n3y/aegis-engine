#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-extend.ts (D-395) — extend the crypto universe from 12 to the broad liquid set. D-392 found the ONE candidate that
// survived its controls (long-only 100d trend: OOS SR 0.32 vs buy&hold 0.14, drawdown -42% vs -73%) on just 12 instruments —
// thin breadth was an explicit caveat. More instruments = more independent bets = the IR=IC*sqrt(breadth) lever, and a
// harder test (if the effect is real it should survive a wider, less cherry-picked universe).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cx",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const SYMS=["BTC-USD","ETH-USD","BNB-USD","XRP-USD","SOL-USD","ADA-USD","DOGE-USD","DOT-USD","LINK-USD","LTC-USD","AVAX-USD","MATIC-USD",
 "TRX-USD","ATOM-USD","XLM-USD","ETC-USD","BCH-USD","NEAR-USD","ALGO-USD","VET-USD","FIL-USD","ICP-USD","HBAR-USD","APT-USD","ARB-USD",
 "OP-USD","AAVE-USD","MKR-USD","GRT-USD","SAND-USD","MANA-USD","AXS-USD","EOS-USD","XTZ-USD","THETA-USD","EGLD-USD","FTM-USD","RUNE-USD",
 "INJ-USD","IMX-USD","CRV-USD","SNX-USD","COMP-USD","ZEC-USD","DASH-USD","CHZ-USD","ENJ-USD","BAT-USD","QNT-USD","KAVA-USD"];
const p2=Math.floor(Date.now()/1000); let ok=0,skip=0;
for(const s of SYMS){
  await new Promise(r=>setTimeout(r,200));
  try{
    const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=0&period2=${p2}`,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.json());
    const res=j?.chart?.result?.[0]; if(!res?.timestamp){skip++;continue;}
    const q=res.indicators.quote[0], ts=res.timestamp as number[]; const bars:number[][]=[];
    for(let i=0;i<ts.length;i++){const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume[i];
      if([o,h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue; bars.push([ts[i],o,h,l,c,v??0]);}
    if(bars.length<400){skip++;continue;}
    await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`,{method:"POST",headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify([{symbol:s,asset_class:"crypto",bars,updated_at:new Date().toISOString()}])});
    ok++;
  }catch{skip++;}
}
console.log(`==> CRYPTO EXTEND: ${ok} stored, ${skip} skipped (insufficient history / unavailable)`);
