#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-combined-book.ts (D-455) — AUDITING D-405's headline improvement.
// D-405 reports that applying the trend overlay SELECTIVELY (only to classes where it measured positive) recovers OOS
// Sharpe from 0.00 (blanket) to 0.37, and calls that "worth ~0.37 of Sharpe". The class list is HARDCODED in the original:
//     const OVERLAY_CLASSES = new Set(["commodity","crypto_ex","sector","equity","etf"]);  // 'index' EXCLUDED
// That set came from D-400's per-class measurement over the FULL sample — which includes the OOS window the improvement
// is then reported on. So the selection was informed by the test data, and an "out-of-sample" Sharpe computed that way is
// not out of sample. This is the same error class as choosing a regime threshold on full-sample data, which D-422
// deliberately avoided by using expanding windows.
// THE AUDIT: make the identical selection using TRAIN ONLY, apply it to TEST, and compare. If the honest OOS Sharpe falls
// back toward the blanket result, the headline improvement is an artefact of the selection.
// Everything else — universe, filters, lookback, seasonal weights, split point — is left EXACTLY as the original.
// (original header follows)
// combined-book.ts (D-405) — THE COMBINED BOOK. Built only from what actually survived its controls, in the order the
// evidence says is correct (D-401's central lesson: cheap risk management first, expensive last):
//   LAYER 1  DIVERSIFY (free)        — equal risk across asset classes. D-401: cuts drawdown from -56/-81% (single class)
//                                       to -33% at ZERO return cost. This does most of the work.
//   LAYER 2  SEASONAL TILT (cheap)   — D-403: turn-of-month +3.45bp/day, September -4.32bp/day, both persisting OOS in sign.
//                                       Too small to trade standalone (cost > edge), but free as a WEIGHT adjustment on a
//                                       book already held. Shade exposure up at the turn, down in September.
//   LAYER 3  SELECTIVE TREND (costly) — D-400 found the overlay helps in commodity/crypto/sector/equity/etf but HURTS on
//                                       index (-19pp). D-401 applied it BLANKET and paid 7.3pp/yr. Applying it only where it
//                                       measured positive is the testable improvement.
// Everything is compared against the honest benchmark (diversified passive) with a train/test split. Nothing is armed.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cb",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H(); const LB=100;
const OVERLAY_CLASSES=new Set(["commodity","crypto_ex","sector","equity","etf"]);   // D-400 positive; 'index' EXCLUDED (-19pp)
const CLASSES=["etf","index","sector","commodity","fx","equity","crypto_ex"];
const byCls=new Map<string,{sym:string;m:Map<string,number>}[]>();
for(const cls of CLASSES){
  const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol,bars&limit=${cls==="equity"?150:200}`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  const keep:{sym:string;m:Map<string,number>}[]=[];
  for(const r of (Array.isArray(rows)?rows:[])){const c=r.bars.map(b=>b[4]); if(c.length<LB+400)continue;
    let mx=0,mn=Infinity; for(let i=1;i<c.length;i++){if(c[i-1]>0){const q=Math.abs(c[i]/c[i-1]-1);if(q>mx)mx=q;} if(c[i]>0&&c[i]<mn)mn=c[i];}
    if(mx>10||mn<0.01)continue;
    keep.push({sym:r.symbol,m:new Map(r.bars.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]))});}
  if(keep.length>=3) byCls.set(cls,keep);
}
const dates=[...new Set([...byCls.values()].flat().flatMap(i=>[...i.m.keys()]))].sort();
console.log(`==> COMBINED BOOK — ${[...byCls.entries()].map(([c,a])=>`${c}(${a.length})`).join(" ")}`);
// seasonal weight (D-403): turn-of-month up, September down. Deliberately MILD — the measured effects are a few bp.
const seasonW=(ds:string)=>{const d=new Date(ds+"T00:00:00Z"); const dom=d.getUTCDate();
  const dim=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  let w=1.0; if(dom<=3||dom>=dim-1) w*=1.15; if(d.getUTCMonth()===8) w*=0.85; return w;};
const books:Record<string,number[]>={passive:[],season:[],blanket:[],selective:[],full:[],selectiveHonest:[]};
const kept:string[]=[];
// per-class daily (passive, overlay) returns, retained so the class choice can be made on TRAIN ONLY below.
// KEYED BY DATE, not by position: a class is skipped on days it has <3 valid instruments, so per-class arrays have
// DIFFERENT lengths and position i is NOT the same date across classes. A first version of this audit indexed them
// positionally and produced a book with Sharpe 1.9 — better than every other line in the table — purely from the
// misalignment. Recording that here because it is a perfect miniature of what this whole audit is about: a bug flatters
// a result far more readily than it damages one.
const perClass:Map<string,Map<string,{P:number;O:number}>>=new Map();
for(let d=LB+30;d<dates.length-1;d++){
  const day=dates[d],nxt=dates[d+1],lag=dates[d-LB];
  let pa=0,se=0,bl=0,sel=0,fu=0,nc=0;
  for(const [cls,list] of byCls){
    let rp=0,ro=0,n=0;
    for(const i of list){const p0=i.m.get(day),p1=i.m.get(nxt),pl=i.m.get(lag);
      if(!p0||!p1||!pl||!(p0>0)||!(pl>0))continue; const ret=p1/p0-1; if(!Number.isFinite(ret))continue;
      rp+=ret; ro+=(p0/pl-1>0?1:0)*ret; n++;}
    if(n<3)continue;
    const P=rp/n, O=ro/n; const use=OVERLAY_CLASSES.has(cls)?O:P;
    if(!perClass.has(cls))perClass.set(cls,new Map());
    perClass.get(cls)!.set(day,{P,O});
    pa+=P; se+=P; bl+=O; sel+=use; fu+=use; nc++;
  }
  if(nc<3)continue;
  const w=seasonW(day);
  books.passive.push(pa/nc);
  books.season.push((se/nc)*w);
  books.blanket.push(bl/nc);
  books.selective.push(sel/nc);
  books.full.push((fu/nc)*w);
  kept.push(day);
}
// ---- HONEST SELECTIVE: choose the overlay classes using TRAIN ONLY ----
// A class qualifies if, over the TRAIN window alone, the overlay beat passive for that class. Classes are then FROZEN and
// applied unchanged to the test window — which is what "out of sample" has to mean.
const spSel=Math.floor(books.passive.length/1.667);
const trainDays=new Set(kept.slice(0,spSel));
const trainPick=new Set<string>();
const perClsTrain:[string,number,number,number][]=[];
for(const [cls,m] of perClass){
  let mp=0,mo=0,n2=0;
  for(const [d,v] of m){ if(!trainDays.has(d))continue; mp+=v.P; mo+=v.O; n2++; }
  if(n2<200)continue;
  mp/=n2; mo/=n2;
  perClsTrain.push([cls,mp*252*100,mo*252*100,n2]);
  if(mo>mp) trainPick.add(cls);
}
{ // rebuild the selective series with the train-chosen set, aligned BY DATE
  for(const day of kept){
    let acc=0,cnt=0;
    for(const [cls,m] of perClass){ const v=m.get(day); if(!v)continue;
      acc+=trainPick.has(cls)?v.O:v.P; cnt++; }
    books.selectiveHonest.push(cnt?acc/cnt:0);
  }
}
console.log(`\n  PER-CLASS OVERLAY BENEFIT, TRAIN WINDOW ONLY (ann %, overlay minus passive)`);
for(const [cls,mp,mo,n2] of perClsTrain.sort((a,b)=>(b[2]-b[1])-(a[2]-a[1])))
  console.log(`    ${cls.padEnd(11)} passive ${mp.toFixed(1).padStart(6)}%  overlay ${mo.toFixed(1).padStart(6)}%  diff ${(mo-mp>=0?"+":"")}${(mo-mp).toFixed(1).padStart(6)}pp  ${mo>mp?"<- would be selected":""}  (n=${n2})`);
console.log(`\n  CLASS SELECTION`);
console.log(`    hardcoded in D-405 (full-sample):   ${[...OVERLAY_CLASSES].sort().join(", ")}`);
console.log(`    chosen on TRAIN ONLY (this audit):  ${[...trainPick].sort().join(", ")||"(none qualified)"}`);
const same=[...OVERLAY_CLASSES].sort().join(",")===[...trainPick].sort().join(",");
console.log(`    identical? ${same?"YES":"NO — the full-sample set differs from what train alone would have chosen"}`);
const stat=(a:number[])=>{const n=a.length;const m=a.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(n-1));
  let c=1,p=1,dd=0;for(const r of a){c*=1+r;p=Math.max(p,c);dd=Math.min(dd,c/p-1);}
  return {sr:+((sd>0?m/sd:0)*Math.sqrt(252)).toFixed(2),ann:+(m*252*100).toFixed(1),dd:+(dd*100).toFixed(1),vol:+(sd*Math.sqrt(252)*100).toFixed(1)};};
const sp=Math.floor(books.passive.length/1.667);
console.log(`\n  book                        | FULL SR / ann / maxDD        | OOS SR / ann / maxDD`);
const LABEL:Record<string,string>={passive:"1. diversified PASSIVE",season:"2. + seasonal tilt",blanket:"3. + BLANKET trend (D-401)",selective:"4. + SELECTIVE (full-sample pick)",full:"5. COMBINED (season+select)",selectiveHonest:"6. + SELECTIVE (TRAIN-only pick)"};
for(const k of ["passive","season","blanket","selective","full","selectiveHonest"]){
  const F=stat(books[k]), O=stat(books[k].slice(sp));
  console.log(`  ${LABEL[k].padEnd(27)} | ${String(F.sr).padStart(5)} / ${String(F.ann).padStart(5)}% / ${String(F.dd).padStart(6)}%   | ${String(O.sr).padStart(5)} / ${String(O.ann).padStart(5)}% / ${String(O.dd).padStart(6)}%`);
}
// crisis behaviour of the final book
const CRISES:[string,string,string][]=[["GFC","2007-10-01","2009-03-31"],["COVID","2020-02-01","2020-04-30"],["2022 bear","2022-01-01","2022-10-31"],["2018 Q4","2018-10-01","2018-12-31"]];
console.log(`\n  crisis (cumulative): passive vs COMBINED`);
for(const [nm,a,b] of CRISES){const idx=kept.map((d,i)=>({d,i})).filter(x=>x.d>=a&&x.d<=b).map(x=>x.i);
  if(idx.length<20){console.log(`    ${nm.padEnd(10)}: (no data)`);continue;}
  const cum=(arr:number[])=>{let c=1;for(const i of idx)c*=1+arr[i];return (c-1)*100;};
  console.log(`    ${nm.padEnd(10)}: passive ${cum(books.passive).toFixed(1)}%  combined ${cum(books.full).toFixed(1)}%  -> ${(cum(books.full)-cum(books.passive))>0?"+":""}${(cum(books.full)-cum(books.passive)).toFixed(1)}pp`);}
