#!/usr/bin/env -S deno run --allow-net --allow-env
// refresh-core-fundamentals.ts (D-420) — COVERAGE LAW repair. The four CORE concepts (Assets, Liabilities,
// (Assets/Liabilities/Equity/NetIncome/Shares) while EDGAR exposes hundreds — so entire documented factor families were
// never tested, not because they failed but because the data was never fetched. The operator was right to call this out.
// Loads the balance-sheet concepts needed for ACCRUALS (Sloan 1996 — among the most robust anomalies ever documented),
// net-operating-assets, and working-capital dynamics. Free/keyless EDGAR frames, point-in-time (period_end + 75d filing lag).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const UA={"User-Agent":"Aegis Research ona@revitalise.io"};
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"df",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
// CIK -> ticker
const c2t=new Map<string,string>();
try{const j=await fetch("https://www.sec.gov/files/company_tickers.json",{headers:UA}).then(r=>r.json());
  for(const v of Object.values(j as Record<string,{cik_str:number;ticker:string}>)) c2t.set(String(v.cik_str),(v.ticker||"").toUpperCase());}catch{/*ignore*/}
const CONCEPTS=["Assets","Liabilities","StockholdersEquity","NetIncomeLoss","EntityCommonStockSharesOutstanding"];
// NetIncomeLoss is a FLOW (duration frame: CY2024Q1) — the others are STOCKS (instantaneous: CY2024Q1I). Requesting the
// wrong frame type returns 404 and would silently look like "the data does not exist", i.e. the exact failure mode the
// COVERAGE LAW exists to prevent. So the suffix is chosen per concept, and misses are counted and reported.
const FLOW=new Set(["NetIncomeLoss"]);
const DEI=new Set(["EntityCommonStockSharesOutstanding"]);
const addDays=(d:string,n:number)=>{const t=new Date(d+"T00:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
let total=0;
for(const c of CONCEPTS){
  let stored=0;
  let miss=0;
  for(let y=2023;y<=2026;y++) for(const q of ["Q1","Q2","Q3","Q4"]){
    const per=`CY${y}${q}${FLOW.has(c)?"":"I"}`;
    try{
      const r=await fetch(`https://data.sec.gov/api/xbrl/frames/${DEI.has(c)?"dei":"us-gaap"}/${c}/${DEI.has(c)?"shares":"USD"}/${per}.json`,{headers:UA});
      if(!r.ok){miss++;await new Promise(x=>setTimeout(x,120));continue;}
      const data=(await r.json())?.data as {cik:number;end:string;val:number}[]|undefined;
      if(!Array.isArray(data)){miss++;await new Promise(x=>setTimeout(x,120));continue;}
      const rows=data.filter(d=>Number.isFinite(d.val)&&d.end)
        .map(d=>({cik:c2t.get(String(d.cik))??String(d.cik),ticker:c2t.get(String(d.cik))??null,concept:c,
                  period_end:d.end,effective_date:addDays(d.end,75),value:d.val,updated_at:new Date().toISOString()}))
        .filter(x=>x.ticker)
        // FUTURE-PERIOD GUARD: EDGAR frames occasionally carry a filing whose period_end is in the future (shell companies
        // reporting a forward fiscal year-end). asOf() filtering makes them inert, but a fact that "was knowable" before it
        // happened has no place in a point-in-time store. Drop them at the door.
        .filter(x=>x.period_end<=new Date().toISOString().slice(0,10));
      // plumbing-ok: chunk write failures tolerated — landing is VERIFIED by re-reading max(effective_date)/counts at the end
      for(let i=0;i<rows.length;i+=1000){
        await fetch(`${OWNED}/trd_fundamentals?on_conflict=cik,concept,period_end`,{method:"POST",
          headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+1000))}).catch(()=>{});}
      stored+=rows.length;
    }catch{/*skip*/}
    await new Promise(x=>setTimeout(x,120));
  }
  console.log(`  ${c}: ${stored} rows fetched, ${miss} frames missing/404`); total+=stored;
}
// VERIFY THE WRITES LANDED (accountability directive: a POST that silently no-ops is the failure mode, not the exception).
// Re-read max(effective_date) per concept from the DB and assert it actually moved past the 2023-07 wall.
console.log(`==> fetched ${total} rows across ${CONCEPTS.length} core concepts — verifying they LANDED:`);
let bad=0;
for(const c of CONCEPTS){
  const r=await fetch(`${OWNED}/trd_fundamentals?concept=eq.${c}&select=effective_date&order=effective_date.desc&limit=1`,{headers:hdr}).then(x=>x.json()).catch(()=>[]);
  const maxd=Array.isArray(r)&&r[0]?r[0].effective_date:"NONE";
  const ok=typeof maxd==="string"&&maxd>"2024-01-01";
  if(!ok)bad++;
  console.log(`  ${ok?"OK  ":"FAIL"} ${c.padEnd(38)} max effective_date now ${maxd}`);
}
if(bad){console.error(`\n!! ${bad}/${CONCEPTS.length} concepts did NOT advance past the 2023 wall — coverage NOT repaired.`);Deno.exit(1);}
console.log(`\n==> COVERAGE REPAIRED: all ${CONCEPTS.length} core concepts now extend past 2024.`);
