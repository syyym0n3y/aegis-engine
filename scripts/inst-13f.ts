#!/usr/bin/env -S deno run --allow-net --allow-env
// inst-13f.ts (D-413) — 13F INSTITUTIONAL HOLDINGS, a Tier-1 gap. Quarterly holdings of every manager >$100M, free from
// EDGAR. Documented signals: institutional ownership CHANGE (smart-money accumulation) and OWNERSHIP CONCENTRATION (crowding).
// The honest constraint stated up front: 13F is filed 45 days after quarter-end, so any signal must be tested with that lag —
// which is exactly why the documented effects are weak. Testing it properly rather than assuming.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
const UA={"User-Agent":"Aegis Research ona@revitalise.io"};
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"f13",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
// 13F-HR filings from the quarterly full-index; sample the largest managers by filing frequency
const YEARS=(Deno.env.get("YEARS")||"2021,2022,2023,2024,2025").split(",");
const filings:{cik:string;acc:string;date:string}[]=[];
for(const y of YEARS) for(const q of [1,2,3,4]){
  try{const r=await fetch(`https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/form.idx`,{headers:UA}); if(!r.ok)continue;
    for(const ln of (await r.text()).split("\n")){
      if(!/^13F-HR\s/.test(ln))continue;
      const m=ln.match(/^13F-HR\s+.*?\s(\d{4,10})\s+(\d{4}-\d{2}-\d{2})\s+(\S+)/); if(!m)continue;
      filings.push({cik:String(+m[1]),acc:m[3],date:m[2]});}
    await new Promise(x=>setTimeout(x,130));
  }catch{/*skip*/}
}
console.log(`==> 13F: ${filings.length} 13F-HR filings across ${YEARS.length} years`);
const byCik=new Map<string,number>(); for(const f of filings) byCik.set(f.cik,(byCik.get(f.cik)||0)+1);
console.log(`    distinct managers: ${byCik.size}; filing consistently (>=8 quarters): ${[...byCik.values()].filter(v=>v>=8).length}`);
// parse the information tables of the largest/most consistent managers
const top=[...byCik.entries()].filter(([,n])=>n>=8).slice(0,Number(Deno.env.get("NMGR")||120)).map(([c])=>c);
const holdings=new Map<string,Map<string,number>>();   // quarter -> cusip/ticker-ish -> total value
let parsed=0;
for(const f of filings.filter(x=>top.includes(x.cik))){
  const accNo=f.acc.split("/").pop()?.replace(".txt","")||""; const accClean=accNo.replace(/-/g,"");
  try{
    const idx=await fetch(`https://www.sec.gov/Archives/edgar/data/${f.cik}/${accClean}/`,{headers:UA});
    if(!idx.ok){await new Promise(x=>setTimeout(x,130));continue;}
    const html=await idx.text();
    const info=[...html.matchAll(/href="([^"]*\.xml)"/gi)].map(m=>m[1]).filter(u=>!/primary_doc/i.test(u));
    if(!info.length){await new Promise(x=>setTimeout(x,130));continue;}
    const xr=await fetch(`https://www.sec.gov${info[0].startsWith("/")?info[0]:"/"+info[0]}`,{headers:UA});
    if(!xr.ok){await new Promise(x=>setTimeout(x,130));continue;}
    const xml=await xr.text();
    const q=f.date.slice(0,7);
    const m=holdings.get(q)??holdings.set(q,new Map()).get(q)!;
    for(const blk of xml.split(/<infoTable>/i).slice(1)){
      const cusip=(blk.match(/<cusip>([^<]+)</i)||[])[1]; const val=+((blk.match(/<value>([^<]+)</i)||[])[1]||0);
      if(cusip&&val>0) m.set(cusip.trim(),(m.get(cusip.trim())||0)+val);}
    parsed++;
    if(parsed%40===0) console.log(`    parsed ${parsed} filings...`);
  }catch{/*skip*/}
  await new Promise(x=>setTimeout(x,130));
  if(parsed>=Number(Deno.env.get("MAXF")||400)) break;
}
console.log(`    parsed ${parsed} information tables; quarters with holdings: ${holdings.size}`);
for(const [q,m] of [...holdings.entries()].sort()) console.log(`      ${q}: ${m.size} distinct CUSIPs, $${([...m.values()].reduce((s,x)=>s+x,0)/1e6).toFixed(0)}M reported`);
console.log(`\n    NOTE: 13F reports CUSIPs, not tickers. A CUSIP->ticker map is required to join to prices and is NOT freely`);
console.log(`    available at scale — that is the real blocker on this gap, and it is stated rather than worked around.`);
