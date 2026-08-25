const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vt",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const dv=await fetch(`${OWNED}/trd_perp_oi?venue=eq.deribit&interval=eq.dvol&select=symbol,ts,open_interest&order=symbol,ts&limit=20000`,{headers:hdr}).then(r=>r.json()) as {symbol:string;ts:number;open_interest:number}[];
const iv=new Map<string,Map<string,number>>();
for(const r of dv){const d=new Date(r.ts*1000).toISOString().slice(0,10);(iv.get(r.symbol)??iv.set(r.symbol,new Map()).get(r.symbol)!).set(d,+r.open_interest);}
const rb=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.BTCUSDT&select=bars`,{headers:hdr}).then(x=>x.json()) as {bars:number[][]}[];
const px=new Map<string,number>();
for(const b of (rb[0]?.bars||[]))if(b[4]>0)px.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
const days=[...px.keys()].sort();
const rows:{d:string;prem:number}[]=[];
for(let i=0;i+30<days.length;i+=30){
  const ivv=iv.get("BTC")?.get(days[i]); if(ivv===undefined||!(ivv>0))continue;
  const impl=Math.pow(ivv/100,2)*(30/365);
  let rv=0,n=0;
  for(let k=i+1;k<=i+30;k++){const a=px.get(days[k]),b=px.get(days[k-1]);if(a===undefined||b===undefined)continue;const r=Math.log(a/b);rv+=r*r;n++;}
  if(n<20)continue;
  rows.push({d:days[i],prem:impl-rv});
}
rows.sort((a,b)=>a.prem-b.prem);
console.log("==> BTC VRP LOSS TAIL — the defining risk of selling variance");
console.log("    5 WORST windows:");
for(const r of rows.slice(0,5))console.log(`      ${r.d}  ${(r.prem*1e4).toFixed(0).padStart(6)} var-pts  (${(r.prem*(365/30)*100).toFixed(1)}%/yr equivalent)`);
console.log("    5 BEST windows:");
for(const r of rows.slice(-5))console.log(`      ${r.d}  ${(r.prem*1e4).toFixed(0).padStart(6)} var-pts`);
const all=rows.map(r=>r.prem);
const worst=all[0], m=mean(all);
console.log(`\n    mean ${(m*1e4).toFixed(0)} var-pts | worst single window ${(worst*1e4).toFixed(0)} = ${(worst/m).toFixed(1)}x the mean, wiping ~${Math.abs(worst/m).toFixed(0)} months of premium`);
const sorted=[...all].sort((a,b)=>a-b);
console.log(`    5th pct ${(sorted[Math.floor(all.length*0.05)]*1e4).toFixed(0)} | median ${(sorted[Math.floor(all.length*0.5)]*1e4).toFixed(0)} | skew: mean-median = ${((m-sorted[Math.floor(all.length*0.5)])*1e4).toFixed(0)} var-pts (negative => left tail)`);
