// trd-futures-validate — stress-test the range-FADE at the two best windows (D-256): London-open (08:30-09:30 UTC =
// 04:30 ET) and NY 8:30 data-release (12:30-13:30 UTC = 08:30 ET). Max rigor on free data: (1) SPLIT-HALF OOS on 5m
// (does the edge hold in BOTH halves of the 49 days?), (2) TIMEFRAME robustness (5m/15m/30m), (3) BROAD instruments
// (indices/gold/bonds/FX/metals/energy). A real edge holds in both halves across instruments — noise won't. NO orders.
const INSTR=["ES=F","NQ=F","YM=F","GC=F","RTY=F","CL=F","ZB=F","ZN=F","6E=F","6J=F","SI=F","NG=F"];
const WINDOWS:{name:string,ws:number}[]=[{name:"London 04:30ET",ws:510},{name:"NY 08:30ET",ws:750}];
interface Bar{t:number;h:number;l:number;c:number}
async function bars(sym:string,interval:string,range:string):Promise<Bar[]|null>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],h,l,c});}
  return o;}catch{return null;}}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function groupDays(b:Bar[]):Bar[][]{const m=new Map<string,Bar[]>();for(const bar of b){const d=new Date(bar.t*1000).toISOString().slice(0,10);(m.get(d)||m.set(d,[]).get(d))!.push(bar);}return [...m.values()];}
function fadeEdge(days:Bar[][],ws:number,we:number,seed:number){const Rs:number[]=[],rr:number[]=[];const rnd=mulberry(seed+ws);
  for(const day of days){const mins=(b:Bar)=>{const d=new Date(b.t*1000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const win=day.filter(x=>{const m=mins(x);return m>=ws&&m<we;});const post=day.filter(x=>mins(x)>=we);
    if(win.length<3||post.length<5)continue;const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const tdir=-dir,stop=entry+dir*w,tgt=entry-dir*w;
    let R=null as number|null;for(let k=bi;k<post.length;k++){if(tdir>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=1;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=1;break;}}}
    if(R===null)R=tdir*(post[post.length-1].c-entry)/w;Rs.push(R);
    const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rd=rnd()<0.5?1:-1,re=post[ri].c,rs=re-rd*w,rt=re+rd*w;
    let x=null as number|null;for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=rs){x=-1;break;}if(post[k].h>=rt){x=1;break;}}else{if(post[k].h>=rs){x=-1;break;}if(post[k].l<=rt){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;rr.push(x);}
  return{edge:+(mean(Rs)-mean(rr)).toFixed(3),n:Rs.length};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  // fetch 5m/15m/30m for all instruments (parallel in chunks)
  const store:Record<string,Record<string,Bar[][]>>={};
  const tfs=[["5m","60d"],["15m","60d"],["30m","60d"]];
  for(const [tf,rg] of tfs){for(let i=0;i<INSTR.length;i+=6){const chunk=INSTR.slice(i,i+6);
    const res=await Promise.all(chunk.map(async s=>({s,b:await bars(s,tf,rg)})));
    for(const {s,b} of res){if(!b)continue;(store[s]||(store[s]={}))[tf]=groupDays(b);}}}
  const results:Record<string,unknown>[]=[];
  for(const W of WINDOWS){const we=W.ws+60;const perInstr:Record<string,unknown>[]=[];let bothPos=0,n=0;
    for(const s of INSTR){const d5=store[s]?.["5m"];if(!d5||d5.length<20)continue;n++;
      const half=Math.floor(d5.length/2);const h1=fadeEdge(d5.slice(0,half),W.ws,we,s.length*31);const h2=fadeEdge(d5.slice(half),W.ws,we,s.length*31);
      const e15=store[s]?.["15m"]?fadeEdge(store[s]["15m"],W.ws,we,s.length*31):{edge:null,n:0};
      const e30=store[s]?.["30m"]?fadeEdge(store[s]["30m"],W.ws,we,s.length*31):{edge:null,n:0};
      const both=h1.edge>0&&h2.edge>0;if(both)bothPos++;
      perInstr.push({instr:s,h1_edge:h1.edge,h2_edge:h2.edge,oos_both_positive:both,tf15_edge:e15.edge,tf30_edge:e30.edge});}
    results.push({window:W.name,instruments:n,oos_robust:`${bothPos}/${n} positive in BOTH halves`,per:perInstr});}
  return new Response(JSON.stringify({ok:true,note:"fade-the-range; split-half OOS on 5m/~49d + 15m/30m robustness; broad instruments. A real edge is positive in BOTH 5m halves across instruments.",results},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
