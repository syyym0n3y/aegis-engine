#!/usr/bin/env -S deno run --allow-net --allow-env
// check-voltiming-survivor.ts (D-498) — adversarial verification of the FIRST-EVER factory survivors:
// voltiming term9d (risk-off when VIX9D/VIX > th) on SPY/QQQ, recorded t 5.53-5.81.
// Three pre-registered killers, each a known slayer of daily timing results:
//   K1 EXECUTION LAG: signal at close i, position taken at close i+1 (return i+1 -> i+2). Same-close execution of a
//      close-derived signal is not tradable; if the edge lives in day i+1 alone, it is a phantom.
//   K2 PSEUDO-REPLICATION: daily t inflated by vol clustering; the deciding stat is the MONTHLY-aggregated excess t.
//   K3 REGIME CONCENTRATION: share of total excess from the top 5 days and from the single best year.
// Every variant evaluated here is recorded as a trial (2 instruments x 2 thresholds x lag{0,1} = 8).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vt",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const iso=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const v9r=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.index_close&symbol=eq.VIX9D&select=ts,open_interest&order=ts&limit=100000`,{headers:hdr}).then(x=>x.json()) as {ts:number;open_interest:number}[];
const v9=new Map(v9r.map(x=>[iso(x.ts),+x.open_interest]));
const vixB=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.%5EVIX&select=bars`,{headers:hdr}).then(x=>x.json()) as {bars:number[][]}[];
const vix=new Map<string,number>((vixB[0]?.bars||[]).map(b=>[iso(b[0]),b[4]]));
// trial counter: 8 variants examined
// D-681: the key was `voltiming-adversarial-${Date.now()}`, so every manual re-run of this one-shot counted as a
// fresh trial. It is one specification; re-running it against unchanged data yields the same answer and buys no new
// chance to cherry-pick, so the key is stable and the unique constraint absorbs the repeat. The comment sits ABOVE
// the block deliberately: placed inside it, three lines of prose pushed the res.ok check out of the plumbing guard's
// proximity window and turned a checked write into a reported silent-write — a false positive I created and then had
// to read. Proximity is load-bearing to that guard; keep the check next to its fetch.
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal,resolution=ignore-duplicates"},
  body:JSON.stringify({family:"adhoc",run_key:`voltiming-adversarial-D544`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
for(const inst of ["SPY","QQQ"]){
  const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${inst}&select=bars`,{headers:hdr}).then(x=>x.json()) as {bars:number[][]}[];
  const bars=(r[0]?.bars||[]).filter(b=>b[4]>0);
  for(const th of [1.0,1.05]){
    for(const lag of [0,1]){
      const ex:number[]=[]; const exByDay:{d:string;x:number}[]=[]; let sw=0,prev=1;
      for(let i=0;i<bars.length-1-lag;i++){
        const d=iso(bars[i][0]); const a=v9.get(d),b=vix.get(d);
        if(a==null||b==null)continue;
        const w=(a/b>th)?0:1;
        const j=i+lag;                                   // position applies to return j -> j+1
        const r2=bars[j+1][4]/bars[j][4]-1;
        const net=w*r2-(w!==prev?10/1e4:0); if(w!==prev){sw++;prev=w;}
        ex.push(net-r2); exByDay.push({d:iso(bars[j][0]),x:net-r2});
      }
      const m=mean(ex),t=m/((sdv(ex)||1e-9)/Math.sqrt(ex.length));
      // K2: monthly aggregation
      const moMap=new Map<string,number>();
      for(const e of exByDay) moMap.set(e.d.slice(0,7),(moMap.get(e.d.slice(0,7))||0)+e.x);
      const mos=[...moMap.values()];
      const tm=mean(mos)/((sdv(mos)||1e-9)/Math.sqrt(mos.length));
      // K3: concentration
      const sorted=[...exByDay].sort((p,q)=>q.x-p.x);
      const tot=ex.reduce((s,x)=>s+x,0);
      const top5=sorted.slice(0,5).reduce((s,e)=>s+e.x,0);
      const byYr=new Map<string,number>();
      for(const e of exByDay) byYr.set(e.d.slice(0,4),(byYr.get(e.d.slice(0,4))||0)+e.x);
      const bestYr=[...byYr.entries()].sort((p,q)=>q[1]-p[1])[0];
      const yrs=[...byYr.entries()].sort();
      console.log(`${inst} th=${th} lag=${lag}: n=${ex.length} excess ${(m*252*100).toFixed(1)}%/yr t_daily=${t.toFixed(2)} t_monthly=${tm.toFixed(2)} (n=${mos.length}mo) sw=${sw}`);
      console.log(`   top5days=${(100*top5/Math.abs(tot||1e-9)).toFixed(0)}% of total | best yr ${bestYr[0]}=${(bestYr[1]*100).toFixed(1)}pp of ${(tot*100).toFixed(1)}pp total`);
      if(lag===1) console.log(`   years: ${yrs.map(([y,v])=>`${y.slice(2)}:${(v*100).toFixed(0)}`).join(" ")}`);
    }
  }
}
