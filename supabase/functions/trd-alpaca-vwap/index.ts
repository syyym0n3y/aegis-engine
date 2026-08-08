// trd-alpaca-vwap — test Strategy 2 (aabandzfx): anchored-VWAP SD-band MEAN-REVERSION. Pulls Alpaca free IEX 1-min,
// anchors VWAP at each session open, computes running SD band, FADES 2SD extremes (short at +2SD / long at -2SD),
// stop 2xATR, TARGET = VWAP (dynamic), exit at VWAP-touch / stop / EOD. vs matched random control (D-146). Returns
// per-symbol R arrays for long-fade and short-fade. $0, no orders.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET};
const ATRN=14,STOP_ATR=2,SD_BAND=2,MAXHOLD=60,SPREAD_BPS=2,NCTRL=2;
let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface Bar{t:string;o:number;h:number;l:number;c:number;v:number}
async function bars(sym:string,startISO:string):Promise<Bar[]>{const out:Bar[]=[];let tok="";for(let p=0;p<200;p++){const url=`https://data.alpaca.markets/v2/stocks/${sym}/bars?timeframe=1Min&start=${startISO}&feed=iex&limit=10000&adjustment=raw${tok?`&page_token=${tok}`:""}`;const r=await fetch(url,{headers:AH});if(!r.ok)break;const j=await r.json();for(const b of (j?.bars??[]))out.push({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v});tok=j?.next_page_token??"";if(!tok)break;}return out;}
function atr(b:Bar[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
 const u=new URL(req.url);const sym=(u.searchParams.get("symbol")??"GLD").toUpperCase();const years=Math.min(3,Math.max(1,Number(u.searchParams.get("years")??2)));
 const start=new Date(Date.now()-years*365*864e5).toISOString().slice(0,10);const b=await bars(sym,start);
 if(b.length<500)return new Response(JSON.stringify({sym,nbars:b.length,err:"too few"}),{headers:cors});
 const at=atr(b,ATRN);
 // session-anchored VWAP + running SD (reset each calendar day)
 const vwap=new Array(b.length).fill(NaN),sd=new Array(b.length).fill(NaN);
 let day="",cumPV=0,cumV=0,cumP2=0,n=0;
 for(let i=0;i<b.length;i++){const d=b[i].t.slice(0,10);if(d!==day){day=d;cumPV=0;cumV=0;cumP2=0;n=0;}const tp=(b[i].h+b[i].l+b[i].c)/3;cumPV+=tp*b[i].v;cumV+=b[i].v;cumP2+=b[i].v*tp*tp;n++;if(cumV>0){const vw=cumPV/cumV;vwap[i]=vw;const varr=Math.max(0,cumP2/cumV-vw*vw);sd[i]=Math.sqrt(varr);}}
 const pool:number[]=[];for(let i=ATRN+1;i<b.length-MAXHOLD-1;i++)if(at[i]>0&&sd[i]>0&&vwap[i]>0)pool.push(i);
 const sim=(i:number,dir:1|-1)=>{const stopD=STOP_ATR*at[i];if(!(stopD>b[i].c*1e-4))return null;const entry=b[i+1].o,stop=entry-dir*stopD;let g:number|null=null;
   for(let k=i+1;k<Math.min(i+1+MAXHOLD,b.length);k++){if(b[k].t.slice(0,10)!==b[i].t.slice(0,10)){g=dir*(b[k].o-entry)/stopD;break;}if(dir===1?b[k].l<=stop:b[k].h>=stop){g=-1;break;}const tgt=vwap[k];if(dir===1?b[k].h>=tgt:b[k].l<=tgt){g=Math.abs(tgt-entry)/stopD*Math.sign(dir*(tgt-entry));break;}}
   if(g===null){const last=Math.min(i+MAXHOLD,b.length-1);g=dir*(b[last].c-entry)/stopD;}
   return g-(entry*(SPREAD_BPS/10000)*2)/stopD;};
 const rs:Record<string,number[]>={short_sig:[],short_ctrl:[],long_sig:[],long_ctrl:[]};
 for(const i of pool){const up=vwap[i]+SD_BAND*sd[i],dn=vwap[i]-SD_BAND*sd[i];
   if(b[i].c>=up){const t=sim(i,-1);if(t!==null){rs.short_sig.push(+t.toFixed(4));for(let q=0;q<NCTRL;q++){const j=pool[Math.floor(rnd()*pool.length)];const rc=sim(j,-1);if(rc!==null)rs.short_ctrl.push(+rc.toFixed(4));}}}
   if(b[i].c<=dn){const t=sim(i,1);if(t!==null){rs.long_sig.push(+t.toFixed(4));for(let q=0;q<NCTRL;q++){const j=pool[Math.floor(rnd()*pool.length)];const rc=sim(j,1);if(rc!==null)rs.long_ctrl.push(+rc.toFixed(4));}}}}
 return new Response(JSON.stringify({sym,nbars:b.length,...rs}),{headers:cors});
}catch(e){return new Response(JSON.stringify({err:String(e).slice(0,200)}),{status:500,headers:cors});}});
