#!/usr/bin/env -S deno run --allow-net --allow-env
// insider-cluster.ts (D-388) — NON-PRICE FRONTIER #2: insider CLUSTER buying. We already tested aggregate insider-buy
// intensity and it was null (D-373). The documented result (Cohen-Malloy-Pomorski) is that the aggregate hides the signal:
// what predicts is CLUSTER buying — several DISTINCT insiders buying the same name in a short window — versus routine
// single-filer activity. Each row in trd_insider is one Form-4 filing, so the cluster size is the count of distinct filings
// in the trailing window. Pure non-price information. PIT on disclosed_date (the legally knowable date), liquid-only,
// cross-sectional, real train/test split, net of cost.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ic",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H(); const HZ=Number(Deno.env.get("HZ")||21), WIN=Number(Deno.env.get("WIN")||90), LIQ=5e6;
console.log(`==> INSIDER CLUSTER BUYING (non-price) — window ${WIN}d, horizon ${HZ}d`);
// load all insider events (PIT date = disclosed_date)
const ev=new Map<string,{d:number;v:number}[]>();
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_insider?select=ticker,disclosed_date,value_usd&disclosed_date=not.is.null&order=ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {ticker:string;disclosed_date:string;value_usd:number}[]) (ev.get(r.ticker)??ev.set(r.ticker,[]).get(r.ticker)!).push({d:new Date(r.disclosed_date).getTime(),v:+r.value_usd||0});
 if(p.length<1000)break;}
for(const a of ev.values()) a.sort((x,y)=>x.d-y.d);
console.log(`insider events loaded for ${ev.size} tickers`);
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>ev.has(s)); console.log(`equities with prices + insider history: ${targets.length}`);
// monthly cross-sections: cluster = # distinct Form-4 buy filings in trailing WIN days (0 if none)
const byMonth=new Map<string,{sym:string;cluster:number;dollars:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]); const evs=ev.get(row.symbol)!; let last="";
    for(let j=260;j<b.length-HZ;j++){
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7); if(mo===last)continue; last=mo;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ)continue;
      const at=ts[j]*1000, lo=at-WIN*864e5;
      let cluster=0,dollars=0; for(const e of evs){ if(e.d>at) break; if(e.d>lo){cluster++;dollars+=e.v;} }
      const fwd=c[j+HZ]/c[j]-1; if(!Number.isFinite(fwd))continue;
      (byMonth.get(mo)??byMonth.set(mo,[]).get(mo)!).push({sym:row.symbol,cluster,dollars,fwd});
    }}}
const months=[...byMonth.keys()].sort();
const all=[...byMonth.values()].flat();
console.log(`cross-sections: ${months.length} months, ${all.length} obs; with >=1 filing: ${all.filter(x=>x.cluster>0).length}`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
// A. event-study by cluster size (the documented claim: MORE distinct insiders = stronger)
console.log("\n=== forward 21d return by CLUSTER SIZE (# distinct Form-4 buy filings in trailing 90d) ===");
const buckets:[string,(x:number)=>boolean][]=[["0 (none)",x=>x===0],["1",x=>x===1],["2",x=>x===2],["3-4",x=>x>=3&&x<=4],["5+",x=>x>=5]];
const baseAll=mean(all.map(x=>x.fwd));
for(const [nm,f] of buckets){const s=all.filter(x=>f(x.cluster)); if(s.length<200){console.log(`  ${nm.padEnd(9)}: n=${s.length} (thin)`);continue;}
  const m=mean(s.map(x=>x.fwd)); console.log(`  ${nm.padEnd(9)}: n=${String(s.length).padStart(6)}  fwd ${(m*100).toFixed(2)}%  vs-universe ${((m-baseAll)*100).toFixed(2)}pp`);}
// B. cross-sectional monthly LS: long cluster>=2, short cluster==0 (net of cost), train/test
const ls:number[]=[];
for(const mo of months){const a=byMonth.get(mo)!; const L=a.filter(x=>x.cluster>=2), S=a.filter(x=>x.cluster===0);
  if(L.length<5||S.length<20)continue; ls.push(mean(L.map(x=>x.fwd))-mean(S.map(x=>x.fwd)));}
const split=Math.floor(ls.length*0.6);
const rep=(nm:string,a:number[])=>{if(a.length<12){console.log(`  ${nm}: thin (${a.length})`);return;}const m=mean(a)-0.002;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1));console.log(`  ${nm}: n=${a.length}mo NET ${(m*100).toFixed(2)}%/21d ann ${(m*12*100).toFixed(1)}% SR ${(sd>0?(m/sd)*Math.sqrt(12):0).toFixed(2)} t ${tstat(a).toFixed(2)} win ${(100*a.filter(x=>x>0.002).length/a.length).toFixed(0)}%`);};
console.log("\n=== monthly LS: long cluster>=2 vs short cluster==0 (liquid, net 20bp) ===");
rep("FULL      ",ls); rep("TRAIN(60%)",ls.slice(0,split)); rep("TEST (40%)",ls.slice(split));

// C. DECISIVE: is the "5+ cluster" effect cross-sectional ALPHA or time-clustered BETA? Insiders buy en masse at market
// bottoms, so a pooled event study credits the signal for the market's subsequent bounce. Control by comparing 5+ names to
// the SAME MONTH's universe (within-month excess), and show when the 5+ observations actually occur.
console.log("\n=== is 5+ cluster ALPHA or time-clustered BETA? ===");
const exc:number[]=[]; const when=new Map<string,number>();
for(const mo of months){const a=byMonth.get(mo)!; const hi=a.filter(x=>x.cluster>=5); if(!hi.length)continue;
  when.set(mo.slice(0,4),(when.get(mo.slice(0,4))||0)+hi.length);
  if(a.length<20)continue; exc.push(mean(hi.map(x=>x.fwd))-mean(a.map(x=>x.fwd)));}
if(exc.length>=12){const m=mean(exc);const sd=Math.sqrt(exc.reduce((s,x)=>s+(x-m)**2,0)/(exc.length-1));
  console.log(`  WITHIN-MONTH excess of 5+ vs same-month universe: ${(m*100).toFixed(2)}%/21d  t ${tstat(exc).toFixed(2)}  n=${exc.length}mo  (pooled said +1.39pp)`);}
const yrs=[...when.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
console.log(`  5+ observations concentrate in: ${yrs.map(([y,n])=>`${y}(${n})`).join(", ")}`);
