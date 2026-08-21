#!/usr/bin/env -S deno run --allow-net --allow-env
// collect-option-skew.ts (D-444) — daily snapshot of the Deribit option surface: SKEW and TERM STRUCTURE.
// WHY A COLLECTOR AND NOT A TEST: D-435 tested the LEVEL of implied vol (DVOL) because Deribit publishes DVOL history.
// It publishes NO historical option chain, and get_last_trades_by_currency_and_time returns empty for past windows
// (verified). So skew and term structure CANNOT be backtested — under the COVERAGE LAW that verdict is **UNTESTED**, not
// null: the absence is in our data, not in the market.
// The honest response to a genuinely-unavailable history is not to file it away, it is to START THE CLOCK. This snapshots
// the live chain daily so the series exists a year from now. It measures, it does not trade.
//   SKEW = 25-delta put IV minus 25-delta call IV. Positive = crash insurance is bid. In equities this is a documented
//          risk indicator; in crypto it is untested here.
//   TERM  = far-dated ATM IV minus near-dated ATM IV. Negative (backwardation) = near-term stress.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sk",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const D="https://www.deribit.com/api/v2/public";
const today=Math.floor(Date.now()/86400000)*86400;      // UTC day bucket, so re-runs are idempotent
const rows:{symbol:string;venue:string;interval:string;ts:number;open_interest:number}[]=[];
for(const cur of ["BTC","ETH"]){
  const j=await fetch(`${D}/get_book_summary_by_currency?currency=${cur}&kind=option`).then(r=>r.json()).catch(()=>null) as {result?:{instrument_name:string;mark_iv?:number;underlying_price?:number}[]}|null;
  const L=j?.result;
  if(!Array.isArray(L)||!L.length){console.error(`  ${cur}: chain unavailable — recording NOTHING rather than a zero`);continue;}
  const spot=L.find(x=>x.underlying_price)?.underlying_price;
  if(!spot){console.error(`  ${cur}: no underlying price — skipping`);continue;}
  // parse BTC-25JUN27-90000-C
  type Opt={days:number;strike:number;call:boolean;iv:number};
  const opts:Opt[]=[];
  for(const o of L){
    const m=/^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(o.instrument_name);
    if(!m||!o.mark_iv||o.mark_iv<=0)continue;
    const mo=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(m[2]);
    if(mo<0)continue;
    const exp=Date.UTC(2000+Number(m[3]),mo,Number(m[1]),8);
    const days=(exp-Date.now())/86400000; if(days<3||days>200)continue;
    opts.push({days,strike:Number(m[4]),call:m[5]==="C",iv:o.mark_iv});
  }
  if(opts.length<20){console.error(`  ${cur}: only ${opts.length} usable options — skipping`);continue;}
  // nearest expiry to 30 days
  const tenors=[...new Set(opts.map(o=>Math.round(o.days)))].sort((a,b)=>Math.abs(a-30)-Math.abs(b-30));
  const near=tenors[0];
  const slice=opts.filter(o=>Math.round(o.days)===near);
  // moneyness proxy for 25-delta: ~ +/-10% from spot at a 30d tenor. Labelled a PROXY because a true delta needs the
  // full greeks; Deribit's book summary does not return delta, and inventing one would be worse than approximating openly.
  const put=slice.filter(o=>!o.call).sort((a,b)=>Math.abs(a.strike-spot*0.9)-Math.abs(b.strike-spot*0.9))[0];
  const call=slice.filter(o=>o.call).sort((a,b)=>Math.abs(a.strike-spot*1.1)-Math.abs(b.strike-spot*1.1))[0];
  const atmN=slice.sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];
  const farT=tenors.filter(t=>t>near+40).sort((a,b)=>a-b)[0];
  const atmF=farT?opts.filter(o=>Math.round(o.days)===farT).sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0]:null;
  if(put&&call) rows.push({symbol:cur,venue:"deribit",interval:"skew25",ts:today,open_interest:put.iv-call.iv});
  if(atmN) rows.push({symbol:cur,venue:"deribit",interval:"atm_iv_near",ts:today,open_interest:atmN.iv});
  if(atmN&&atmF) rows.push({symbol:cur,venue:"deribit",interval:"term",ts:today,open_interest:atmF.iv-atmN.iv});
  console.log(`  ${cur}  spot ${spot.toFixed(0)}  ${near}d tenor: ATM IV ${atmN?.iv.toFixed(1)}  skew(90%P - 110%C) ${put&&call?(put.iv-call.iv).toFixed(2):"n/a"}  term(${farT??"-"}d - ${near}d) ${atmN&&atmF?(atmF.iv-atmN.iv).toFixed(2):"n/a"}`);
}
if(!rows.length){console.error("!! nothing collected");Deno.exit(1);}
const res=await fetch(`${OWNED}/trd_perp_oi?on_conflict=symbol,venue,interval,ts`,{method:"POST",
  headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
if(!res.ok){console.error(`!! write ${res.status}: ${(await res.text()).slice(0,150)}`);Deno.exit(1);}
// count DISTINCT days, not rows — BTC and ETH each write one row per day, so a row count would double the apparent depth.
const back=await fetch(`${OWNED}/trd_perp_oi?venue=eq.deribit&interval=eq.skew25&symbol=eq.BTC&select=ts`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
const dayCount=Array.isArray(back)?new Set((back as {ts:number}[]).map(r=>r.ts)).size:0;
console.log(`==> collected ${rows.length} points; skew series now ${dayCount} distinct day(s) deep. Testable at ~250.`);
