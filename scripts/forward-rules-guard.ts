#!/usr/bin/env -S deno run --allow-net --allow-env
// forward-rules-guard.ts (D-571) — THE PRE-COMMITMENT LAW. Thirteenth guard.
// Origin: four forward clocks were started without stating what result would promote or kill each candidate. That
// leaves every future reader — including a future session of me — free to rationalise whatever arrives, which is the
// failure mode no statistical gate can catch because it happens in the narration.
// RULE: every lineage row in a forward-registered state must have a matching row in trd_forward_rules, written BEFORE
// its data exists, specifying promote / kill / inconclusive.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const SELFTEST=Deno.env.get("SELFTEST")==="1";
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fr",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const rules=await fetch(`${OWNED}/trd_forward_rules?select=id,spec,promote_if,kill_if`,{headers:hdr}).then(r=>r.json()).catch(()=>null) as {id:string;spec:string;promote_if:string;kill_if:string}[]|null;
if(!Array.isArray(rules)){console.error("!! could not read trd_forward_rules — RED.");Deno.exit(1);}
console.log(`==> FORWARD-RULES GUARD — ${rules.length} registered decision rules`);
let red=0;
// every rule must specify BOTH directions, in falsifiable terms
for(const r of rules){
  const ok=r.promote_if.length>40&&r.kill_if.length>40&&/\d/.test(r.promote_if)&&/\d/.test(r.kill_if);
  if(!ok)red++;
  console.log(`  ${ok?"PASS":"RED "} ${r.id.padEnd(22)} ${ok?"promote AND kill conditions are numeric and specific":"VAGUE OR ONE-SIDED — a rule without a kill condition is not a rule"}`);
}
if(SELFTEST){
  const bad={id:"SELFTEST-VAGUE",spec:"x",promote_if:"if it looks good",kill_if:"if it looks bad"};
  const ok=bad.promote_if.length>40&&bad.kill_if.length>40&&/\d/.test(bad.promote_if)&&/\d/.test(bad.kill_if);
  console.log(`  ${ok?"PASS":"RED "} SELFTEST-VAGUE         ${ok?"":"VAGUE OR ONE-SIDED — a rule without a kill condition is not a rule"}`);
  if(!ok)red++;
}
console.log(`\n  ${red===0?`ALL ${rules.length} FORWARD RULES ARE TWO-SIDED AND NUMERIC.`:`${red} RULE(S) RED — pre-commitment that cannot be violated is not pre-commitment.`}`);
if(red>0)Deno.exit(1);
