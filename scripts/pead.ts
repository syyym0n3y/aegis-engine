#!/usr/bin/env -S deno run --allow-net --allow-env
// pead.ts (D-393) — POST-EARNINGS ANNOUNCEMENT DRIFT. The most robust documented anomaly in the literature (Ball-Brown 1968;
// Bernard-Thomas 1989; still alive in Chan-Jegadeesh-Lakonishok and modern replications) — and I never tested it despite
// having the data. Operator was right to call that out.
// Two classic forms, both tested:
//   (A) SUE  — standardised unexpected earnings via seasonal random walk (this quarter's NI vs same quarter last year,
//              scaled by the stdev of past changes). Fundamental surprise.
//   (B) CAR  — the 3-day abnormal return AROUND the announcement (market-adjusted). The purest PEAD form and robust to
//              our lack of analyst estimates: the market's own reaction predicts the drift.
// Event date = the actual 10-Q/10-K FILING date from EDGAR (real, not the synthetic period_end+75d). Drift window starts
// 2 days AFTER the event (no look-ahead — the F5/D-389 lesson). Within-event-month cross-sections, liquid-only, net of cost.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const UA={"User-Agent":"Aegis Research ona@revitalise.io"};
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"pd",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const YEARS=(Deno.env.get("YEARS")||"2019,2020,2021,2022,2023,2024,2025").split(",");
const DRIFT=Number(Deno.env.get("DRIFT")||42);   // drift window (trading days) — literature uses ~60 calendar / 40-60 trading
console.log(`==> PEAD — earnings drift over ${DRIFT} trading days`);
// 1. CIK->ticker
const c2t=new Map<string,string>();
try{const j=await fetch("https://www.sec.gov/files/company_tickers.json",{headers:UA}).then(r=>r.json());
 for(const v of Object.values(j as Record<string,{cik_str:number;ticker:string}>)) c2t.set(String(v.cik_str),(v.ticker||"").toUpperCase());}catch{/*ignore*/}
// 2. real earnings-filing dates (10-Q + 10-K) from EDGAR full-index
const ev=new Map<string,string[]>();   // ticker -> [YYYY-MM-DD]
let idx=0;
for(const y of YEARS) for(const q of [1,2,3,4]){
  try{const r=await fetch(`https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/form.idx`,{headers:UA}); if(!r.ok)continue;
    const txt=await r.text(); idx++;
    for(const ln of txt.split("\n")){
      if(!/^10-[QK]\s/.test(ln)) continue;
      const m=ln.match(/^10-[QK]\s+.*?\s(\d{4,10})\s+(\d{4}-\d{2}-\d{2})\s/); if(!m) continue;
      const tk=c2t.get(String(+m[1])); if(!tk) continue;
      (ev.get(tk)??ev.set(tk,[]).get(tk)!).push(m[2]);
    }
    await new Promise(r=>setTimeout(r,120));
  }catch{/*skip*/}
}
for(const a of ev.values()) a.sort();
console.log(`EDGAR indexes: ${idx}; tickers with 10-Q/K events: ${ev.size}`);
// 3. fundamentals for SUE
const ni=new Map<string,{e:number;pe:string;v:number}[]>();
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_fundamentals?concept=eq.NetIncomeLoss&select=ticker,effective_date,period_end,value&order=ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {ticker:string;effective_date:string;period_end:string;value:number}[])(ni.get(r.ticker)??ni.set(r.ticker,[]).get(r.ticker)!).push({e:new Date(r.effective_date).getTime(),pe:r.period_end,v:+r.value});
 if(p.length<1000)break;}
for(const a of ni.values()) a.sort((x,y)=>x.pe<y.pe?-1:1);
// 4. join to prices; SPY for market adjustment
const spyRow=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.SPY&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
const spy=new Map<string,number>(); if(spyRow.length) for(const b of spyRow[0].bars) spy.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>ev.has(s)); console.log(`equities with prices + earnings events: ${targets.length}`);
const LIQ=5e6;
const byMo=new Map<string,{sym:string;car:number;sue:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]);
    const idxm=new Map<string,number>(); for(let j=0;j<ts.length;j++) idxm.set(new Date(ts[j]*1000).toISOString().slice(0,10),j);
    const nis=ni.get(row.symbol);
    for(const d of ev.get(row.symbol)!){
      let j=idxm.get(d); if(j==null){for(let k=1;k<=4&&j==null;k++){const dd=new Date(d);dd.setUTCDate(dd.getUTCDate()+k);j=idxm.get(dd.toISOString().slice(0,10));}}
      if(j==null||j<260||j+2+DRIFT>=c.length) continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ) continue;
      // (B) CAR: 3-day market-adjusted return around the event [-1,+1]
      const a0=c[j-2], a1=c[j+1]; if(!(a0>0)||!(a1>0)) continue;
      const dm0=new Date(ts[j-2]*1000).toISOString().slice(0,10), dm1=new Date(ts[j+1]*1000).toISOString().slice(0,10);
      const s0=spy.get(dm0), s1=spy.get(dm1); const mkt=(s0&&s1&&s0>0)? s1/s0-1 : 0;
      const car=(a1/a0-1)-mkt;
      // (A) SUE: seasonal random walk on NetIncomeLoss (this period vs same period last year), scaled by stdev of changes
      let sue=NaN;
      if(nis&&nis.length>=6){ const known=nis.filter(x=>x.e<=ts[j]*1000);
        if(known.length>=5){ const cur=known[known.length-1], yr=known[known.length-5];
          const chgs:number[]=[]; for(let k=4;k<known.length;k++) chgs.push(known[k].v-known[k-4].v);
          const m=chgs.reduce((s,x)=>s+x,0)/chgs.length; const sd=Math.sqrt(chgs.reduce((s,x)=>s+(x-m)**2,0)/chgs.length)||1;
          sue=(cur.v-yr.v)/sd; } }
      // drift: from 2 days AFTER the event (entry) forward DRIFT days — market-adjusted
      const e=j+2, x=e+DRIFT; const de=new Date(ts[e]*1000).toISOString().slice(0,10), dx=new Date(ts[x]*1000).toISOString().slice(0,10);
      const se=spy.get(de), sx=spy.get(dx); const mktD=(se&&sx&&se>0)? sx/se-1 : 0;
      const fwd=(c[x]/c[e]-1)-mktD; if(!Number.isFinite(fwd)||!Number.isFinite(car)) continue;
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7);
      (byMo.get(mo)??byMo.set(mo,[]).get(mo)!).push({sym:row.symbol,car,sue:Number.isFinite(sue)?sue:NaN,fwd});
    }}}
const months=[...byMo.keys()].sort(); const all=[...byMo.values()].flat();
console.log(`events: ${all.length} across ${months.length} months`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
for(const [nm,get] of [["CAR (3d announcement reaction)",(x:{car:number;sue:number})=>x.car],["SUE (earnings surprise)",(x:{car:number;sue:number})=>x.sue]] as [string,(x:{car:number;sue:number})=>number][]){
  const ics:number[]=[], ls:number[]=[];
  for(const mo of months){const a=byMo.get(mo)!.filter(x=>Number.isFinite(get(x))); if(a.length<20)continue;
    ics.push(rankIC(a.map(get),a.map(x=>x.fwd)));      // PEAD: HIGH surprise -> HIGH drift (positive IC expected)
    const s=[...a].sort((p,q)=>get(p)-get(q)); const q=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(s.length-q).map(x=>x.fwd))-mean(s.slice(0,q).map(x=>x.fwd)));}
  if(ls.length<12){console.log(`\n${nm}: thin`);continue;}
  const sp=Math.floor(ls.length*0.6), cost=0.004;   // 2 legs x 20bp round-trip
  const rep=(t:string,ic:number[],l:number[])=>{const m=mean(l)-cost; const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1)); const per=252/DRIFT;
    console.log(`  ${t}: n=${l.length}mo IC ${mean(ic).toFixed(4)} (t ${tstat(ic).toFixed(2)}) quintile-LS gross ${(mean(l)*100).toFixed(2)}% NET ${(m*100).toFixed(2)}%/${DRIFT}d ann ${(m*per*100).toFixed(1)}% SR ${(sd>0?(m/sd)*Math.sqrt(per):0).toFixed(2)} t ${tstat(l).toFixed(2)}`);};
  console.log(`\n=== ${nm} -> market-adjusted drift, entry 2d AFTER the filing ===`);
  rep("FULL      ",ics,ls); rep("TRAIN(60%)",ics.slice(0,sp),ls.slice(0,sp)); rep("TEST (40%)",ics.slice(sp),ls.slice(sp));
}
