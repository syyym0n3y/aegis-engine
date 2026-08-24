#!/usr/bin/env -S deno run --allow-net --allow-env
// sign-guard.ts (D-554) — THE SIGN LAW, enforced. Tenth guard.
// Origin: D-553. The funding book was run LONG-HIGH-funding, reported as if it were the pre-registered SHORT-HIGH
// direction, and the resulting "+48.1%/yr, SR 1.70 blend" stood as the session's best result until an unrelated test
// produced an inconsistent number. Every other law was satisfied: coverage was expanded 20x first, the portfolio-t
// decided, execution was lagged, the universe swept. The defect was that a DIRECTION was asserted and never checked
// against what the code actually did.
// RULE: any lineage row invoking a pre-registered / expected / literature sign must ALSO state whether the measured
// direction MATCHED or MISSED it. A row that claims a directional prior without stating the outcome is RED — that is
// exactly the shape D-553 had.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=Deno.env.get("SELFTEST")==="1";
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const CLAIMS_SIGN=/(pre-?registered sign|prereg(istered)? (direction|side)|literature[- ]sided|expected sign|literature sign|pre-?registered .{0,24}(short|long))/i;
// Pattern widened once (D-554b) after it flagged rows that DID state their outcome in plural or "missed" phrasing.
// Widening a detector that produces false positives is legitimate; the selftest below re-verifies it still catches the
// true negative (a row claiming a prior and stating nothing), so this is not loosening the gate to pass.
const STATES_OUTCOME=/(prereg miss|sign error|sign flip|opposite sign|sign outcome|(sign|signs|direction|directions|prior|priors)\s+(largely\s+|mostly\s+|all\s+)?(matched|missed|held|confirmed|failed|went against)|matches the (registered|pre-?registered)|registered direction (loses|wins|held)|MIXED against)/i;
console.log("==> SIGN GUARD — does every claimed directional prior state whether it MATCHED or MISSED?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,status,hypothesis,test_method,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as
  {id:string;name:string;status:string;hypothesis:string|null;test_method:string|null;key_metric:string|null;verdict:string|null}[]|null;
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-BAD",name:"carry with a directional prior",status:"monitoring",hypothesis:"the pre-registered sign is short high funding",
   test_method:"single-feature book",key_metric:"+48.1%/yr",verdict:"carry is real"},
  {id:"SELFTEST-OK",name:"carry with a stated outcome",status:"monitoring",hypothesis:"the pre-registered sign is short high funding",
   test_method:"single-feature book",key_metric:"-48.1%/yr with the registered sign",verdict:"PREREG MISS: opposite sign, not claimable"},
  {id:"SELFTEST-NOPRIOR",name:"no directional prior claimed",status:"monitoring",hypothesis:"does non-linearity add",
   test_method:"paired IC",key_metric:"t 1.76",verdict:"null"},
]:[])];
let red=0,checked=0;
for(const r of subjects){
  const hay=`${r.hypothesis||""} ${r.test_method||""} ${r.key_metric||""} ${r.verdict||""}`;
  if(!CLAIMS_SIGN.test(hay))continue;                      // exempt: no directional prior invoked
  checked++;
  const ok=STATES_OUTCOME.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(28)} ${(r.name||"").slice(0,32).padEnd(34)} ${ok?"sign outcome stated":"CLAIMS A SIGN PRIOR, NEVER STATES THE OUTCOME"}`);
}
if(checked===0)console.log("  (no row invokes a directional prior — nothing to certify)");
console.log(`\n  ${red===0?`ALL ${checked} ROW(S) WITH A SIGN PRIOR STATE THEIR OUTCOME.`
  :`${red} ROW(S) RED — a direction asserted and never checked is how D-553 happened.`}`);
if(red>0)Deno.exit(1);
