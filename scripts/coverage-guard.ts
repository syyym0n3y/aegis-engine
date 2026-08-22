#!/usr/bin/env -S deno run --allow-net --allow-env
// coverage-guard.ts (D-407) — THE MACHINE GUARD for the Coverage Law. Aegis reported market-level conclusions while holding
// 5 of hundreds of available fundamental concepts: entire factor families were "not found" because their inputs were never
// fetched. Documentation cannot prevent that recurring; this can.
// For every factor family Aegis claims to test, this declares the data it REQUIRES, measures what is actually held on the
// owned node, and EXITS RED if any family's verdict would rest on inadequate coverage. Run before recording any verdict.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
// each family: the concepts/tables it REQUIRES and the minimum coverage for a verdict to be about the MARKET
const STRICT=Deno.env.get("GUARD_SELFTEST")==="1";
const FAMILIES:{name:string;concepts?:string[];table?:string;minTickers:number;note:string}[]=[
  {name:"value / earnings-yield",concepts:["StockholdersEquity","NetIncomeLoss","EntityCommonStockSharesOutstanding"],minTickers:STRICT?99999:1000,note:"book/mktcap, E/P"},
  {name:"ACCRUALS (Sloan)",concepts:["AssetsCurrent","LiabilitiesCurrent","CashAndCashEquivalentsAtCarryingValue","Assets"],minTickers:1000,note:"working-capital accruals"},
  {name:"working-capital growth",concepts:["InventoryNet","AccountsReceivableNetCurrent"],minTickers:800,note:"inventory/receivable growth"},
  {name:"investment / asset growth",concepts:["Assets"],minTickers:1000,note:"asset growth"},
  {name:"net issuance",concepts:["EntityCommonStockSharesOutstanding"],minTickers:1000,note:"share-count change"},
  {name:"insider",table:"trd_insider",minTickers:500,note:"Form-4 events"},
  ...(STRICT?[{name:"cash-flow-to-price (UNFETCHED)",concepts:["NetCashProvidedByUsedInOperatingActivities"],minTickers:1000,note:"the exact failure mode: input never loaded"}]:[]),
  {name:"short interest",table:"trd_fundflow",minTickers:0,note:"see D-391: underpowered, 26 settlements"},
];
console.log("==> COVERAGE GUARD — is every factor family's verdict backed by adequate data?");
let red=0;
// D-467c: breadth AND freshness now come from trd_fundamentals_coverage_v — one server-side grouped scan instead of
// paginating 1.2M rows client-side (which, once correctly ORDER'd, took >2 minutes; the view answers in milliseconds).
const cov=await fetch(`${OWNED}/trd_fundamentals_coverage_v?select=concept,tickers,newest_period_end`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {concept:string;tickers:number;newest_period_end:string}[];
if(!Array.isArray(cov)||!cov.length){console.error("!! coverage view unreadable — cannot certify anything. RED.");Deno.exit(1);}
const perConcept=new Map<string,number>(cov.map(r=>[r.concept,+r.tickers]));
const MAX_STALE_DAYS=Number(Deno.env.get("MAX_STALE_DAYS")||400);
const today=new Date().toISOString().slice(0,10);
const ageDays=(d:string)=>Math.round((Date.parse(today)-Date.parse(d))/86400000);
const freshness=new Map<string,string>(cov.map(r=>[r.concept,r.newest_period_end||"NONE"]));
for(const f of FAMILIES){
  let have=Infinity, missing:string[]=[];
  if(f.concepts){ for(const c of f.concepts){const n=perConcept.get(c)||0; if(n<f.minTickers) missing.push(`${c}(${n})`); have=Math.min(have,n);
      const fd=freshness.get(c)||"NONE"; const age=fd==="NONE"?99999:ageDays(fd);
      // STRICT self-test tightens the bar so the guard is proven to go RED on staleness, not merely to pass on fresh data.
      if(age>(STRICT?1:MAX_STALE_DAYS)) missing.push(`${c} STALE: newest period_end ${fd} (${age}d old)`); } }
  else if(f.table){ const r=await fetch(`${OWNED}/${f.table}?select=ticker&limit=1`,{headers:{...hdr,Prefer:"count=exact"}}); const cr=r.headers.get("content-range")||""; have=+(cr.split("/")[1]||0); if(have<f.minTickers) missing.push(`${f.table}(${have})`); }
  const ok=missing.length===0;
  if(!ok) red++;
  const fresh=f.concepts?` | newest ${f.concepts.map(c=>freshness.get(c)||"NONE").sort()[0]}`:"";
  console.log(`  ${ok?"PASS":"RED "} ${f.name.padEnd(26)} min ${String(f.minTickers).padStart(5)} | ${ok?`coverage ${have}${fresh}`:`INADEQUATE: ${missing.join(", ")}`}  — ${f.note}`);
}
console.log(`\n  ${red===0?"ALL FAMILIES ADEQUATELY COVERED — a null here is evidence about the MARKET."
  :`${red} FAMILY(S) RED — a null in those is evidence about OUR DATA, not the market. Report them as UNTESTED, not NULL.`}`);
if(red>0) Deno.exit(1);
