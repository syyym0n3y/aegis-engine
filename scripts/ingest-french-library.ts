#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-french-library.ts (D-472) — the Ken French research library at BREADTH. The repo already fetches one file of it
// in production (autopilot: the Momentum factor); this ingests the panels: 49 value-weighted industry portfolios and the
// 100 size x book-to-market portfolios, monthly, 1926->present. Century-scale, survivorship-clean by construction —
// the one place where a portfolio-t has enough independent months to clear a 5.3 ceiling honestly if anything can.
// Rows land in trd_ff_factors (month, factor, ret) — the schema the autopilot already reads.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"kf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const BASE="https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function unzipCsv(name:string):Promise<string>{
  const buf=new Uint8Array(await (await fetch(BASE+name)).arrayBuffer());
  // ZIP local-file header parse (single-file zips, DEFLATE or STORE) — same approach the autopilot uses
  if(buf[0]!==0x50||buf[1]!==0x4b)throw new Error("not a zip");
  const method=buf[8]|buf[9]<<8, nameLen=buf[26]|buf[27]<<8, extraLen=buf[28]|buf[29]<<8;
  // compressed size lives at offset 18 (LE u32) — without slicing to it, the central directory gets fed into the
  // inflater and the stream dies at the end (the first run's failure).
  const csize=(buf[18]|buf[19]<<8|buf[20]<<16|buf[21]<<24)>>>0;
  const start=30+nameLen+extraLen;
  const comp=buf.subarray(start,csize>0?start+csize:undefined);
  if(method===0)return new TextDecoder("latin1").decode(comp);
  const ds=new DecompressionStream("deflate-raw");
  const out=new Response(new Blob([comp]).stream().pipeThrough(ds));
  return new TextDecoder("latin1").decode(new Uint8Array(await out.arrayBuffer()));
}
const monthEnd=(yyyymm:string)=>{const y=+yyyymm.slice(0,4),m=+yyyymm.slice(4,6);const d=new Date(Date.UTC(y,m,0));return d.toISOString().slice(0,10);};
type Row={month:string;factor:string;ret:number};
async function parsePanel(file:string,prefix:string):Promise<Row[]>{
  const txt=await unzipCsv(file);
  const lines=txt.split(/\r?\n/);
  // find the FIRST monthly block: header row of names following a blank/desc, rows = ^\s*\d{6},
  let hi=-1;
  for(let i=0;i<lines.length;i++){ if(/^\s*\d{6}\s*,/.test(lines[i])){hi=i-1;break;} }
  if(hi<0)throw new Error(`${file}: no data block`);
  const names=lines[hi].split(",").slice(1).map(s=>s.trim().replace(/\s+/g,"_")).map(s=>s||"UNNAMED");
  const rows:Row[]=[];
  for(let i=hi+1;i<lines.length;i++){
    const m=lines[i].match(/^\s*(\d{6})\s*,(.*)$/); if(!m)break;      // the monthly block ends at the first non-matching line
    const vals=m[2].split(",");
    for(let j=0;j<names.length&&j<vals.length;j++){
      const v=parseFloat(vals[j]);
      if(!Number.isFinite(v)||v<=-99)continue;                        // -99.99 = missing in French files
      rows.push({month:monthEnd(m[1]),factor:`${prefix}:${names[j]}`,ret:v/100});
    }
  }
  return rows;
}
let total=0;
for(const [file,prefix] of [["49_Industry_Portfolios_CSV.zip","ind49"],["100_Portfolios_10x10_CSV.zip","szbm100"]] as [string,string][]){
  const rows=await parsePanel(file,prefix);
  console.log(`  ${file}: ${rows.length.toLocaleString()} obs, ${new Set(rows.map(r=>r.factor)).size} series, ${rows[0]?.month} .. ${rows[rows.length-1]?.month}`);
  for(let i=0;i<rows.length;i+=3000){
    const res=await fetch(`${OWNED}/trd_ff_factors?on_conflict=month,factor`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+3000))}).catch(()=>null);
    if(!res||!res.ok){console.error(`WRITE-FAILED trd_ff_factors ${res?res.status:"net"} @${i}`);Deno.exit(1);}
  }
  total+=rows.length; await sleep(500);
}
const back=await fetch(`${OWNED}/trd_ff_factors?select=factor&or=(factor.like.ind49:*,factor.like.szbm100:*)&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${total.toLocaleString()} obs sent; DB re-read confirms ${cnt.toLocaleString()} panel rows`);
if(cnt<total*0.95){console.error("!! writes did NOT land");Deno.exit(1);}
