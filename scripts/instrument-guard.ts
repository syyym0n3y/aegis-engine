#!/usr/bin/env -S deno run --allow-net --allow-env
// instrument-guard.ts (D-575) — THE INSTRUMENT LAW. Fourteenth guard.
// Origin: FOUR implementability failures with four DISTINCT mechanisms, every one discovered AFTER a statistical claim
// had been made and reported:
//   D-530 equity decile long-shorts  -> cannot be placed at all (thousands of names, borrow assumed)
//   D-555 ETF wrappers               -> placeable but capture ~20% of the signal (long-only tilt is not a long-short)
//   D-556 concentrated stock books   -> placeable and simply dead (t 0.35, -93% drawdowns)
//   D-574 crypto variance premium    -> t 3.76 in variance space becomes t 1.18 / 0.42 in the tradable straddle
// The common structure: the premium was measured in RESEARCH SPACE and the conversion to instrument space was assumed
// rather than measured. In 4 of 4 cases the conversion destroyed most or all of the edge.
// RULE: any live row claiming a return must state WHICH SPACE it was measured in — the placeable instrument, or a
// research proxy whose conversion has been measured. An unstated conversion is the single most reliable failure
// predictor this programme has found.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=Deno.env.get("SELFTEST")==="1";
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ig",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const LIVE=new Set(["monitoring","promoted","paper","micro","small","scaled"]);
const IN_SCOPE=new Set(["book","ml","vol"]);
const CLAIMS_RETURN=/(SR\s*-?\d|Sharpe\s*-?\d|%\/yr)/;
const STATES_SPACE=/(instrument space|placeable instrument|research proxy|conversion measured|implementab|not implementable|vehicle|tradable form|placeable form)/i;
console.log("==> INSTRUMENT GUARD — does every live return claim state WHICH SPACE it was measured in?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,family,status,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as
  {id:string;name:string;family:string;status:string;key_metric:string|null;verdict:string|null}[]|null;
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-BAD",name:"premium in research space",family:"vol",status:"monitoring",key_metric:"10.8%/yr t 3.76 on variance notional",verdict:"premium present"},
  {id:"SELFTEST-OK",name:"premium with conversion measured",family:"vol",status:"monitoring",key_metric:"10.8%/yr t 3.76 research proxy; in placeable form t 1.18",verdict:"conversion measured"},
]:[])];
let red=0,checked=0;
for(const r of subjects){
  if(!LIVE.has((r.status||"").toLowerCase()))continue;
  if(!IN_SCOPE.has((r.family||"").toLowerCase()))continue;
  const hay=`${r.key_metric||""} ${r.verdict||""}`;
  if(!CLAIMS_RETURN.test(hay))continue;
  checked++;
  const ok=STATES_SPACE.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(28)} ${(r.name||"").slice(0,30).padEnd(32)} ${ok?"measurement space stated":"RETURN CLAIMED WITHOUT STATING THE SPACE IT LIVES IN"}`);
}
if(checked===0)console.log("  (no live return claims in scope)");
console.log(`\n  ${red===0?`ALL ${checked} LIVE RETURN CLAIM(S) STATE THEIR MEASUREMENT SPACE.`
  :`${red} ROW(S) RED — 4 of 4 unstated conversions destroyed the edge. This is the programme's most reliable failure predictor.`}`);
if(red>0)Deno.exit(1);
