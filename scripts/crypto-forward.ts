#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-forward.ts (D-394) — FORWARD-TEST the one candidate that survived its controls (D-392): long-only crypto trend at a
// 100-day lookback, which beat buy-and-hold OUT-OF-SAMPLE on Sharpe (0.32 vs 0.14) and halved the drawdown (-42% vs -73%).
// Each run: (1) SCORE the prior snapshot's realised paper return (accruing a live track record with NO capital), (2) emit
// today's positions — long the crypto instruments in a 100d uptrend, vol-scaled. DORMANT: recorded, never armed.
// The honest bar this must clear before it ever earns capital: hold up forward for a meaningful window, with the drawdown
// advantage intact. SR 0.32 alone was t~0.7 — not significant — so forward evidence is exactly what is missing.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
// D-399: use the EXCHANGE-quality feed (Alpaca, D-397). Yahoo's aggregated crypto produced a false positive that forced a
// retraction; the forward record must not be built on the weaker source.
const CLS=Deno.env.get("FWD_CLS")||"crypto_ex";
const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${CLS}&select=symbol,bars`,{headers:hdr}).then(r=>r.json()) as {symbol:string;bars:number[][]}[];
// 1. score the most recent prior snapshot (paper, no capital)
const prior=await fetch(`${OWNED}/trd_crypto_forward?scored_at=is.null&select=id,asof,sym,px,weight,in_uptrend&order=asof.asc&limit=500`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {id:number;asof:string;sym:string;px:number;weight:number;in_uptrend:boolean}[];
const MIN_HOLD_D=Number(Deno.env.get("MIN_HOLD_D")||5);
if(Array.isArray(prior)&&prior.length){
  const oldest=prior[0].asof;
  // FLAW FIXED: the first version scored a snapshot the same day it was written (~zero elapsed time), stamping a meaningless
  // observation. Require MIN_HOLD_D calendar days before a snapshot counts — a forward record must measure forward time.
  const elapsed=(Date.now()-new Date(oldest+"T00:00:00Z").getTime())/864e5;
  if(elapsed<MIN_HOLD_D){ console.log(`  forward-test: newest unscored snapshot ${oldest} is only ${elapsed.toFixed(1)}d old (<${MIN_HOLD_D}d) — not scoring yet`); }
  else {
  const batch=prior.filter(p=>p.asof===oldest);
  let wsum=0,pnl=0,n=0;
  for(const p of batch){ const r=rows.find(x=>x.symbol===p.sym); if(!r) continue;
    const pxNow=r.bars[r.bars.length-1][4]; if(!(pxNow>0)||!(p.px>0)) continue;
    const ret=pxNow/p.px-1; const w=p.in_uptrend?(+p.weight||0):0; pnl+=w*ret; wsum+=w; n++;
    {const res=await fetch(`${OWNED}/trd_crypto_forward?id=eq.${p.id}`,{method:"PATCH",headers:{...hdr,Prefer:"return=minimal"},body:JSON.stringify({fwd_return:+ret.toFixed(4),scored_at:new Date().toISOString()})}).catch(()=>null); if(!res||!res.ok)console.log(`WRITE-FAILED trd_crypto_forward(patch) ${res?res.status:"network"}`);}}
  if(wsum>0) console.log(`  forward-test: snapshot ${oldest} (${elapsed.toFixed(0)}d held) paper return ${(100*pnl/wsum).toFixed(2)}% across ${n} legs (NO capital)`);
  }
}
// 2. emit today's positions
const asof=new Date().toISOString().slice(0,10); const out:Record<string,unknown>[]=[];
for(const r of rows){ const b=r.bars; if(!b||b.length<150) continue;
  const c=b.map(x=>x[4]); const k=c.length-1; const px=c[k], pl=c[k-100];
  if(!(px>0)||!(pl>0)) continue;
  const t100=px/pl-1;
  const w:number[]=[]; for(let j=k-30;j<k;j++) if(c[j]>0) w.push(c[j+1]/c[j]-1);
  const vol=Math.sqrt(w.reduce((s,x)=>s+x*x,0)/w.length)||0.05;
  const weight=Math.min(3,(0.60/Math.sqrt(365))/vol);
  out.push({asof,sym:r.symbol,in_uptrend:t100>0,trend100:+(t100*100).toFixed(1),px:+px.toFixed(4),weight:+weight.toFixed(3)});
}
{const res=await fetch(`${OWNED}/trd_crypto_forward?on_conflict=asof,sym`,{method:"POST",headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(out)}).catch(()=>null); if(!res||!res.ok)console.log(`WRITE-FAILED trd_crypto_forward ${res?res.status:"network"}`);}
const longs=out.filter(o=>o.in_uptrend);
console.log(`==> CRYPTO FORWARD-TEST ${asof}: ${longs.length}/${out.length} in 100d uptrend -> LONG ${longs.map(o=>o.sym).join(", ")||"(none — flat)"} [DORMANT]`);
