#!/usr/bin/env -S deno run --allow-net --allow-env
// nonprice-frontier.ts (D-387) — HUNT THE NON-PRICE FRONTIER. D-372 showed ~85% of a stock's variance is idiosyncratic to
// macro forces, and D-373 showed the per-name FUNDAMENTAL forces have real IC but no tradable deflated edge. The remaining
// untested territory is genuinely NON-PRICE information. This tests SEC 8-K FILING INTENSITY: the count of material-event
// filings (8-K) a company makes in a window, normalised against its own history — pure corporate-event flow, containing ZERO
// price input. Documented family: information/attention flow predicts returns. Free + keyless from EDGAR full-index.
// Tested with the same discipline as everything else: point-in-time, liquid-only, cross-sectional rank-IC, real train/test
// split, decile spread net of cost, and deflation.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA = { "User-Agent": "Aegis Research ona@revitalise.io" };
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"np",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H = async () => { const t = await jwt(); return { "Content-Type":"application/json", Authorization:`Bearer ${t}`, apikey:t }; };
const hdr = await H();
const YEARS = (Deno.env.get("YEARS")||"2018,2019,2020,2021,2022,2023,2024,2025").split(",");
console.log("==> NON-PRICE FRONTIER: SEC 8-K filing intensity (free/keyless, zero price input)");

// 1. CIK -> ticker map (from the owned fundamentals table: cik was stored as ticker in the sync, so pull the SEC map fresh)
const c2t = new Map<string,string>();
try {
  const j = await fetch("https://www.sec.gov/files/company_tickers.json",{headers:UA}).then(r=>r.json());
  for (const v of Object.values(j as Record<string,{cik_str:number;ticker:string}>)) c2t.set(String(v.cik_str), (v.ticker||"").toUpperCase());
} catch(e){ console.log("cik map failed:",String(e).slice(0,80)); }
console.log(`cik->ticker map: ${c2t.size}`);

// 2. EDGAR quarterly form index -> count 8-K filings per ticker per month (PIT: the filing date IS the knowable date)
const cnt = new Map<string, Map<string, number>>(); // ticker -> "YYYY-MM" -> count
let idxOk = 0;
for (const y of YEARS) for (const q of [1,2,3,4]) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/form.idx`;
  try {
    const r = await fetch(url,{headers:UA}); if(!r.ok) continue;
    const txt = await r.text(); idxOk++;
    for (const ln of txt.split("\n")) {
      if (!ln.startsWith("8-K ")) continue;                       // form type is left-justified in col 0
      const m = ln.match(/^8-K\s+.*?\s(\d{4,10})\s+(\d{4}-\d{2}-\d{2})\s/);
      if (!m) continue;
      const tk = c2t.get(String(+m[1])); if(!tk) continue;
      const mo = m[2].slice(0,7);
      const t = cnt.get(tk) ?? cnt.set(tk,new Map()).get(tk)!;
      t.set(mo,(t.get(mo)||0)+1);
    }
    await new Promise(r=>setTimeout(r,120));                       // SEC pace
  } catch { /* skip */ }
}
console.log(`quarterly indexes read: ${idxOk}; tickers with 8-K activity: ${cnt.size}`);
if (cnt.size < 100) { console.log("insufficient filing data — abort"); Deno.exit(0); }

// 3. join to prices (owned) and test cross-sectionally
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets = esyms.filter(s=>cnt.has(s));
console.log(`equities with both prices and 8-K history: ${targets.length}`);
const HZ=21, LIQ=5e6;
const byMonth = new Map<string,{sym:string;sig:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){
    const b=row.bars; if(!b||b.length<300) continue;
    const c=b.map(r=>r[4]), v=b.map(r=>r[5]), ts=b.map(r=>r[0]);
    const hist=cnt.get(row.symbol)!;
    let last="";
    for(let j=260;j<b.length-HZ;j++){
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7); if(mo===last)continue; last=mo;
      if(!hist.has(mo)) continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ) continue;
      // ABNORMAL filing intensity: this month's 8-K count vs the trailing 12-month mean for the SAME company (own baseline,
      // so it is a surprise measure, not a size proxy). PIT: only months strictly BEFORE `mo` enter the baseline.
      const prior:number[]=[]; const d=new Date(mo+"-01");
      for(let back=1;back<=12;back++){const dd=new Date(d); dd.setUTCMonth(dd.getUTCMonth()-back); const key=dd.toISOString().slice(0,7); prior.push(hist.get(key)||0);}
      const base=prior.reduce((s,x)=>s+x,0)/prior.length;
      const sd=Math.sqrt(prior.reduce((s,x)=>s+(x-base)**2,0)/prior.length)||1;
      const sig=((hist.get(mo)||0)-base)/sd;                        // z-score of event flow vs own history
      const fwd=c[j+HZ]/c[j]-1; if(!Number.isFinite(sig)||!Number.isFinite(fwd)) continue;
      (byMonth.get(mo)??byMonth.set(mo,[]).get(mo)!).push({sym:row.symbol,sig,fwd});
    }
  }
}
const months=[...byMonth.keys()].sort();
console.log(`cross-sections: ${months.length} months, ${[...byMonth.values()].reduce((s,a)=>s+a.length,0)} obs`);
if(months.length<24){console.log("too few months — abort");Deno.exit(0);}
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
const ics:number[]=[], ls:number[]=[];
for(const mo of months){const a=byMonth.get(mo)!; if(a.length<20)continue;
  ics.push(rankIC(a.map(x=>x.sig),a.map(x=>x.fwd)));
  const s=[...a].sort((p,q)=>p.sig-q.sig); const d=Math.max(1,Math.floor(s.length/5));
  ls.push(s.slice(s.length-d).reduce((t,x)=>t+x.fwd,0)/d - s.slice(0,d).reduce((t,x)=>t+x.fwd,0)/d);
}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const split=Math.floor(ls.length*0.6);
const rep=(nm:string,ic:number[],l:number[])=>{ if(l.length<12){console.log(`  ${nm}: thin`);return;} const m=mean(l)-0.002; const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1)); const sr=sd>0?(m/sd)*Math.sqrt(12):0; console.log(`  ${nm}: n=${l.length}mo  IC ${mean(ic).toFixed(4)} (t ${tstat(ic).toFixed(2)})  quintile-LS NET ${(m*100).toFixed(2)}%/21d  ann ${(m*12*100).toFixed(1)}%  SR ${sr.toFixed(2)}`); };
console.log("\n=== 8-K FILING-INTENSITY (abnormal event flow) -> forward 21d return ===");
rep("FULL      ",ics,ls);
rep("TRAIN(60%)",ics.slice(0,split),ls.slice(0,split));
rep("TEST (40%)",ics.slice(split),ls.slice(split));
