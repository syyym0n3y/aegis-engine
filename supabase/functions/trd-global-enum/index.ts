// trd-global-enum — enumerate the ENTIRE global equity universe (D-239) from the Adanos free-ticker-database
// (63k securities, 81 exchanges, no key). mode=exchanges → dry-run histogram of exchange codes (to build the Yahoo
// suffix map). mode=populate&offset=&limit= → map exchange→Yahoo symbol + FX, upsert into trd_global_universe
// (resumable/idempotent). Deno fetch reaches raw.githubusercontent.com + Yahoo directly. NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const CSV="https://raw.githubusercontent.com/adanos-software/free-ticker-database/main/data/tickers.csv";
// Adanos exchange code -> Yahoo suffix (""=US no suffix). Filled after the dry-run histogram.
const SUFFIX:Record<string,string>={
  NASDAQ:"",NYSE:"",AMEX:"","NYSE American":"","NYSE MKT":"","NYSE Arca":"","OTC":"",
  LSE:".L",TSX:".TO",TSXV:".V",ASX:".AX",XETRA:".DE",FSX:".F",
  HKEX:".HK",SZSE:".SZ",SSE:".SS",TSE:".T",JPX:".T",KRX:".KS",KOSDAQ:".KQ",
  NSE_IN:".NS",BSE_IN:".BO",TWSE:".TW",TPEX:".TWO",SIX:".SW",Bursa:".KL",SGX:".SI",
  SET:".BK",BK:".BK",IDX:".JK","Borsa Italiana":".MI",BME:".MC",Euronext:".PA",
  STO:".ST",OSL:".OL",JSE:".JO",TASE:".TA",B3:".SA",BMV:".MX",BIST:".IS",WSE:".WA",
  HEL:".HE",CPH:".CO",AMS:".AS",ATHEX:".AT",TADAWUL:".SR",EGX:".CA",PSE:".PS",
  SSE_CL:".SN",HOSE:".VN",PSX:".KA",
};
function parseCSVLine(l:string):string[]{const o:string[]=[];let cur="",q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){q=!q;}else if(c===","&&!q){o.push(cur);cur="";}else cur+=c;}o.push(cur);return o;}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const mode=u.searchParams.get("mode")||"exchanges";
  const txt=await fetch(CSV,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.text());
  const lines=txt.split("\n");const header=parseCSVLine(lines[0]);
  const ci=(n:string)=>header.indexOf(n);
  const iT=ci("ticker"),iE=ci("exchange"),iA=ci("asset_type"),iC=ci("country"),iCC=ci("country_code");
  if(mode==="exchanges"){
    const hist:Record<string,number>={};let stocks=0;const unmapped:Record<string,number>={};
    for(let k=1;k<lines.length;k++){const r=parseCSVLine(lines[k]);if(r.length<iCC+1)continue;if(r[iA]!=="Stock")continue;stocks++;const ex=r[iE];hist[ex]=(hist[ex]||0)+1;if(!(ex in SUFFIX))unmapped[ex]=(unmapped[ex]||0)+1;}
    const sorted=Object.entries(hist).sort((a,b)=>b[1]-a[1]);
    const mappedCount=sorted.filter(([e])=>e in SUFFIX).reduce((a,[,c])=>a+c,0);
    return new Response(JSON.stringify({ok:true,totalRows:lines.length-1,stocks,distinctExchanges:sorted.length,mappedStocks:mappedCount,exchanges:sorted,unmapped:Object.entries(unmapped).sort((a,b)=>b[1]-a[1])},null,2),{headers:cors});
  }
  if(mode==="populate"){
    const offset=+(u.searchParams.get("offset")||"0"),limit=+(u.searchParams.get("limit")||"2000");
    const rows:Record<string,unknown>[]=[];let scanned=0,i=1+offset;
    for(;i<lines.length&&scanned<limit;i++){scanned++;const r=parseCSVLine(lines[i]);if(r.length<iCC+1)continue;if(r[iA]!=="Stock")continue;const ex=r[iE];if(!(ex in SUFFIX))continue;const suf=SUFFIX[ex];let t=r[iT];if(ex==="HKEX")t=t.replace(/^0+/,"").padStart(4,"0");const ysym=t+suf;
      rows.push({yahoo_sym:ysym,ticker:r[iT],exchange:ex,country:r[iC],country_code:r[iCC]});}
    if(rows.length)await fetch(`${SB}/rest/v1/trd_global_universe?on_conflict=yahoo_sym`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
    const done=i>=lines.length;
    return new Response(JSON.stringify({ok:true,offset,scanned,inserted:rows.length,nextOffset:offset+scanned,done}),{headers:cors});
  }
  return new Response(JSON.stringify({ok:false,err:"mode=exchanges|populate"}),{status:400,headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
