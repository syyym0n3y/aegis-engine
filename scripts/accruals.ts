#!/usr/bin/env -S deno run --allow-net --allow-env
// accruals.ts (D-408) — THE ACCRUALS ANOMALY (Sloan 1996), testable for the first time now that D-406 loaded the inputs.
// This is the specific factor whose absence exposed the Coverage-Law failure: it was never "found to fail", it was never
// TESTED, because AssetsCurrent/LiabilitiesCurrent/Cash were never fetched.
// Balance-sheet accruals = change in non-cash working capital, scaled by average total assets:
//   WC = (AssetsCurrent - Cash) - LiabilitiesCurrent ;  Accruals = (WC_t - WC_{t-4q}) / avg(Assets)
// Hypothesis stated IN ADVANCE (Sloan): HIGH accruals -> LOW future returns (accrual-heavy earnings are low quality and
// mean-revert). So the long-side score is NEGATIVE accruals. Also tests NOA (net operating assets) and working-capital growth.
// Full controls: point-in-time via effective_date, liquid-only, within-month cross-sections, train/test, net of cost.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ac",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H(); const HZ=63, LIQ=5e6;
// load the fundamental panel (10 concepts now)
const fund=new Map<string,Record<string,{e:number;pe:string;v:number}[]>>();
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_fundamentals?select=ticker,concept,effective_date,period_end,value&order=ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
 if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {ticker:string;concept:string;effective_date:string;period_end:string;value:number}[]){
   if(!r.ticker)continue; const m=fund.get(r.ticker)??fund.set(r.ticker,{}).get(r.ticker)!;
   (m[r.concept]||=[]).push({e:new Date(r.effective_date).getTime(),pe:r.period_end,v:+r.value});}
 if(p.length<1000)break;}
for(const m of fund.values()) for(const k in m) m[k].sort((a,b)=>a.pe<b.pe?-1:1);
console.log(`==> ACCRUALS (Sloan) — fundamental panel: ${fund.size} tickers`);
// point-in-time getter: latest value KNOWN at time `at`, plus the value n quarters before it
const pit=(a:{e:number;pe:string;v:number}[]|undefined,at:number,back=0)=>{
  if(!a)return null; const known=a.filter(x=>x.e<=at); if(known.length<=back)return null;
  return known[known.length-1-back].v;};
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>fund.has(s));
console.log(`    equities with prices + fundamentals: ${targets.length}`);
const byMo=new Map<string,{sym:string;acc:number;noa:number;wcg:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]); const fm=fund.get(row.symbol)!; let last="";
    for(let j=260;j<b.length-HZ;j++){
      const mo=new Date(ts[j]*1000).toISOString().slice(0,7); if(mo===last)continue; last=mo;
      const at=ts[j]*1000, px=c[j]; if(!(px>0))continue;
      let dv=0,cn=0; for(let k=j-21;k<j;k++){if(c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ)continue;
      const ca=pit(fm.AssetsCurrent,at), cl=pit(fm.LiabilitiesCurrent,at), csh=pit(fm.CashAndCashEquivalentsAtCarryingValue,at), ta=pit(fm.Assets,at);
      const ca4=pit(fm.AssetsCurrent,at,4), cl4=pit(fm.LiabilitiesCurrent,at,4), csh4=pit(fm.CashAndCashEquivalentsAtCarryingValue,at,4), ta4=pit(fm.Assets,at,4);
      const liab=pit(fm.Liabilities,at), eq=pit(fm.StockholdersEquity,at);
      const fwd=c[j+HZ]/c[j]-1; if(!Number.isFinite(fwd))continue;
      let acc=NaN,noa=NaN,wcg=NaN;
      if(ca!=null&&cl!=null&&csh!=null&&ca4!=null&&cl4!=null&&csh4!=null&&ta!=null&&ta4!=null&&ta>0&&ta4>0){
        const wc=(ca-csh)-cl, wc4=(ca4-csh4)-cl4; acc=(wc-wc4)/((ta+ta4)/2);
        if(wc4!==0) wcg=(wc-wc4)/Math.abs(wc4);}
      if(ta!=null&&csh!=null&&liab!=null&&eq!=null&&ta>0){ noa=((ta-csh)-(liab))/ta; }   // net operating assets / assets
      if(![acc,noa,wcg].some(Number.isFinite))continue;
      (byMo.get(mo)??byMo.set(mo,[]).get(mo)!).push({sym:row.symbol,acc,noa,wcg,fwd});
    }}}
const months=[...byMo.keys()].sort();
console.log(`    cross-sections: ${months.length} months, ${[...byMo.values()].reduce((s,a)=>s+a.length,0)} obs`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
for(const [nm,get] of [["ACCRUALS (Sloan)",(x:{acc:number;noa:number;wcg:number})=>x.acc],["NET OPERATING ASSETS",(x:{acc:number;noa:number;wcg:number})=>x.noa],["working-capital growth",(x:{acc:number;noa:number;wcg:number})=>x.wcg]] as [string,(x:{acc:number;noa:number;wcg:number})=>number][]){
  const ics:number[]=[], ls:number[]=[];
  for(const mo of months){const a=byMo.get(mo)!.filter(x=>Number.isFinite(get(x))); if(a.length<20)continue;
    ics.push(rankIC(a.map(x=>-get(x)),a.map(x=>x.fwd)));      // hypothesis stated in advance: HIGH accruals -> LOW returns
    const s=[...a].sort((p,q)=>get(p)-get(q)); const q=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(0,q).map(x=>x.fwd))-mean(s.slice(s.length-q).map(x=>x.fwd)));}  // long LOW-accrual / short HIGH
  if(ls.length<12){console.log(`\n  ${nm}: thin (${ls.length})`);continue;}
  const sp=Math.floor(ls.length*0.6), cost=0.004, per=252/HZ;
  const rep=(t:string,ic:number[],l:number[])=>{const m=mean(l)-cost;const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));
    console.log(`    ${t} n=${l.length}mo IC ${mean(ic).toFixed(4)} (t ${tst(ic).toFixed(2)}) LS gross ${(mean(l)*100).toFixed(2)}% NET ${(m*100).toFixed(2)}%/${HZ}d ann ${(m*per*100).toFixed(1)}% SR ${(sd>0?(m/sd)*Math.sqrt(per):0).toFixed(2)}`);};
  console.log(`\n  === ${nm} -> fwd ${HZ}d (long LOW / short HIGH) ===`);
  rep("FULL      ",ics,ls); rep("TRAIN(60%)",ics.slice(0,sp),ls.slice(0,sp)); rep("TEST (40%)",ics.slice(sp),ls.slice(sp));
}
