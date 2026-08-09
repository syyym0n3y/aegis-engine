// trd-pairs-exec — pairs/stat-arb executor (D-233): the 3rd uncorrelated edge (D-208, market-neutral, confound-free).
// For 24 verified same-sector pairs: spread=logA−β·logB (rolling-60d OLS), z-scored. Fade |z|>2, exit z→0 (|z|<0.5),
// stop |z|>3.5, max-hold 20 trading days. Market-NEUTRAL (long one leg / short the other) → drift confound cancelled.
// One idempotent tick does BOTH entry and exit (Alpaca has no native stop on a computed spread). Guards: killswitch
// OFF + arm 'paper' ON + per-pair dedup (durable trd_pairs_pos) + skip if a leg is held by another edge + 6-pair heat
// cap + short leg must be shortable/ETB. $0 real (Alpaca paper). Signals Yahoo; orders Alpaca equity (market hours).
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const PAIRS:[string,string][]=[["KO","PEP"],["V","MA"],["XOM","CVX"],["JPM","BAC"],["GS","MS"],["HD","LOW"],["GOOGL","META"],["MSFT","AAPL"],["NVDA","AMD"],["UPS","FDX"],["WMT","TGT"],["CAT","DE"],["T","VZ"],["COP","SLB"],["DUK","SO"],["GLD","SLV"],["XLE","XOP"],["EEM","EFA"],["QQQ","SPY"],["USO","BNO"],["WFC","C"],["ADBE","CRM"],["PFE","MRK"],["NKE","LULU"]];
const WIN=60,ZENTRY=2,ZEXIT=0.5,ZSTOP=3.5,MAXHOLD_D=28,GROSS=0.02,MAXPAIRS=6;
async function closes(sym:string):Promise<Map<string,number>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];const m=new Map<string,number>();if(!res?.timestamp)return m;const c=res.indicators.quote[0].close;for(let i=0;i<res.timestamp.length;i++){const px=c[i];if(px!=null&&Number.isFinite(px))m.set(new Date(res.timestamp[i]*1000).toISOString().slice(0,10),px);}return m;}catch{return new Map();}}
// returns {z,beta,pa,pb} at the latest aligned bar, or null
async function signal(a:string,b:string){const ma=await closes(a),mb=await closes(b);const ds=[...ma.keys()].filter(d=>mb.has(d)).sort();if(ds.length<WIN+5)return null;const la=ds.map(d=>Math.log(ma.get(d)!)),lb=ds.map(d=>Math.log(mb.get(d)!));const n=ds.length,i=n-1;let sx=0,sy=0,sxx=0,sxy=0;for(let k=i-WIN;k<i;k++){sx+=lb[k];sy+=la[k];sxx+=lb[k]*lb[k];sxy+=lb[k]*la[k];}const beta=(WIN*sxy-sx*sy)/(WIN*sxx-sx*sx||1e-9);const spr:number[]=[];for(let k=i-WIN;k<=i;k++)spr.push(la[k]-beta*lb[k]);const mean=spr.slice(0,WIN).reduce((x,y)=>x+y,0)/WIN;let v=0;for(let k=0;k<WIN;k++)v+=(spr[k]-mean)**2;const sd=Math.sqrt(v/WIN)||1e-9;const z=(spr[WIN]-mean)/sd;return{z,beta,pa:ma.get(ds[i])!,pb:mb.get(ds[i])!};}
async function shortable(sym:string){const a=await fetch(`${PAPER}/v2/assets/${sym}`,{headers:AH}).then(r=>r.json()).catch(()=>null);return!!(a?.shortable&&a?.easy_to_borrow);}
async function closeLeg(sym:string){await fetch(`${PAPER}/v2/positions/${sym}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>{});}
async function order(sym:string,qty:number,side:string){return await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:sym,qty:String(qty),side,type:"market",time_in_force:"day"})});}
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const heldSyms=new Set((positions as {symbol:string}[]).map(p=>p.symbol));
  const openRows=await fetch(`${SB}/rest/v1/trd_pairs_pos?open=eq.true&select=*`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const openByPair=new Map<string,{leg_a:string,leg_b:string,entry_date:string}>();for(const r of openRows as {pair:string,leg_a:string,leg_b:string,entry_date:string}[])openByPair.set(r.pair,r);
  const exited:string[]=[],entered:string[]=[];
  // ---- EXITS: manage open pairs on current z ----
  for(const r of openRows as {pair:string,leg_a:string,leg_b:string,entry_date:string}[]){
    const sg=await signal(r.leg_a,r.leg_b);if(!sg)continue;
    const az=Math.abs(sg.z);const heldDays=(Date.now()-new Date(r.entry_date).getTime())/864e5;
    let reason="";if(az<ZEXIT)reason="reverted z→0";else if(az>ZSTOP)reason="stop |z|>3.5";else if(heldDays>MAXHOLD_D)reason="max-hold";
    if(reason){await closeLeg(r.leg_a);await closeLeg(r.leg_b);
      await fetch(`${SB}/rest/v1/trd_pairs_pos?pair=eq.${encodeURIComponent(r.pair)}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({open:false,exit_date:new Date().toISOString(),exit_z:sg.z,exit_reason:reason})});
      exited.push(`${r.pair} (${reason})`);}
  }
  // ---- ENTRIES: open fresh pairs at |z|>2 ----
  let openCount=openByPair.size-exited.length;
  for(const[a,b]of PAIRS){
    const pair=`${a}/${b}`;
    if(openCount>=MAXPAIRS)break;
    if(openByPair.has(pair))continue;                                          // open (or just-managed) this tick — wait a tick before re-entry
    if(heldSyms.has(a)||heldSyms.has(b))continue;                              // a leg is held by another edge — skip
    const sg=await signal(a,b);if(!sg)continue;const az0=Math.abs(sg.z);if(az0<ZENTRY||az0>=ZSTOP)continue;  // enter only in the 2..3.5 band (above stop = no R:R room)
    const dir=sg.z>0?-1:1;                                                     // z>0 → spread rich → SHORT spread (short A/long B)
    const shortLeg=dir<0?a:b;if(!(await shortable(shortLeg)))continue;         // short leg must be borrowable
    const allocA=0.5*GROSS*equity;const qtyA=Math.floor(allocA/sg.pa);const qtyB=Math.floor((sg.beta*allocA)/sg.pb);
    if(qtyA<1||qtyB<1)continue;
    const oa=await order(a,qtyA,dir>0?"buy":"sell");const ob=await order(b,qtyB,dir>0?"sell":"buy");
    if(oa.ok&&ob.ok){
      await fetch(`${SB}/rest/v1/trd_pairs_pos?on_conflict=pair`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({pair,leg_a:a,leg_b:b,dir,beta:sg.beta,entry_z:sg.z,qty_a:qtyA,qty_b:qtyB,open:true,entry_date:new Date().toISOString(),exit_date:null,exit_z:null,exit_reason:null})});
      entered.push(`${pair} z=${sg.z.toFixed(2)} dir=${dir>0?"longA/shortB":"shortA/longB"}`);openCount++;
    } else {if(oa.ok)await closeLeg(a);if(ob.ok)await closeLeg(b);}            // partial fill → unwind the placed leg
  }
  return new Response(JSON.stringify({ok:true,armed:true,edge:"pairs-statarb",equity:+equity.toFixed(2),openPairs:openCount,entered,exited}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
