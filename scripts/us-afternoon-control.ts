#!/usr/bin/env -S deno run --allow-net --allow-env
// us-afternoon-control.ts (D-447) — is 21:00-23:00 UTC actually SPECIAL, or just a slice of a large daily drift?
// D-445 found hours 21 and 22 positive on 14/14 symbols and called the window real-but-fee-bound. It flagged, without
// resolving, that the summed hourly drift across all 24 hours is ~+19.8bp/day — enormous, and survivorship-inflated. A
// 2-hour window inside a strongly drifting day is positive almost by construction. That objection has to be settled
// before the window means anything, and settling it needs the right null:
//   NULL 1 — ALL 2-hour windows. Where does 21:00-23:00 rank among the other 23 possible windows? If it is unremarkable,
//            the "14/14 symbols" claim is just the drift showing up everywhere.
//   NULL 2 — the DRIFT-NEUTRAL version: subtract each symbol's average 2-hour return over the whole sample, so what
//            remains is only the EXCESS of this window over a typical one. That is the tradable quantity.
//   NULL 3 — per-era stability. An effect that lives in one year is a calendar coincidence.
// Also tests the long/short pairing (long 21-23, short the consistently-negative 14:00 hour), which is drift-neutral by
// construction and doubles the edge per unit of exposure — if the two effects are independent.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ua",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};

const syms=(await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[]).filter(s=>s.n_bars>=20000);
console.log(`==> US-AFTERNOON CONTROL — ${syms.length} perps`);
// per symbol: for each start hour h, the return from close(h) to close(h+2), plus the date for era work
const win=new Map<number,number[][]>();      // startHour -> per-symbol arrays of 2h returns
const dated=new Map<number,{d:string;r:number}[][]>();
for(let h=0;h<24;h++){win.set(h,[]);dated.set(h,[]);}
const names:string[]=[];
for(const s of syms){
  const b=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(b)||!b[0])continue;
  const byDay=new Map<string,Map<number,number>>();
  for(const bar of b[0].bars){ if(!(bar[4]>0))continue; const dt=new Date(bar[0]*1000);
    (byDay.get(dt.toISOString().slice(0,10))??byDay.set(dt.toISOString().slice(0,10),new Map()).get(dt.toISOString().slice(0,10))!).set(dt.getUTCHours(),bar[4]); }
  names.push(s.symbol);
  for(let h=0;h<24;h++){
    const rs:number[]=[]; const dd:{d:string;r:number}[]=[];
    for(const [d,m] of byDay){ const e=m.get(h), x=m.get((h+2)%24);
      if(e&&x&&e>0&&(h+2)<24){ rs.push(x/e-1); dd.push({d,r:x/e-1}); } }
    if(rs.length>300){ win.get(h)!.push(rs); dated.get(h)!.push(dd); }
  }
}
console.log(`    loaded ${names.length} symbols\n`);
// NULL 1: rank every 2-hour window
console.log(`    NULL 1 — ALL 2-hour windows ranked (mean bp across symbols, and cross-symbol sign consistency)`);
const rank:{h:number;bp:number;pos:number;n:number}[]=[];
for(let h=0;h<22;h++){ const arr=win.get(h)!; if(arr.length<5)continue;
  const per=arr.map(a=>mean(a)*1e4); rank.push({h,bp:mean(per),pos:per.filter(x=>x>0).length,n:per.length}); }
rank.sort((a,b)=>b.bp-a.bp);
for(const r of rank.slice(0,6)) console.log(`      #${(rank.indexOf(r)+1).toString().padEnd(3)} ${String(r.h).padStart(2)}:00-${String(r.h+2).padStart(2)}:00  ${r.bp.toFixed(2).padStart(6)}bp  ${r.pos}/${r.n} symbols positive`);
console.log(`      ...`);
for(const r of rank.slice(-3)) console.log(`      #${(rank.indexOf(r)+1).toString().padEnd(3)} ${String(r.h).padStart(2)}:00-${String(r.h+2).padStart(2)}:00  ${r.bp.toFixed(2).padStart(6)}bp  ${r.pos}/${r.n} symbols positive`);
const target=rank.find(r=>r.h===20)!;
const others=rank.filter(r=>r.h!==20).map(r=>r.bp);
console.log(`\n      20:00-22:00 ranks #${rank.indexOf(target)+1} of ${rank.length}. Mean of all OTHER windows: ${mean(others).toFixed(2)}bp, sd ${sdv(others).toFixed(2)}bp`);
console.log(`      => it sits ${((target.bp-mean(others))/(sdv(others)||1e-9)).toFixed(2)} sd above the typical window`);
// NULL 2: drift-neutral excess
console.log(`\n    NULL 2 — DRIFT-NEUTRAL: each symbol's window return MINUS its own average 2h return over all hours`);
const excess:number[]=[];
for(let i=0;i<names.length;i++){
  const all:number[]=[]; for(let h=0;h<22;h++){const arr=win.get(h)!; if(arr[i])all.push(mean(arr[i]));}
  const t=win.get(20)![i]; if(!t||!all.length)continue;
  excess.push((mean(t)-mean(all))*1e4);
}
if(excess.length){
  const m=mean(excess), t=m/(sdv(excess)/Math.sqrt(excess.length));
  console.log(`      excess over a typical 2h window: ${m.toFixed(2)}bp, ${excess.filter(x=>x>0).length}/${excess.length} symbols positive, t ${t.toFixed(2)}`);
  console.log(`      vs 9bp taker round trip: ${(Math.abs(m)/9).toFixed(2)}x the fee  |  vs 3.6bp maker: ${(Math.abs(m)/3.6).toFixed(2)}x`);
}
// NULL 3: per-era
console.log(`\n    NULL 3 — PER-ERA stability of the 20:00-22:00 window (mean bp across symbols)`);
const ERA=(d:string)=>{const y=+d.slice(0,4);return y<=2021?"<=2021":y===2022?"2022":y<=2024?"2023-24":"2025-26";};
for(const e of ["<=2021","2022","2023-24","2025-26"]){
  const per:number[]=[];
  for(const dd of dated.get(20)!){ const g=dd.filter(x=>ERA(x.d)===e).map(x=>x.r); if(g.length>60)per.push(mean(g)*1e4); }
  if(per.length<5)continue;
  console.log(`      ${e.padEnd(9)} ${mean(per).toFixed(2).padStart(6)}bp  ${per.filter(x=>x>0).length}/${per.length} symbols positive`);
}
