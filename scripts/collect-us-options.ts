#!/usr/bin/env -S deno run --allow-net --allow-env
// collect-us-options.ts (D-469) — daily snapshot of the US option surface from CBOE's free delayed chains.
// Twin of collect-option-skew.ts (Deribit): no free historical chains exist for US options either, so the honest
// response is the same — start the clock. Per underlying, per day: ATM IV at the ~30d tenor, 25-delta-proxy skew
// (90% put IV − 110% call IV), term slope, and total put/call open interest. Idempotent by UTC day. Measures, never trades.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"uso",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// D-487b: widened — every daily snapshot is a forward series that costs one request; single names give idiosyncratic
// skew/IV, the index complex gives the market surface.
const UNDER=["_SPX","SPY","QQQ","IWM","TLT","GLD","HYG","EEM","XLE","XLF","AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AMD","JPM","XOM"];
const today=Math.floor(Date.now()/86400000)*86400;
type Opt={exp:string;days:number;strike:number;call:boolean;iv:number;oi:number};
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
for(const u of UNDER){
  const j=await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${u}.json`).then(r=>r.json()).catch(()=>null) as
    {data?:{current_price?:number;options?:{option:string;iv:number;open_interest:number}[]}}|null;
  await sleep(400);
  const spot=j?.data?.current_price, list=j?.data?.options;
  if(!spot||!Array.isArray(list)||!list.length){console.error(`  ${u}: chain unavailable — recording NOTHING`);continue;}
  const opts:Opt[]=[];
  for(const o of list){
    // OCC symbology: ROOT + YYMMDD + C/P + strike*1000 (8 digits)
    const m=/^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(o.option); if(!m)continue;
    const iv=+o.iv; if(!(iv>0.01)||iv>5)continue;
    const exp=`20${m[2].slice(0,2)}-${m[2].slice(2,4)}-${m[2].slice(4,6)}`;
    const days=(Date.parse(exp)-Date.now())/86400000; if(days<5||days>200)continue;
    opts.push({exp,days,strike:+m[4]/1000,call:m[3]==="C",iv:iv*100,oi:+o.open_interest||0});
  }
  if(opts.length<40){console.error(`  ${u}: only ${opts.length} usable strikes — skipping`);continue;}
  const tenors=[...new Set(opts.map(o=>Math.round(o.days)))].sort((a,b)=>Math.abs(a-30)-Math.abs(b-30));
  const near=tenors[0], slice=opts.filter(o=>Math.round(o.days)===near);
  const atm=slice.slice().sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];
  const put=slice.filter(o=>!o.call).sort((a,b)=>Math.abs(a.strike-spot*0.9)-Math.abs(b.strike-spot*0.9))[0];
  const call=slice.filter(o=>o.call).sort((a,b)=>Math.abs(a.strike-spot*1.1)-Math.abs(b.strike-spot*1.1))[0];
  const farT=tenors.filter(t=>t>near+40).sort((a,b)=>a-b)[0];
  const atmF=farT?opts.filter(o=>Math.round(o.days)===farT).sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0]:null;
  const putOI=opts.reduce((s,o)=>s+(o.call?0:o.oi),0), callOI=opts.reduce((s,o)=>s+(o.call?o.oi:0),0);
  const sym=u.replace(/^_/,"");
  if(atm) rows.push({symbol:sym,venue:"cboe",interval:"atm_iv_near",ts:today,open_interest:atm.iv});
  if(put&&call) rows.push({symbol:sym,venue:"cboe",interval:"skew25",ts:today,open_interest:put.iv-call.iv});
  if(atm&&atmF) rows.push({symbol:sym,venue:"cboe",interval:"term",ts:today,open_interest:atmF.iv-atm.iv});
  if(callOI>0) rows.push({symbol:sym,venue:"cboe",interval:"pc_oi",ts:today,open_interest:putOI/callOI});
  console.log(`  ${sym.padEnd(5)} spot ${spot.toFixed(0)}  ${near}d: ATM ${atm?.iv.toFixed(1)}  skew ${put&&call?(put.iv-call.iv).toFixed(2):"-"}  term ${atm&&atmF?(atmF.iv-atm.iv).toFixed(2):"-"}  P/C-OI ${(putOI/Math.max(1,callOI)).toFixed(2)}`);
}
if(!rows.length){console.error("!! nothing collected");Deno.exit(1);}
const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
  headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)}).catch(()=>null);
if(!res||!res.ok){console.error(`WRITE-FAILED trd_perp_oi(cboe) ${res?res.status:"network"}`);Deno.exit(1);}
const back=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.atm_iv_near&symbol=eq.SPX&select=ts`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
console.log(`==> ${rows.length} points; SPX ATM-IV series ${Array.isArray(back)?new Set(back.map((r:{ts:number})=>r.ts)).size:0} distinct day(s) deep.`);
