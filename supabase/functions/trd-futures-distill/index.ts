// trd-futures-distill — the multi-timeframe DISTILLATION engine (D-257). Takes 1-minute bars and resamples them to
// 2m/4m/5m/10m/15m/30m (o=first,h=max,l=min,c=last,v=sum) so NO timeframe is neglected — exactly the operator's ask.
// Data-source-AGNOSTIC: runs on whatever 1m feed is wired (Yahoo 1m=7d now; ready for Databento/FirstRate years of 1m).
// Proves the pipeline + gives a (tiny-sample, noise-level) fade readout per timeframe. Scales to real history unchanged.
const INSTR=["ES=F","NQ=F"];const TFS=[2,4,5,10,15,30];  // minutes to distill 1m into
interface Bar{t:number;o:number;h:number;l:number;c:number}
async function bars1m(sym:string):Promise<Bar[]|null>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=7d`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],o:O,h,l,c});}
  return o;}catch{return null;}}
// resample 1m → tf-minute bars, bucketed by floor(epoch_minute / tf) so buckets align to the clock
function resample(b1:Bar[],tf:number):Bar[]{const buckets=new Map<number,Bar[]>();for(const b of b1){const k=Math.floor(b.t/60/tf);(buckets.get(k)||buckets.set(k,[]).get(k))!.push(b);}
  const out:Bar[]=[];for(const [k,arr] of [...buckets.entries()].sort((a,z)=>a[0]-z[0]))out.push({t:k*tf*60,o:arr[0].o,h:Math.max(...arr.map(x=>x.h)),l:Math.min(...arr.map(x=>x.l)),c:arr[arr.length-1].c});return out;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function fade(b:Bar[],ws:number,we:number,seed:number){const days=new Map<string,Bar[]>();for(const bar of b){const d=new Date(bar.t*1000).toISOString().slice(0,10);(days.get(d)||days.set(d,[]).get(d))!.push(bar);}
  const Rs:number[]=[],rr:number[]=[];const rnd=mulberry(seed);
  for(const day of days.values()){const mins=(x:Bar)=>{const d=new Date(x.t*1000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const win=day.filter(x=>{const m=mins(x);return m>=ws&&m<we;});const post=day.filter(x=>mins(x)>=we);if(win.length<2||post.length<3)continue;
    const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const tdir=-dir,stop=entry+dir*w,tgt=entry-dir*w;let R=null as number|null;
    for(let k=bi;k<post.length;k++){if(tdir>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=1;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=1;break;}}}
    if(R===null)R=tdir*(post[post.length-1].c-entry)/w;Rs.push(R);
    const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rd=rnd()<0.5?1:-1,re=post[ri].c;let x=null as number|null;
    for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=re-rd*w){x=-1;break;}if(post[k].h>=re+rd*w){x=1;break;}}else{if(post[k].h>=re-rd*w){x=-1;break;}if(post[k].l<=re+rd*w){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;rr.push(x);}
  return{edge:Rs.length?+(mean(Rs)-mean(rr)).toFixed(3):null,n:Rs.length};}
Deno.serve(async(_req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const out:Record<string,unknown>[]=[];
  for(const sym of INSTR){const b1=await bars1m(sym);if(!b1){out.push({instrument:sym,available:false});continue;}
    const tfBars:Record<string,number>={"1m":b1.length};const fadeNY:Record<string,unknown>={};
    // NY 8:30 window 12:30-13:30 UTC — proves distillation + a (7d, noise) readout per timeframe
    fadeNY["1m"]=fade(b1,750,810,sym.length);
    for(const tf of TFS){const rb=resample(b1,tf);tfBars[`${tf}m`]=rb.length;fadeNY[`${tf}m`]=fade(rb,750,810,sym.length);}
    out.push({instrument:sym,span:`${new Date(b1[0].t*1000).toISOString().slice(0,10)}→${new Date(b1[b1.length-1].t*1000).toISOString().slice(0,10)}`,bars_per_timeframe:tfBars,ny_fade_per_timeframe:fadeNY});}
  return new Response(JSON.stringify({ok:true,note:"Distills 1m→2/4/5/10/15/30m (clock-aligned buckets). Yahoo 1m=7d so the fade readout is NOISE — the deliverable is the DISTILLATION ENGINE, which scales unchanged to years of 1m from a paid feed.",distilled:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
