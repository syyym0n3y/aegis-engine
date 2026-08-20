#!/usr/bin/env -S deno run --allow-net --allow-env
// short-interest-positions.ts (D-391) — SHORT INTEREST (OPEN POSITIONS), the dataset D-389/390 flagged as missing. FINRA
// consolidated short interest: currentShortPositionQuantity (actual open short shares), daysToCoverQuantity, and the change
// vs the prior settlement. Bi-monthly. This is the classic short-interest anomaly dataset (Asquith-Pathak-Ritter; Boehmer et
// al) — distinct from the short-VOLUME flow tested in D-389/390.
// Tested with every control the session's five killed discoveries taught: PIT (settlementDate is the knowable date, and the
// data is published ~8 business days later, so we lag 10 trading days), WITHIN-PERIOD cross-section, liquid-only, real
// train/test split, net of cost + borrow, and the sign stated in advance (HIGH short interest -> LOW future returns).
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sip",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const PUB_LAG=10;   // FINRA publishes ~8 business days after settlement; we lag 10 trading days to be safe
// 1. INGEST all consolidated short interest (paginated CSV)
type Rec={date:string;sym:string;si:number;prev:number;adv:number;dtc:number};
const recs:Rec[]=[];
// FIX: offset-only pagination capped at ~25 settlements. settlementDate is the API's partition key, so page PER YEAR with
// dateRangeFilters + offset within each year — that yields the full 2019-2026 history instead of one year.
for(let y=2019;y<=2026;y++){
  for(let off=0; off<200000; off+=5000){
    let txt="";
    try{
      const r=await fetch("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({limit:5000,offset:off,dateRangeFilters:[{fieldName:"settlementDate",startDate:`${y}-01-01`,endDate:`${y}-12-31`}]})});
      if(!r.ok) break; txt=await r.text();
    }catch{break;}
    const lines=txt.split("\n"); if(lines.length<3) break;
    let got=0;
    for(const ln of lines.slice(1)){
      const p=ln.split(",").map(x=>x.replace(/^"|"$/g,"").trim()); if(p.length<14) continue;
      const d=p[13]; const sym=p[1]; const si=+p[5], prev=+p[6], adv=+p[8], dtc=+p[9];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!sym||!(si>0)) continue;
      recs.push({date:d,sym,si,prev:prev||0,adv:adv||0,dtc:dtc||0}); got++;
    }
    if(got<4000) break;
    await new Promise(r=>setTimeout(r,60));
  }
  console.log(`  ${y}: cumulative ${recs.length} records`);
}
const dates=[...new Set(recs.map(r=>r.date))].sort();
console.log(`==> FINRA SHORT INTEREST (open positions): ${recs.length} records, ${new Set(recs.map(r=>r.sym)).size} tickers, ${dates.length} settlement dates ${dates[0]}..${dates[dates.length-1]}`);
if(dates.length<12){console.log("insufficient history — abort");Deno.exit(0);}
// index by ticker
const bySym=new Map<string,Rec[]>(); for(const r of recs)(bySym.get(r.sym)??bySym.set(r.sym,[]).get(r.sym)!).push(r);
for(const a of bySym.values()) a.sort((x,y)=>x.date<y.date?-1:1);
// 2. shares outstanding (owned) for the true short-interest RATIO
const sh=new Map<string,{e:number;v:number}[]>();
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker,effective_date,value&order=ticker&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;
 for(const r of p as {ticker:string;effective_date:string;value:number}[])(sh.get(r.ticker)??sh.set(r.ticker,[]).get(r.ticker)!).push({e:new Date(r.effective_date).getTime(),v:+r.value});
 if(p.length<1000)break;}
for(const a of sh.values()) a.sort((x,y)=>x.e-y.e);
const pit=(a:{e:number;v:number}[]|undefined,at:number)=>{if(!a)return null;let v:number|null=null;for(const x of a){if(x.e<=at)v=x.v;else break;}return v;};
// 3. join to prices, build per-settlement cross-sections
const esyms:string[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;for(const r of p as {symbol:string}[])esyms.push(r.symbol);if(p.length<1000)break;}
const targets=esyms.filter(s=>bySym.has(s)); console.log(`equities with prices + short interest: ${targets.length}`);
const HZ=21, LIQ=5e6;
const cs=new Map<string,{sym:string;ratio:number;dtc:number;chg:number;fwd:number}[]>();
for(let i=0;i<targets.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${targets.slice(i,i+25).map(s=>`"${s}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(r=>r[4]),v=b.map(r=>r[5]),ts=b.map(r=>r[0]);
    const idx=new Map<string,number>(); for(let j=0;j<ts.length;j++) idx.set(new Date(ts[j]*1000).toISOString().slice(0,10),j);
    const list=bySym.get(row.symbol)!;
    for(const r of list){
      let j=idx.get(r.date); if(j==null){ for(let k=1;k<=5&&j==null;k++){const d=new Date(r.date); d.setUTCDate(d.getUTCDate()+k); j=idx.get(d.toISOString().slice(0,10));} }
      if(j==null) continue;
      const e=j+PUB_LAG;                                        // ENTER only after the data is public
      if(e+HZ>=c.length||!(c[e]>0)) continue;
      let dv=0,cn=0; for(let k=e-21;k<e;k++){if(k>=0&&c[k]>0&&v[k]>0){dv+=c[k]*v[k];cn++;}} if(!cn||dv/cn<LIQ) continue;
      const so=pit(sh.get(row.symbol), ts[j]*1000);
      const ratio=so&&so>0? r.si/so : NaN;                      // short interest as % of shares outstanding
      const chg=r.prev>0? r.si/r.prev-1 : NaN;                  // change vs prior settlement
      const fwd=c[e+HZ]/c[e]-1; if(!Number.isFinite(fwd)) continue;
      (cs.get(r.date)??cs.set(r.date,[]).get(r.date)!).push({sym:row.symbol,ratio,dtc:r.dtc,chg,fwd});
    }}}
const periods=[...cs.keys()].sort();
console.log(`cross-sections: ${periods.length} settlements, ${[...cs.values()].reduce((s,a)=>s+a.length,0)} obs`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
for(const [nm,get] of [["SHORT INTEREST % of shares out",(x:{ratio:number;dtc:number;chg:number})=>x.ratio],["DAYS TO COVER",(x:{ratio:number;dtc:number;chg:number})=>x.dtc],["CHANGE in short interest",(x:{ratio:number;dtc:number;chg:number})=>x.chg]] as [string,(x:{ratio:number;dtc:number;chg:number})=>number][]){
  const ics:number[]=[], ls:number[]=[];
  for(const d of periods){const a=cs.get(d)!.filter(x=>Number.isFinite(get(x))); if(a.length<20)continue;
    ics.push(rankIC(a.map(x=>-get(x)),a.map(x=>x.fwd)));         // stated in advance: HIGH short interest -> LOW returns
    const s=[...a].sort((p,q)=>get(p)-get(q)); const q=Math.max(1,Math.floor(s.length/5));
    ls.push(mean(s.slice(0,q).map(x=>x.fwd))-mean(s.slice(s.length-q).map(x=>x.fwd)));}
  if(ls.length<10){console.log(`\n${nm}: thin (${ls.length})`);continue;}
  const split=Math.floor(ls.length*0.6); const cost=0.002+0.03/12;
  const rep=(t:string,ic:number[],l:number[])=>{if(l.length<5){console.log(`  ${t}: thin`);return;} const m=mean(l)-cost; const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));
    console.log(`  ${t}: n=${l.length}  IC ${mean(ic).toFixed(4)} (t ${tstat(ic).toFixed(2)})  LS gross ${(mean(l)*100).toFixed(2)}%  NET ${(m*100).toFixed(2)}%/21d  ann ${(m*12*100).toFixed(1)}%  SR ${(sd>0?(m/sd)*Math.sqrt(12):0).toFixed(2)}  t ${tstat(l).toFixed(2)}`);};
  console.log(`\n=== ${nm} -> fwd 21d (long LOW / short HIGH, entered ${PUB_LAG}d after settlement, net cost+borrow) ===`);
  rep("FULL      ",ics,ls); rep("TRAIN(60%)",ics.slice(0,split),ls.slice(0,split)); rep("TEST (40%)",ics.slice(split),ls.slice(split));
}
