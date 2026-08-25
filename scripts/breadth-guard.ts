#!/usr/bin/env -S deno run --allow-net --allow-env
// breadth-guard.ts (D-446) — THE MACHINE GUARD for the BREADTH LAW.
// Origin: three separate times this program produced a large, significant-looking number from a CONCENTRATED book, and
// each time the number evaporated when the concentration was removed:
//   D-415  funding crowding, IC 0.1404 at t 38.35 — a POOLING artifact across 180 heterogeneous perps. Retracted.
//   D-423  score-weighted construction, 72.1%/yr at SR 1.49 — ~160 names normalised to gross 2. Flagged as concentration.
//   D-443  crypto momentum, 94.2%/yr at SR 1.13, alpha t 2.93 on FOURTEEN names — quintiles meant 3 long and 3 short.
//          At 162-name breadth the same rule gives SR 0.34, t 0.86.
// A cross-sectional statistic computed on a thin universe is a statement about a few names, not about a factor. The
// t-stat does not know the difference; this does.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
async function mustFetch(url:string,hdr:Record<string,string>,what:string):Promise<any[]>{
  // D-584: a guard that cannot READ the ledger has verified NOTHING and must never certify.
  // The old `.catch(()=>[])` turned an unreachable database into an empty array, which then sailed
  // through `Array.isArray` and printed GREEN over zero rows. Fail CLOSED instead.
  let r:Response; try{ r=await fetch(url,{headers:hdr}); }
  catch(e){ console.error(`!! cannot reach ${what}: ${e instanceof Error?e.message:e} — verified nothing. RED.`); Deno.exit(1); }
  if(!r.ok){ console.error(`!! ${what} returned HTTP ${r.status} — verified nothing. RED.`); Deno.exit(1); }
  let j:unknown; try{ j=await r.json(); }
  catch(e){ console.error(`!! ${what} gave unparseable JSON: ${e instanceof Error?e.message:e} — RED.`); Deno.exit(1); }
  if(!Array.isArray(j)){ console.error(`!! ${what} did not return rows — RED.`); Deno.exit(1); }
  return j as any[];
}

const PROMOTED=new Set(["promoted","paper","micro","small","live","armed"]);
const MIN_BREADTH=Number(Deno.env.get("MIN_XSEC_BREADTH")||50);
const SELFTEST=Deno.env.get("GUARD_SELFTEST")==="1";
// families whose results are inherently cross-sectional; a single-instrument or carry strategy has no breadth to state.
const XSEC=/(factor|cross|xsec|equity|crypto-factor)/i;

console.log("==> BREADTH GUARD — is every promoted cross-sectional result computed on enough names to BE a factor?");
const rows=await mustFetch(`${OWNED}/trd_lineage?select=id,name,family,status,key_metric,verdict`,hdr,"trd ledger") as
  {id:string;name:string;family:string|null;status:string;key_metric:string|null;verdict:string|null}[];
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-THIN",name:"14-name quintile sort",family:"crypto-factor",status:"promoted",
   key_metric:"SR 1.13, alpha t 2.93, breadth 14 names",verdict:"concentration mistaken for a factor"},
  {id:"SELFTEST-SILENT",name:"cross-section with no breadth stated",family:"equity-factor",status:"promoted",
   key_metric:"IC 0.045, t 9.25, holds OOS, 3.2x the fee, liq:HIGH SR 0.55",verdict:"never stated how many names"},
  {id:"SELFTEST-OK",name:"broad cross-section",family:"equity-factor",status:"promoted",
   key_metric:"SR 0.55 on breadth 1,850 names, liq:HIGH SR 0.55, 3.2x the fee",verdict:"a genuine factor"},
]:[])];
let red=0, checked=0;
const B=/breadth[^0-9]{0,12}([\d,]+)|([\d,]+)\s*names/i;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  if(!XSEC.test(`${r.family||""} ${r.name||""}`))continue;      // carry/single-instrument strategies are exempt
  checked++;
  const m=`${r.key_metric||""} ${r.verdict||""}`.match(B);
  const n=m?Number((m[1]||m[2]).replace(/,/g,"")):null;
  const ok=n!==null&&n>=MIN_BREADTH;
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(18)} ${(r.name||"").slice(0,32).padEnd(34)} ${
    n===null?"NO breadth stated":`breadth ${n} vs floor ${MIN_BREADTH}`}`);
}
if(checked===0) console.log(`  (no promoted cross-sectional rows — nothing to certify)`);
console.log(`\n  ${red===0?`ALL ${checked} PROMOTED CROSS-SECTIONAL ROW(S) STATE ADEQUATE BREADTH.`
  :`${red} ROW(S) RED — a thin cross-section is a statement about a few names, not a factor. Report breadth or do not promote.`}`);
if(red>0) Deno.exit(1);
