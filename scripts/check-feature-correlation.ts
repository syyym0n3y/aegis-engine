// D-550: verify (or refute) the explanation I gave for why funding hurt the book — that it duplicates momentum/flow.
// Measures the CROSS-SECTIONAL rank correlation between features, averaged across days, on the top-50 liquid universe.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const corr=(a:number[],b:number[])=>{const ma=mean(a),mb=mean(b);let nu=0,d1=0,d2=0;
  for(let i=0;i<a.length;i++){nu+=(a[i]-ma)*(b[i]-mb);d1+=(a[i]-ma)**2;d2+=(b[i]-mb)**2;}
  return d1&&d2?nu/Math.sqrt(d1*d2):0;};
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()) as {symbol:string}[];
const fundMap=new Map<string,{ts:number;r:number}[]>();
{let off=0;for(;;){const p=await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&select=symbol,ts,open_interest&order=symbol,ts&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
 if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {symbol:string;ts:number;open_interest:number}[])(fundMap.get(r.symbol)??fundMap.set(r.symbol,[]).get(r.symbol)!).push({ts:+r.ts,r:+r.open_interest});
 if(p.length<50000)break; off+=50000;}}
const f7=(sym:string,tsEnd:number)=>{const a=fundMap.get(sym);if(!a)return null;const lo=tsEnd-7*86400;let s=0,n=0;
  let i=a.length-1;while(i>=0&&a[i].ts>tsEnd)i--;for(;i>=0&&a[i].ts>=lo;i--){s+=a[i].r;n++;}return n>=10?s/n:null;};
const NAMES=["mom30","mom7","rev1","vol30","maxret","dvol","hi60","flow","relvol","trades","fund7"];
const byDay=new Map<string,number[][]>();
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){const b=r.bars;if(!b||b.length<120)continue;
    for(let k=61;k<b.length-1;k++){
      const c=b[k][4],cP7=b[k-7][4],cP30=b[k-30][4],cP1=b[k-1][4];
      if(!(c>0&&cP7>0&&cP30>0&&cP1>0))continue;
      const rets:number[]=[];for(let j=k-30;j<k;j++)if(b[j][4]>0&&b[j-1][4]>0)rets.push(b[j][4]/b[j-1][4]-1);
      if(rets.length<25)continue;
      const dv=mean(b.slice(k-30,k).map(x=>x[6]).filter(Number.isFinite)); if(!(dv>1e6))continue;
      const hi=Math.max(...b.slice(k-60,k+1).map(x=>x[2]));
      const fw=b.slice(k-7,k);let tb=0,tv=0;for(const x of fw){tb+=x[7];tv+=x[5];}
      const v7=mean(b.slice(k-7,k).map(x=>x[5])),v30=mean(b.slice(k-30,k).map(x=>x[5]));
      const fr=f7(r.symbol,b[k][0]);
      const x=[c/cP30-1,c/cP7-1,c/cP1-1,sdv(rets),Math.max(...rets),Math.log(dv),c/hi,tv>0?(2*tb-tv)/tv:0,(v7>0&&v30>0)?Math.log(v7/v30):0,Math.log(1+mean(b.slice(k-7,k).map(y=>y[8]).filter(Number.isFinite))),fr??NaN];
      if(x.some(v=>!Number.isFinite(v)))continue;
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      (byDay.get(d)??byDay.set(d,[]).get(d)!).push(x);
    }}}
const acc=new Map<string,number[]>();
let days=0;
for(const [,g] of byDay){
  if(g.length<40)continue;
  const top=g.sort((a,b)=>b[5]-a[5]).slice(0,50);
  if(top.length<30)continue;
  days++;
  for(let a=0;a<NAMES.length;a++)for(let b=a+1;b<NAMES.length;b++){
    const key=`${NAMES[a]}|${NAMES[b]}`;
    (acc.get(key)??acc.set(key,[]).get(key)!).push(corr(top.map(r=>r[a]),top.map(r=>r[b])));
  }}
console.log(`==> CROSS-SECTIONAL FEATURE CORRELATION (top-50 liquid, ${days} days) — testing my own explanation for D-549`);
const fundPairs=[...acc.entries()].filter(([k])=>k.includes("fund7")).map(([k,v])=>[k,mean(v)] as [string,number]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
console.log(`    funding vs each signal:`);
for(const [k,v] of fundPairs)console.log(`      ${k.padEnd(22)} ${v>=0?"+":""}${v.toFixed(3)}`);
const others=[...acc.entries()].filter(([k])=>!k.includes("fund7")).map(([k,v])=>[k,mean(v)] as [string,number]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6);
console.log(`    strongest NON-funding pairs (for scale):`);
for(const [k,v] of others)console.log(`      ${k.padEnd(22)} ${v>=0?"+":""}${v.toFixed(3)}`);
