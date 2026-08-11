// trd-futures-backtest-hist — DEFINITIVE range breakout/fade validation on real Databento 1m (D-258/D-260).
// ?symbol=ES.c.0&start=&end=&period=2024Q1 → pulls ohlcv-1m, distills to 1/2/4/5/10/15/30m, tests BOTH directions
// (fade + follow) vs a matched random-entry control, at 7 ET session windows, per timeframe. Stores per
// (symbol,tf,win,period,mode). CONSISTENCY FIX (D-260): windowing is DST-aware America/New_York local time — a
// fixed-UTC window drifts 1h across DST and mixes two clocks; every window is now the SAME ET clock year-round.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const BASE="https://hist.databento.com/v0";
const TFS=[1,2,4,5,10,15,30];
// [name, startMinET, endMinET] — minutes past ET midnight. op812 is the operator's 8:12–9:12 window.
const WINS:[string,number,number][]=[
  ["london",270,330],   // 04:30–05:30 ET (London open)
  ["premkt7",420,480],  // 07:00–08:00 ET (early data)
  ["op812",492,552],    // 08:12–09:12 ET (operator's window)
  ["ny830",510,570],    // 08:30–09:30 ET (NY pre-open / 08:30 data release)
  ["cash_open",570,630],// 09:30–10:30 ET (EQUITY CASH OPEN — the executable ETF window)
  ["lunch",720,780],    // 12:00–13:00 ET
  ["power",900,960],    // 15:00–16:00 ET (power hour into equity close)
];
interface Bar{t:number;o:number;h:number;l:number;c:number;m?:number;d?:string}
// Fast DST-aware ET (no Intl — Intl.formatToParts per bar blows the worker compute budget). US DST: 2nd Sun Mar
// 07:00 UTC → 1st Sun Nov 06:00 UTC = EDT (UTC-4); else EST (UTC-5). Correct for the whole 2022–2026 span.
function etOffH(t:number):number{const d=new Date(t*1000),y=d.getUTCFullYear();
  const mar1=new Date(Date.UTC(y,2,1)).getUTCDay();const dstStart=Date.UTC(y,2,1+((7-mar1)%7)+7,7)/1000;
  const nov1=new Date(Date.UTC(y,10,1)).getUTCDay();const dstEnd=Date.UTC(y,10,1+((7-nov1)%7),6)/1000;
  return (t>=dstStart&&t<dstEnd)?-4:-5;}
function etOf(t:number):{m:number,d:string}{const lt=t+etOffH(t)*3600;const d=new Date(lt*1000);return{m:d.getUTCHours()*60+d.getUTCMinutes(),d:d.toISOString().slice(0,10)};}
function resample(b1:Bar[],tf:number):Bar[]{const src=tf===1?b1:(()=>{const bk=new Map<number,Bar[]>();for(const b of b1){const k=Math.floor(b.t/60/tf);(bk.get(k)||bk.set(k,[]).get(k))!.push(b);}
  const o:Bar[]=[];for(const [k,a] of [...bk.entries()].sort((x,y)=>x[0]-y[0]))o.push({t:k*tf*60,o:a[0].o,h:Math.max(...a.map(z=>z.h)),l:Math.min(...a.map(z=>z.l)),c:a[a.length-1].c});return o;})();
  for(const b of src){const e=etOf(b.t);b.m=e.m;b.d=e.d;}return src;}  // precompute ET once per bar per tf
function mulberry(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
// Returns fade R per day + a matched random-entry R per day. follow = mirror of fade (symmetric ±width barriers).
function test(b:Bar[],ws:number,we:number,seed:number){const days=new Map<string,Bar[]>();for(const x of b){(days.get(x.d!)||days.set(x.d!,[]).get(x.d!))!.push(x);}
  const R:number[]=[],rr:number[]=[];const rnd=mulberry(seed+ws);
  for(const day of days.values()){
    const win=day.filter(x=>x.m!>=ws&&x.m!<we);const post=day.filter(x=>x.m!>=we);
    if(win.length<2||post.length<3)continue;
    const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l));const w=rH-rL;if(!(w>0))continue;
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0)continue;const td=-dir,stop=entry+dir*w,tgt=entry-dir*w;let r=null as number|null; // td=-dir → FADE
    for(let k=bi;k<post.length;k++){if(td>0){if(post[k].l<=stop){r=-1;break;}if(post[k].h>=tgt){r=1;break;}}else{if(post[k].h>=stop){r=-1;break;}if(post[k].l<=tgt){r=1;break;}}}
    if(r===null)r=td*(post[post.length-1].c-entry)/w;R.push(r);
    const ri=Math.floor(rnd()*Math.max(1,post.length-2));const rd=rnd()<0.5?1:-1,re=post[ri].c;let x=null as number|null;
    for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=re-rd*w){x=-1;break;}if(post[k].h>=re+rd*w){x=1;break;}}else{if(post[k].h>=re-rd*w){x=-1;break;}if(post[k].l<=re+rd*w){x=1;break;}}}
    if(x===null)x=rd*(post[post.length-1].c-re)/w;rr.push(x);}
  return{R,rr};
}
function rowset(symbol:string,tf:number,wn:string,period:string,R:number[],rr:number[]){
  if(R.length<5)return[] as Record<string,unknown>[];const rMean=mean(R),rrMean=mean(rr);
  const fadeWin=R.filter(v=>v>0).length/R.length*100, followWin=R.filter(v=>v<0).length/R.length*100;
  return[
    {symbol,timeframe:`${tf}m`,win:wn,period,mode:"fade",  n:R.length,mean_r:+rMean.toFixed(4), edge_r:+(rMean-rrMean).toFixed(4), win_pct:+fadeWin.toFixed(0)},
    {symbol,timeframe:`${tf}m`,win:wn,period,mode:"follow",n:R.length,mean_r:+(-rMean).toFixed(4),edge_r:+(-rMean-rrMean).toFixed(4),win_pct:+followWin.toFixed(0)},
  ];
}
function q4d(d:string){return `${d.slice(0,4)}Q${Math.floor((+d.slice(5,7)-1)/3)+1}`;}
// Per-day FOLLOW trade + matched random control + regime tags (dir / range-width vs trailing median / trend-align).
function followRegime(b:Bar[],ws:number,we:number,seed:number){
  const days=new Map<string,Bar[]>();for(const x of b){(days.get(x.d!)||days.set(x.d!,[]).get(x.d!))!.push(x);}
  const keys=[...days.keys()].sort();const rnd=mulberry(seed);const widths:number[]=[],pcl:number[]=[];
  const out:{R:number,rr:number,dir:string,rw:string,tr:string,period:string}[]=[];
  for(const dk of keys){const day=days.get(dk)!;const dc=day[day.length-1].c;
    const win=day.filter(x=>x.m!>=ws&&x.m!<we);const post=day.filter(x=>x.m!>=we);
    if(win.length<2||post.length<3){pcl.push(dc);continue;}
    const rH=Math.max(...win.map(x=>x.h)),rL=Math.min(...win.map(x=>x.l)),w=rH-rL;
    if(!(w>0)){widths.push(w);pcl.push(dc);continue;}
    let dir=0,entry=0,bi=-1;for(let i=0;i<post.length;i++){if(post[i].h>rH){dir=1;entry=rH;bi=i;break;}if(post[i].l<rL){dir=-1;entry=rL;bi=i;break;}}
    if(dir===0){widths.push(w);pcl.push(dc);continue;}
    const stop=entry-dir*w,tgt=entry+dir*w;let R=null as number|null; // FOLLOW: stop=opposite extreme, tgt=+1w
    for(let k=bi;k<post.length;k++){if(dir>0){if(post[k].l<=stop){R=-1;break;}if(post[k].h>=tgt){R=1;break;}}else{if(post[k].h>=stop){R=-1;break;}if(post[k].l<=tgt){R=1;break;}}}
    if(R===null)R=dir*(post[post.length-1].c-entry)/w;
    const ri=Math.floor(rnd()*Math.max(1,post.length-2)),rd=rnd()<0.5?1:-1,re=post[ri].c;let rr=null as number|null;
    for(let k=ri;k<post.length;k++){if(rd>0){if(post[k].l<=re-rd*w){rr=-1;break;}if(post[k].h>=re+rd*w){rr=1;break;}}else{if(post[k].h>=re-rd*w){rr=-1;break;}if(post[k].l<=re+rd*w){rr=1;break;}}}
    if(rr===null)rr=rd*(post[post.length-1].c-re)/w;
    const dirB=dir>0?"up":"down";let rwB="normal";
    if(widths.length>=10){const sw=[...widths].sort((a,b)=>a-b);const med=sw[Math.floor(sw.length/2)];rwB=w<med*0.8?"tight":w>med*1.2?"wide":"normal";}
    let trB="na";if(pcl.length>=3){const up=pcl[pcl.length-1]>pcl[pcl.length-3];trB=((up&&dir>0)||(!up&&dir<0))?"withtrend":"counter";}
    out.push({R,rr,dir:dirB,rw:rwB,tr:trB,period:q4d(dk)});widths.push(w);pcl.push(dc);}
  return out;
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
  for(const tf of TFS){const rb=resample(b1,tf);for(const [wn,ws,we] of WINS){const {R,rr}=test(rb,ws,we,symbol.length*13+tf);rows.push(...rowset(symbol,tf,wn,period,R,rr));}}
  if(rows.length)await fetch(`${SB}/rest/v1/trd_futures_orb_results?on_conflict=symbol,timeframe,win,period,mode`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
  // REGIME MATRIX for the executable cash_open (09:30-10:30 ET) follow, on 5m — per dir / range-width / trend-align
  const rb5=resample(b1,5);const fr=followRegime(rb5,570,630,symbol.length*17+5);
  const acc=new Map<string,{n:number,sf:number,sr:number}>();
  const add=(dim:string,bkt:string,per:string,R:number,rr:number)=>{const k=`${dim}|${bkt}|${per}`;const a=acc.get(k)||{n:0,sf:0,sr:0};a.n++;a.sf+=R;a.sr+=rr;acc.set(k,a);};
  for(const d of fr){add("dir",d.dir,d.period,d.R,d.rr);if(d.rw!=="normal")add("rangewidth",d.rw,d.period,d.R,d.rr);if(d.tr!=="na")add("trend",d.tr,d.period,d.R,d.rr);}
  const rrows=[...acc.entries()].filter(([,a])=>a.n>=3).map(([k,a])=>{const p=k.split("|");return {symbol,dim:p[0],bucket:p[1],period:p[2],n:a.n,follow_mean:+(a.sf/a.n).toFixed(4),rand_mean:+(a.sr/a.n).toFixed(4),edge:+((a.sf-a.sr)/a.n).toFixed(4)};});
  if(rrows.length)await fetch(`${SB}/rest/v1/trd_futures_regime?on_conflict=symbol,dim,bucket,period`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rrows)});
  return new Response(JSON.stringify({ok:true,symbol,period,bars_1m:b1.length,span:`${etOf(b1[0].t).d}→${etOf(b1[b1.length-1].t).d}`,stored:rows.length,regime:rrows.length}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
