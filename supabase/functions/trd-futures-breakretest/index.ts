// trd-futures-breakretest — tests the BREAK-AND-RETEST of the prior-day high/low on futures (D-286). Price breaks
// PDH (5m close > PDH), pulls back to RETEST it (a bar dips to PDH but closes back above = level holds as support),
// enter LONG at that close, stop below the retest, target +2R, race to EOD. Symmetric SHORT at PDL. vs matched
// random control. Instruments: ES/NQ (index), GC (gold), SI (silver). Databento 1m (key in trd_secrets). ?symbol=&start=&end=
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const BASE="https://hist.databento.com/v0";
interface Bar{t:number;o:number;h:number;l:number;c:number;d:string}
function etDate(t:number){const y=new Date(t*1000).getUTCFullYear();const mar1=new Date(Date.UTC(y,2,1)).getUTCDay();const ds=Date.UTC(y,2,1+((7-mar1)%7)+7,7)/1000;const nov1=new Date(Date.UTC(y,10,1)).getUTCDay();const de=Date.UTC(y,10,1+((7-nov1)%7),6)/1000;const off=(t>=ds&&t<de)?-4:-5;return new Date((t+off*3600)*1000).toISOString().slice(0,10);}
function resample5(b1:Bar[]):Bar[]{const bk=new Map<number,Bar[]>();for(const b of b1){const k=Math.floor(b.t/300);(bk.get(k)||bk.set(k,[]).get(k))!.push(b);}
  const o:Bar[]=[];for(const [k,a] of [...bk.entries()].sort((x,y)=>x[0]-y[0]))o.push({t:k*300,o:a[0].o,h:Math.max(...a.map(z=>z.h)),l:Math.min(...a.map(z=>z.l)),c:a[a.length-1].c,d:etDate(k*300)});return o;}
function mul(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
const vv=(a:number[])=>{if(a.length<2)return NaN;const m=mean(a);return a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1);};
function race(bars:Bar[],from:number,dir:number,entry:number,stop:number,tgt:number){const risk=Math.abs(entry-stop);if(risk<=0)return null;
  for(let k=from;k<bars.length;k++){if(dir>0){if(bars[k].l<=stop)return -1;if(bars[k].h>=tgt)return 2;}else{if(bars[k].h>=stop)return -1;if(bars[k].l<=tgt)return 2;}}
  return dir*(bars[bars.length-1].c-entry)/risk;}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const key=(await fetch(`${SB}/rest/v1/trd_secrets?name=eq.databento_key&select=value`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0]?.value;if(!key)throw new Error("no key");
  const AUTH={Authorization:`Basic ${btoa(key+":")}`};const u=new URL(req.url);const symbol=u.searchParams.get("symbol")||"ES.c.0",start=u.searchParams.get("start")!,end=u.searchParams.get("end")!;
  const body=new URLSearchParams({dataset:"GLBX.MDP3",symbols:symbol,schema:"ohlcv-1m",stype_in:"continuous",start,end,encoding:"json"});
  const r=await fetch(`${BASE}/timeseries.get_range`,{method:"POST",headers:{...AUTH,"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
  if(!r.ok)return new Response(JSON.stringify({ok:false,status:r.status,err:(await r.text()).slice(0,150)}),{status:500,headers:cors});
  const b1:Bar[]=[];for(const line of (await r.text()).split("\n")){if(!line)continue;try{const j=JSON.parse(line);const t=Math.floor(Number(j.hd.ts_event)/1e9);b1.push({t,o:+j.open/1e9,h:+j.high/1e9,l:+j.low/1e9,c:+j.close/1e9,d:etDate(t)});}catch{/**/}}
  if(b1.length<500)return new Response(JSON.stringify({ok:true,symbol,bars:b1.length,note:"thin"}),{headers:cors});
  const b5=resample5(b1);const days=new Map<string,Bar[]>();for(const x of b5){(days.get(x.d)||days.set(x.d,[]).get(x.d))!.push(x);}
  const dk=[...days.keys()].sort();const dayHL=new Map<string,{h:number,l:number}>();for(const d of dk){const a=days.get(d)!;dayHL.set(d,{h:Math.max(...a.map(x=>x.h)),l:Math.min(...a.map(x=>x.l))});}
  const rnd=mul(symbol.length*77);const R:{r:number,d:string}[]=[],C:number[]=[];
  for(let di=1;di<dk.length;di++){const prev=dayHL.get(dk[di-1])!,bars=days.get(dk[di])!;const PDH=prev.h,PDL=prev.l;
    // LONG break-retest of PDH
    let broke=false,done=false;
    for(let i=1;i<bars.length-1;i++){if(!broke&&bars[i].c>PDH){broke=true;}
      else if(broke&&!done&&bars[i].l<=PDH&&bars[i].c>PDH){const entry=bars[i].c,stop=Math.min(bars[i].l,PDH)*0.9995,tgt=entry+2*(entry-stop);const rr=race(bars,i+1,1,entry,stop,tgt);if(rr!=null){R.push({r:rr,d:dk[di]});done=true;}break;}}
    // SHORT break-retest of PDL
    let brokeD=false,doneD=false;
    for(let i=1;i<bars.length-1;i++){if(!brokeD&&bars[i].c<PDL){brokeD=true;}
      else if(brokeD&&!doneD&&bars[i].h>=PDL&&bars[i].c<PDL){const entry=bars[i].c,stop=Math.max(bars[i].h,PDL)*1.0005,tgt=entry-2*(stop-entry);const rr=race(bars,i+1,-1,entry,stop,tgt);if(rr!=null){R.push({r:rr,d:dk[di]});doneD=true;}break;}}
    // matched random control: random bar, random dir, ~same 2R geometry off a 0.1% stop
    if(bars.length>10){const ri=3+Math.floor(rnd()*(bars.length-6)),rd=rnd()<0.5?1:-1,e=bars[ri].c,st=rd>0?e*0.999:e*1.001,tg=e+rd*2*Math.abs(e-st);const rr=race(bars,ri+1,rd,e,st,tg);if(rr!=null)C.push(rr);}}
  if(R.length<20)return new Response(JSON.stringify({ok:true,symbol,signals:R.length,note:"few signals"}),{headers:cors});
  const rs=R.map(x=>x.r),edge=mean(rs)-mean(C),se=Math.sqrt(vv(rs)/rs.length+vv(C)/C.length),t=se>0?edge/se:0;
  const cut=[...new Set(R.map(x=>x.d))].sort()[Math.floor([...new Set(R.map(x=>x.d))].length/2)];
  const h1=R.filter(x=>x.d<cut).map(x=>x.r),h2=R.filter(x=>x.d>=cut).map(x=>x.r);
  return new Response(JSON.stringify({ok:true,symbol,span:`${b1[0].d}→${b1[b1.length-1].d}`,signals:R.length,mean_r:+mean(rs).toFixed(3),random_r:+mean(C).toFixed(3),edge_r:+edge.toFixed(3),t:+t.toFixed(2),passes:t>=2,win_pct:+(rs.filter(x=>x>0).length/rs.length*100).toFixed(0),h1:+mean(h1).toFixed(3),h2:+mean(h2).toFixed(3),holds_both:mean(h1)>mean(C)&&mean(h2)>mean(C)},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
