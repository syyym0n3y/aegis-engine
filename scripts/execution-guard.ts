#!/usr/bin/env -S deno run --allow-net --allow-env
// execution-guard.ts (D-449) — THE MACHINE GUARD for the EXECUTION LAW.
// Origin: D-445/447 built the strongest candidate this program has produced — the 20:00-22:00 UTC window, rank #1 of 22
// possible windows, 3.61sd above a typical one, drift-neutral excess 7.83bp at t 10.92 with 14/14 symbols agreeing, and
// positive in three of four eras. It failed at taker fees (0.87x) and cleared comfortably at maker fees (2.17x), so the
// verdict rested entirely on a maker assumption that I had written down as a "cost model".
// It is not a cost model. It is a HYPOTHESIS ABOUT FILLS, and when measured on 5-minute bars it was false: the passive
// order fills on 92% of days and those days return -1.85bp, while the +68bp lives in the 8% of days the order never fills.
// You are filled when the market comes back to you — which is when the move is not happening.
// This guard makes that impossible to forget: any promoted result whose viability depends on passive execution must state
// its return CONDITIONAL ON FILLING, not its all-days return beside a maker fee.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"eg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const PROMOTED=new Set(["promoted","paper","micro","small","live","armed"]);
const SELFTEST=Deno.env.get("GUARD_SELFTEST")==="1";
// A result only needs this certificate if it LEANS on passive execution. Taker-costed results are exempt.
// NEGATION HANDLING (a flaw caught by the guard's own self-test): a naive keyword match flagged a taker-costed row RED
// because its text read "no passive assumption" — the match fired on the negation. Keyword matching cannot distinguish
// "relies on passive fills" from "relies on nothing passive", so negated forms are stripped BEFORE matching, and a row
// that costs itself at taker without ever invoking maker is exempt outright.
const NEG=/\b(no|not|never|without)\s+(maker|limit order|passive|rebate|resting)\b/ig;
const NEEDS=/(maker|limit order|passive|rebate|resting)/i;
const TAKER_ONLY=/taker/i;
const HAS=/(conditional on fill|filled[- ]days|fill[- ]conditional|adverse selection measured)/i;

console.log("==> EXECUTION GUARD — does every maker-dependent result state its return CONDITIONAL ON FILLING?");
const rows=await fetch(`${OWNED}/trd_lineage?select=id,name,status,key_metric,verdict`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as
  {id:string;name:string;status:string;key_metric:string|null;verdict:string|null}[];
if(!Array.isArray(rows)){console.error("!! could not read trd_lineage — RED.");Deno.exit(1);}
const subjects=[...rows,...(SELFTEST?[
  {id:"SELFTEST-MAKER",name:"maker assumption, no fill study",status:"promoted",
   key_metric:"7.83bp drift-neutral, 2.17x the maker fee, 14/14 symbols",verdict:"tradable by resting orders"},
  {id:"SELFTEST-OK",name:"fill-conditional measured",status:"promoted",
   key_metric:"maker execution; return conditional on fill +9.4bp at 61% fill rate, adverse selection measured at -1.2bp",
   verdict:"passive execution verified"},
  {id:"SELFTEST-TAKER",name:"taker-costed result",status:"promoted",
   key_metric:"3.2x the taker fee, crossing the spread",verdict:"no passive assumption"},
]:[])];
let red=0, checked=0;
for(const r of subjects){
  if(!PROMOTED.has((r.status||"").toLowerCase()))continue;
  const raw=`${r.key_metric||""} ${r.verdict||""}`;
  const hay=raw.replace(NEG,"");                     // strip negated mentions before deciding relevance
  if(!NEEDS.test(hay))continue;                      // exempt: nothing here depends on passive fills
  if(TAKER_ONLY.test(raw)&&!/maker|rebate/i.test(hay))continue;   // exempt: costed by crossing the spread
  checked++;
  const ok=HAS.test(hay);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(18)} ${(r.name||"").slice(0,34).padEnd(36)} ${ok?"fill-conditional return stated":"MAKER ASSUMED, no fill-conditional return"}`);
}
if(checked===0) console.log(`  (no promoted result depends on passive execution — nothing to certify)`);
console.log(`\n  ${red===0?`ALL ${checked} MAKER-DEPENDENT ROW(S) STATE A FILL-CONDITIONAL RETURN.`
  :`${red} ROW(S) RED — a maker fee is a hypothesis about fills, not a cost. Measure the return conditional on filling.`}`);
if(red>0) Deno.exit(1);
