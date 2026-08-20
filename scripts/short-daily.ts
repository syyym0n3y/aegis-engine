#!/usr/bin/env -S deno run --allow-net --allow-env
// short-daily.ts (D-390) — FINRA short-sale volume at the DAILY horizon, where the documented effect actually lives
// (Boehmer-Jones-Zhang: informed shorting shows up over days, not months). Our D-389 monthly test was null, which does NOT
// refute the daily literature — this tests it directly.
// NO LOOK-AHEAD, conservatively: FINRA publishes day D's file AFTER the close of D, so the signal is known at close(D);
// entry is the close of D+1 (a full day to trade), exit close(D+1+K). Cross-section is WITHIN-DAY (the control that killed
// the insider beta trap). Liquid-only, net of cost + borrow, train/test split.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sd",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const Y0=Number(Deno.env.get("Y0")||2022), Y1=Number(Deno.env.get("Y1")||2025);
const LIQ=5e6;
// 1. ingest CONSECUTIVE daily files (dense, so a same-day cross-section is real). Walk every calendar day in range.
const day=new Map<string,Map<string,number>>();   // "YYYY-MM-DD" -> ticker -> short ratio
let files=0;
for(let y=Y0;y<=Y1;y++) for(let m=1;m<=12;m++) for(let d=1;d<=31;d++){
  const dt=new Date(Date.UTC(y,m-1,d)); if(dt.getUTCMonth()!==m-1) continue;
  const wd=dt.getUTCDay(); if(wd===0||wd===6) continue;
  const key=`${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}`;
  let txt=""; try{const r=await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${key}.txt`); if(r.ok) txt=await r.text();}catch{/*skip*/}
  if(!txt) continue; files++;
  const iso=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const t=day.set(iso,new Map()).get(iso)!;
  for(const ln of txt.split("\n")){const p=ln.split("|"); if(p.length<5||p[0]==="Date")continue; const sv=+p[2],tv=+p[4]; if(!(tv>0)||!Number.isFinite(sv))continue; t.set(p[1],sv/tv);}
  await new Promise(r=>setTimeout(r,40));
}
console.log(`==> FINRA DAILY: ${files} consecutive daily files (${Y0}-${Y1}), ${day.size} trading days`);
if(files<200){console.log("insufficient — abort");Deno.exit(0);}
// 2. join to owned prices, build per-day observations
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const KS=[1,5];
const obs=new Map<number,Map<string,{sym:string;sig:number;fwd:number}[]>>(); for(const k of KS) obs.set(k,new Map());
let joined=0;
for(let i=0;i<esyms.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${esyms.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]);
    const idx=new Map<string,number>(); for(let j=0;j<ts.length;j++) idx.set(new Date(ts[j]*1000).toISOString().slice(0,10),j);
    let used=false;
    for(const [iso,tmap] of day){ const sig=tmap.get(row.symbol); if(sig==null) continue;
      const j=idx.get(iso); if(j==null||j<25) continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ) continue;
      for(const K of KS){ const e=j+1, x=j+1+K; if(x>=c.length||!(c[e]>0)) continue;   // ENTER at close(D+1), EXIT close(D+1+K)
        const fwd=c[x]/c[e]-1; if(!Number.isFinite(fwd)) continue; used=true;
        const m=obs.get(K)!; (m.get(iso)??m.set(iso,[]).get(iso)!).push({sym:row.symbol,sig,fwd}); } }
    if(used) joined++;
  }}
console.log(`equities joined: ${joined}`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
for(const K of KS){
  const m=obs.get(K)!; const days=[...m.keys()].sort();
  const ics:number[]=[], ls:number[]=[];
  for(const d of days){const a=m.get(d)!; if(a.length<30)continue;
    ics.push(rankIC(a.map(x=>-x.sig),a.map(x=>x.fwd)));            // hypothesis: HIGH short ratio -> LOW return
    const s=[...a].sort((p,q)=>p.sig-q.sig); const q=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(0,q).map(x=>x.fwd))-mean(s.slice(s.length-q).map(x=>x.fwd)));  // long LOW-short / short HIGH-short
  }
  if(ls.length<30){console.log(`\nK=${K}: thin`);continue;}
  const per=252/K, cost=0.002+0.03/252*K;                          // round-trip + borrow for the holding period
  const split=Math.floor(ls.length*0.6);
  const rep=(t:string,ic:number[],l:number[])=>{const mm=mean(l)-cost; const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));
    console.log(`  ${t}: n=${l.length}d  IC ${mean(ic).toFixed(4)} (t ${tstat(ic).toFixed(2)})  LS gross ${(mean(l)*100).toFixed(3)}%  NET ${(mm*100).toFixed(3)}%/${K}d  ann ${(mm*per*100).toFixed(1)}%  SR ${(sd>0?(mm/sd)*Math.sqrt(per):0).toFixed(2)}`);};
  console.log(`\n=== DAILY horizon K=${K}d (enter close D+1, exit close D+1+${K}); long LOW-short / short HIGH-short ===`);
  rep("FULL      ",ics,ls); rep("TRAIN(60%)",ics.slice(0,split),ls.slice(0,split)); rep("TEST (40%)",ics.slice(split),ls.slice(split));
}
