#!/usr/bin/env -S deno run --allow-net --allow-env
// liquidity-guard.ts (D-424) — THE MACHINE GUARD for the LIQUIDITY LAW.
// Two independent panels (D-419 price/volume, 367 months; D-423 fundamentals, 103 months) reached the same conclusion by
// different routes: the entire cross-sectional return lives in the illiquid tail. In the genuinely liquid third the same
// strategies earn 5.7% and 0.9% per year gross-of-nothing-else, i.e. SR 0.26 and 0.04 — nothing. A headline number computed
// over the whole universe is therefore not a statement about a tradable strategy; it is a statement about names that cannot
// absorb size. Documentation will not stop that being quoted as an edge. This will.
//
// RULE ENFORCED: no lineage row may sit in a PROMOTED state without a recorded liquid-tercile Sharpe that clears the floor.
// A strategy whose edge disappears in the liquid tercile is capacity-bound, and capacity-bound is not promotable.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"lg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();

const PROMOTED=new Set(["promoted","paper","micro","small","live","armed"]);
const FLOOR=Number(Deno.env.get("LIQ_SR_FLOOR")||0.30);   // liquid-tercile net Sharpe a promotable strategy must clear
const SELFTEST=Deno.env.get("GUARD_SELFTEST")==="1";

console.log("==> LIQUIDITY GUARD — is every promoted strategy's edge present in the LIQUID tercile?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,status,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as
  {id:string;name:string;status:string;key_metric:string|null;verdict:string|null}[];
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — cannot certify. Treating as RED.");Deno.exit(1);}

// In SELFTEST the guard is asked to judge a deliberately non-compliant row, so it is PROVEN to fail rather than merely to pass.
// Three fixtures so EVERY branch is proven reachable, not just the one that happens to fire today: a below-floor row, a row
// that never states a liquid number at all (the likelier real failure — a headline quoted without its decomposition), and a
// compliant row (so a PASS is demonstrably achievable and the guard is not trivially always-red).
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-BELOW",name:"capacity-bound mirage",status:"promoted",
   key_metric:"headline SR 1.36 (whole universe); liq:HIGH SR 0.04",verdict:"edge vanishes at size"},
  {id:"SELFTEST-SILENT",name:"headline with no decomposition",status:"promoted",
   key_metric:"SR 1.49, 72.1%/yr gross",verdict:"never reported a liquidity tercile"},
  {id:"SELFTEST-OK",name:"compliant example",status:"promoted",
   key_metric:"liq:HIGH SR 0.55 net of cost across all three eras",verdict:"tradable at size"},
]:[])];

let red=0, checked=0;
// A row satisfies the law if its recorded metric states a LIQUID-tercile Sharpe at or above the floor. The metric text is
// the evidence: a promotion whose evidence never mentions the liquid tercile has not been shown to be tradable at size.
const LIQ=/liq[:\s_-]*high[^0-9-]{0,40}(-?\d+\.\d+)/i;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  checked++;
  const hay=`${r.key_metric||""} ${r.verdict||""}`;
  const m=hay.match(LIQ);
  const sr=m?Number(m[1]):null;
  const ok=sr!==null&&sr>=FLOOR;
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(16)} ${(r.name||"").slice(0,34).padEnd(36)} ${
    sr===null?"NO liquid-tercile Sharpe recorded":`liq:HIGH SR ${sr} vs floor ${FLOOR}`}`);
}
if(checked===0) console.log(`  (no rows in a promoted state — nothing is at risk, so nothing to certify)`);
console.log(`\n  ${red===0?`ALL ${checked} PROMOTED ROW(S) CARRY A LIQUID-TERCILE EDGE.`
  :`${red} PROMOTED ROW(S) RED — edge not demonstrated in the liquid tercile. Capacity-bound is NOT promotable.`}`);
if(red>0) Deno.exit(1);
