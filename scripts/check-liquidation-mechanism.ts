#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// check-liquidation-mechanism.ts (D-581) — MECHANISM HYPOTHESIS #3.
// D-580 localised the edge to PERPETUAL FUTURES (SR 1.23) versus spot (SR 0.22) on identical signals, period and
// breadth. The concrete difference between those instruments is leverage: funding payments, margin, and forced
// liquidation — mechanical, non-informational price pressure that exists in the derivative and not in the underlying.
// PREDICTION, stated before running: if liquidation dynamics drive the edge, the book should earn MORE in months when
// leverage is crowded. Absolute funding is a direct crowding proxy — large |funding| means one side is paying heavily
// to hold its position, which is precisely the state that precedes forced unwinds.
// HONEST ACCOUNTING: this is the THIRD mechanism tested (arbitrage-thinness refuted D-577, dispersion refuted D-579).
// Testing mechanisms in sequence is itself a search, and each costs a trial. A positive here needs the same scepticism
// as any other third-look result.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"lm",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const corr=(a:number[],b:number[])=>{const ma=mean(a),mb=mean(b);let nu=0,d1=0,d2=0;
  for(let i=0;i<a.length;i++){nu+=(a[i]-ma)*(b[i]-mb);d1+=(a[i]-ma)**2;d2+=(b[i]-mb)**2;}
  return d1&&d2?nu/Math.sqrt(d1*d2):0;};
// monthly mean |funding| across the whole perp universe = leverage crowding
const fund=new Map<string,number[]>();
{let off=0;for(;;){
  const p=await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&select=ts,open_interest&order=ts&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break;
  for(const r of p as {ts:number;open_interest:number}[]){
    const mo=new Date(r.ts*1000).toISOString().slice(0,7);
    (fund.get(mo)??fund.set(mo,[]).get(mo)!).push(Math.abs(+r.open_interest));
  }
  if(p.length<50000)break; off+=50000;}}
const crowd=new Map<string,number>();
for(const [mo,v] of fund) if(v.length>=200) crowd.set(mo,mean(v));
// monthly book returns from the frozen stream
const raw=await Deno.readTextFile("/Users/ona/aegis-data/crypto_books_1dSF_lit5_top50_lag1_hold5.tsv");
const byMo=new Map<string,number[]>();
for(const l of raw.trim().split("\n")){const f=l.split("\t"); const v=+f[5];
  if(f[0]&&Number.isFinite(v))(byMo.get(f[0].slice(0,7))??byMo.set(f[0].slice(0,7),[]).get(f[0].slice(0,7))!).push(v);}
const pairs:{mo:string;c:number;r:number}[]=[];
for(const [mo,rs] of byMo){
  if(rs.length<15)continue;
  const c=crowd.get(mo); if(c===undefined)continue;
  pairs.push({mo,c,r:rs.reduce((s,x)=>s+x,0)});
}
console.log(`==> LIQUIDATION / LEVERAGE MECHANISM (D-581) — mechanism hypothesis #3`);
console.log(`    ${pairs.length} months with both a book return and universe-wide funding crowding`);
if(pairs.length<24){console.log("    too few months — UNTESTED");Deno.exit(0);}
const c=corr(pairs.map(p=>p.c),pairs.map(p=>p.r));
const t=c*Math.sqrt((pairs.length-2)/(1-c*c));
const s=[...pairs].sort((a,b)=>a.c-b.c);
const third=Math.floor(s.length/3);
const lo=s.slice(0,third), hi=s.slice(-third);
console.log(`    corr(mean |funding|, book return) = ${c.toFixed(3)}   t ${t.toFixed(2)}`);
console.log(`    LOW-crowding third  (|fund| ${(mean(lo.map(p=>p.c))*1e4).toFixed(2)}bp/8h): book ${(mean(lo.map(p=>p.r))*12*100).toFixed(1)}%/yr equivalent`);
console.log(`    HIGH-crowding third (|fund| ${(mean(hi.map(p=>p.c))*1e4).toFixed(2)}bp/8h): book ${(mean(hi.map(p=>p.r))*12*100).toFixed(1)}%/yr equivalent`);
const dm=mean(hi.map(p=>p.r))-mean(lo.map(p=>p.r));
const se=Math.sqrt(sdv(hi.map(p=>p.r))**2/hi.length+sdv(lo.map(p=>p.r))**2/lo.length);
console.log(`    high - low: ${(dm*12*100).toFixed(1)}%/yr equivalent, t ${(dm/se).toFixed(2)}`);
console.log(`    -> ${t>2?"SUPPORTED: the edge is larger when leverage is crowded":t<-2?"INVERTED: edge is larger when leverage is CALM":"NOT SUPPORTED at this power — leverage crowding does not explain the edge"}`);
console.log(`\n    CAVEAT: |funding| is a proxy for crowding, not a measure of realised liquidations. Binance publishes forced`);
console.log(`    orders only for a short recent window, so the direct test — do book returns spike around liquidation`);
console.log(`    cascades — cannot be run on this history and is recorded as unavailable rather than answered.`);
