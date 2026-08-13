// trd-crypto-orb — tests ORB-follow on the CRYPTO universe using FREE+KEYLESS Binance 1m/15m (D-284, doctrine D-283).
// Pulls ~2.5yr of 15m klines per symbol (keyless, paginated), tests the opening-range breakout-FOLLOW at two session
// windows (00:00 UTC crypto-day, 13:30 UTC US-open) vs a random-direction control, with split-half OOS. $0, no key.
const WINS:[string,number,number][]=[["utc00",0,60],["usopen",810,870]];
interface Bar{t:number;h:number;l:number;c:number;m:number;d:string}
async function klines(sym:string,startMs:number):Promise<Bar[]>{const out:Bar[]=[];let cur=startMs;const now=Date.now();let calls=0;
  while(cur<now&&calls<260){calls++;
    const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&startTime=${cur}&limit=1000`).catch(()=>null);
    if(!r||!r.ok)break;const j=await r.json().catch(()=>null);if(!Array.isArray(j)||!j.length)break;
    for(const k of j){const t=Math.floor(k[0]/1000);const dt=new Date(k[0]);out.push({t,h:+k[2],l:+k[3],c:+k[4],m:dt.getUTCHours()*60+dt.getUTCMinutes(),d:dt.toISOString().slice(0,10)});}
    cur=j[j.length-1][6]+1;if(j.length<1000)break;}
  return out;}
function mul(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
const vari=(a:number[])=>{if(a.length<2)return NaN;const m=mean(a);return a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1);};
function testWin(b:Bar[],ws:number,we:number,seed:number){const days=new Map<string,Bar[]>();for(const x of b){(days.get(x.d)||days.set(x.d,[]).get(x.d))!.push(x);}
  const R:{r:number,d:string}[]=[],C:number[]=[];const rnd=mul(seed);
  for(const day of days.values()){const win=day.filter(x=>x.m>=ws&&x.m<we),post=day.filter(x=>x.m>=we);
    if(win.length<2||post.length<3)continue;const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l)),w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const stop=entry-dir*w,tgt=entry+dir*w;let r=null as number|null;
    for(let k=bi;k<post.length;k++){if(dir>0){if(post[k].l<=stop){r=-1;break;}if(post[k].h>=tgt){r=1;break;}}else{if(post[k].h>=stop){r=-1;break;}if(post[k].l<=tgt){r=1;break;}}}
    if(r===null)r=dir*(post[post.length-1].c-entry)/w;R.push({r,d:day[0].d});
    const ri=Math.floor(rnd()*Math.max(1,post.length-2)),rd=rnd()<0.5?1:-1,re=post[ri].c;let x=null as number|null;
    for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=re-rd*w){x=-1;break;}if(post[k].h>=re+rd*w){x=1;break;}}else{if(post[k].h>=re-rd*w){x=-1;break;}if(post[k].l<=re+rd*w){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;C.push(x);}
  if(R.length<30)return{n:R.length,edge:null};
  const rs=R.map(x=>x.r),edge=mean(rs)-mean(C),se=Math.sqrt(vari(rs)/rs.length+vari(C)/C.length),t=se>0?edge/se:0;
  const cut=[...new Set(R.map(x=>x.d))].sort();const mid=cut[Math.floor(cut.length/2)];
  const h1=R.filter(x=>x.d<mid).map(x=>x.r),h2=R.filter(x=>x.d>=mid).map(x=>x.r);
  const h1e=mean(h1)-mean(C.slice(0,h1.length)),h2e=mean(h2)-mean(C.slice(h1.length));
  return{n:R.length,mean_r:+mean(rs).toFixed(4),edge:+edge.toFixed(4),t:+t.toFixed(2),passes:t>=2,h1:+h1e.toFixed(4),h2:+h2e.toFixed(4),holds_both:h1e>0&&h2e>0};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const syms=(u.searchParams.get("symbols")||"BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,LINKUSDT").split(",");
  const yrs=+(u.searchParams.get("years")||"2.5");const start=Date.now()-yrs*365*864e5;
  const res=[];const pooled:Record<string,{R:number[],C:number[]}>={utc00:{R:[],C:[]},usopen:{R:[],C:[]}};
  for(const sym of syms){const b=await klines(sym,start);if(b.length<500){res.push({sym,bars:b.length,skip:"thin"});continue;}
    const per:Record<string,unknown>={};for(const [wn,ws,we] of WINS)per[wn]=testWin(b,ws,we,sym.length*101+ws);
    res.push({sym,bars:b.length,span:`${b[0].d}→${b[b.length-1].d}`,...per});}
  return new Response(JSON.stringify({ok:true,source:"Binance 15m (free+keyless)",symbols:syms.length,results:res},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
