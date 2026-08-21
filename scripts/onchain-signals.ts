#!/usr/bin/env -S deno run --allow-net --allow-env
// onchain-signals.ts (D-439) — do Bitcoin's ON-CHAIN FUNDAMENTALS time its price?
// Four hypotheses stated IN ADVANCE, each with a documented rationale, each directional:
//   H1 NVT (market cap / on-chain transaction value) is crypto's P/E -> HIGH NVT means price has outrun settlement
//      activity -> LOWER forward returns.
//   H2 NETWORK GROWTH (30d change in unique addresses) is adoption -> RISING -> HIGHER forward returns (Metcalfe).
//   H3 MINER REVENUE PER HASH -> when it collapses, miners capitulate and sell; the bottom of that is historically a
//      price bottom -> LOW -> HIGHER forward returns.
//   H4 HASH RIBBON (30d/60d hash-rate MA) recovering from below 1 -> HIGHER forward returns.
//
// THE CONTROL THAT DECIDES A SINGLE-ASSET TIMING TEST: BTC went from cents to ~$78,000. ANY slowly-varying signal that is
// long most of the time will show a huge positive return and a beautiful t-stat — because it inherited the trend, not
// because it timed anything. So every signal here is measured against BUY-AND-HOLD over the identical window, and the
// number that counts is the DIFFERENCE. A timing rule that returns less than holding has no value however significant it
// looks. This is the same logic as D-418's disagree-day test: isolate the observations where the claim and the null differ.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"os",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_RT_BP=Number(Deno.env.get("SPOT_FEE_RT_BP")||10);

async function series(name:string){
  const out=new Map<string,number>();
  for(let off=0;;off+=10000){
    const p=await fetch(`${OWNED}/trd_perp_oi?venue=eq.blockchain.info&interval=eq.${name}&select=ts,open_interest&order=ts&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p)||!p.length)break;
    for(const r of p as {ts:number;open_interest:number}[]) out.set(new Date(r.ts*1000).toISOString().slice(0,10),r.open_interest); // last value of the day
    if(p.length<10000)break;
  }
  return out;
}
const px=await series("market-price"), mc=await series("market-cap"), txv=await series("estimated-transaction-volume-usd");
const addr=await series("n-unique-addresses"), rev=await series("miners-revenue"), hash=await series("hash-rate");
const days=[...px.keys()].filter(d=>px.get(d)!>0).sort();
console.log(`==> BITCOIN ON-CHAIN SIGNALS — ${days.length} daily observations ${days[0]} .. ${days[days.length-1]}`);

// LAG EVERY ON-CHAIN INPUT BY ONE DAY. These series are published with a delay and are revised intraday; using same-day
// values would be a look-ahead that this program has caught in itself before (D-414 funding).
const LAG=1;
const at=(m:Map<string,number>,i:number)=>{const d=days[i-LAG]; return d?m.get(d):undefined;};
const ret:number[]=[]; for(let i=1;i<days.length;i++)ret.push(px.get(days[i])!/px.get(days[i-1])!-1);

type Sig={name:string;v:(i:number)=>number|null;dir:number};   // dir=+1 high is bullish, -1 high is bearish
const SIGS:Sig[]=[
  {name:"H1 NVT (mcap/txvol)",dir:-1,v:i=>{const a=at(mc,i),b=at(txv,i);return a&&b&&b>0?Math.log(a/b):null;}},
  {name:"H2 network growth",dir:+1,v:i=>{const a=at(addr,i),b=i>30?addr.get(days[i-31]):undefined;return a&&b&&b>0?a/b-1:null;}},
  {name:"H3 miner rev/hash",dir:+1,v:i=>{const a=at(rev,i),b=at(hash,i);return a&&b&&b>0?Math.log(a/b):null;}},
  {name:"H4 hash ribbon",dir:+1,v:i=>{const w=(k:number)=>{const s:number[]=[];for(let j=i-k;j<i;j++){const x=hash.get(days[j]);if(x&&x>0)s.push(x);}return s.length?mean(s):null;};
    const a=w(30),b=w(60);return a&&b&&b>0?a/b-1:null;}},
];
const LOOK=365;
const results:{name:string;h:number;ann:number;bh:number;diff:number;t:number;inMkt:number;n:number}[]=[];
for(const s of SIGS) for(const h of [7,30,90]){
  const strat:number[]=[], hold:number[]=[]; let inMkt=0;
  for(let i=LOOK+2;i+h<ret.length;i+=h){                       // NON-OVERLAPPING
    const cur=s.v(i); if(cur===null)continue;
    const w:number[]=[]; for(let j=i-LOOK;j<i;j++){const x=s.v(j); if(x!==null)w.push(x);}
    if(w.length<200)continue;
    const m=mean(w), sd=sdv(w)||1e-9; const z=(cur-m)/sd;      // TRAILING z, no full-sample normalisation
    let f=1; for(let k=1;k<=h;k++)f*=1+ret[i+k];
    const fwd=f-1;
    const long=s.dir*z>0;                                       // long when the signal is bullish by its stated direction
    if(long)inMkt++;
    strat.push(long?fwd-FEE_RT_BP/1e4:0);                       // cash when flat; fee charged on each entry
    hold.push(fwd);
  }
  if(strat.length<25)continue;
  const per=365/h;
  const annS=mean(strat)*per, annH=mean(hold)*per;
  const d=strat.map((x,i)=>x-hold[i]);
  results.push({name:s.name,h,ann:annS,bh:annH,diff:mean(d)*per,
    t:mean(d)/(sdv(d)/Math.sqrt(d.length)),inMkt:100*inMkt/strat.length,n:strat.length});
}
const BAR=Math.sqrt(2*Math.log(Math.max(2,results.length)));
console.log(`    tests: ${results.length}  ->  multiple-testing bar |t| > ${BAR.toFixed(2)}  (fee ${FEE_RT_BP}bp per entry)\n`);
console.log(`    ${"signal".padEnd(22)}${"h".padEnd(5)}${"strategy %/yr".padEnd(15)}${"buy&hold %/yr".padEnd(15)}${"DIFFERENCE".padEnd(13)}${"t(diff)".padEnd(9)}${"in-mkt".padEnd(8)}n`);
for(const r of results)
  console.log(`    ${r.name.padEnd(22)}${String(r.h).padEnd(5)}${((r.ann*100).toFixed(1)+"%").padEnd(15)}${((r.bh*100).toFixed(1)+"%").padEnd(15)}${((r.diff*100).toFixed(1)+"%").padEnd(13)}${r.t.toFixed(2).padEnd(9)}${(r.inMkt.toFixed(0)+"%").padEnd(8)}${r.n}`);
const beat=results.filter(r=>r.diff>0&&Math.abs(r.t)>BAR);
console.log(`\n    signals BEATING buy-and-hold past the multiple-testing bar: ${beat.length}/${results.length}`);
for(const r of beat) console.log(`      ${r.name} h=${r.h}: +${(r.diff*100).toFixed(1)}%/yr over holding, t ${r.t.toFixed(2)}`);
if(!beat.length) console.log(`      (none — every on-chain timing rule underperformed simply holding the asset)`);
