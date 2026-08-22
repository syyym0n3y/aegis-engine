#!/usr/bin/env -S deno run --allow-net --allow-env
// factory-report.ts (D-470) — the sweep's verdict, straight from the ledger. Survivors come from the GENERATED column;
// this script formats, it never judges.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fr",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const j=async(u:string)=>await fetch(`${OWNED}/${u}`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
const cnt=async(u:string)=>{const r=await fetch(`${OWNED}/${u}&limit=1`,{headers:{...hdr,Prefer:"count=exact"}}).catch(()=>null);return r?+((r.headers.get("content-range")||"").split("/")[1]||0):0;};
const trials=await cnt("trd_trial_counter?select=id");
const N=1_530_000+trials, CEIL=Math.sqrt(2*Math.log(N));
console.log(`==> FACTORY REPORT — deflation ceiling ${CEIL.toFixed(3)} at N=${N.toLocaleString()} (${trials} factory trials)`);
const fam=await j("trd_factory?select=family") as {family:string}[];
const byFam=new Map<string,number>(); for(const r of fam)byFam.set(r.family,(byFam.get(r.family)||0)+1);
const survN=await cnt("trd_factory?survivor=eq.true&select=spec_key");
console.log(`    specs: ${fam.length}  (${[...byFam.entries()].map(([f,n])=>`${f}:${n}`).join("  ")})`);
console.log(`    SURVIVORS (all six gates + not ruined): ${survN}`);
const surv=await j("trd_factory?survivor=eq.true&select=spec_key,n_names,n_periods,net_ann,sharpe_net,portfolio_t,maxdd_pct&order=portfolio_t.desc&limit=25") as Record<string,number|string>[];
for(const s of surv) console.log(`      ${String(s.spec_key).padEnd(44)} t=${(+s.portfolio_t).toFixed(2)}  net ${(+s.net_ann*100).toFixed(1)}%/yr  SR ${(+s.sharpe_net).toFixed(2)}  breadth ${s.n_names}  n=${s.n_periods}  dd ${s.maxdd_pct}%`);
console.log(`\n    TOP LEADS (best portfolio-t regardless of gates):`);
const leads=await j("trd_factory?portfolio_t=not.is.null&ruined=eq.false&select=spec_key,family,n_names,n_periods,net_ann,portfolio_t,g_breadth,g_effect,g_benchmark,g_era,g_deflation&order=portfolio_t.desc&limit=15") as Record<string,unknown>[];
const gg=(r:Record<string,unknown>)=>["breadth","effect","benchmark","era","deflation"].map(k=>r["g_"+k]?"+":"-").join("");
for(const r of leads) console.log(`      ${String(r.spec_key).padEnd(44)} t=${(+(r.portfolio_t as number)).toFixed(2)}  net ${(+(r.net_ann as number)*100).toFixed(1)}%/yr  n=${r.n_periods}  gates[b/e/bm/era/defl]=${gg(r)}`);
const untested=await cnt("trd_factory?portfolio_t=is.null&select=spec_key");
console.log(`\n    UNTESTED (insufficient panel — recorded, not hidden): ${untested}`);
