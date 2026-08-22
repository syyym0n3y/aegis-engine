#!/usr/bin/env -S deno run --allow-net --allow-env
// cooldown-oos.ts (D-463) — applying the SELECTION LAW to the cooldown parameters, the same way D-461 did for VRP.
// D-462's sweep found -5% trigger / 5d cooldown buys 14pp of drawdown reduction for 1.2pp/yr — a ~12:1 ratio, on 95% of
// 328 instruments. But I picked that cell BY LOOKING AT THE GRID, which is exactly the in-sample selection that killed
// D-405's "selective overlay". The cell is also suspicious on its face: within the -5% row the ratios run 2.60 (3d),
// 0.09 (5d), 0.19 (10d), 0.13 (20d) — the 3d value is 20x worse than its neighbour, which smells of noise rather than
// structure, and a value that good sitting next to a value that bad usually means both are noisy.
// HONEST TEST: split every instrument's history, choose ONE parameter pair on the TRAIN half across all instruments,
// freeze it, and measure it on the TEST half. Compare against the cell I would have picked by eye.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"co",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:NaN;};
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const series:number[][]=[];
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){ const b=r.bars; if(!b||b.length<400)continue;
    const ret:number[]=[]; for(let k=1;k<b.length;k++) if(b[k][4]>0&&b[k-1][4]>0) ret.push(b[k][4]/b[k-1][4]-1);
    if(ret.length>=400) series.push(ret); }
}
console.log(`==> COOLDOWN OUT-OF-SAMPLE — ${series.length} instruments with >=400 daily bars`);
const stat=(p:number[])=>{const m=mean(p),sd=sdv(p)||1e-9;let c=1,pk=1,dd=0;
  for(const x of p){c*=1+x;pk=Math.max(pk,c);dd=Math.min(dd,c/pk-1);}
  return {ann:m*365*100,sr:(m/sd)*Math.sqrt(365),dd:dd*100};};
const apply=(ret:number[],trig:number,cool:number,from:number,to:number)=>{
  const g:number[]=[];
  for(let k=from;k<to;k++){ let flat=false;
    for(let q=Math.max(0,k-cool);q<k;q++) if(ret[q]<trig){flat=true;break;}
    g.push(flat?0:ret[k]); }
  return g;
};
const GRID:[number,number][]=[]; for(const t of [-0.04,-0.05,-0.06,-0.08,-0.10,-0.12]) for(const c of [3,5,10,15,20,30]) GRID.push([t,c]);
// evaluate a (trig,cool) over a window of every instrument; score = median drawdown gain per point of return given up
function evalGrid(frac0:number,frac1:number){
  const res:{trig:number;cool:number;cost:number;ddGain:number;ratio:number;ddBet:number;n:number}[]=[];
  for(const [t,c] of GRID){
    const costs:number[]=[], gains:number[]=[]; let ddBet=0,n=0;
    for(const ret of series){
      const a=Math.floor(ret.length*frac0), b=Math.floor(ret.length*frac1);
      if(b-a<150)continue;
      const R=stat(ret.slice(a,b)), G=stat(apply(ret,t,c,a,b));
      costs.push(G.ann-R.ann); gains.push(G.dd-R.dd); if(G.dd>R.dd)ddBet++; n++;
    }
    if(n<50)continue;
    const cost=mean(costs), g=med(gains);
    // SIGN MATTERS AND I GOT IT WRONG FIRST TIME. `cost` is (cooldown return - raw return), so a POSITIVE value means the
    // rule ADDED return, not that it cost anything. Taking Math.abs() made a gain display identically to a loss and
    // inverted the whole reading. The ratio is only meaningful when the rule actually costs something; when it pays, that
    // is reported as a gain, not as an expensive result.
    res.push({trig:t,cool:c,cost,ddGain:g,ratio:(g>0&&cost<0)?(-cost)/g:(g>0?0:Infinity),ddBet,n});
  }
  return res;
}
const train=evalGrid(0,0.6), test=evalGrid(0.6,1);
// pick on TRAIN: best (lowest) cost per point of drawdown removed, requiring a materially positive drawdown gain
const cand=train.filter(r=>r.ddGain>3).sort((a,b)=>a.ratio-b.ratio);
const pick=cand[0];
console.log(`\n    TRAIN pick (lowest cost per drawdown point, requiring >3pp of gain):`);
console.log(`      trigger ${(pick.trig*100).toFixed(0)}% / cooldown ${pick.cool}d — cost ${pick.cost.toFixed(1)}%/yr, dd gain ${pick.ddGain.toFixed(1)}pp, ratio ${pick.ratio.toFixed(2)}, maxDD improved ${pick.ddBet}/${pick.n}`);
const eye=train.find(r=>r.trig===-0.05&&r.cool===5)!;
console.log(`      (the cell I picked by eye in D-462, -5%/5d, on TRAIN: ratio ${eye?eye.ratio.toFixed(2):"n/a"}, dd gain ${eye?eye.ddGain.toFixed(1):"n/a"}pp)`);
const oosPick=test.find(r=>r.trig===pick.trig&&r.cool===pick.cool)!;
const oosEye=test.find(r=>r.trig===-0.05&&r.cool===5)!;
console.log(`\n    ratio = return GIVEN UP per point of drawdown removed; 0.00 means the rule PAID rather than cost.`);
console.log(`    "TEST return" is signed: + means the cooldown ADDED return in that window.`);
console.log(`\n    ${"setting".padEnd(28)}${"TRAIN ratio".padEnd(14)}${"TEST ratio".padEnd(13)}${"TEST return".padEnd(12)}${"TEST dd gain".padEnd(14)}TEST maxDD improved`);
const row=(lab:string,tr:{ratio:number}|undefined,te:{ratio:number;cost:number;ddGain:number;ddBet:number;n:number}|undefined)=>
  console.log(`    ${lab.padEnd(28)}${(tr?tr.ratio.toFixed(2):"—").padEnd(14)}${(te?te.ratio.toFixed(2):"—").padEnd(13)}${(te?(te.cost>=0?"+":"")+te.cost.toFixed(1)+"%":"—").padEnd(12)}${(te?te.ddGain.toFixed(1)+"pp":"—").padEnd(14)}${te?`${te.ddBet}/${te.n} (${(100*te.ddBet/te.n).toFixed(0)}%)`:"—"}`);
row(`TRAIN-PICKED ${(pick.trig*100).toFixed(0)}%/${pick.cool}d`,pick,oosPick);
row(`eye-picked -5%/5d (D-462)`,eye,oosEye);
// stability: does the ratio ranking survive at all?
const common=train.filter(t=>test.some(u=>u.trig===t.trig&&u.cool===t.cool&&Number.isFinite(u.ratio))&&Number.isFinite(t.ratio));
const pairs=common.map(t=>({tr:t.ratio,te:test.find(u=>u.trig===t.trig&&u.cool===t.cool)!.ratio}));
const rank=(a:number[])=>{const idx=[...a.keys()].sort((i,j)=>a[i]-a[j]);const r=new Array(a.length);idx.forEach((v,k)=>r[v]=k);return r;};
const ra=rank(pairs.map(p=>p.tr)), rb=rank(pairs.map(p=>p.te));
const m=(pairs.length-1)/2; let nu=0,da=0,db=0;
for(let i=0;i<pairs.length;i++){nu+=(ra[i]-m)*(rb[i]-m);da+=(ra[i]-m)**2;db+=(rb[i]-m)**2;}
const rho=da&&db?nu/Math.sqrt(da*db):0;
console.log(`\n    rank correlation of the cost/drawdown ratio, TRAIN vs TEST, across ${pairs.length} settings: rho ${rho.toFixed(2)}`);
console.log(`    -> ${rho>0.5?"the parameter ranking PERSISTS: choosing on train is meaningful."
  :rho>0.2?"weak persistence — train tells you something, but not much."
  :"the ranking does NOT persist: which parameters look best is noise, and picking any of them is arbitrary."}`);
