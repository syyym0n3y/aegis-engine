// trd-xsec-mom-exec — cross-sectional 12-1 MOMENTUM executor (D-248): the 6th edge, and the strong survivor of the
// cross-sectional sweep (D-246: NASDAQ long-short t=6.0). Monthly long-short quintile basket on the liquid US set:
// LONG the top-N 12-1 momentum names, SHORT the bottom-N (shortable). Market-neutral factor → risk control is
// diversification + neutrality + MONTHLY rebalance (not a per-name stop — the different, standard factor risk model).
// Own state (trd_xsec_pos), self-reconciling. Guards: killswitch OFF + arm 'paper' ON + skip names held by other
// edges + ~monthly cadence (rebalance only when the basket is empty or >21d old). $0 paper. Small size (1%/name).
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets",DATA="https://data.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const N_LEG=6,ALLOC=0.01,LOOK=252,SKIP=21,STALE_D=21;
const UNIV=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","COST","JNJ","ABBV","WMT","KO","PEP","BAC","CRM","AMD","NFLX","ADBE","CSCO","ACN","MCD","LIN","TMO","ABT","DHR","INTC","QCOM","TXN","NKE","DIS","VZ","CMCSA","PM","WFC","MS","GS","CAT","DE","BA","HON","UNP","LOW","INTU","AMAT","MU","LRCX","NOW","ISRG","BKNG","GILD","REGN","VRTX","PANW","SNPS","CDNS","ORCL","IBM","GE","F","T","PFE","MRK","XOM","CVX","COP","SLB","UPS","FDX","TGT","SBUX","BLK","C","SCHW","AXP","PYPL","UBER","SHOP","MRNA","LULU","ROKU","SNAP"];
async function closePos(sym:string){await fetch(`${PAPER}/v2/positions/${sym}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>{});}
async function patch(sym:string,body:Record<string,unknown>){await fetch(`${SB}/rest/v1/trd_xsec_pos?sym=eq.${sym}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify(body)}).catch(()=>{});}
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const orders=await fetch(`${PAPER}/v2/orders?status=open&limit=200`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const posSet=new Set((positions as {symbol:string}[]).map(p=>p.symbol));
  const heldSyms=new Set([...(positions as {symbol:string}[]).map(p=>p.symbol),...(Array.isArray(orders)?(orders as {symbol:string}[]).map(o=>o.symbol):[])]);
  // reconcile state: xsec rows marked open but no longer actually held (e.g. bracket/manager closed) → mark closed
  const openRows=await fetch(`${SB}/rest/v1/trd_xsec_pos?open=eq.true&select=sym,side,entry_date`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const xsecOpen=new Map<string,{side:string,entry_date:string}>();
  for(const r of openRows as {sym:string,side:string,entry_date:string}[]){if(!posSet.has(r.sym)){await patch(r.sym,{open:false,exit_date:new Date().toISOString()});}else xsecOpen.set(r.sym,{side:r.side,entry_date:r.entry_date});}
  // ~monthly cadence: if basket populated and freshest entry < STALE_D days old → HOLD
  if(xsecOpen.size>0){const freshest=Math.max(...[...xsecOpen.values()].map(v=>new Date(v.entry_date).getTime()));
    if((Date.now()-freshest)/864e5<STALE_D)return new Response(JSON.stringify({ok:true,action:"hold",basket:xsecOpen.size,ageDays:+((Date.now()-freshest)/864e5).toFixed(1)}),{headers:cors});}
  // compute 12-1 momentum for the universe
  const start=new Date(Date.now()-400*864e5).toISOString().slice(0,10);const moms:{sym:string,mom:number,px:number}[]=[];
  for(const sym of UNIV){const br=await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`,{headers:AH}).then(r=>r.json()).catch(()=>null);
    const bs=br?.bars??[];if(bs.length<LOOK+2)continue;const cl=bs.map((b:{c:number})=>b.c);const mom=cl[cl.length-1-SKIP]/cl[cl.length-1-LOOK]-1;moms.push({sym,mom,px:cl[cl.length-1]});}
  if(moms.length<2*N_LEG)return new Response(JSON.stringify({ok:true,skipped:`only ${moms.length} names with data`}),{headers:cors});
  moms.sort((a,b)=>b.mom-a.mom);
  const wantLong=moms.slice(0,N_LEG),wantShort=moms.slice(-N_LEG);
  const target=new Map<string,{side:string,px:number,mom:number}>();
  for(const m of wantLong)target.set(m.sym,{side:"long",px:m.px,mom:m.mom});
  for(const m of wantShort)target.set(m.sym,{side:"short",px:m.px,mom:m.mom});
  const exited:string[]=[],entered:string[]=[];
  // EXITS: open xsec positions not matching the new target (sym+side) → close
  for(const[sym,v]of xsecOpen){const t=target.get(sym);if(!t||t.side!==v.side){await closePos(sym);await patch(sym,{open:false,exit_date:new Date().toISOString()});exited.push(`${sym} ${v.side}`);}}
  // ENTRIES: target names not already open in the right side → open (skip if held by another edge)
  const qty=(px:number)=>Math.max(1,Math.floor((equity*ALLOC)/px));
  for(const[sym,t]of target){
    const cur=xsecOpen.get(sym);if(cur&&cur.side===t.side)continue;                 // already correct
    if(heldSyms.has(sym)&&!cur)continue;                                            // held by another edge — skip
    if(t.side==="short"){const a=await fetch(`${PAPER}/v2/assets/${sym}`,{headers:AH}).then(r=>r.json()).catch(()=>null);if(!a?.shortable||!a?.easy_to_borrow)continue;}
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:sym,qty:qty(t.px),side:t.side==="long"?"buy":"sell",type:"market",time_in_force:"day"})});
    if(resp.ok){await fetch(`${SB}/rest/v1/trd_xsec_pos?on_conflict=sym`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({sym,side:t.side,mom:+t.mom.toFixed(4),open:true,entry_date:new Date().toISOString(),exit_date:null})});entered.push(`${sym} ${t.side} x${qty(t.px)}`);}
  }
  return new Response(JSON.stringify({ok:true,armed:true,edge:"xsec-momentum",action:"rebalance",equity:+equity.toFixed(2),ranked:moms.length,exited,entered}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
