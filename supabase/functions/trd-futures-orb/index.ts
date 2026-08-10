// trd-futures-orb — time-based Opening-Range breakout/FADE tester (D-254). Range over a fixed intraday WINDOW (default
// 8:12–9:12 ET = 12:12–13:12 UTC/EDT); ?fade=1 trades REVERSION (short the up-break/long the down-break) instead of
// following. Random-entry control. Reports data availability. Params: ?interval=5m&range=60d&winStart=&winEnd=&tp=&fade=.
const INSTR=["ES=F","NQ=F","YM=F","RTY=F","CL=F","GC=F"];
interface Bar{t:number;o:number;h:number;l:number;c:number}
async function bars(sym:string,interval:string,range:string):Promise<Bar[]|null>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],o:O,h,l,c});}
  return o;}catch{return null;}}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const interval=u.searchParams.get("interval")||"5m";const range=u.searchParams.get("range")||"60d";
  const winStart=+(u.searchParams.get("winStart")||"732"),winEnd=+(u.searchParams.get("winEnd")||"792");
  const TP=+(u.searchParams.get("tp")||"1");const FADE=u.searchParams.get("fade")==="1";
  const out:Record<string,unknown>[]=[];
  for(const sym of INSTR){const b=await bars(sym,interval,range);
    if(!b||b.length<50){out.push({instrument:sym,available:!!b,bars:b?b.length:0,note:"no/insufficient intraday data"});continue;}
    const span=`${new Date(b[0].t*1000).toISOString().slice(0,10)}→${new Date(b[b.length-1].t*1000).toISOString().slice(0,10)}`;
    const byDay=new Map<string,Bar[]>();for(const bar of b){const d=new Date(bar.t*1000).toISOString().slice(0,10);(byDay.get(d)||byDay.set(d,[]).get(d))!.push(bar);}
    let nDays=0,up=0,down=0,noBreak=0;const Rs:number[]=[],rndRs:number[]=[];const rnd=mulberry(sym.length*997+winStart);
    for(const [,day] of byDay){
      const mins=(bar:Bar)=>{const dt=new Date(bar.t*1000);return dt.getUTCHours()*60+dt.getUTCMinutes();};
      const win=day.filter(x=>mins(x)>=winStart&&mins(x)<winEnd);const post=day.filter(x=>mins(x)>=winEnd);
      if(win.length<3||post.length<5)continue;nDays++;
      const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const width=rH-rL;if(!(width>0))continue;
      let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
      if(dir===0){noBreak++;continue;}dir>0?up++:down++;
      const tdir=FADE?-dir:dir;const stop=FADE?(entry+dir*width):(dir>0?rL:rH), tgt=entry+tdir*width*TP;
      let R=null as number|null;for(let k=bi;k<post.length;k++){if(tdir>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=TP;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=TP;break;}}}
      if(R===null)R=tdir*(post[post.length-1].c-entry)/width;
      Rs.push(R);
      const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rdir=rnd()<0.5?1:-1;const re=post[ri].c,rstop=re-rdir*width,rtg=re+rdir*width*TP;
      let rr=null as number|null;for(let k=ri;k<post.length;k++){if(rdir>0){if(post[k].l<=rstop){rr=-1;break;}if(post[k].h>=rtg){rr=TP;break;}}else{if(post[k].h>=rstop){rr=-1;break;}if(post[k].l<=rtg){rr=TP;break;}}}
      if(rr===null)rr=rdir*(post[post.length-1].c-re)/width;rndRs.push(rr);
    }
    const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
    const wins=Rs.filter(r=>r>0).length;
    out.push({instrument:sym,available:true,bars:b.length,span,days_tested:nDays,
      break_up_pct:nDays?+(up/nDays*100).toFixed(0):0, break_down_pct:nDays?+(down/nDays*100).toFixed(0):0, no_break_pct:nDays?+(noBreak/nDays*100).toFixed(0):0,
      win_pct:Rs.length?+(wins/Rs.length*100).toFixed(0):null, mean_R:+mean(Rs).toFixed(3), random_mean_R:+mean(rndRs).toFixed(3), edge_R:+(mean(Rs)-mean(rndRs)).toFixed(3)});}
  return new Response(JSON.stringify({ok:true,mode:FADE?"FADE (range reversion)":"BREAKOUT (follow)",interval,range,window_utc:`${Math.floor(winStart/60)}:${String(winStart%60).padStart(2,"0")}-${Math.floor(winEnd/60)}:${String(winEnd%60).padStart(2,"0")} (default 8:12-9:12 ET/EDT)`,results:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
