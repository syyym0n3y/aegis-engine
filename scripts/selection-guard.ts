#!/usr/bin/env -S deno run --allow-net --allow-env
// selection-guard.ts (D-456) — THE MACHINE GUARD for the SELECTION LAW.
// Origin: D-455. The combined book reported that overlaying trend SELECTIVELY — only on the asset classes where it
// measured positive — recovered out-of-sample Sharpe from 0.00 to 0.37. The class list was hardcoded from a FULL-SAMPLE
// measurement and then applied across the OOS window. Re-made honestly on TRAIN ONLY, the overlay was negative in EVERY
// class (equity −22.0pp, commodity −8.8pp, sector −4.6pp, index −3.5pp, etf −1.7pp, fx −0.9pp): no class qualified, and
// the "selective" book collapsed exactly onto the passive one.
// This is look-ahead in the CHOICE rather than in the data, and it is invisible to every other guard here — the returns
// were computed correctly, the split was real, no future prices were touched. What leaked was WHICH COMPONENTS to keep.
// Any result that picks among classes, symbols, parameters or variants must declare that the pick was made on train only.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sg2",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
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
const SELFTEST=(Deno.env.get("SELFTEST")||Deno.env.get("GUARD_SELFTEST"))==="1";   // D-586: accept BOTH names — the split (6 guards one, 5 the other) produced a silent no-op self-test that I nearly reported as a verification
// Does this result involve CHOOSING among components? Those are the ones that can leak selection.
// NEGATION HANDLING: the same flaw the execution guard's self-test exposed. A fixture reading "nothing chosen" tripped the
// naive match on the word "chosen". Negated forms are stripped before deciding relevance, so a result that explicitly
// makes NO selection is exempt rather than flagged.
const NEG=/\b(no|not|never|nothing|without)\s+(selective|chosen|selected|picked|selection|choice)\b/ig;
const PICKS=/(selective|only where|subset of|chosen|selected|best[- ]performing|excluding|top[- ]?n|picked)/i;
// Did it declare the pick was made without using the evaluation window?
const CLEAN=/(train[- ]only|selected on train|expanding window|walk[- ]forward selection|out[- ]of[- ]sample selection|frozen on train)/i;

console.log("==> SELECTION GUARD — was every component choice made WITHOUT the evaluation window?");
const rows=await mustFetch(`${OWNED}/trd_lineage?select=id,name,status,key_metric,verdict,test_method`,hdr,"trd ledger") as
  {id:string;name:string;status:string;key_metric:string|null;verdict:string|null;test_method:string|null}[];
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-LEAK",name:"selective overlay, full-sample pick",status:"promoted",test_method:"applied the overlay ONLY WHERE it measured positive across the whole sample",
   key_metric:"OOS Sharpe 0.00 -> 0.37",verdict:"selectivity is worth 0.37 of Sharpe"},
  {id:"SELFTEST-OK",name:"selective overlay, train-only pick",status:"promoted",test_method:"classes SELECTED ON TRAIN only, frozen, then applied to test",
   key_metric:"OOS Sharpe 0.44",verdict:"honest selection"},
  {id:"SELFTEST-NOPICK",name:"no component choice at all",status:"promoted",test_method:"single fixed rule applied to every instrument, nothing chosen",
   key_metric:"SR 0.5",verdict:"no selection step"},
]:[])];
let red=0, checked=0;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  const hay=`${r.test_method||""} ${r.key_metric||""} ${r.verdict||""}`.replace(NEG,"");
  if(!PICKS.test(hay))continue;                        // exempt: nothing was chosen, so nothing could leak
  checked++;
  const ok=CLEAN.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(20)} ${(r.name||"").slice(0,34).padEnd(36)} ${ok?"selection declared train-only":"SELECTION may have used the evaluation window"}`);
}
if(checked===0) console.log(`  (no promoted result involves a component choice — nothing to certify)`);
console.log(`\n  ${red===0?`ALL ${checked} SELECTING ROW(S) DECLARE AN HONEST SELECTION.`
  :`${red} ROW(S) RED — choosing components on the full sample and reporting an OOS number is not out of sample.`}`);
if(red>0) Deno.exit(1);
