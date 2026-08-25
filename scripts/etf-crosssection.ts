#!/usr/bin/env -S deno run --allow-net --allow-env
// etf-crosssection.ts (D-576) — INSTRUMENT-SPACE FIRST, per the law enacted in D-575.
// Every previous equity test measured a premium in research space (decile long-shorts over thousands of names) and
// then failed to convert it. Here the measurement IS the instrument: ~26 liquid, shortable ETFs, ranked against each
// other, with ETF-scale costs. No conversion step exists, so no conversion can destroy it.
// This is the "value and momentum everywhere" / asset-class-momentum literature, and the signals carry their published
// signs: 12-1 momentum (+), 1-month reversal (-), volatility (-), proximity to 52-week high (+).
// BREADTH IS HONEST: ~26 names is far below the 50-name cross-sectional floor, so this is judged as a TIME-SERIES
// PORTFOLIO class (like the COT books), with the name count stated, never as a broad cross-section.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ex",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const UNIV=["SPY","QQQ","IWM","DIA","EEM","EFA","VGK","EWJ","XLF","XLK","XLE","XLU","XLP","XLI","XLV","XLY","TLT","IEF","HYG","LQD","JNK","GLD","MTUM","VLUE","QUAL","USMV"];
const FEE_BP=Number(Deno.env.get("ETF_FEE_RT_BP")||10);
const K=Number(Deno.env.get("K")||5);
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[]))if(b[4]>0)m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const px=new Map<string,Map<string,number>>();
for(const s of UNIV)px.set(s,await load(s));
const have=UNIV.filter(s=>(px.get(s)?.size??0)>500);
console.log(`==> ETF CROSS-SECTION (D-576) — INSTRUMENT SPACE, ${have.length} liquid shortable ETFs, ${K} long / ${K} short, ${FEE_BP}bp round trip`);
// monthly grid from SPY's calendar
const spyDays=[...px.get("SPY")!.keys()].sort();
const monthEnd:string[]=[];
for(let i=0;i<spyDays.length-1;i++) if(spyDays[i].slice(0,7)!==spyDays[i+1].slice(0,7)) monthEnd.push(spyDays[i]);
monthEnd.push(spyDays[spyDays.length-1]);
const at=(s:string,d:string)=>px.get(s)!.get(d);
const back=(s:string,d:string,n:number)=>{const idx=monthEnd.indexOf(d);return idx-n>=0?at(s,monthEnd[idx-n]):undefined;};
type Sig=[string,number];
const SIGS:Sig[]=[["mom12_1",1],["rev1m",-1],["vol12",-1],["hi52",1]];
const rets:number[]=[]; const dates:string[]=[]; let avgN=0,nm=0;
let prevW=new Map<string,number>();
for(let j=13;j<monthEnd.length-1;j++){
  const d=monthEnd[j], dn=monthEnd[j+1];
  const rows:{sym:string;vals:number[];fwd:number}[]=[];
  for(const s of have){
    const p0=at(s,d), p1=at(s,dn); if(p0===undefined||p1===undefined)continue;
    const p12=back(s,d,12), p1m=back(s,d,1);
    if(p12===undefined||p1m===undefined)continue;
    // trailing 12m monthly vol
    const r12:number[]=[];
    for(let q=j-11;q<=j;q++){const a=at(s,monthEnd[q]),b=at(s,monthEnd[q-1]);if(a!==undefined&&b!==undefined)r12.push(a/b-1);}
    if(r12.length<10)continue;
    const hi=Math.max(...monthEnd.slice(Math.max(0,j-11),j+1).map(m=>at(s,m)??0));
    rows.push({sym:s,vals:[p1m/p12-1, p0/p1m-1, sdv(r12), hi>0?p0/hi:0],fwd:p1/p0-1});
  }
  if(rows.length<12)continue;
  // rank-normalise each signal, apply literature signs, average
  const score=new Array(rows.length).fill(0);
  SIGS.forEach(([,sg],f)=>{
    const ord=[...rows.keys()].sort((a,b)=>rows[a].vals[f]-rows[b].vals[f]);
    ord.forEach((gi,rk)=>{score[gi]+=sg*(rk/(rows.length-1)-0.5)/SIGS.length;});
  });
  const ord=[...rows.keys()].sort((a,b)=>score[b]-score[a]);
  const w=new Map<string,number>();
  for(const i of ord.slice(0,K))w.set(rows[i].sym,1/(2*K));
  for(const i of ord.slice(-K))w.set(rows[i].sym,-(1/(2*K)));
  let ret=0; for(const [s,ww] of w) ret+=ww*(rows.find(r=>r.sym===s)!.fwd);
  let to=0; for(const s of new Set([...w.keys(),...prevW.keys()])) to+=Math.abs((w.get(s)||0)-(prevW.get(s)||0));
  prevW=w;
  rets.push(ret-(to/2)*FEE_BP/1e4); dates.push(d); avgN+=2*K; nm++;
}
const m=mean(rets),sd=sdv(rets)||1e-9;
let cum=1,pk=1,dd=0,cur=0,longest=0;
for(const x of rets){cum*=1+x; if(cum>=pk){pk=cum;longest=Math.max(longest,cur);cur=0;} else cur++; dd=Math.min(dd,cum/pk-1);}
longest=Math.max(longest,cur);
const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*rets.length/4),b=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a,b));});
console.log(`    ${rets.length} months (${dates[0]} .. ${dates.at(-1)}), ${(avgN/Math.max(1,nm)).toFixed(0)} positions/month`);
console.log(`    ${(m*12*100).toFixed(1)}%/yr  SR ${((m/sd)*Math.sqrt(12)).toFixed(2)}  t ${(m/(sd/Math.sqrt(rets.length))).toFixed(2)}  maxDD ${(dd*100).toFixed(0)}%  win ${(100*rets.filter(x=>x>0).length/rets.length).toFixed(0)}%  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
console.log(`    HOLDABILITY: longest underwater ${longest} months (${(longest/12).toFixed(1)} years)`);
console.log(`    MEASUREMENT SPACE: PLACEABLE INSTRUMENT — every name is a liquid shortable ETF and the fee is ETF-scale.`);
console.log(`    BREADTH: ${(avgN/Math.max(1,nm)).toFixed(0)} positions from ${have.length} candidates — BELOW the 50-name floor, so this is a`);
console.log(`    time-series-portfolio class judged with its name count stated, not a broad cross-section.`);
