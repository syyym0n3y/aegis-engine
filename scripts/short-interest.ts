#!/usr/bin/env -S deno run --allow-net --allow-env
// short-interest.ts (D-389) — NON-PRICE FRONTIER #3: FINRA daily SHORT-SALE VOLUME. The strongest remaining documented
// non-price signal (Boehmer-Jones-Zhang 2008, "Which Shorts Are Informed?": heavily-shorted names underperform — short
// sellers are informed). Free + keyless from cdn.finra.org (operator added to the allowlist, D-389). Signal contains ZERO
// price input: it is the fraction of each day's volume executed short.
// Tested with the full discipline the audit forced: point-in-time, liquid-only, WITHIN-MONTH cross-sectional (the control
// that killed the insider-cluster beta trap), real train/test split, net of cost + borrow, and BOTH level and change.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"si",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const Y0=Number(Deno.env.get("Y0")||2019), Y1=Number(Deno.env.get("Y1")||2025);
const HZ=21, LIQ=5e6;
// 1. INGEST: sample ~4 days/month of FINRA daily short volume -> monthly mean short ratio per ticker
const ratio=new Map<string,Map<string,{s:number;t:number;n:number}>>(); // ticker -> month -> sums
let files=0;
for(let y=Y0;y<=Y1;y++) for(let m=1;m<=12;m++) for(const d of [5,12,19,26]) {
  const ds=`${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}`;
  let txt=""; 
  for(const off of [0,1,2]) { // skip weekends/holidays by trying the next day or two
    const dt=new Date(Date.UTC(y,m-1,d+off)); const k=`${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,"0")}${String(dt.getUTCDate()).padStart(2,"0")}`;
    try{const r=await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${k}.txt`); if(r.ok){txt=await r.text(); break;} }catch{/*next*/}
  }
  if(!txt) continue; files++;
  const mo=`${y}-${String(m).padStart(2,"0")}`;
  for(const ln of txt.split("\n")){
    const p=ln.split("|"); if(p.length<5||p[0]==="Date") continue;
    const sym=p[1]; const sv=+p[2], tv=+p[4]; if(!(tv>0)||!Number.isFinite(sv)) continue;
    const t=ratio.get(sym)??ratio.set(sym,new Map()).get(sym)!;
    const c=t.get(mo)??t.set(mo,{s:0,t:0,n:0}).get(mo)!; c.s+=sv; c.t+=tv; c.n++;
  }
  await new Promise(r=>setTimeout(r,60));
}
console.log(`==> FINRA SHORT VOLUME: ${files} daily files, ${ratio.size} tickers`);
if(files<50){console.log("insufficient files — abort");Deno.exit(0);}
// 2. JOIN to owned prices
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>ratio.has(s)); console.log(`equities with prices + short data: ${targets.length}`);
const byMonth=new Map<string,{sym:string;lvl:number;chg:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]); const hist=ratio.get(row.symbol)!; let last="";
    for(let j=260;j<b.length-HZ;j++){
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7); if(mo===last)continue; last=mo;
      // CRITICAL FIX (caught pre-publication): the signal must come from a STRICTLY PRIOR month. Using month M's short
      // ratio (sampled on days 5/12/19/26) to predict the return starting day 1 of M measures the signal INSIDE the return
      // window — short volume rises as a stock rallies, so it is mechanically correlated with the return it "predicts".
      // That produced an absurd SR 3.2 with the sign inverted vs the literature: a textbook look-ahead artifact (F5 class).
      const dprev=new Date(mo+"-01"); dprev.setUTCMonth(dprev.getUTCMonth()-1);
      const cur=hist.get(dprev.toISOString().slice(0,7)); if(!cur||cur.n<2||!(cur.t>0)) continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ) continue;
      const lvl=cur.s/cur.t;                                   // short volume ratio this month
      // 3-month trailing baseline for the CHANGE variant (PIT: strictly prior months)
      const prior:number[]=[]; const dref=new Date(mo+"-01");
      // baseline is strictly BEFORE the (already-lagged) signal month
      for(let back=2;back<=4;back++){const dd=new Date(dref); dd.setUTCMonth(dd.getUTCMonth()-back); const pc=hist.get(dd.toISOString().slice(0,7)); if(pc&&pc.t>0) prior.push(pc.s/pc.t);}
      const chg=prior.length? lvl-(prior.reduce((s,x)=>s+x,0)/prior.length) : NaN;
      const fwd=c[j+HZ]/c[j]-1; if(!Number.isFinite(lvl)||!Number.isFinite(fwd)) continue;
      (byMonth.get(mo)??byMonth.set(mo,[]).get(mo)!).push({sym:row.symbol,lvl,chg,fwd});
    }}}
const months=[...byMonth.keys()].sort(); const all=[...byMonth.values()].flat();
console.log(`cross-sections: ${months.length} months, ${all.length} obs`);
if(months.length<24){console.log("too few months — abort");Deno.exit(0);}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
// WITHIN-MONTH cross-sectional tests (the control that killed the insider trap). Hypothesis: HIGH short ratio -> LOW returns,
// so the tradable score is NEGATIVE short ratio (long low-shorted, short high-shorted).
for(const [nm,get] of [["LEVEL (short volume ratio)",(x:{lvl:number;chg:number})=>x.lvl],["CHANGE (vs own 3mo baseline)",(x:{lvl:number;chg:number})=>x.chg]] as [string,(x:{lvl:number;chg:number})=>number][]){
  const ics:number[]=[], ls:number[]=[];
  for(const mo of months){const a=byMonth.get(mo)!.filter(x=>Number.isFinite(get(x))); if(a.length<20)continue;
    ics.push(rankIC(a.map(x=>-get(x)),a.map(x=>x.fwd)));     // sign: negative short ratio = the long-side score
    const s=[...a].sort((p,q)=>get(p)-get(q)); const d=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(0,d).map(x=>x.fwd))-mean(s.slice(s.length-d).map(x=>x.fwd))); // long LOW-shorted, short HIGH-shorted
  }
  if(ls.length<12){console.log(`\n${nm}: thin`);continue;}
  const split=Math.floor(ls.length*0.6);
  const rep=(t:string,ic:number[],l:number[])=>{const m=mean(l)-0.002-0.03/12; const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));
    console.log(`  ${t}: n=${l.length}mo  IC ${mean(ic).toFixed(4)} (t ${tstat(ic).toFixed(2)})  quintile-LS NET ${(m*100).toFixed(2)}%/21d  ann ${(m*12*100).toFixed(1)}%  SR ${(sd>0?(m/sd)*Math.sqrt(12):0).toFixed(2)}  t ${tstat(l).toFixed(2)}`);};
  console.log(`\n=== ${nm} -> forward 21d (long low-short / short high-short, net 20bp + 3%/yr borrow) ===`);
  rep("FULL      ",ics,ls); rep("TRAIN(60%)",ics.slice(0,split),ls.slice(0,split)); rep("TEST (40%)",ics.slice(split),ls.slice(split));
}
