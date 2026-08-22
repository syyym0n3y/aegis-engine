#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// agent-output-guard.ts (D-459) — THE MACHINE GUARD for the RUNNING CODE, not the record.
// Origin: D-457/458. Aegis had seven laws with seven guards, all green, and three real defects sitting in production the
// entire time — because every one of those guards inspects `trd_lineage`, the RECORD of what was concluded, and none
// inspects what the agents are actually computing and printing. The autopilot had SURFACED a false positive for nine
// cycles off a noise ceiling set 1,530x too low; positioning announced "validated edges" while its own stored note said
// neither leg was validated; discovery ranked a bankrupt strategy by its Sharpe.
// Every one of those was visible in a log file that nothing was reading. This reads them.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ag",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const DIR=Deno.env.get("AGENT_LOG_DIR")||new URL("../infra/data/",import.meta.url).pathname;
const SELFTEST=Deno.env.get("GUARD_SELFTEST")==="1";
const AGENTS=["autopilot","coverage","cryptofwd","daily","discovery","positioning"];
const MAX_STALE_H=Number(Deno.env.get("AGENT_MAX_STALE_H")||30);   // daily agents; a 24h loop plus slack

// the program's real deflation ceiling, from the live trial counter or the documented figure
const cnt=await fetch(`${OWNED}/trd_trial_counter?select=trials&order=trials.desc&limit=1`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
const TRIALS=(Array.isArray(cnt)&&cnt[0]?.trials>0)?+cnt[0].trials:1_530_000;
const CEIL=Math.sqrt(2*Math.log(TRIALS));
// is anything actually promoted? if not, no agent may speak of "validated edges"
const lin=await fetch(`${OWNED}/trd_lineage?select=id,status`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {status:string}[];
const nPromoted=Array.isArray(lin)?lin.filter(r=>["promoted","paper","micro","small","live","armed"].includes((r.status||"").toLowerCase())).length:0;

console.log(`==> AGENT OUTPUT GUARD — reading what the agents actually PRINT (ceiling ${CEIL.toFixed(2)} at N=${TRIALS.toLocaleString()}, ${nPromoted} promoted)`);
type Finding={agent:string;what:string};
const bad:Finding[]=[];
// dedupe: one distinct problem per agent, however many lines exhibit it
const push=(f:Finding)=>{ if(!bad.some(b=>b.agent===f.agent&&b.what===f.what)) bad.push(f); };
const check=(agent:string,text:string,ageH:number|null,errBytes:number)=>{
  // 1. RUIN reported as an ordinary drawdown
  for(const m of text.matchAll(/maxDD\s*(-?\d+(?:\.\d+)?)%/gi)){ const v=Math.abs(+m[1]);
    if(v>100&&!/RUINED/i.test(text)) push({agent,what:`maxDD worse than -100% — worse than -100% means equity went NEGATIVE; that is ruin, not a drawdown`}); }
  // 2. a deflation ceiling set below the program's real trial count
  for(const m of text.matchAll(/ceil=(\d+(?:\.\d+)?)/g)){ const v=+m[1];
    if(v<CEIL-0.01) push({agent,what:`noise ceiling ${v} is below the program's ${CEIL.toFixed(2)} (N=${TRIALS.toLocaleString()}) — the bar is set too low`}); }
  // 3. claiming validated edges when the ledger promotes nothing
  if(nPromoted===0&&/validated edge|decorrelated edges|verified edge/i.test(text)&&!/UNVALIDATED|NOT a validated|never a validated/i.test(text))
    push({agent,what:`claims a "validated/verified edge" while the lineage ledger promotes NOTHING`});
  // 4. staleness and 5. stderr
  if(ageH!==null&&ageH>MAX_STALE_H) push({agent,what:`log is ${ageH.toFixed(0)}h old (> ${MAX_STALE_H}h) — the agent may be wedged`});
  if(errBytes>0) push({agent,what:`stderr is non-empty (${errBytes} bytes)`});
};
for(const a of AGENTS){
  let text="",ageH:number|null=null,errB=0;
  try{ const st=await Deno.stat(`${DIR}${a}.log`); ageH=(Date.now()-(st.mtime?.getTime()??Date.now()))/3600000;
    const raw=await Deno.readTextFile(`${DIR}${a}.log`);
    // ONLY THE LATEST RUN. A first version scanned the whole tail and flagged defects that had already been fixed —
    // historical lines are a record of what WAS wrong, not what IS. Each agent prints a "==> ..." banner when it starts,
    // so everything after the LAST banner is the current run. Without this the guard can never go green after a fix,
    // which is worse than useless: a guard that cannot be satisfied gets ignored.
    const parts=raw.split(/^==> /m);
    text=parts.length>1?parts[parts.length-1]:raw.slice(-20000); }catch{ push({agent:a,what:"log file missing"}); continue; }
  try{ errB=(await Deno.stat(`${DIR}${a}.err`)).size; }catch{ /* no err file is fine */ }
  check(a,text,ageH,errB);
  const mine=bad.filter(b=>b.agent===a);
  console.log(`  ${mine.length?"RED ":"PASS"} ${a.padEnd(13)} ${ageH!==null?`${ageH.toFixed(0)}h old`.padEnd(9):"".padEnd(9)} ${mine.length?mine.map(m=>m.what).join(" | "):"output consistent"}`);
}
if(SELFTEST){
  // Prove every branch fires. Synthetic text, never written to disk.
  console.log(`\n  SELFTEST — synthetic agent output, all branches:`);
  const before=bad.length;
  check("SELFTEST","[cycle 9] best=Mom(z3.73) ceil=3.72 clearing=1 | SURFACED\n  strat maxDD -114.8%\n  the sum of two decorrelated edges",999,7);
  for(const f of bad.slice(before)) console.log(`    RED  ${f.what}`);
}
console.log(`\n  ${bad.length===0?"ALL AGENT OUTPUT CONSISTENT — no impossible values, no unsupported claims, nothing stale."
  :`${bad.length} PROBLEM(S) IN LIVE AGENT OUTPUT. A guard on the ledger does not constrain the code.`}`);
if(bad.length>0) Deno.exit(1);
