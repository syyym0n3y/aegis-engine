#!/usr/bin/env -S deno run --allow-net --allow-env
import { mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
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
const CORE=["_SPX","SPY","QQQ","IWM","TLT","GLD","HYG","EEM","XLE","XLF","AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AMD","JPM","XOM"];
// D-817: WIDE=1 (runner default) appends every liquid-decile equity — CBOE's delayed chains answer for any underlying with
// open_interest and iv per strike, so the per-name surface (ATM IV, skew, term, P/C OI, naive GEX) becomes a daily forward
// series across ~1,100 names instead of 20. There is no free keyless per-strike HISTORY (probed: OCC = market totals only,
// Massive = key + current OI only, OptionsDX = checkout, OptionCharts = no endpoint); the snapshot IS the free route.
const WIDE=(Deno.env.get("WIDE")??"0")==="1";
let UNDER=[...CORE];
if(WIDE){ try{ const dec=JSON.parse(await Deno.readTextFile(new URL("../data/liquid-decile.json",import.meta.url).pathname)) as {symbols:string[]}; const extra=dec.symbols.filter(x=>/^[A-Z]{1,5}$/.test(x)&&!CORE.includes(x)); UNDER=[...CORE,...extra]; }catch(e){ if(!(e instanceof Deno.errors.NotFound)) throw e; console.error("  WIDE=1 but data/liquid-decile.json is missing — collecting the core 20 only"); } }
console.log(`  underlyings: ${UNDER.length} (${WIDE?"wide":"core"})`);
const today=Math.floor(Date.now()/86400000)*86400;
let throttled=0, noOptions=0;
const doneToday=new Set<string>();
if(WIDE){ // strict read: a transport failure must be LOUD, never an empty resume set (silent-read class); ordered + paged (truncation class)
  const { q: qs } = mkStrictRead(OWNED, hdr);
  for(let off=0;;off+=1000){ const dt=await qs(`trd_perp_oi?venue=eq.cboe&interval=eq.atm_iv_near&ts=eq.${today}&select=symbol&order=symbol&offset=${off}&limit=1000`) as {symbol:string}[]; for(const r of dt) doneToday.add(r.symbol); if(dt.length<1000) break; }
  console.log(`  already collected today: ${doneToday.size}`); }
type Opt={exp:string;days:number;strike:number;call:boolean;iv:number;oi:number};
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
for(const u of UNDER){
  if(WIDE&&doneToday.has(u.replace(/^_/,""))) continue;   // D-817: idempotent within the day (a relaunch resumes)
  // D-817: CBOE throttles sustained requests with 429 — back off (10s, 30s, 90s) and retry; a 429 must never read as
  // "chain unavailable" (565 names were skipped that way on the first wide run). Wide pace 1.2s/name.
  let j:{data?:{current_price?:number;options?:{option:string;iv:number;open_interest:number}[]}}|null=null;
  for(let attempt=0;attempt<4;attempt++){
    const r=await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${u}.json`).catch(()=>null);
    if(r&&r.status===429){ await r.body?.cancel(); throttled++; await sleep([10000,30000,90000,90000][attempt]); continue; }
    if(r&&r.status===404){ await r.body?.cancel(); j=null; noOptions++; break; }
    j=r&&r.ok? await r.json().catch(()=>null):null; break;
  }
  await sleep(WIDE?1200:400);
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
  const MIN_STRIKES=WIDE&&!CORE.includes(u)?20:40;   // D-817: 40 was set for the core 20; mid-liquid names carry fewer usable strikes and 20 still supports ATM IV and P/C OI
  if(opts.length<MIN_STRIKES){console.error(`  ${u}: only ${opts.length} usable strikes — skipping`);continue;}
  const tenors=[...new Set(opts.map(o=>Math.round(o.days)))].sort((a,b)=>Math.abs(a-30)-Math.abs(b-30));
  const near=tenors[0], slice=opts.filter(o=>Math.round(o.days)===near);
  const atm=slice.slice().sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];
  const put=slice.filter(o=>!o.call).sort((a,b)=>Math.abs(a.strike-spot*0.9)-Math.abs(b.strike-spot*0.9))[0];
  const call=slice.filter(o=>o.call).sort((a,b)=>Math.abs(a.strike-spot*1.1)-Math.abs(b.strike-spot*1.1))[0];
  const farT=tenors.filter(t=>t>near+40).sort((a,b)=>a-b)[0];
  const atmF=farT?opts.filter(o=>Math.round(o.days)===farT).sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0]:null;
  const putOI=opts.reduce((s,o)=>s+(o.call?0:o.oi),0), callOI=opts.reduce((s,o)=>s+(o.call?o.oi:0),0);
  // D-806: NAIVE gamma exposure from the same chain — Black-Scholes gamma per contract (r=0, q=0) x OI x 100 x spot^2 x 1%,
  // calls +, puts - (the D-792 Deribit convention: dealers assumed short puts / long calls). A CONVENTION, not a measured
  // dealer book — labelled naive for that reason. Closes the register's "dealer gamma: all-NULL table" barrier in naive form.
  const nCdf=(x:number)=>{const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422804014327*Math.exp(-x*x/2);const p=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-p:p;};
  let gex=0, gexN=0;
  for(const o of opts){ if(!(o.oi>0))continue; const T=o.days/365, sig=o.iv/100; if(!(T>0&&sig>0))continue;
    const d1=(Math.log(spot/o.strike)+0.5*sig*sig*T)/(sig*Math.sqrt(T)); const pdf=Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI);
    const gamma=pdf/(spot*sig*Math.sqrt(T)); if(!Number.isFinite(gamma))continue;
    gex+=(o.call?1:-1)*gamma*o.oi*100*spot*spot*0.01; gexN++; }
  void nCdf;
  const sym=u.replace(/^_/,"");
  if(atm) rows.push({symbol:sym,venue:"cboe",interval:"atm_iv_near",ts:today,open_interest:atm.iv});
  if(put&&call) rows.push({symbol:sym,venue:"cboe",interval:"skew25",ts:today,open_interest:put.iv-call.iv});
  if(atm&&atmF) rows.push({symbol:sym,venue:"cboe",interval:"term",ts:today,open_interest:atmF.iv-atm.iv});
  if(callOI>0) rows.push({symbol:sym,venue:"cboe",interval:"pc_oi",ts:today,open_interest:putOI/callOI});
  if(gexN>=20) rows.push({symbol:sym,venue:"cboe",interval:"naive_gex_usd",ts:today,open_interest:gex});
  console.log(`  ${sym.padEnd(5)} spot ${spot.toFixed(0)}  ${near}d: ATM ${atm?.iv.toFixed(1)}  skew ${put&&call?(put.iv-call.iv).toFixed(2):"-"}  term ${atm&&atmF?(atmF.iv-atm.iv).toFixed(2):"-"}  P/C-OI ${(putOI/Math.max(1,callOI)).toFixed(2)}`);
}
console.log(`  throttled (429, retried) ${throttled} | no options listed (404) ${noOptions}`);
if(!rows.length){console.error("!! nothing collected");Deno.exit(1);}
const namesToday=new Set(rows.map(r=>r.symbol)).size; rows.push({symbol:"_WIDE",venue:"cboe",interval:"names_collected",ts:today,open_interest:namesToday});
const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
  headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)}).catch(()=>null);
if(!res||!res.ok){console.error(`WRITE-FAILED trd_perp_oi(cboe) ${res?res.status:"network"}`);Deno.exit(1);}
const back=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.atm_iv_near&symbol=eq.SPX&select=ts`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
console.log(`==> ${rows.length} points; SPX ATM-IV series ${Array.isArray(back)?new Set(back.map((r:{ts:number})=>r.ts)).size:0} distinct day(s) deep.`);
