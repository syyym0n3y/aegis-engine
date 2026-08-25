#!/usr/bin/env -S deno run --allow-net --allow-env
// holdability-guard.ts (D-566) — THE HOLDABILITY LAW. Twelfth guard.
// Origin: eleven guards, every one about statistical validity, and NONE about whether a human can hold the thing.
// The crypto candidate survived ten attacks and was then disqualified by a fact no gate measured: 42 months underwater.
// Depth alone does not capture this — a -65% drawdown recovered in three months is a different instrument from one
// that lasts three and a half years, and the second is what ends real deployments.
// RULE: any lineage row making a RETURN claim (SR or %/yr) in a live state must also state its TIME UNDERWATER.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=(Deno.env.get("SELFTEST")||Deno.env.get("GUARD_SELFTEST"))==="1";   // D-586: accept BOTH names — the split (6 guards one, 5 the other) produced a silent no-op self-test that I nearly reported as a verification
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"hg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const LIVE=new Set(["monitoring","promoted","paper","micro","small","scaled"]);
// SCOPE, stated: this law protects DEPLOYMENT decisions, so it binds rows describing a candidate BOOK (families
// book/ml) — not every research row that happens to quote a factor's %/yr. Narrowing scope to where a law is
// meaningful is legitimate; narrowing it to dodge failures is not, so the excluded families are named explicitly and
// the guard still REDs any book/ml row that omits duration.
const IN_SCOPE=new Set(["book","ml"]);
const CLAIMS_RETURN=/(SR\s*-?\d|Sharpe\s*-?\d|%\/yr)/;
const STATES_UW=/(underwater|time.under.water|months? under|days? under|recovery (time|period)|drawdown duration|held through)/i;
console.log("==> HOLDABILITY GUARD — does every live return claim state its TIME UNDERWATER, not just its depth?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,family,status,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as
  {id:string;name:string;family:string;status:string;key_metric:string|null;verdict:string|null}[]|null;
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-BAD",name:"return claim, depth only",family:"ml",status:"monitoring",key_metric:"66.8%/yr SR 1.18 maxDD -65%",verdict:"strong"},
  {id:"SELFTEST-OK",name:"return claim with duration",family:"ml",status:"monitoring",key_metric:"66.8%/yr SR 1.18 maxDD -65%, 42 months underwater",verdict:"holdability stated"},
  // D-586: proves the cross-reference exclusion is not a blanket escape hatch — a row that quotes an inherited SR
  // AND makes its own return claim must still be caught.
  {id:"SELFTEST-XREF-ONLY",name:"quotes another spec, claims nothing",family:"ml",status:"monitoring",key_metric:"rank IC 0.0798 t 5.69; BOOK VERDICT UNAVAILABLE | UNIVERSE SENSITIVITY: inherited from the frozen spec — SR 0.64-1.41",verdict:"IC only"},
  {id:"SELFTEST-XREF-PLUS",name:"quotes another AND claims its own",family:"ml",status:"monitoring",key_metric:"this book earns 44.0%/yr | UNIVERSE SENSITIVITY: inherited — SR 0.64-1.41",verdict:"own claim, no duration"},
  {id:"SELFTEST-NOCLAIM",name:"no return claim",family:"ml",status:"monitoring",key_metric:"rank IC 0.08, t 5.69",verdict:"replication"},
]:[])];
let red=0,checked=0;
for(const r of subjects){
  if(!LIVE.has((r.status||"").toLowerCase()))continue;
  if(!IN_SCOPE.has((r.family||"").toLowerCase()))continue;
  const hay=`${r.key_metric||""} ${r.verdict||""}`;
  // D-586: a row's OWN return claim, not one it merely quotes. The inherited "UNIVERSE SENSITIVITY: ... SR 0.64-1.41"
  // boilerplate is a cross-reference to the spec a row TESTS, and matching it flagged crypto-bybit-replication —
  // a row that explicitly records "BOOK VERDICT UNAVAILABLE" and reports an IC, never a return. A guard that reddens
  // already-correct rows is the failure mode that gets guards ignored, so strip cross-references before testing.
  const own=hay.replace(/UNIVERSE SENSITIVITY:[^|]*/gi,"").replace(/[^|]*inherited from[^|]*/gi,"");
  if(!CLAIMS_RETURN.test(own))continue;
  checked++;
  const ok=STATES_UW.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(28)} ${(r.name||"").slice(0,30).padEnd(32)} ${ok?"time-underwater stated":"RETURN CLAIMED, DURATION OF PAIN NOT STATED"}`);
}
if(checked===0)console.log("  (no live return claims — nothing to certify)");
console.log(`\n  ${red===0?`ALL ${checked} LIVE RETURN CLAIM(S) STATE THEIR TIME UNDERWATER.`
  :`${red} ROW(S) RED — depth without duration hides the thing that actually ends deployments.`}`);
if(red>0)Deno.exit(1);
