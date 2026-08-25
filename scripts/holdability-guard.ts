#!/usr/bin/env -S deno run --allow-net --allow-env
// holdability-guard.ts (D-566) — THE HOLDABILITY LAW. Twelfth guard.
// Origin: eleven guards, every one about statistical validity, and NONE about whether a human can hold the thing.
// The crypto candidate survived ten attacks and was then disqualified by a fact no gate measured: 42 months underwater.
// Depth alone does not capture this — a -65% drawdown recovered in three months is a different instrument from one
// that lasts three and a half years, and the second is what ends real deployments.
// RULE: any lineage row making a RETURN claim (SR or %/yr) in a live state must also state its TIME UNDERWATER.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=Deno.env.get("SELFTEST")==="1";
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
  {id:"SELFTEST-NOCLAIM",name:"no return claim",family:"ml",status:"monitoring",key_metric:"rank IC 0.08, t 5.69",verdict:"replication"},
]:[])];
let red=0,checked=0;
for(const r of subjects){
  if(!LIVE.has((r.status||"").toLowerCase()))continue;
  if(!IN_SCOPE.has((r.family||"").toLowerCase()))continue;
  const hay=`${r.key_metric||""} ${r.verdict||""}`;
  if(!CLAIMS_RETURN.test(hay))continue;
  checked++;
  const ok=STATES_UW.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(28)} ${(r.name||"").slice(0,30).padEnd(32)} ${ok?"time-underwater stated":"RETURN CLAIMED, DURATION OF PAIN NOT STATED"}`);
}
if(checked===0)console.log("  (no live return claims — nothing to certify)");
console.log(`\n  ${red===0?`ALL ${checked} LIVE RETURN CLAIM(S) STATE THEIR TIME UNDERWATER.`
  :`${red} ROW(S) RED — depth without duration hides the thing that actually ends deployments.`}`);
if(red>0)Deno.exit(1);
