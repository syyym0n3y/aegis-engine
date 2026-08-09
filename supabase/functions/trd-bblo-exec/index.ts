// trd-bblo-exec — Bollinger lower-band FADE LONG executor (D-244): the 5th edge, and the ONE survivor of the 24-setup
// global sweep (D-243) — robust on 16/16 major liquid markets (54–62% beat random, median +0.02..+0.13R), long-only,
// no borrow. Confirms + generalizes bbfade_lo (D-194/197). Here run at max capacity on the liquid US set (Alpaca).
// Signal: close < MA20 − 2σ(20). UNCONDITIONAL (edge is regime-independent). Same guards as the fleet: killswitch OFF
// + arm 'paper' ON + per-name dedup + 0.5% risk + 8-position cap + bracket (2ATR stop = −1R, 3R target). $0 paper.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets",DATA="https://data.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const RISK=0.005,MAXPOS=8,BB=20,K=2,ATRN=14,STOP_ATR=2,TP=3;
// liquid US large/mid-cap universe (tradeable; the edge holds market-wide, this is the executable US slice)
const UNIV=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","COST","JNJ","ABBV","WMT","KO","PEP","BAC","CRM","AMD","NFLX","ADBE","CSCO","ACN","MCD","LIN","TMO","ABT","DHR","INTC","QCOM","TXN","NKE","DIS","VZ","CMCSA","PM","WFC","MS","GS","CAT","DE","BA","HON","UNP","LOW","INTU","AMAT","MU","LRCX","NOW","ISRG","BKNG","GILD","REGN","VRTX","PANW","SNPS","CDNS","ORCL","IBM","GE","F","T","PFE","MRK","XOM","CVX","COP","SLB","UPS","FDX","TGT","SBUX","BLK","C","SCHW","AXP","PYPL","UBER","SHOP","SQ","COIN","MRNA","LULU","ROKU","DOCU","ZM","SNAP"];
interface B{h:number;l:number;c:number}
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const orders=await fetch(`${PAPER}/v2/orders?status=open&limit=200`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const held=new Set([...(positions as {symbol:string}[]).map(p=>p.symbol),...(Array.isArray(orders)?(orders as {symbol:string}[]).map(o=>o.symbol):[])]);
  const openLongs=(positions as {side:string}[]).filter(p=>p.side==="long").length;
  if(openLongs>=MAXPOS)return new Response(JSON.stringify({ok:true,skipped:`heat cap ${openLongs}/${MAXPOS} longs`}),{headers:cors});
  const start=new Date(Date.now()-260*864e5).toISOString().slice(0,10);const placed:string[]=[];let checked=0;
  for(const sym of UNIV){
    if(openLongs+placed.length>=MAXPOS)break;
    if(held.has(sym))continue;
    const br=await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=260`,{headers:AH}).then(r=>r.json()).catch(()=>null);
    const bs=br?.bars??[];if(bs.length<BB+ATRN)continue;checked++;
    const cl=bs.map((b:{c:number})=>b.c),hi=bs.map((b:{h:number})=>b.h),lo=bs.map((b:{l:number})=>b.l);
    const w=cl.slice(-BB);const m=w.reduce((a:number,x:number)=>a+x,0)/BB;const sd=Math.sqrt(w.reduce((a:number,x:number)=>a+(x-m)*(x-m),0)/BB);
    const last=cl[cl.length-1];const lower=m-K*sd;
    if(!(last<lower))continue;                                   // not below the lower band today
    let tr=0;for(let i=cl.length-ATRN;i<cl.length;i++)tr+=Math.max(hi[i]-lo[i],Math.abs(hi[i]-cl[i-1]),Math.abs(lo[i]-cl[i-1]));const atr=tr/ATRN;
    const stopD=STOP_ATR*atr;if(!(stopD>0))continue;
    const qty=Math.max(1,Math.floor((equity*RISK)/stopD));
    const order={symbol:sym,qty,side:"buy",type:"market",time_in_force:"day",order_class:"bracket",
      stop_loss:{stop_price:+(last-stopD).toFixed(2)},take_profit:{limit_price:+(last+stopD*TP).toFixed(2)}};
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify(order)});
    if(resp.ok)placed.push(`${sym} x${qty}`);
  }
  return new Response(JSON.stringify({ok:true,armed:true,edge:"bblo-long",equity:+equity.toFixed(2),openLongs,checked,placed}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
