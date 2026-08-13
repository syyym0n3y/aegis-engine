// trd-orbfollow-scanner — BROAD deployment of the validated ORB-follow edge (D-278). The edge (D-259/271: opening-
// range breakout EXTENDS, +0.14R vs random, OOS-robust across index+gold futures) is instrument-general, so trade it
// on a broad liquid-ETF universe EVERY day, not just 4 names. Many trades/day → real paper P&L now + fast forward
// evidence (collapses the 30-trade gate from weeks to ~1 day). Same geometry as trd-orbfollow-exec: 09:30-10:30 ET
// range, follow the first break after 10:30, bracket (stop=opposite extreme, target=+1 range width). Edge tag
// 'orbfollow' (feeds the same gate). Universe EXCLUDES SPY/QQQ/DIA/GLD (owned by trd-orbfollow-exec) — no Alpaca merge.
// Guards: killswitch + arm 'paper' + per-name/day dedup + position cap + small size. Runs every 30m across RTH.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
// ~50 liquid ETFs — sector SPDRs, index, international, bonds, commodities, styles/industries. Close analogs to the
// validated index/gold futures edge; ETFs (not single stocks) keep the generalization tight.
const UNIVERSE=["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","IWM","MDY","IJH","IJR","VTI","VEA","VWO","EFA","EEM","FXI","EWJ","EWZ","INDA","TLT","IEF","SHY","HYG","LQD","TIP","AGG","SLV","USO","GDX","GDXJ","DBC","UNG","VUG","VTV","MTUM","QUAL","IWF","IWD","SMH","XBI","KRE","ITB","XRT","IYR","XME",
  "VOO","VO","VB","VYM","VIG","USMV","SPLV","SDY","SCHD","DVY","NOBL","PFF","VGT","VFH","VDE","VHT","VIS","VCR","VDC","VPU","VAW","VNQ","IEMG","IEFA","VXUS","ACWI","MCHI","EWG","EWU","EWY","EWT","EWA","EWC","EWH","EWW","VGK","EZU",
  "BND","JNK","IEI","GOVT","MBB","VCIT","MUB","EMB","IAU","SOXX","IBB","KBE","XHB","XOP","OIH","IGV","JETS","ICLN","TAN"];
const RISK_NOTIONAL=0.02,POS_CAP=60,RANGE_START=570,RANGE_END=630,CONC=20;
interface Bar{h:number;l:number;c:number;m:number;d:string}
function etOffH(t:number):number{const d=new Date(t*1000),y=d.getUTCFullYear();
  const mar1=new Date(Date.UTC(y,2,1)).getUTCDay();const dstStart=Date.UTC(y,2,1+((7-mar1)%7)+7,7)/1000;
  const nov1=new Date(Date.UTC(y,10,1)).getUTCDay();const dstEnd=Date.UTC(y,10,1+((7-nov1)%7),6)/1000;
  return (t>=dstStart&&t<dstEnd)?-4:-5;}
function etOf(t:number){const lt=t+etOffH(t)*3600;const d=new Date(lt*1000);return{m:d.getUTCHours()*60+d.getUTCMinutes(),d:d.toISOString().slice(0,10)};}
async function bars5m(sym:string):Promise<Bar[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=5d`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;const e=etOf(res.timestamp[i]);o.push({h,l,c,m:e.m,d:e.d});}
  return o;}catch{return[];}}
async function pool<T,R>(items:T[],n:number,fn:(x:T)=>Promise<R>):Promise<R[]>{const out:R[]=[];let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const dbg=new URL(req.url).searchParams.get("debug")==="1";
  const nowMin=etOf(Math.floor(Date.now()/1000)).m;
  // EOD FLATTEN (safety + backtest fidelity): the edge is INTRADAY — flatten ALL orbfollow positions just before the
  // close so no position is carried naked overnight (day-TIF bracket legs cancel at close). Runs even if DISARMED
  // (positions must never strand); only in the 15:50-16:05 ET window (DST-safe via two cron ticks that no-op else).
  if(new URL(req.url).searchParams.get("eod")==="1"){
    if(nowMin<950||nowMin>965)return new Response(JSON.stringify({ok:true,eod:true,skip:`not close window (ET ${nowMin})`}),{headers:cors});
    const uni=new Set([...UNIVERSE,"SPY","QQQ","DIA","GLD"]);
    const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
    const oo=await fetch(`${PAPER}/v2/orders?status=open&limit=500`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
    const flat:string[]=[];
    for(const p of (Array.isArray(positions)?positions:[]) as {symbol:string}[]){if(!uni.has(p.symbol))continue;
      for(const o of (Array.isArray(oo)?oo:[]) as {id:string,symbol:string}[])if(o.symbol===p.symbol)await fetch(`${PAPER}/v2/orders/${o.id}`,{method:"DELETE",headers:AH}).catch(()=>{});
      const ok=(await fetch(`${PAPER}/v2/positions/${p.symbol}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>null))?.ok;if(ok)flat.push(p.symbol);}
    await fetch(`${SB}/rest/v1/trd_trades?edge=eq.orbfollow&status=eq.open`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({status:"closed",exit_at:new Date().toISOString()})}).catch(()=>{});
    return new Response(JSON.stringify({ok:true,eod:true,flattened:flat},null,2),{headers:cors});
  }
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed&&!dbg)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity)||100000;
  const cfg=await fetch(`${SB}/rest/v1/trd_exec_config?edge=eq.orbfollow&select=size_notional`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const sizeN=Number(cfg?.[0]?.size_notional)>0?Number(cfg[0].size_notional):RISK_NOTIONAL; // config-driven (D-279); scale = update trd_exec_config
  const posList=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const heldSyms=new Set((Array.isArray(posList)?posList:[]).map((p:{symbol:string})=>p.symbol));
  const today=etOf(Math.floor(Date.now()/1000)).d;
  // already-fired orbfollow names today (dedup) + count for the cap
  const firedRows=await fetch(`${SB}/rest/v1/trd_trades?edge=eq.orbfollow&entry_at=gte.${today}T00:00:00Z&select=sym`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const fired=new Set((Array.isArray(firedRows)?firedRows:[]).map((r:{sym:string})=>r.sym));let openCount=fired.size;
  const bars=await pool(UNIVERSE,CONC,bars5m);
  const out:Record<string,unknown>[]=[];let placed=0;
  if(!dbg&&nowMin>=900)return new Response(JSON.stringify({ok:true,edge:"orbfollow-broad",note:"past 15:00 ET — no NEW entries (positions need room; EOD flatten handles exits)",nowMin}),{headers:cors});
  for(let idx=0;idx<UNIVERSE.length;idx++){const sym=UNIVERSE[idx],b=bars[idx];
    if(openCount>=POS_CAP){out.push({sym,skip:"position cap"});continue;}
    if(fired.has(sym)||heldSyms.has(sym)){out.push({sym,skip:"already/held"});continue;}
    if(!b||b.length<5){out.push({sym,skip:"no bars"});continue;}
    const day=b[b.length-1].d;const rangeB=b.filter(x=>x.d===day&&x.m>=RANGE_START&&x.m<RANGE_END);const post=b.filter(x=>x.d===day&&x.m>=RANGE_END);
    if(rangeB.length<2){out.push({sym,skip:"range forming"});continue;}
    if(post.length<1){out.push({sym,skip:"pre-10:30"});continue;}
    const rH=Math.max(...rangeB.map(x=>x.h)),rL=Math.min(...rangeB.map(x=>x.l)),w=rH-rL;if(!(w>0)){out.push({sym,skip:"zero width"});continue;}
    let dir=0;for(const x of post){if(x.h>rH){dir=1;break;}if(x.l<rL){dir=-1;break;}}
    if(dir===0){out.push({sym,skip:"no break"});continue;}
    const px=post[post.length-1].c,entry=dir>0?rH:rL,stop=dir>0?rL:rH,tgt=dir>0?entry+w:entry-w;
    // CONVICTION SIZING (D-295): flex notional by MEASURED setup quality (D-271: tight range + up-break = high edge).
    const dHi=new Map<string,number>(),dLo=new Map<string,number>();
    for(const x of b){if(x.d!==day&&x.m>=RANGE_START&&x.m<RANGE_END){dHi.set(x.d,Math.max(dHi.get(x.d)??-1e18,x.h));dLo.set(x.d,Math.min(dLo.get(x.d)??1e18,x.l));}}
    const priorW=[...dHi.keys()].map(dd=>dHi.get(dd)!-dLo.get(dd)!).filter(v=>v>0).sort((a,c)=>a-c);
    const medW=priorW.length?priorW[Math.floor(priorW.length/2)]:w;
    const conv=(medW>0?(w<0.8*medW?1.5:w>1.3*medW?0.6:1.0):1.0)*(dir>0?1.2:0.85);
    const qty=Math.max(1,Math.floor((sizeN*conv*equity)/px));
    if(dbg){out.push({sym,dir:dir>0?"long":"short",qty,entry:+entry.toFixed(2),stop:+stop.toFixed(2),tgt:+tgt.toFixed(2),w:+w.toFixed(2)});openCount++;continue;}
    const order={symbol:sym,qty,side:dir>0?"buy":"sell",type:"market",time_in_force:"day",order_class:"bracket",stop_loss:{stop_price:+stop.toFixed(2)},take_profit:{limit_price:+tgt.toFixed(2)}};
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify(order)});
    if(resp.ok){await fetch(`${SB}/rest/v1/trd_trades`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edge:"orbfollow",sym,side:dir>0?"long":"short",qty,entry_px:+px.toFixed(2),status:"open"})}).catch(()=>{});openCount++;placed++;out.push({sym,dir:dir>0?"long":"short",qty,placed:true});}
    else out.push({sym,placed:false,detail:(await resp.text()).slice(0,120)});
  }
  return new Response(JSON.stringify({ok:true,edge:"orbfollow-broad",universe:UNIVERSE.length,openCount,placed,results:dbg?out.filter(o=>o.dir):out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
