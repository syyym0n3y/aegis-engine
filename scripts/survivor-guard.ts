#!/usr/bin/env -S deno run --allow-net --allow-env
// survivor-guard.ts (D-557) — THE LEDGER MUST NOT CONTRADICT ITSELF. Eleventh guard.
// Origin: trd_factory reported 2 SURVIVORS — book|p1|core (t 6.21) and book|p2|volmanaged (t 7.09) — both clearing the
// deflation ceiling. Their own trd_lineage rows say the t is DESCRIPTIVE because the components were selected
// in-sample. The gate cannot see that: in-sample component selection never passed through the trial counter, so the
// ceiling is blind to it. The `survivor` column is a GENERATED boolean over six gates and cannot be edited, which is
// correct design — the fix is not to mutate it but to CATCH the contradiction.
// RULE: any trd_factory row flagged survivor whose corresponding lineage row disclaims its own statistic
// (descriptive / in-sample / not identified / superseded) is RED.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=Deno.env.get("SELFTEST")==="1";
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sv",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const DISCLAIMS=/(descriptive|in-sample|not identified|NOT IDENTIFIED|superseded|selected in-sample|is DESCRIPTIVE|prereg miss|unregistered)/i;
console.log("==> SURVIVOR GUARD — does any flagged survivor disclaim its own statistic elsewhere in the ledger?");
const surv=await fetch(`${OWNED}/trd_factory?survivor=eq.true&select=spec_key,family,portfolio_t,note`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as
  {spec_key:string;family:string;portfolio_t:number;note:string|null}[]|null;
if(!Array.isArray(surv)){console.error("!! could not read trd_factory — RED.");Deno.exit(1);}
const lin=await fetch(`${OWNED}/trd_lineage?select=id,family,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as
  {id:string;family:string;key_metric:string|null;verdict:string|null}[];
const subjects=[...surv,...(SELFTEST?[
  // synthetic rows use an isolated family so they are judged on their OWN note, not on real lineage text — the first
  // version pooled all lineage of family "book" and so flagged the clean row too, a false positive caught by its own selftest
  {spec_key:"SELFTEST|disclaimed",family:"SELFTESTFAM",portfolio_t:9.9,note:"the t is DESCRIPTIVE: components selected in-sample"},
  {spec_key:"SELFTEST|clean",family:"SELFTESTFAM",portfolio_t:9.9,note:"pre-registered, out-of-sample, no disclaimer"},
]:[])];
let red=0;
for(const s of subjects){
  const own=(s.note||"");
  const kin=(Array.isArray(lin)?lin:[]).filter(l=>l.family===s.family).map(l=>`${l.key_metric||""} ${l.verdict||""}`).join(" ");
  const hay=`${own} ${kin}`;
  const bad=DISCLAIMS.test(hay);
  if(bad)red++;
  console.log(`  ${bad?"RED ":"PASS"} ${s.spec_key.padEnd(24)} t=${(+s.portfolio_t).toFixed(2).padStart(6)}  ${bad?"FLAGGED SURVIVOR but the ledger disclaims this statistic":"survivor with no disclaimer"}`);
}
if(!subjects.length)console.log("  (no survivors flagged — nothing to certify)");
console.log(`\n  ${red===0?`NO CONTRADICTED SURVIVORS.`
  :`${red} CONTRADICTED SURVIVOR(S) — the gates cannot see in-sample component selection, so a flagged survivor whose own lineage calls its t descriptive is a FALSE POSITIVE and must not be read as a promotion.`}`);
if(red>0)Deno.exit(1);
