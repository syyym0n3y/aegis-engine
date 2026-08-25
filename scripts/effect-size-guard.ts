#!/usr/bin/env -S deno run --allow-net --allow-env
// effect-size-guard.ts (D-429) — THE MACHINE GUARD for the EFFECT-SIZE LAW.
// Origin (D-426): perp order flow produced the most statistically convincing result this program has ever seen — rank IC
// negative on 20 of 20 instruments (P ~ 2e-6 under the null), |t| to 4.9, holding out-of-sample, on an instrument clearing
// $523M PER HOUR. Capacity was not the constraint. It was still untradable, and the reason was invisible in every statistic
// being reported: the effect is 0.02x-0.14x the round-trip maker fee. The same data gives OLS |t| < 1.3 — because in
// fat-tailed hourly returns a RANK statistic orders the 99% of small moves that carry no money, while the money sits in a
// tail where the relationship is absent.
// A significance test answers "is it there". Only effect-size-in-fee-units answers "is it worth acting on". This enforces
// that the second question was asked.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"es",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
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
const MIN_X=Number(Deno.env.get("MIN_FEE_MULTIPLE")||1.0);
const SELFTEST=Deno.env.get("GUARD_SELFTEST")==="1";

console.log("==> EFFECT-SIZE GUARD — is every promoted strategy's edge LARGER than the cost of acting on it?");
const rows=await mustFetch(`${OWNED}/trd_lineage?select=id,name,status,key_metric,verdict`,hdr,"trd ledger") as
  {id:string;name:string;status:string;key_metric:string|null;verdict:string|null}[];
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — cannot certify. RED.");Deno.exit(1);}
// Fixtures cover all three branches: below-fee, significant-but-never-stated (the D-426 failure mode itself), and compliant.
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-SUBFEE",name:"sub-fee microstructure",status:"promoted",
   key_metric:"rank IC -0.015, t -4.9, 20/20 sign consistency; effect 0.09x the fee",verdict:"statistically overwhelming, economically absent"},
  {id:"SELFTEST-SILENT",name:"significance without magnitude",status:"promoted",
   key_metric:"IC 0.045, t 9.25, holds out-of-sample",verdict:"never stated an effect size in fee units"},
  {id:"SELFTEST-OK",name:"compliant example",status:"promoted",
   key_metric:"effect 3.2x the fee net of slippage",verdict:"tradable"},
]:[])];
let red=0, checked=0;
const FEEX=/(\d+\.?\d*)\s*x\s*(the\s*)?fee/i;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  checked++;
  const m=`${r.key_metric||""} ${r.verdict||""}`.match(FEEX);
  const x=m?Number(m[1]):null;
  const ok=x!==null&&x>=MIN_X;
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(18)} ${(r.name||"").slice(0,32).padEnd(34)} ${
    x===null?"NO effect size in fee units recorded":`${x}x the fee vs floor ${MIN_X}x`}`);
}
if(checked===0) console.log(`  (no rows in a promoted state — nothing to certify)`);
console.log(`\n  ${red===0?`ALL ${checked} PROMOTED ROW(S) STATE AN EDGE LARGER THAN ITS COST.`
  :`${red} PROMOTED ROW(S) RED — significance is not tradability. State the effect in fee units or do not promote.`}`);
if(red>0) Deno.exit(1);
