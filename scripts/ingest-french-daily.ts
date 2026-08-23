#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-french-daily.ts (D-481) — the DAILY French panels (the monthly parser reads 6-digit yyyymm rows; daily files
// use 8-digit yyyymmdd — a separate parser, not a silent skip). ~26k days x 49 industries etc.: the substrate for
// factor-momentum / factor-timing families at daily resolution, 1926->.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"kfd",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const BASE="https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function unzipCsv(name:string):Promise<string>{
  const buf=new Uint8Array(await (await fetch(BASE+name)).arrayBuffer());
  if(buf[0]!==0x50||buf[1]!==0x4b)throw new Error("not a zip");
  const method=buf[8]|buf[9]<<8,nameLen=buf[26]|buf[27]<<8,extraLen=buf[28]|buf[29]<<8;
  const csize=(buf[18]|buf[19]<<8|buf[20]<<16|buf[21]<<24)>>>0;
  const start=30+nameLen+extraLen;
  const comp=buf.subarray(start,csize>0?start+csize:undefined);
  if(method===0)return new TextDecoder("latin1").decode(comp);
  const out=new Response(new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  return new TextDecoder("latin1").decode(new Uint8Array(await out.arrayBuffer()));
}
let total=0;
for(const [file,prefix] of [["49_Industry_Portfolios_daily_CSV.zip","ind49d"],["10_Portfolios_Prior_12_2_Daily_CSV.zip","mom10d"],["25_Portfolios_5x5_Daily_CSV.zip","szbm25d"]] as [string,string][]){
  const txt=await unzipCsv(file); await sleep(500);
  const lines=txt.split(/\r?\n/);
  let hi=-1;
  for(let i=0;i<lines.length;i++) if(/^\s*\d{8}\s*,/.test(lines[i])){hi=i-1;break;}
  if(hi<0){console.log(`  ${file}: no daily block found — recorded, not silent`);continue;}
  const names=lines[hi].split(",").slice(1).map(s=>s.trim().replace(/\s+/g,"_")).map(s=>s||"UNNAMED");
  const rows:{month:string;factor:string;ret:number}[]=[];
  for(let i=hi+1;i<lines.length;i++){
    const m=lines[i].match(/^\s*(\d{8})\s*,(.*)$/); if(!m)break;
    const d=`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`;
    const vals=m[2].split(",");
    for(let j=0;j<names.length&&j<vals.length;j++){
      const v=parseFloat(vals[j]); if(!Number.isFinite(v)||v<=-99)continue;
      rows.push({month:d,factor:`${prefix}:${names[j]}`,ret:v/100});
    }
  }
  console.log(`  ${file}: ${rows.length.toLocaleString()} obs, ${new Set(rows.map(r=>r.factor)).size} series, ${rows[0]?.month} .. ${rows[rows.length-1]?.month}`);
  for(let i=0;i<rows.length;i+=5000){
    const res=await fetch(`${OWNED}/trd_ff_factors?on_conflict=month,factor`,{method:"POST",
      headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+5000))}).catch(()=>null);
    if(!res||!res.ok){console.log(`WRITE-FAILED ${prefix} ${res?res.status:"net"} @${i}`);Deno.exit(1);}
  }
  total+=rows.length;
}
const back=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.ind49d:*,factor.like.mom10d:*,factor.like.szbm25d:*)&select=factor&limit=1`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${total.toLocaleString()} sent; DB confirms ${cnt.toLocaleString()}`);
if(cnt<total*0.95){console.error("!! writes did NOT land");Deno.exit(1);}
