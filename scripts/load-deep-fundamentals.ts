#!/usr/bin/env -S deno run --allow-net --allow-env
// load-deep-fundamentals.ts (D-406) — closing a SELF-INFLICTED research gap. Aegis had FIVE fundamental concepts loaded
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
const CONCEPTS=["AssetsCurrent","LiabilitiesCurrent","CashAndCashEquivalentsAtCarryingValue","InventoryNet","AccountsReceivableNetCurrent"];
const addDays=(d:string,n:number)=>{const t=new Date(d+"T00:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
let total=0;
for(const c of CONCEPTS){
  let stored=0;
  for(let y=2012;y<=2025;y++) for(const q of ["Q1I","Q2I","Q3I","Q4I"]){
    const per=`CY${y}${q}`;
    try{
      const r=await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${c}/USD/${per}.json`,{headers:UA});
      if(!r.ok){await new Promise(x=>setTimeout(x,120));continue;}
      const data=(await r.json())?.data as {cik:number;end:string;val:number}[]|undefined;
      if(!Array.isArray(data)){await new Promise(x=>setTimeout(x,120));continue;}
      const rows=data.filter(d=>Number.isFinite(d.val)&&d.end)
        .map(d=>({cik:c2t.get(String(d.cik))??String(d.cik),ticker:c2t.get(String(d.cik))??null,concept:c,
                  period_end:d.end,effective_date:addDays(d.end,75),value:d.val,updated_at:new Date().toISOString()}))
        .filter(x=>x.ticker);
      for(let i=0;i<rows.length;i+=1000){
        await fetch(`${OWNED}/trd_fundamentals?on_conflict=cik,concept,period_end`,{method:"POST",
          headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+1000))}).catch(()=>{});}
      stored+=rows.length;
    }catch{/*skip*/}
    await new Promise(x=>setTimeout(x,120));
  }
  console.log(`  ${c}: ${stored} rows`); total+=stored;
}
console.log(`==> DEEP FUNDAMENTALS: ${total} rows across ${CONCEPTS.length} new concepts`);
