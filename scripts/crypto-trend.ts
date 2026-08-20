#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-trend.ts (D-392) — pursuing the lead I DROPPED. The multiclass map (D-376) flagged crypto daily time-series
// momentum at Sharpe 0.57 / 52.7%/yr — the strongest cell in the entire matrix — and it was never followed up. That was a
// failure of curiosity, not of rigor. Testing it properly now.
// Crypto is the least-efficient liquid market (24/7, retail-dominated, no short-sale constraints), so it is the most
// plausible home for a real trend edge. Tested as a PORTFOLIO (not pooled instrument-days, which inflates t), vol-scaled,
// net of realistic crypto costs, with THE decisive control: does it beat simply BUYING AND HOLDING crypto? Crypto rose ~100x
// in-sample, so any long-biased rule looks brilliant; only the long-SHORT and the vs-buy-and-hold comparison are informative.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ct",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.crypto&select=symbol,bars`,{headers:hdr}).then(r=>r.json()) as {symbol:string;bars:number[][]}[];
console.log(`==> CRYPTO TREND (the dropped lead): ${rows.length} instruments`);
const inst=rows.map(r=>({sym:r.symbol,ts:r.bars.map(b=>b[0]),c:r.bars.map(b=>b[4])})).filter(x=>x.c.length>400);
// align on a common daily date axis
const dates=[...new Set(inst.flatMap(i=>i.ts.map(t=>new Date(t*1000).toISOString().slice(0,10))))].sort();
const px=new Map<string,Map<string,number>>();
for(const i of inst){const m=new Map<string,number>(); i.ts.forEach((t,k)=>m.set(new Date(t*1000).toISOString().slice(0,10),i.c[k])); px.set(i.sym,m);}
const stat=(a:number[],per:number)=>{const n=a.length;if(n<30)return null;const m=a.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(n-1));const msr=sd>0?m/sd:0;
  const sk=sd>0?a.reduce((s,x)=>s+((x-m)/sd)**3,0)/n:0, ku=sd>0?a.reduce((s,x)=>s+((x-m)/sd)**4,0)/n:3;
  const dn2=1-sk*msr+((ku-1)/4)*msr*msr; const psr=dn2>0?(msr*Math.sqrt(n-1))/Math.sqrt(dn2):NaN;
  let cum=1,peak=1,dd=0; for(const r of a){cum*=1+r;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  return {sharpe:+(msr*Math.sqrt(per)).toFixed(2),ann_pct:+(m*per*100).toFixed(1),win:+(100*a.filter(x=>x>0).length/n).toFixed(0),skew:+sk.toFixed(2),maxdd:+(dd*100).toFixed(1),psr_z:Number.isFinite(psr)?+psr.toFixed(2):null,psr_valid:Math.abs(sk)<=2&&dn2>0,n};};
const COSTS=[0.0010,0.0020,0.0050];   // 10bp / 20bp / 50bp round-trip (crypto taker + slippage)
for(const LB of [20,50,100]){
  console.log(`\n===== lookback ${LB}d =====`);
  // build daily portfolio returns: sign(trend) * vol-scaled weight, equal risk, rebalanced when the SIGN FLIPS (turnover-aware)
  const ls:number[]=[], lo:number[]=[], bh:number[]=[]; const turn:number[]=[];
  const prevSign=new Map<string,number>();
  for(let d=Math.max(LB,250); d<dates.length-1; d++){
    const day=dates[d], nxt=dates[d+1];
    let sw=0, rls=0, rlo=0, rbh=0, nbh=0, flips=0, legs=0;
    for(const i of inst){
      const m=px.get(i.sym)!; const p0=m.get(day), p1=m.get(nxt), pl=m.get(dates[d-LB]);
      if(!p0||!p1||!pl||!(p0>0)||!(pl>0)) continue;
      const ret=p1/p0-1; if(!Number.isFinite(ret)) continue;
      // trailing vol for risk parity
      const w:number[]=[]; for(let k=d-30;k<d;k++){const a=m.get(dates[k]),b=m.get(dates[k+1]); if(a&&b&&a>0)w.push(b/a-1);}
      if(w.length<20) continue;
      const vol=Math.sqrt(w.reduce((s,x)=>s+x*x,0)/w.length)||0.05;
      const scale=Math.min(3,(0.60/Math.sqrt(365))/vol);          // 60% annual target per leg (crypto vol is huge)
      const sig=Math.sign(p0/pl-1);
      if(prevSign.get(i.sym)!==undefined&&prevSign.get(i.sym)!==sig) flips++;
      prevSign.set(i.sym,sig);
      rls+=sig*scale*ret; rlo+=(sig>0?1:0)*scale*ret; sw+=scale; rbh+=ret; nbh++; legs++;
    }
    if(sw<=0||!legs) continue;
    ls.push(rls/sw); lo.push(rlo/sw); bh.push(rbh/nbh); turn.push(flips/legs);
  }
  const avgTurn=turn.reduce((s,x)=>s+x,0)/turn.length;
  console.log(`  days ${ls.length}, avg daily sign-flip rate ${(avgTurn*100).toFixed(2)}%`);
  for(const c of COSTS){
    const net=ls.map((r,i)=>r-turn[i]*c);
    const s=stat(net,365);
    console.log(`  LONG-SHORT  @${(c*1e4).toFixed(0)}bp: ${s?`SR ${s.sharpe} ann ${s.ann_pct}% win ${s.win}% maxDD ${s.maxdd}% psr_z ${s.psr_valid?s.psr_z:"INVALID(skew)"}`:"thin"}`);
  }
  const sLo=stat(lo.map((r,i)=>r-turn[i]*0.002),365), sBh=stat(bh,365);
  console.log(`  LONG-ONLY   @20bp: ${sLo?`SR ${sLo.sharpe} ann ${sLo.ann_pct}% maxDD ${sLo.maxdd}%`:"thin"}`);
  console.log(`  BUY&HOLD (the control): ${sBh?`SR ${sBh.sharpe} ann ${sBh.ann_pct}% maxDD ${sBh.maxdd}%`:"thin"}`);
  // train/test on the long-short @20bp
  const net=ls.map((r,i)=>r-turn[i]*0.002); const sp=Math.floor(net.length*0.6);
  const a=stat(net.slice(0,sp),365), b=stat(net.slice(sp),365);
  console.log(`  LONG-SHORT  TRAIN SR ${a?a.sharpe:"-"} | TEST SR ${b?b.sharpe:"-"}  <- the honest number is TEST`);
  // the same split for LONG-ONLY and BUY&HOLD — if long-only beats buy&hold OOS, the value is risk management (drawdown),
  // not alpha, and that is still worth something. If it does not, the whole thing is just crypto beta.
  const netLo=lo.map((r,i)=>r-turn[i]*0.002);
  const la=stat(netLo.slice(0,sp),365), lb=stat(netLo.slice(sp),365);
  const ba=stat(bh.slice(0,sp),365), bb=stat(bh.slice(sp),365);
  console.log(`  LONG-ONLY   TRAIN SR ${la?la.sharpe:"-"} (dd ${la?la.maxdd:"-"}%) | TEST SR ${lb?lb.sharpe:"-"} (dd ${lb?lb.maxdd:"-"}%)`);
  console.log(`  BUY&HOLD    TRAIN SR ${ba?ba.sharpe:"-"} (dd ${ba?ba.maxdd:"-"}%) | TEST SR ${bb?bb.sharpe:"-"} (dd ${bb?bb.maxdd:"-"}%)`);
}
