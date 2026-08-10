// trd-futures-backtest-hist — the DEFINITIVE range-fade validation on real Databento 1m (D-258). ?symbol=ES.c.0
// &start=&end=&period=2024Q1 → pulls ohlcv-1m, distills to 1/2/4/5/10/15/30m, runs the fade at 3 windows (London
// 04:30ET, NY 08:30ET, op 8:12ET) per timeframe, stores per (symbol,tf,window,period). Aggregating periods = real OOS.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const BASE="https://hist.databento.com/v0";
const TFS=[1,2,4,5,10,15,30];
const WINS:[string,number,number][]=[["london",510,570],["ny830",750,810],["op812",732,792]];  // UTC minutes
interface Bar{t:number;o:number;h:number;l:number;c:number}
function resample(b1:Bar[],tf:number):Bar[]{if(tf===1)return b1;const bk=new Map<number,Bar[]>();for(const b of b1){const k=Math.floor(b.t/60/tf);(bk.get(k)||bk.set(k,[]).get(k))!.push(b);}
  const o:Bar[]=[];for(const [k,a] of [...bk.entries()].sort((x,y)=>x[0]-y[0]))o.push({t:k*tf*60,o:a[0].o,h:Math.max(...a.map(z=>z.h)),l:Math.min(...a.map(z=>z.l)),c:a[a.length-1].c});return o;}
function mulberry(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function fade(b:Bar[],ws:number,we:number,seed:number){const days=new Map<string,Bar[]>();for(const x of b){const d=new Date(x.t*1000).toISOString().slice(0,10);(days.get(d)||days.set(d,[]).get(d))!.push(x);}
  const Rs:number[]=[],rr:number[]=[];const rnd=mulberry(seed+ws);
  for(const day of days.values()){const mins=(x:Bar)=>{const d=new Date(x.t*1000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const win=day.filter(x=>{const m=mins(x);return m>=ws&&m<we;});const post=day.filter(x=>mins(x)>=we);if(win.length<2||post.length<3)continue;
    const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const td=-dir,stop=entry+dir*w,tgt=entry-dir*w;let R=null as number|null;
    for(let k=bi;k<post.length;k++){if(td>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=1;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=1;break;}}}
    if(R===null)R=td*(post[post.length-1].c-entry)/w;Rs.push(R);
    const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rd=rnd()<0.5?1:-1,re=post[ri].c;let x=null as number|null;
    for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=re-rd*w){x=-1;break;}if(post[k].h>=re+rd*w){x=1;break;}}else{if(post[k].h>=re-rd*w){x=-1;break;}if(post[k].l<=re+rd*w){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;rr.push(x);}
  return{n:Rs.length,edge:Rs.length?+(mean(Rs)-mean(rr)).toFixed(4):null,mean_r:Rs.length?+mean(Rs).toFixed(4):null,win_pct:Rs.length?+(Rs.filter(r=>r>0).length/Rs.length*100).toFixed(0):null};
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const key=(await fetch(`${SB}/rest/v1/trd_secrets?name=eq.databento_key&select=value`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0]?.value;
  if(!key)throw new Error("no key");const AUTH={Authorization:`Basic ${btoa(key+":")}`};
  const u=new URL(req.url);const symbol=u.searchParams.get("symbol")||"ES.c.0";const start=u.searchParams.get("start")!,end=u.searchParams.get("end")!,period=u.searchParams.get("period")!;
  const body=new URLSearchParams({dataset:"GLBX.MDP3",symbols:symbol,schema:"ohlcv-1m",stype_in:"continuous",start,end,encoding:"json"});
  const r=await fetch(`${BASE}/timeseries.get_range`,{method:"POST",headers:{...AUTH,"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
  if(!r.ok)return new Response(JSON.stringify({ok:false,stage:"pull",status:r.status,err:(await r.text()).slice(0,200)}),{status:500,headers:cors});
  const txt=await r.text();const b1:Bar[]=[];
  for(const line of txt.split("\n")){if(!line)continue;try{const j=JSON.parse(line);b1.push({t:Math.floor(Number(j.hd.ts_event)/1e9),o:Number(j.open)/1e9,h:Number(j.high)/1e9,l:Number(j.low)/1e9,c:Number(j.close)/1e9});}catch{/*skip*/}}
  if(b1.length<100)return new Response(JSON.stringify({ok:true,symbol,period,bars:b1.length,note:"too few bars"}),{headers:cors});
  const rows:Record<string,unknown>[]=[];
  for(const tf of TFS){const rb=resample(b1,tf);for(const [wn,ws,we] of WINS){const f=fade(rb,ws,we,symbol.length*13+tf);if(f.n>=5)rows.push({symbol,timeframe:`${tf}m`,win:wn,period,n:f.n,edge_r:f.edge,mean_r:f.mean_r,win_pct:f.win_pct});}}
  if(rows.length)await fetch(`${SB}/rest/v1/trd_futures_orb_results?on_conflict=symbol,timeframe,win,period`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
  return new Response(JSON.stringify({ok:true,symbol,period,bars_1m:b1.length,span:`${new Date(b1[0].t*1000).toISOString().slice(0,10)}→${new Date(b1[b1.length-1].t*1000).toISOString().slice(0,10)}`,stored:rows.length}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
