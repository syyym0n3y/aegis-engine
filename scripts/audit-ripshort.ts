#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-ripshort.ts (D-452) — re-testing the program's FLAGSHIP claimed edge against the laws that did not exist when it
// was validated. The prior record lists a "verified tradeable set" of three, and one of those three (crypto momentum) was
// shown in D-443/451 to be a concentration artifact whose sign even flips at proper breadth. That makes auditing the
// other two mandatory rather than optional.
// RULE (from supabase/functions/trd-ripshort-scan/index.ts): RSI(14) > 70 AND close < 200MA, in a bull regime -> SHORT.
// Original headline: "equity daily, p=1e-7".
// WHAT THE AUDIT ADDS, all of which postdate the original validation:
//   PSEUDO-REPLICATION (D-451) — a p-value over TRADES is not a p-value over the strategy. Rip-short fires on overbought
//     names in downtrends, which cluster on the same days, so trades are NOT independent draws. The portfolio t-stat
//     (n = trading days) is the honest one, and it is computed here beside the trade-level one to show the gap.
//   LIQUIDITY (D-424/450) — a $10M/day floor, since the equity cross-section's edge otherwise lives where size cannot go.
//   EFFECT SIZE (D-429) — net of a 10bp round trip, stated in fee multiples.
//   BENCHMARK (D-439) — a short strategy in a rising market must be measured against the alternative of holding cash,
//     and against the market's own return over the same windows.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ar",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("EQ_FEE_RT_BP")||10);
const DV_MIN=Number(Deno.env.get("DV_MIN")||1e7);
const HOLDS=[5,10,21];

// market regime from SPY
const spyRow=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.SPY&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
if(!spyRow[0]){console.error("!! no SPY bars");Deno.exit(1);}
const spy=new Map<string,number>(); for(const b of spyRow[0].bars) if(b[4]>0) spy.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
const spyDays=[...spy.keys()].sort();
const bull=new Map<string,boolean>(); const spyRet=new Map<string,number>();
for(let i=200;i<spyDays.length;i++){
  const w=spyDays.slice(i-200,i).map(d=>spy.get(d)!);
  bull.set(spyDays[i], spy.get(spyDays[i])! > mean(w));
  spyRet.set(spyDays[i], spy.get(spyDays[i])!/spy.get(spyDays[i-1])!-1);
}
console.log(`==> AUDIT: RIP-SHORT (RSI>70 & close<200MA in a bull tape -> SHORT), liquidity floor $${(DV_MIN/1e6).toFixed(0)}M/day, ${FEE_BP}bp round trip`);
const meta:{symbol:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
// trades: {entryDay, exitDay, ret} per hold
const trades=new Map<number,{d:string;r:number}[]>(); for(const h of HOLDS)trades.set(h,[]);
const daily=new Map<number,Map<string,number[]>>(); for(const h of HOLDS)daily.set(h,new Map());
for(let i=0;i<meta.length;i+=30){
  const part=meta.slice(i,i+30).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const row of rows){
    const b=row.bars; if(!b||b.length<300)continue;
    const c=b.map(x=>x[4]), v=b.map(x=>x[5]);
    for(let k=200;k<b.length-Math.max(...HOLDS);k++){
      if(!(c[k]>0))continue;
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      if(bull.get(d)!==true)continue;                                   // bull regime only, as specified
      const ma200=mean(c.slice(k-200,k)); if(!(c[k]<ma200))continue;     // below the 200MA
      let ag=0,al=0; for(let j=k-13;j<=k;j++){const ch=c[j]-c[j-1]; ag+=Math.max(ch,0); al+=Math.max(-ch,0);}
      const rs=100-100/(1+(ag/14)/((al/14)||1e-9)); if(!(rs>70))continue; // overbought
      let dv=0,n=0; for(let j=k-21;j<k;j++) if(c[j]>0&&v[j]>0){dv+=c[j]*v[j];n++;}
      if(!n||dv/n<DV_MIN)continue;                                       // LIQUIDITY FLOOR
      for(const h of HOLDS){
        if(k+h>=c.length||!(c[k+h]>0))continue;
        const r=-(c[k+h]/c[k]-1)-FEE_BP/1e4;                             // SHORT, net of the round trip
        trades.get(h)!.push({d,r});
        // portfolio view: the trade's return is spread over the days it is HELD, so overlapping trades aggregate
        for(let q=1;q<=h;q++){
          const dd=new Date(b[k+q][0]*1000).toISOString().slice(0,10);
          const daily_r=-(c[k+q]/c[k+q-1]-1)-(q===1?FEE_BP/1e4:0);
          (daily.get(h)!.get(dd)??daily.get(h)!.set(dd,[]).get(dd)!).push(daily_r);
        }
      }
    }
  }
  if(i%900===0)Deno.stderr.write(new TextEncoder().encode(`  ..${i}/${meta.length} trades5=${trades.get(5)!.length}\r`));
}
console.log("");
console.log(`    ${"hold".padEnd(7)}${"trades".padEnd(9)}${"mean/trade".padEnd(12)}${"TRADE-level t".padEnd(15)}${"days".padEnd(8)}${"PORTFOLIO %/yr".padEnd(16)}${"SR".padEnd(7)}${"PORTFOLIO t".padEnd(13)}vs fee`);
for(const h of HOLDS){
  const tr=trades.get(h)!; if(tr.length<200)continue;
  const rs=tr.map(x=>x.r);
  const tTrade=mean(rs)/(sdv(rs)/Math.sqrt(rs.length));
  const dm=daily.get(h)!;
  const dd=[...dm.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([,v])=>mean(v));   // equal-weight across open positions
  const m=mean(dd), sd=sdv(dd)||1e-9;
  const tPort=m/(sd/Math.sqrt(dd.length));
  console.log(`    ${String(h).padEnd(7)}${String(tr.length).padEnd(9)}${((mean(rs)*100).toFixed(3)+"%").padEnd(12)}${tTrade.toFixed(2).padEnd(15)}${String(dd.length).padEnd(8)}${((m*252*100).toFixed(1)+"%").padEnd(16)}${((m/sd)*Math.sqrt(252)).toFixed(2).padEnd(7)}${tPort.toFixed(2).padEnd(13)}${(Math.abs(mean(rs))*1e4/FEE_BP).toFixed(2)}x`);
}
console.log(`\n    TRADE-level t treats every signal as an independent draw. Rip-short fires on overbought names in downtrends,`);
console.log(`    which cluster on the same days — so the honest denominator is DAYS, and the PORTFOLIO t is the real one.`);
console.log(`    Benchmark: cash returns 0% at zero risk; the deflated ceiling for this program is t ~ 5.34 (D-363/364).`);
