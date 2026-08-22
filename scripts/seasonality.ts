#!/usr/bin/env -S deno run --allow-net --allow-env
// seasonality.ts (D-403) — CALENDAR EFFECTS, never tested. Documented family: turn-of-month (Ariel/Lakonishok-Smidt),
// day-of-week, month-of-year (Sell-in-May), and the turn-of-year/January effect. These are TIME-SERIES effects (when to be
// in the market at all), not cross-sectional — a different mechanism from everything tested so far, and cheap to trade
// because they are calendar-triggered rather than signal-triggered (low turnover).
// Tested across the whole owned stack, per asset class, with the honest controls: effect size vs the unconditional mean,
// t-stats, and a train/test split. Calendar effects are the most notoriously data-mined family in finance, so the OOS split
// is the whole test — an in-sample-only calendar result is worthless.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sz",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
// use broad liquid proxies per class (calendar effects are market-level, not name-level)
const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=in.(etf,index,sector,commodity,fx,crypto_ex)&select=symbol,asset_class,bars&order=symbol&limit=100`,{headers:hdr}).then(r=>r.json()) as {symbol:string;asset_class:string;bars:number[][]}[];
type R={date:Date;ret:number;cls:string};
const all:R[]=[];
for(const r of rows){const b=r.bars; if(!b||b.length<500)continue;
  let mx=0; for(let i=1;i<b.length;i++) if(b[i-1][4]>0){const q=Math.abs(b[i][4]/b[i-1][4]-1); if(q>mx)mx=q;}
  if(mx>10) continue;
  for(let i=1;i<b.length;i++){const p0=b[i-1][4],p1=b[i][4]; if(!(p0>0))continue; const ret=p1/p0-1;
    if(Number.isFinite(ret)&&Math.abs(ret)<0.5) all.push({date:new Date(b[i][0]*1000),ret,cls:r.asset_class});}}
console.log(`==> SEASONALITY: ${rows.length} instruments, ${all.length} instrument-days`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const base=mean(all.map(r=>r.ret));
console.log(`  unconditional mean daily return: ${(base*1e4).toFixed(2)}bp\n`);
const cut=new Date(Date.UTC(2016,0,1));   // train pre-2016, test post (calendar effects decay; the OOS half is the real test)
const rep=(nm:string,sel:(r:R)=>boolean)=>{
  const s=all.filter(sel); if(s.length<500){console.log(`  ${nm.padEnd(26)} n=${s.length} (thin)`);return;}
  const tr=s.filter(r=>r.date<cut).map(r=>r.ret), te=s.filter(r=>r.date>=cut).map(r=>r.ret);
  const ex=(a:number[])=>a.length>200?`${((mean(a)-base)*1e4).toFixed(2)}bp (t ${tst(a.map(x=>x-base)).toFixed(2)})`:"thin";
  console.log(`  ${nm.padEnd(26)} n=${String(s.length).padStart(7)}  excess ${((mean(s.map(r=>r.ret))-base)*1e4).toFixed(2)}bp (t ${tst(s.map(r=>r.ret-base)).toFixed(2)})  | TRAIN ${ex(tr)} | TEST ${ex(te)}`);
};
console.log("  TURN OF MONTH (last day + first 3 days is the documented window):");
rep("  turn-of-month window",r=>{const d=r.date.getUTCDate(); const dim=new Date(Date.UTC(r.date.getUTCFullYear(),r.date.getUTCMonth()+1,0)).getUTCDate(); return d<=3||d>=dim-1;});
rep("  mid-month (rest)",r=>{const d=r.date.getUTCDate(); const dim=new Date(Date.UTC(r.date.getUTCFullYear(),r.date.getUTCMonth()+1,0)).getUTCDate(); return !(d<=3||d>=dim-1);});
console.log("\n  DAY OF WEEK:");
for(const [i,nm] of [[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"]] as [number,string][]) rep(`  ${nm}`,r=>r.date.getUTCDay()===i);
console.log("\n  MONTH OF YEAR (Sell-in-May / January):");
rep("  Nov-Apr (winter)",r=>{const m=r.date.getUTCMonth(); return m>=10||m<=3;});
rep("  May-Oct (summer)",r=>{const m=r.date.getUTCMonth(); return m>=4&&m<=9;});
rep("  January",r=>r.date.getUTCMonth()===0);
rep("  September",r=>r.date.getUTCMonth()===8);
