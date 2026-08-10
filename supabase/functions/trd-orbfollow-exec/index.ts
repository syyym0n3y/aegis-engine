// trd-orbfollow-exec — edge #7: opening-range BREAKOUT-FOLLOW on ETF proxies (D-262). VALIDATED on 4yr real
// Databento futures 1m: the 09:30–10:30 ET range, followed on breakout, is +0.138R vs random, holds split-half
// in BOTH halves, 23.5k trades (D-260). Proxies: SPY(≈ES) QQQ(≈NQ) DIA(≈YM) GLD(≈GC) — traded in liquid RTH.
// GEOMETRY (matches the backtest exactly): range = 09:30–10:30 ET high/low; on the first break AFTER 10:30,
// enter in the break direction; stop = OPPOSITE range extreme (risk R = range width); target = entry ± 1R.
// Fires once/day/symbol (dedup via trd_trades). Guards: killswitch OFF + arm 'paper' + risk cap + notional cap.
// Cron runs it every 30m across RTH so late breakouts are caught. NO real money — Alpaca paper only.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const SYMS=["SPY","QQQ","DIA","GLD"];
const RISK=0.005,NOTIONAL_CAP=0.10,RANGE_START=570,RANGE_END=630; // ET minutes: 09:30–10:30
interface Bar{t:number;h:number;l:number;c:number;m:number;d:string}
// Fast DST-aware ET (same arithmetic as the backtest engine — no Intl).
function etOffH(t:number):number{const d=new Date(t*1000),y=d.getUTCFullYear();
  const mar1=new Date(Date.UTC(y,2,1)).getUTCDay();const dstStart=Date.UTC(y,2,1+((7-mar1)%7)+7,7)/1000;
  const nov1=new Date(Date.UTC(y,10,1)).getUTCDay();const dstEnd=Date.UTC(y,10,1+((7-nov1)%7),6)/1000;
  return (t>=dstStart&&t<dstEnd)?-4:-5;}
function etOf(t:number){const lt=t+etOffH(t)*3600;const d=new Date(lt*1000);return{m:d.getUTCHours()*60+d.getUTCMinutes(),d:d.toISOString().slice(0,10)};}
async function bars5m(sym:string):Promise<Bar[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;const e=etOf(res.timestamp[i]);o.push({t:res.timestamp[i],h,l,c,m:e.m,d:e.d});}
  return o;}catch{return[];}}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const dbg=new URL(req.url).searchParams.get("debug")==="1";
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const out:Record<string,unknown>[]=[];
  for(const sym of SYMS){
    const b=await bars5m(sym);if(b.length<5){out.push({sym,skip:"no bars"});continue;}
    const today=b[b.length-1].d;
    const rangeBars=b.filter(x=>x.d===today&&x.m>=RANGE_START&&x.m<RANGE_END);
    const post=b.filter(x=>x.d===today&&x.m>=RANGE_END);
    if(rangeBars.length<2){out.push({sym,skip:"range not formed yet"});continue;}
    if(post.length<1){out.push({sym,skip:"before 10:30 ET"});continue;}
    const rH=Math.max(...rangeBars.map(x=>x.h)),rL=Math.min(...rangeBars.map(x=>x.l)),w=rH-rL;
    if(!(w>0)){out.push({sym,skip:"zero width"});continue;}
    // first break AFTER the range
    let dir=0;for(const x of post){if(x.h>rH){dir=1;break;}if(x.l<rL){dir=-1;break;}}
    if(dir===0){out.push({sym,rH:+rH.toFixed(2),rL:+rL.toFixed(2),skip:"no break yet"});continue;}
    // dedup: already fired an orbfollow entry for this symbol today?
    const already=await fetch(`${SB}/rest/v1/trd_trades?edge=eq.orbfollow&sym=eq.${sym}&entry_at=gte.${today}T00:00:00Z&select=id&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    if(Array.isArray(already)&&already.length){out.push({sym,skip:"already fired today"});continue;}
    // also skip if a live position exists (safety)
    const pos=await fetch(`${PAPER}/v2/positions/${sym}`,{headers:AH});if(pos.ok){out.push({sym,skip:"position exists"});continue;}
    const px=post[post.length-1].c;
    const entry=dir>0?rH:rL, stop=dir>0?rL:rH, tgt=dir>0?entry+w:entry-w;
    const qty=Math.max(1,Math.min(Math.floor((equity*RISK)/w),Math.floor((NOTIONAL_CAP*equity)/px)));
    if(dbg){out.push({sym,dir,rH:+rH.toFixed(2),rL:+rL.toFixed(2),w:+w.toFixed(2),qty,entry:+entry.toFixed(2),stop:+stop.toFixed(2),tgt:+tgt.toFixed(2),would:"ENTER"});continue;}
    const order={symbol:sym,qty,side:dir>0?"buy":"sell",type:"market",time_in_force:"day",order_class:"bracket",
      stop_loss:{stop_price:+stop.toFixed(2)},take_profit:{limit_price:+tgt.toFixed(2)}};
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify(order)});
    const txt=await resp.text();
    if(resp.ok){await fetch(`${SB}/rest/v1/trd_trades`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edge:"orbfollow",sym,side:dir>0?"long":"short",qty,entry_px:+px.toFixed(2),status:"open"})}).catch(()=>{});}
    out.push({sym,dir:dir>0?"long":"short",qty,entry:+px.toFixed(2),stop:+stop.toFixed(2),tgt:+tgt.toFixed(2),placed:resp.ok,detail:resp.ok?undefined:txt.slice(0,160)});
  }
  return new Response(JSON.stringify({ok:true,edge:"orbfollow",equity:+equity.toFixed(2),results:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
