// trd-futures-sessions — sweep the time-based range-FADE across EVERY session window (D-255). For each 60-min window
// stepped 30 min across the 24h futures day, measure the fade edge (meanR setup − random) per instrument, aggregated
// across the index futures + gold. Finds where the "market picks a side then reverts" pattern is strongest — NY 8:12
// was one window; this maps all of them. Cross-instrument agreement = robustness. 5m Yahoo (~49d). Multiple-testing:
// only windows positive across MOST instruments with a large edge are real leads. NO order path.
const INSTR=["ES=F","NQ=F","YM=F","GC=F","RTY=F","CL=F"];
const CORE=["ES=F","NQ=F","YM=F","GC=F"];  // aggregate over these (the ones that fade); CL trends, RTY noisy
interface Bar{t:number;h:number;l:number;c:number}
async function bars(sym:string):Promise<Bar[]|null>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=60d`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],h,l,c});}
  return o;}catch{return null;}}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
// fade edge for one instrument's day-grouped bars over window [ws,we) UTC minutes
function fadeEdge(byDay:Bar[][],ws:number,we:number,seed:number):{edge:number,n:number,win:number}{
  const Rs:number[]=[],rr:number[]=[];const rnd=mulberry(seed+ws);
  for(const day of byDay){
    const mins=(b:Bar)=>{const d=new Date(b.t*1000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const win=day.filter(x=>{const m=mins(x);return m>=ws&&m<we;});const post=day.filter(x=>mins(x)>=we);
    if(win.length<3||post.length<5)continue;
    const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const tdir=-dir,stop=entry+dir*w,tgt=entry-dir*w;
    let R=null as number|null;for(let k=bi;k<post.length;k++){if(tdir>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=1;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=1;break;}}}
    if(R===null)R=tdir*(post[post.length-1].c-entry)/w;Rs.push(R);
    const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rd=rnd()<0.5?1:-1,re=post[ri].c,rs=re-rd*w,rt=re+rd*w;
    let x=null as number|null;for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=rs){x=-1;break;}if(post[k].h>=rt){x=1;break;}}else{if(post[k].h>=rs){x=-1;break;}if(post[k].l<=rt){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;rr.push(x);
  }
  return{edge:+(mean(Rs)-mean(rr)).toFixed(3),n:Rs.length,win:Rs.length?+(Rs.filter(r=>r>0).length/Rs.length*100).toFixed(0):0};
}
const etLabel=(utcMin:number)=>{let et=(utcMin-240+1440)%1440;const h=Math.floor(et/60),m=et%60;const sess=et<180?"Asia":et<800/60*60?"":"";return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} ET`;};
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const data=new Map<string,Bar[][]>();
  for(const sym of INSTR){const b=await bars(sym);if(!b)continue;const byDay=new Map<string,Bar[]>();for(const bar of b){const d=new Date(bar.t*1000).toISOString().slice(0,10);(byDay.get(d)||byDay.set(d,[]).get(d))!.push(bar);}data.set(sym,[...byDay.values()]);}
  const windows:Record<string,unknown>[]=[];
  for(let ws=0;ws<1440;ws+=30){const we=ws+60;const per:Record<string,number>={};let coreEdges=0,corePos=0,minN=1e9;
    for(const sym of INSTR){const bd=data.get(sym);if(!bd)continue;const {edge,n}=fadeEdge(bd,ws,we,sym.length*997);per[sym]=edge;if(CORE.includes(sym)){coreEdges+=edge;if(edge>0)corePos++;if(n<minN)minN=n;}}
    windows.push({win_utc:`${String(Math.floor(ws/60)).padStart(2,"0")}:${String(ws%60).padStart(2,"0")}`,win_et:etLabel(ws),core_mean_edge:+(coreEdges/CORE.length).toFixed(3),core_positive:`${corePos}/${CORE.length}`,min_days:minN===1e9?0:minN,per_instr:per});}
  windows.sort((a,b)=>(b.core_mean_edge as number)-(a.core_mean_edge as number));
  return new Response(JSON.stringify({ok:true,note:"5m Yahoo ~49d; fade the range-breakout; core=ES/NQ/YM/GC; sorted by mean core edge. Multiple-testing: only broad+large edges are real leads.",top_windows:windows.slice(0,10),worst_windows:windows.slice(-4)},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
