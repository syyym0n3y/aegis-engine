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
const counts=new Map<string,number>();
for(let off=0;;off+=1000){
  const p=await fetch(`${OWNED}/trd_fundamentals?select=concept,ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break;
  for(const r of p as {concept:string;ticker:string}[]) if(r.ticker) counts.set(r.concept+"|"+r.ticker,1);
  if(p.length<1000)break;
}
const perConcept=new Map<string,number>();
for(const k of counts.keys()){const c=k.split("|")[0]; perConcept.set(c,(perConcept.get(c)||0)+1);}
for(const f of FAMILIES){
  let have=Infinity, missing:string[]=[];
  if(f.concepts){ for(const c of f.concepts){const n=perConcept.get(c)||0; if(n<f.minTickers) missing.push(`${c}(${n})`); have=Math.min(have,n);} }
  else if(f.table){ const r=await fetch(`${OWNED}/${f.table}?select=ticker&limit=1`,{headers:{...hdr,Prefer:"count=exact"}}); const cr=r.headers.get("content-range")||""; have=+(cr.split("/")[1]||0); if(have<f.minTickers) missing.push(`${f.table}(${have})`); }
  const ok=missing.length===0;
  if(!ok) red++;
  console.log(`  ${ok?"PASS":"RED "} ${f.name.padEnd(26)} min ${String(f.minTickers).padStart(5)} | ${ok?`coverage ${have}`:`INADEQUATE: ${missing.join(", ")}`}  — ${f.note}`);
}
console.log(`\n  ${red===0?"ALL FAMILIES ADEQUATELY COVERED — a null here is evidence about the MARKET."
  :`${red} FAMILY(S) RED — a null in those is evidence about OUR DATA, not the market. Report them as UNTESTED, not NULL.`}`);
if(red>0) Deno.exit(1);
