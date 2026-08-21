#!/usr/bin/env -S deno run --allow-net --allow-env
// long-horizon.ts (D-416) — TIER-2 METHOD GAP: almost every test in this program used 1-63 day horizons. Long horizons
// (6-24 months) are exactly where a retail operation is NOT structurally disadvantaged — no latency, no colocation, no
// order-flow edge required — and where the documented value/quality premia actually live. Uses data already loaded.
// Tests the full factor panel at 126d / 252d / 504d against the same controls: PIT, liquid-only, within-month cross-section,
// train/test, net of cost (which is far smaller at these horizons because turnover collapses).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"lh",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H(); const LIQ=5e6;
const fund=new Map<string,Record<string,{e:number;v:number}[]>>();
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_fundamentals?select=ticker,concept,effective_date,value&order=ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
 if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {ticker:string;concept:string;effective_date:string;value:number}[]){if(!r.ticker)continue;
   const m=fund.get(r.ticker)??fund.set(r.ticker,{}).get(r.ticker)!;(m[r.concept]||=[]).push({e:new Date(r.effective_date).getTime(),v:+r.value});}
 if(p.length<1000)break;}
for(const m of fund.values()) for(const k in m) m[k].sort((a,b)=>a.e-b.e);
const pit=(a:{e:number;v:number}[]|undefined,at:number)=>{if(!a)return null;let v:number|null=null;for(const x of a){if(x.e<=at)v=x.v;else break;}return v;};
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>fund.has(s));
console.log(`==> LONG HORIZON — ${targets.length} equities with fundamentals`);
const HZS=[126,252,504];
const panels=new Map<number,Map<string,{v:number;q:number;e:number;fwd:number}[]>>();
for(const h of HZS) panels.set(h,new Map());
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<800)continue;
    const c=b.map(r=>r[4]),vol=b.map(r=>r[5]),ts=b.map(r=>r[0]); const fm=fund.get(row.symbol)!; let last="";
    for(let j=260;j<b.length-Math.max(...HZS);j++){
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7); if(mo===last)continue; last=mo;
      const at=ts[j]*1000, px=c[j]; if(!(px>0))continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&vol[k]>0){dv+=c[k]*vol[k];cn++;}} if(!cn||dv/cn<LIQ)continue;
      const be=pit(fm.StockholdersEquity,at), ni=pit(fm.NetIncomeLoss,at), sh=pit(fm.EntityCommonStockSharesOutstanding,at);
      const mc=sh&&sh>0?sh*px:null; if(!mc||be==null||ni==null||!(be>0))continue;
      const v=be/mc, q=ni/be, e=ni/mc;
      for(const h of HZS){const fwd=c[j+h]/c[j]-1; if(!Number.isFinite(fwd))continue;
        (panels.get(h)!.get(mo)??panels.get(h)!.set(mo,[]).get(mo)!).push({v,q,e,fwd});}
    }}}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
for(const h of HZS){
  const P=panels.get(h)!; const months=[...P.keys()].sort();
  console.log(`\n  === horizon ${h}d (${(h/252).toFixed(1)}yr) — ${months.length} months ===`);
  for(const [nm,get] of [["value (B/M)",(x:{v:number;q:number;e:number})=>x.v],["quality (ROE)",(x:{v:number;q:number;e:number})=>x.q],["earnings yield",(x:{v:number;q:number;e:number})=>x.e]] as [string,(x:{v:number;q:number;e:number})=>number][]){
    const ics:number[]=[],ls:number[]=[];
    for(const mo of months){const a=P.get(mo)!.filter(x=>Number.isFinite(get(x))); if(a.length<20)continue;
      ics.push(rankIC(a.map(get),a.map(x=>x.fwd)));
      const s=[...a].sort((p,q2)=>get(p)-get(q2)); const q3=Math.max(1,Math.floor(s.length/5));
      ls.push(mean(s.slice(s.length-q3).map(x=>x.fwd))-mean(s.slice(0,q3).map(x=>x.fwd)));}
    if(ls.length<12){console.log(`    ${nm}: thin`);continue;}
    // OVERLAP CORRECTION: monthly sampling of an h-day forward return means consecutive observations share ~(h-21)/h of
    // their window. Treating them as independent inflates t and SR by roughly sqrt(h/21). Report the NON-OVERLAPPING series
    // (every h/21-th month) alongside — that is the honest significance. This is the same effective-N discipline as D-341.
    const step=Math.max(1,Math.round(h/21));
    const lsNO=ls.filter((_,i)=>i%step===0), icsNO=ics.filter((_,i)=>i%step===0);
    const sp=Math.floor(ls.length*0.6), cost=0.004, per=252/h;
    const f=(l:number[])=>{const m=mean(l)-cost;const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));return `NET ${(m*100).toFixed(2)}% ann ${(m*per*100).toFixed(1)}% SR ${(sd>0?(m/sd)*Math.sqrt(per):0).toFixed(2)}`;};
    console.log(`    ${nm.padEnd(16)} IC ${mean(ics).toFixed(4)} (t ${tst(ics).toFixed(2)} OVERLAPPING) | FULL ${f(ls)} | TEST ${f(ls.slice(sp))}`);
    console.log(`      ${" ".repeat(14)} NON-OVERLAPPING (n=${lsNO.length} independent): IC ${mean(icsNO).toFixed(4)} (t ${tst(icsNO).toFixed(2)})  ${f(lsNO)}`);
  }
}
