// trd-vrp-exec — VRP / short-vol executor (D-234): the 4th edge, via a BOUNDED-RISK PROXY (long SVXY), NOT naked
// short options. HONESTY LABEL: D-207 measured VRP on the CBOE ^PUT/^BXM indices (untradeable); selling options
// would be unbounded-loss short vol and breaks the 1R-stop invariant. Long SVXY floors at 0 → a 2×ATR/1R stop is
// real. It is a PROXY: SVXY's roll/decay is not identical to the measured put-write edge — deployed labelled as such.
// Timing rule (standard short-vol carry + D-210 term structure): be long SVXY only when VIX curve is in CONTANGO
// (VIX3M>VIX, premium is paid) AND VIX not spiking (<30). EXIT on backwardation (VIX>VIX3M) or VIX>35 = vol stress.
// One idempotent tick = entry + thesis-exit. Guards: killswitch OFF + arm 'paper' + dedup + 1-unit cap. $0 real.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const SYM="SVXY",RISK=0.005,ATRN=14,STOP_ATR=2,VIX_SPIKE=30,VIX_EXIT=35;
interface B{h:number;l:number;c:number}
async function bars(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=6mo`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}return o;}catch{return[];}}
async function lastClose(sym:string):Promise<number|null>{const b=await bars(sym);return b.length?b[b.length-1].c:null;}
function atr(b:B[],n:number){let s=0;for(let i=b.length-n;i<b.length;i++)s+=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));return s/n;}
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-vrp-exec", p_outcome: o.slice(0, 180) }),
  }).catch(() => {});
const SERVE = (h: (r: Request) => Response | Promise<Response>) =>
  Deno.serve(async (r: Request) => {
    let res: Response;
    try { res = await h(r); } catch (e) { await __beat("THREW " + String(e).slice(0, 150)); throw e; }
    let body = "";
    try { body = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch { /* unreadable body */ }
    await __beat(`${res.status} ${body}`);
    return res;
  });

SERVE(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const vix=await lastClose("^VIX"),vix3m=await lastClose("^VIX3M");if(vix==null||vix3m==null)throw new Error("no VIX data");
  const contango=vix3m>vix;const ratio=+(vix3m/vix).toFixed(3);
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const held=(positions as {symbol:string}[]).some(p=>p.symbol===SYM);
  // THESIS EXIT: hold short-vol only while curve is in contango and vol calm
  if(held&&(!contango||vix>VIX_EXIT)){
    await fetch(`${PAPER}/v2/positions/${SYM}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>{});
    return new Response(JSON.stringify({ok:true,armed:true,edge:"vrp-shortvol-proxy",action:"EXIT",reason:contango?`VIX ${vix}>${VIX_EXIT}`:"backwardation (vol stress)",vix,vix3m,ratio}),{headers:cors});
  }
  if(held)return new Response(JSON.stringify({ok:true,armed:true,edge:"vrp-shortvol-proxy",action:"hold",vix,vix3m,ratio}),{headers:cors});
  // ENTRY: contango + not spiking
  if(!contango||vix>=VIX_SPIKE)return new Response(JSON.stringify({ok:true,armed:true,edge:"vrp-shortvol-proxy",action:"flat",reason:!contango?"backwardation — no short-vol":`VIX ${vix}>=${VIX_SPIKE} spike`,vix,vix3m,ratio}),{headers:cors});
  const b=await bars(SYM);if(b.length<ATRN+1)throw new Error("no SVXY bars");
  const px=b[b.length-1].c,a=atr(b,ATRN),sd=STOP_ATR*a;if(!(sd>0))throw new Error("bad atr");
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const NOTIONAL_CAP=0.05;  // no single position > 5% equity notional (risk-based sizing balloons notional on low-vol names)
  const qty=Math.max(1,Math.min(Math.floor((equity*RISK)/sd),Math.floor((NOTIONAL_CAP*equity)/px)));
  const order={symbol:SYM,qty,side:"buy",type:"market",time_in_force:"day",order_class:"bracket",
    stop_loss:{stop_price:+(px-sd).toFixed(2)},take_profit:{limit_price:+(px+sd*6).toFixed(2)}};  // 1R stop; far TP (carry runs, thesis-exit is primary)
  const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify(order)});
  const txt=await resp.text();
  return new Response(JSON.stringify({ok:resp.ok,armed:true,edge:"vrp-shortvol-proxy",action:resp.ok?"ENTER":"reject",qty,px,stop:+(px-sd).toFixed(2),vix,vix3m,ratio,detail:resp.ok?undefined:txt.slice(0,200)}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
