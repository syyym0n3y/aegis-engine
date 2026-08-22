#!/usr/bin/env -S deno run --allow-net --allow-env
// passive-plus-cooldown.ts (D-465) — the synthesis: apply the ONE validated mechanism to the ONE recommended book.
// D-405's honest bottom line, which survived its own audit (D-455) and was strengthened by it: the best risk-adjusted book
// this program has is **diversified passive** — equal risk across asset classes, OOS Sharpe 0.57, maxDD −25.1%.
// D-401 tried to improve it with a 200MA blanket trend overlay and destroyed it (OOS Sharpe 0.00, all return gone).
// D-461/462/463 then validated a DIFFERENT mechanism on 328 instruments: a post-loss cooldown reduces drawdown on 88-93%
// of instruments in and out of sample, adds no Sharpe, and costs in rising markets while paying in falling ones.
// Those two facts have never been put together. This does that, and it is the last question the program can usefully ask
// of its own recommendation.
// SELECTION LAW (D-456) IS APPLIED FROM THE START, not bolted on: the cooldown parameters are chosen on the TRAIN window
// only, frozen, and applied to TEST. D-405's "selective overlay" failed precisely because its choice used the full sample.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"pc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const LB=100;
const CLASSES=["etf","index","sector","commodity","fx","equity","crypto_ex"];
const byCls=new Map<string,{sym:string;m:Map<string,number>}[]>();
for(const cls of CLASSES){
  const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol,bars&limit=${cls==="equity"?150:200}`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  const keep:{sym:string;m:Map<string,number>}[]=[];
  for(const r of (Array.isArray(rows)?rows:[])){ const c=r.bars.map(b=>b[4]); if(c.length<LB+400)continue;
    let mx=0,mn=Infinity; for(let i=1;i<c.length;i++){ if(c[i-1]>0){const q=Math.abs(c[i]/c[i-1]-1); if(q>mx)mx=q;} if(c[i]>0&&c[i]<mn)mn=c[i]; }
    if(mx>10||mn<0.01)continue;                                  // same data-quality filter as D-405
    keep.push({sym:r.symbol,m:new Map(r.bars.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]))}); }
  if(keep.length>=3) byCls.set(cls,keep);
}
const dates=[...new Set([...byCls.values()].flat().flatMap(i=>[...i.m.keys()]))].sort();
console.log(`==> PASSIVE + COOLDOWN — ${[...byCls.entries()].map(([c,a])=>`${c}(${a.length})`).join(" ")}`);

// per-instrument daily returns aligned to the common date axis
type Inst={sym:string;cls:string;r:Map<string,number>};
const insts:Inst[]=[];
for(const [cls,list] of byCls) for(const i of list){
  const r=new Map<string,number>();
  let prev:number|null=null, prevD="";
  for(const d of dates){ const p=i.m.get(d); if(p===undefined||!(p>0)){continue;}
    if(prev!==null&&prevD) r.set(d,p/prev-1); prev=p; prevD=d; }
  if(r.size>400) insts.push({sym:i.sym,cls,r});
}
console.log(`    instruments with usable series: ${insts.length}`);
// EQUAL RISK ACROSS CLASSES (D-405 layer 1): average within class, then average across classes present that day.
function book(cool:number|null,trig:number){
  const out:{d:string;r:number}[]=[];
  const hist=new Map<string,number[]>();                          // per-instrument prior returns, for the cooldown
  for(const d of dates){
    const perCls=new Map<string,number[]>();
    for(const it of insts){
      const rv=it.r.get(d); if(rv===undefined)continue;
      const h=hist.get(it.sym)??hist.set(it.sym,[]).get(it.sym)!;
      let w=1;
      if(cool!==null){ for(let q=Math.max(0,h.length-cool);q<h.length;q++) if(h[q]<trig){w=0;break;} }
      (perCls.get(it.cls)??perCls.set(it.cls,[]).get(it.cls)!).push(w*rv);
      h.push(rv);
    }
    const cls=[...perCls.values()].filter(a=>a.length>=3).map(a=>mean(a));
    if(cls.length>=3) out.push({d,r:mean(cls)});
  }
  return out;
}
const stat=(a:number[])=>{const m=mean(a),sd=sdv(a)||1e-9;let c=1,p=1,dd=0;
  for(const r of a){c*=1+r;p=Math.max(p,c);dd=Math.min(dd,c/p-1);}
  return {sr:(m/sd)*Math.sqrt(252),ann:m*252*100,dd:dd*100,worst:Math.min(...a)*100};};

const passive=book(null,0);
const kept=passive.map(x=>x.d);
const sp=Math.floor(passive.length/1.667);                        // same 60/40 split as D-405
console.log(`    book days ${passive.length} (${kept[0]} .. ${kept[kept.length-1]}), train/test split at ${kept[sp]}`);
// TRAIN-ONLY parameter choice: best OOS-blind Sharpe on the train window
let best={cool:10,trig:-0.05,sr:-9};
const GRID:[number,number][]=[]; for(const t of [-0.03,-0.05,-0.08,-0.12]) for(const c of [5,10,20,30]) GRID.push([t,c]);
const cache=new Map<string,{d:string;r:number}[]>();
for(const [t,c] of GRID){ const b=book(c,t); cache.set(`${t}|${c}`,b);
  const s=stat(b.slice(0,sp).map(x=>x.r)); if(s.sr>best.sr) best={cool:c,trig:t,sr:s.sr}; }
console.log(`    TRAIN-picked cooldown: trigger ${(best.trig*100).toFixed(0)}% / ${best.cool}d (train SR ${best.sr.toFixed(2)})`);
const cd=cache.get(`${best.trig}|${best.cool}`)!;
console.log(`\n    ${"book".padEnd(30)}${"FULL SR".padEnd(10)}${"ann".padEnd(9)}${"maxDD".padEnd(10)}${"worst day".padEnd(12)}${"OOS SR".padEnd(9)}${"OOS ann".padEnd(10)}${"OOS maxDD".padEnd(11)}OOS worst`);
const rows:[string,{d:string;r:number}[]][]=[["diversified PASSIVE (D-405)",passive],[`+ COOLDOWN ${(best.trig*100).toFixed(0)}%/${best.cool}d`,cd]];
for(const [lab,b] of rows){
  const F=stat(b.map(x=>x.r)), O=stat(b.slice(sp).map(x=>x.r));
  console.log(`    ${lab.padEnd(30)}${F.sr.toFixed(2).padEnd(10)}${(F.ann.toFixed(1)+"%").padEnd(9)}${(F.dd.toFixed(1)+"%").padEnd(10)}${(F.worst.toFixed(1)+"%").padEnd(12)}${O.sr.toFixed(2).padEnd(9)}${(O.ann.toFixed(1)+"%").padEnd(10)}${(O.dd.toFixed(1)+"%").padEnd(11)}${O.worst.toFixed(1)}%`);
}
const P=stat(passive.slice(sp).map(x=>x.r)), C=stat(cd.slice(sp).map(x=>x.r));
console.log(`\n    OOS verdict: Sharpe ${P.sr.toFixed(2)} -> ${C.sr.toFixed(2)} (${(C.sr-P.sr>=0?"+":"")}${(C.sr-P.sr).toFixed(2)}), maxDD ${P.dd.toFixed(1)}% -> ${C.dd.toFixed(1)}% (${(C.dd-P.dd>=0?"+":"")}${(C.dd-P.dd).toFixed(1)}pp), return ${P.ann.toFixed(1)}% -> ${C.ann.toFixed(1)}%`);
console.log(`    (D-401's blanket 200MA trend overlay on this same book gave OOS Sharpe 0.00 — the bar this has to clear.)`);
