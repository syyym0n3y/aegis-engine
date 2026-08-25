#!/usr/bin/env -S deno run --allow-net --allow-env
// universe-guard.ts (D-535) — THE UNIVERSE LAW, enforced.
// Origin: the crypto GBM book, this program's best placeable candidate, reported 20.0 / 35.9 / 50.2 / 53.1 / 80.9 %/yr
// (SR 0.61 / 1.11 / 0.99 / 0.95 / 1.30) across FIVE defensible universe definitions of the SAME idea — a 2.1x spread in
// Sharpe and 4.0x in return, with no principled criterion selecting among them. Every existing law was satisfied
// throughout: trials counted, liquidity decomposed, breadth adequate, execution lagged, selection train-only. The
// degree of freedom that moved the number most was the one nothing measured: WHO IS IN THE UNIVERSE.
// Rule: any lineage row in a cross-sectional family that is promoted (monitoring/promoted/paper/micro/small/scaled)
// must state its universe sensitivity — the range of the headline metric across defensible universe definitions.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=(Deno.env.get("SELFTEST")||Deno.env.get("GUARD_SELFTEST"))==="1";   // D-586: accept BOTH names — the split (6 guards one, 5 the other) produced a silent no-op self-test that I nearly reported as a verification
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ug",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const PROMOTED=new Set(["monitoring","promoted","paper","micro","small","scaled"]);
const XSEC=/(xsec|cross-section|cross section|decile|tercile|quintile|panel|universe|book|ml|nport|own13f|form345|darkpool)/i;
const STATES=/(universe sensitivity|universe-sensitivity|across universes|universe range|universe definitions)/i;
const EXEMPT=/(single-instrument|single instrument|time-series only|one instrument|not cross-sectional|infrastructure)/i;
console.log("==> UNIVERSE GUARD — does every promoted cross-sectional claim state its universe sensitivity?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,family,status,key_metric,verdict,test_method`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as
  {id:string;name:string;family:string;status:string;key_metric:string|null;verdict:string|null;test_method:string|null}[]|null;
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-BAD",name:"cross-sectional decile book",family:"ml",status:"monitoring",
   key_metric:"SR 1.30 on the top-60 universe",verdict:"strong",test_method:"decile long-short panel"},
  {id:"SELFTEST-OK",name:"cross-sectional decile book",family:"ml",status:"monitoring",
   key_metric:"SR 1.30 top-60; universe sensitivity SR 0.61-1.30 across five definitions",verdict:"not identified",test_method:"panel"},
  {id:"SELFTEST-EXEMPT",name:"single-instrument timing rule",family:"timing",status:"monitoring",
   key_metric:"excess vs buy-and-hold",verdict:"single-instrument, not cross-sectional",test_method:"one instrument"},
]:[])];
let red=0,checked=0;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  const hay=`${r.name||""} ${r.family||""} ${r.test_method||""} ${r.key_metric||""} ${r.verdict||""}`;
  if(EXEMPT.test(hay))continue;
  if(!XSEC.test(hay))continue;
  checked++;
  const ok=STATES.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(26)} ${(r.name||"").slice(0,32).padEnd(34)} ${ok?"universe sensitivity stated":"NO universe-sensitivity statement"}`);
}
if(checked===0)console.log("  (no promoted cross-sectional claim — nothing to certify)");
console.log(`\n  ${red===0?`ALL ${checked} PROMOTED CROSS-SECTIONAL ROW(S) STATE UNIVERSE SENSITIVITY.`
  :`${red} ROW(S) RED — a Sharpe that doubles across defensible universes is a CHOICE, not a measurement. State the range.`}`);
if(red>0)Deno.exit(1);
