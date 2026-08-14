// trd-crypto-exec — crypto MOMENTUM executor (D-232): Donchian-20 breakout LONG on Alpaca crypto (paper, 24/7).
// The 2nd uncorrelated edge into execution (D-205 survivorship-checked). Maximizes independent +EV bets / calendar
// coverage (D-231). Guards: killswitch OFF + arm 'paper' ON + per-name dedup + 0.5% risk + 8-position crypto cap.
// No equity-regime gate (crypto momentum is unconditional). Signals from Yahoo; orders on Alpaca. Exits via the
// position manager (killswitch-flatten + trend break). Crypto orders can't bracket, so a stop order is attached.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const RISK=0.005,MAXPOS=8,DON=20,ATRN=14,STOP_ATR=2;
// Yahoo symbol → Alpaca crypto pair (only Alpaca-supported coins)
const COINS:[string,string][]=[["BTC-USD","BTC/USD"],["ETH-USD","ETH/USD"],["SOL-USD","SOL/USD"],["AVAX-USD","AVAX/USD"],["LTC-USD","LTC/USD"],["BCH-USD","BCH/USD"],["LINK-USD","LINK/USD"],["UNI-USD","UNI/USD"],["AAVE-USD","AAVE/USD"],["DOGE-USD","DOGE/USD"],["DOT-USD","DOT/USD"]];
interface B{h:number;l:number;c:number}
async function bars(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=6mo`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){let s=0;for(let i=b.length-n;i<b.length;i++)s+=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));return s/n;}
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-crypto-exec", p_outcome: o.slice(0, 180) }),
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
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity);if(!(equity>0))throw new Error("no equity");
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const orders=await fetch(`${PAPER}/v2/orders?status=open&limit=100`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const held=new Set([...(positions as {symbol:string}[]).map(p=>p.symbol.replace("/","")),...(Array.isArray(orders)?(orders as {symbol:string}[]).map(o=>o.symbol.replace("/","")):[])]);
  const cryptoPos=(positions as {symbol:string,asset_class?:string}[]).filter(p=>p.symbol.endsWith("USD")&&p.symbol.length<=8).length;
  if(cryptoPos>=MAXPOS)return new Response(JSON.stringify({ok:true,skipped:`crypto heat cap ${cryptoPos}/${MAXPOS}`}),{headers:cors});
  const placed:string[]=[];
  for(const[ysym,pair]of COINS){
    if((cryptoPos+placed.length)>=MAXPOS)break;
    if(held.has(pair.replace("/","")))continue;
    const b=await bars(ysym);if(b.length<DON+ATRN)continue;
    const c=b[b.length-1].c;let hh=-1e18;for(let k=b.length-1-DON;k<b.length-1;k++)hh=Math.max(hh,b[k].h);
    if(!(c>hh))continue;                                   // Donchian-20 breakout LONG signal
    const a=atr(b,ATRN);const sd=STOP_ATR*a;if(!(sd>0))continue;
    const qty=+((equity*RISK)/sd).toFixed(6);if(!(qty>0))continue;
    const buy=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:pair,qty:String(qty),side:"buy",type:"market",time_in_force:"gtc"})});
    if(buy.ok){placed.push(`${pair} x${qty}`);
      // attach a protective stop (crypto has no bracket) at 2ATR below
      await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:pair,qty:String(qty),side:"sell",type:"stop",time_in_force:"gtc",stop_price:+(c-sd).toFixed(2)})}).catch(()=>{});
    }
  }
  return new Response(JSON.stringify({ok:true,armed:true,edge:"crypto-momentum",equity:+equity.toFixed(2),cryptoOpen:cryptoPos,placed}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
