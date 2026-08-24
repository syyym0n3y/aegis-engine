#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// etf-book.ts (D-531) — AN ETF-NATIVE BOOK: every leg is a pair of liquid ETFs the operator can actually place.
// Motivated by D-530: the French-portfolio book is not implementable, so a placeable analogue must be specified in its
// own right — NOT fitted to reproduce the research book (that fit failed OOS anyway; fitting harder would be curve-
// fitting a proxy). Construction is PRE-REGISTERED and dumb on purpose: six literature-sided legs, equal-VOL weights
// computed on an expanding window (point-in-time, no full-sample vol), monthly rebalance, 5bp round-trip per leg per
// rebalance (ETF-scale, stated). History starts 2013 (MTUM/VLUE/QUAL inception) — SHORT, and that limit is the
// headline caveat, not a footnote.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"eb",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[])) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
// PRE-REGISTERED LEGS: long the literature-favoured side, short the plain-beta hedge. All liquid, all shortable.
const LEGS:[string,string,string][]=[
  ["momentum","MTUM","SPY"],["value","VLUE","SPY"],["quality","QUAL","SPY"],
  ["lowvol","USMV","SPY"],["credit_carry","HYG","IEF"],["size","IWM","SPY"],
];
const px=new Map<string,Map<string,number>>();
for(const s of [...new Set(LEGS.flatMap(l=>[l[1],l[2]]))])px.set(s,await load(s));
const me=new Map<string,Map<string,number>>();
for(const [k,v] of px){const o=new Map<string,number>();for(const d of [...v.keys()].sort())o.set(d.slice(0,7),v.get(d)!);me.set(k,o);}
const allMo=[...new Set([...me.values()].flatMap(m=>[...m.keys()]))].sort();
const legRet=new Map<string,Map<string,number>>();
for(const [n,a,b] of LEGS){
  const m=new Map<string,number>();
  for(let i=1;i<allMo.length;i++){
    const A=me.get(a)!,B=me.get(b)!;
    const a1=A.get(allMo[i]),a0=A.get(allMo[i-1]),b1=B.get(allMo[i]),b0=B.get(allMo[i-1]);
    if(a1===undefined||a0===undefined||b1===undefined||b0===undefined)continue;
    m.set(allMo[i],(a1/a0-1)-(b1/b0-1)-2*5/1e4);              // 5bp round trip on each side, monthly
  }
  legRet.set(n,m);
}
const names=LEGS.map(l=>l[0]);
const mos=allMo.filter(mo=>names.every(n=>legRet.get(n)!.has(mo)));
console.log(`==> ETF-NATIVE BOOK (D-531) — ${names.length} placeable legs, ${mos.length} months (${mos[0]} .. ${mos.at(-1)})`);
const rets:number[]=[],used:string[]=[];
for(let i=24;i<mos.length;i++){                                // 24-month burn-in for the expanding-window vol
  const w=new Map<string,number>();
  for(const n of names){
    const hist=mos.slice(0,i).map(mo=>legRet.get(n)!.get(mo)!).filter(Number.isFinite);
    w.set(n,1/(sdv(hist)||1e-9));                              // POINT-IN-TIME vol only
  }
  const ws=[...w.values()].reduce((s,x)=>s+x,0);
  let acc=0; for(const n of names)acc+=(w.get(n)!/ws)*legRet.get(n)!.get(mos[i])!;
  rets.push(acc); used.push(mos[i]);
}
const m=mean(rets),sd=sdv(rets)||1e-9;
let cum=1,pk=1,dd=0;for(const x of rets){cum*=1+x;pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*rets.length/4),b=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a,b));});
console.log(`    per-leg (net of 10bp/mo round trip): ${names.map(n=>{const v=mos.map(mo=>legRet.get(n)!.get(mo)!);return `${n} ${(mean(v)*12*100).toFixed(1)}%/yr`;}).join("  ")}`);
console.log(`    BOOK: n=${rets.length}mo  net ${(m*12*100).toFixed(2)}%/yr  SR ${((m/sd)*Math.sqrt(12)).toFixed(2)}  t ${(m/(sd/Math.sqrt(rets.length))).toFixed(2)}  maxDD ${(dd*100).toFixed(0)}%  win ${(100*rets.filter(x=>x>0).length/rets.length).toFixed(0)}%  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
console.log(`    CAVEAT (headline, not footnote): ${rets.length} months of history. This is BELOW every sample floor the`);
console.log(`    program enforces. It is specified and placeable, not proven. Its only honest test is FORWARD.`);
await Deno.writeTextFile("/Users/ona/aegis-data/book_etf_native.tsv",used.map((mo,i)=>`${mo}\t${rets[i]}`).join("\n"));
console.log(`    stream written -> /Users/ona/aegis-data/book_etf_native.tsv`);
