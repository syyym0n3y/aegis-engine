// trd-bblo-scanner — BROAD real-time paper scanner for the one confirmed edge, bblo (Bollinger 2σ lower-band fade
// LONG). Scans a large liquid US universe every run, fires EVERY valid signal (small 0.25% size, 30-cap, bracket
// 2ATR/−1R stop, 3R target), ranked by how far below the band (most oversold first). Parallel Alpaca fetches. This is
// the VOLUME engine to accumulate forward OOS trades fast — but same-day fires are correlated (not 30 independent
// samples for the gate). Guards: killswitch OFF + arm 'paper' ON + per-edge disable + dedup + notional cap. $0 paper.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets",DATA="https://data.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const RISK=0.0025,MAXPOS=30,NOTIONAL_CAP=0.04,BB=20,K=2,ATRN=14,STOP_ATR=2,TP=3,CONC=20;
const UNIV=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","COST","JNJ","ABBV","WMT","KO","PEP","BAC","CRM","AMD","NFLX","ADBE","CSCO","ACN","MCD","LIN","TMO","ABT","DHR","INTC","QCOM","TXN","NKE","DIS","VZ","CMCSA","PM","WFC","MS","GS","CAT","DE","BA","HON","UNP","LOW","INTU","AMAT","MU","LRCX","NOW","ISRG","BKNG","GILD","REGN","VRTX","PANW","SNPS","CDNS","ORCL","IBM","GE","F","T","PFE","MRK","XOM","CVX","COP","SLB","UPS","FDX","TGT","SBUX","BLK","C","SCHW","AXP","PYPL","UBER","SHOP","MRNA","LULU","ROKU","SNAP","ADI","KLAC","MRVL","FTNT","ADSK","WDAY","TEAM","DDOG","NET","CRWD","ZS","OKTA","PLTR","ABNB","DASH","COIN","HOOD","SQ","SOFI","AFRM","RIVN","LCID","NIO","CVNA","DKNG","MELI","SE","JD","BABA","PDD","NEE","DUK","SO","D","AEP","EXC","SRE","XEL","PEG","ED","WEC","PCG","EIX","AEE","CNP","CMS","DTE","ETR","FE","AES","LNT","NRG","PPL","EMR","ETN","ITW","PH","ROK","DOV","XYL","AME","FTV","GPC","PCAR","CMI","PWR","URI","GWW","FAST","ODFL","WM","RSG","REGN","VRTX","BIIB","AMGN","MRNA","ILMN","IDXX","IQV","MTD","WST","RMD","ALGN","DXCM","ZBH","BSX","SYK","BDX","BAX","HCA","CI","CVS","HUM","CNC","MOH","ELV","MCK","ABC","CAH","COR","DGX","LH","A","BIO","TECH","WAT","ISRG","EW","MDT","GEHC","PODD","XRAY","HOLX","STE"];
async function bars(sym:string):Promise<{c:number[],h:number[],l:number[]}|null>{try{
  const start=new Date(Date.now()-60*864e5).toISOString().slice(0,10);
  const r=await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=60`,{headers:AH});
  if(!r.ok)return null;const j=await r.json();const bs=j?.bars??[];if(bs.length<BB+ATRN)return null;
  return{c:bs.map((b:{c:number})=>b.c),h:bs.map((b:{h:number})=>b.h),l:bs.map((b:{l:number})=>b.l)};}catch{return null;}}
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const dis=await fetch(`${SB}/rest/v1/trd_edge_disable?edge=eq.bblo&select=disabled`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(dis?.[0]?.disabled)return new Response(JSON.stringify({ok:true,skipped:"bblo disabled"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const orders=await fetch(`${PAPER}/v2/orders?status=open&limit=300`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const held=new Set([...(positions as {symbol:string}[]).map(p=>p.symbol),...(Array.isArray(orders)?(orders as {symbol:string}[]).map(o=>o.symbol):[])]);
  const openLongs=(positions as {side:string}[]).filter(p=>p.side==="long").length;
  let slots=MAXPOS-openLongs;if(slots<=0)return new Response(JSON.stringify({ok:true,skipped:`cap ${openLongs}/${MAXPOS}`}),{headers:cors});
  // parallel scan: compute bblo signal + how far below band (z) for each name
  const names=[...new Set(UNIV)].filter(s=>!held.has(s));
  const cands:{sym:string,px:number,stopD:number,z:number}[]=[];
  for(let i=0;i<names.length;i+=CONC){const chunk=names.slice(i,i+CONC);
    const res=await Promise.all(chunk.map(async sym=>{const b=await bars(sym);if(!b)return null;
      const c=b.c,n=c.length;const w=c.slice(-BB);const m=w.reduce((a,x)=>a+x,0)/BB;const sd=Math.sqrt(w.reduce((a,x)=>a+(x-m)*(x-m),0)/BB);
      const last=c[n-1];const lower=m-K*sd;if(!(last<lower)||sd<=0)return null;
      let tr=0;for(let k=n-ATRN;k<n;k++)tr+=Math.max(b.h[k]-b.l[k],Math.abs(b.h[k]-c[k-1]),Math.abs(b.l[k]-c[k-1]));const atr=tr/ATRN;const stopD=STOP_ATR*atr;if(!(stopD>0))return null;
      return{sym,px:last,stopD,z:(m-last)/sd};}));
    for(const r of res)if(r)cands.push(r);}
  cands.sort((a,b)=>b.z-a.z);  // most oversold first
  const placed:string[]=[];const logRows:Record<string,unknown>[]=[];
  for(const cd of cands){if(placed.length>=slots)break;
    const qty=Math.max(1,Math.min(Math.floor((equity*RISK)/cd.stopD),Math.floor((NOTIONAL_CAP*equity)/cd.px)));
    const order={symbol:cd.sym,qty,side:"buy",type:"market",time_in_force:"day",order_class:"bracket",
      stop_loss:{stop_price:+(cd.px-cd.stopD).toFixed(2)},take_profit:{limit_price:+(cd.px+cd.stopD*TP).toFixed(2)}};
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify(order)});
    if(resp.ok){placed.push(`${cd.sym} z=${cd.z.toFixed(2)}`);logRows.push({edge:"bblo",sym:cd.sym,side:"long",qty,entry_px:cd.px,status:"open"});}
  }
  if(logRows.length)await fetch(`${SB}/rest/v1/trd_trades`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify(logRows)}).catch(()=>{});
  return new Response(JSON.stringify({ok:true,armed:true,edge:"bblo-scan",universe:names.length,fired:cands.length,openLongs,slots,placed}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
