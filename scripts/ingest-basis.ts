#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-basis.ts (D-428) — the FUTURES TERM STRUCTURE (quarterly basis), distinct from the 8h funding already tested.
// Funding is the PERPETUAL's own clearing price for leverage over 8 hours. The quarterly BASIS is the term price of that
// same leverage out to 3 months, and it is set by a different population (basis traders and hedgers, not perp scalpers).
// Annualised basis = (F/S - 1) * 365/days_to_expiry. It is the cleanest available measure of how crowded and how expensive
// levered length is -- and unlike anything in the equity stack, it is a DIRECT observation of the cost of positioning
// rather than an inference from prices.
// Binance keeps klines for EXPIRED quarterlies, and the symbols follow BTCUSDT_YYMMDD (last Friday of Mar/Jun/Sep/Dec), so
// a continuous series is reconstructable back to 2020. Free, keyless, allowlisted. Strictly sequential.
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const FAPI="https://fapi.binance.com/fapi/v1";
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bs",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();

// last Friday of the quarter-end month, which is Binance's delivery convention
function lastFriday(y:number,m:number){const d=new Date(Date.UTC(y,m,0));while(d.getUTCDay()!==5)d.setUTCDate(d.getUTCDate()-1);return d;}
const contracts:{base:string;sym:string;expiry:number}[]=[];
for(const base of ["BTCUSDT","ETHUSDT"]) for(let y=2020;y<=2026;y++) for(const m of [3,6,9,12]){
  const d=lastFriday(y,m);
  const yy=String(d.getUTCFullYear()).slice(2), mm=String(d.getUTCMonth()+1).padStart(2,"0"), dd=String(d.getUTCDate()).padStart(2,"0");
  contracts.push({base,sym:`${base}_${yy}${mm}${dd}`,expiry:Math.floor(d.getTime()/1000)});
}
console.log(`==> BASIS INGEST — probing ${contracts.length} quarterly contracts (2020-2026, BTC+ETH)`);

async function klines(sym:string){
  const out=new Map<number,number>(); let start=Date.parse("2020-01-01T00:00:00Z");
  for(let g=0;g<40;g++){
    const r=await fetch(`${FAPI}/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1500`).then(x=>x.json()).catch(()=>null);
    await sleep(120);
    if(!Array.isArray(r)||!r.length)break;
    for(const k of r as (string|number)[][]) out.set(Math.floor(Number(k[0])/1000),+k[4]);
    if(r.length<1500)break; start=Number((r[r.length-1] as (string|number)[])[0])+1;
  }
  return out;
}
const perp=new Map<string,Map<number,number>>();
for(const base of ["BTCUSDT","ETHUSDT"]){ perp.set(base,await klines(base));
  console.log(`  perp ${base}: ${perp.get(base)!.size} daily closes`); }

const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
// NOTE ON STORAGE: the basis series is written into trd_perp_oi's numeric column under a distinct `interval` tag rather
// than a new table -- the column is a plain double and the primary key already separates series. Labelled explicitly as
// 'basis_ann' so it can never be mistaken for open interest by a later reader.
let found=0;
for(const c of contracts){
  if(c.expiry*1000>Date.now()+200*86400000)continue;        // not yet listed
  const fk=await klines(c.sym);
  if(fk.size<20)continue;
  found++;
  const sp=perp.get(c.base)!;
  let n=0;
  for(const [ts,f] of fk){
    const s=sp.get(ts); if(!s||!(s>0)||!(f>0))continue;
    const days=(c.expiry-ts)/86400; if(days<5||days>120)continue;   // drop the noisy final week and pre-listing stub
    const ann=(f/s-1)*365/days;
    if(!Number.isFinite(ann)||Math.abs(ann)>3)continue;
    rows.push({symbol:c.base,venue:"binance",interval:"basis_ann",ts,open_interest:ann}); n++;
  }
  console.log(`  ${c.sym.padEnd(16)} ${String(fk.size).padStart(4)} closes -> ${String(n).padStart(4)} basis points`);
}
console.log(`\n  contracts with history: ${found}/${contracts.length}`);
for(let i=0;i<rows.length;i+=2000){
  const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+2000))});
  if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,160)}`);Deno.exit(1);}
}
const back=await fetch(`${OWNED}/trd_perp_oi?interval=eq.basis_ann&select=symbol`,{headers:{...hdr,Prefer:"count=exact"}});
const cnt=+((back.headers.get("content-range")||"").split("/")[1]||0);
console.log(`==> ${rows.length.toLocaleString()} basis observations sent; DB re-read confirms ${cnt.toLocaleString()}`);
if(cnt<rows.length*0.95){console.error("!! writes did NOT land");Deno.exit(1);}
