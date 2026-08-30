#!/usr/bin/env -S deno run --allow-read --allow-env
// plumbing-guard.ts (D-467) — THE MACHINE GUARD for the plumbing itself. Static lint over the repo's TypeScript.
// Origin: a run of defects that were all INFRASTRUCTURE, not research — each one silently distorting recorded numbers:
//   - `limit=150` with no `order=` -> the recommended book held 150 equities that ALL began with "A" (D-466);
//   - fetch() does not throw on HTTP errors -> the trial counter 400'd on every write for its whole life while the agent
//     printed "trial counter: 0 -> N" as success, falsifying a stated non-negotiable (D-467);
//   - `.catch(()=>{})` on state writes -> five live agents could lose state with no trace;
//   - a hardcoded trial count -> a deflation bar quietly set 1,530x too low, in TWO agents (D-457/464).
// Hand-fixing found instances; this keeps the CLASSES dead. Each rule can be waived per-line with `// plumbing-ok: <why>`
// so audited exceptions are visible and reasoned, never silent.
const SELFTEST=(Deno.env.get("SELFTEST")||Deno.env.get("GUARD_SELFTEST"))==="1";   // D-586: accept BOTH names — the split (6 guards one, 5 the other) produced a silent no-op self-test that I nearly reported as a verification
// Roots resolved from THIS FILE's location, not the process cwd — invoked from infra/ by the daily runner, relative
// paths scanned NOTHING and the guard passed vacuously ("0 sites vs baseline 155"). A guard that cannot see its subject
// is worse than no guard: it certifies. Caught on its first in-agent run.
const REPO=new URL("..",import.meta.url).pathname;
const ROOTS=[`${REPO}scripts`,`${REPO}supabase/functions`];
type Hit={file:string;line:number;rule:string;snip:string};
const hits:Hit[]=[];
const OK=/plumbing-ok:/;

function lint(fileAbs:string,src:string){
  const file=fileAbs.startsWith(REPO)?fileAbs.slice(REPO.length):fileAbs;
  const lines=src.split("\n");
  for(let i=0;i<lines.length;i++){
    const L=lines[i]; if(OK.test(L)||OK.test(lines[i-1]??""))continue;
    // RULE 1 — universe-scale truncation: a PostgREST-style fetch with limit >= 50 and no order= is an ARBITRARY sample
    // (physical row order). limit<50 is exempt: those are existence checks and latest-row reads audited separately.
    const lm=L.match(/[?&]limit=(\d+)/);
    if(lm&&+lm[1]>=50&&!/[?&]order=/.test(L)&&/\$\{(OWNED|REST|SB|O)\}|rest\/v1/.test(L))
      hits.push({file,line:i+1,rule:"truncation",snip:`limit=${lm[1]} with no order= — which ${lm[1]} rows you get is an accident of row layout`});
    // RULE 2 — swallowed state write: POST/PATCH/DELETE whose failure handler discards the response. fetch() resolves on
    // HTTP 400/500, so `.catch(()=>{})` OR ignoring the response entirely means a failed write is indistinguishable from
    // a successful one. Requires visible handling: assign the response and check .ok, or print WRITE-FAILED.
    if(/method:\s*"(POST|PATCH|DELETE)"/.test(L)){
      const stmt=lines.slice(i,Math.min(lines.length,i+4)).join(" ");
      const handled=/\.ok\b|WRITE-FAILED|res\s*=|const\s+\w*[Rr]es/.test(stmt);
      const swallowed=/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(stmt);
      if(swallowed||!handled)
        hits.push({file,line:i+1,rule:"silent-write",snip:swallowed?"write with .catch(()=>{}) — a failed write leaves no trace":"write whose response is never checked — fetch() does not throw on HTTP errors"});
    }
    // RULE 3 — hardcoded deflation N: sqrt(2*ln(<literal>)) with a large literal freezes the trial count. The honest N
    // comes from the counter + baseline; a frozen small N sets the bar low forever (the 3.72-vs-5.34 bug, twice).
    const cm=L.match(/Math\.sqrt\(\s*2\s*\*\s*Math\.log\(\s*(\d[\d_]*)\s*\)/);
    if(cm&&+cm[1].replace(/_/g,"")<1_000_000)
      hits.push({file,line:i+1,rule:"frozen-ceiling",snip:`deflation ceiling from literal N=${cm[1]} — the bar is frozen below the program's real trial count`});
  }
  // RULE 4 — FUNDAMENTALS READ WITH NO POINT-IN-TIME FILTER (D-704). CLAUDE.md states look-ahead is "structurally
  // impossible ... every feature carries the effectiveDate it was legally knowable (trd_features), and the backtest
  // may only read via asOf()". `trd_features` IS EMPTY (0 rows) and its only two referencing scripts were last
  // touched 2026-06-07 and are wired into nothing. The protection is REAL but lives elsewhere: aegis-factory builds
  // an in-memory map keyed on `effective_date` and every read goes through asOf/ttm, which filter `eff <= d`.
  // So the discipline is enforced by every script CALLING IT CORRECTLY — a code-review hope, which is exactly what
  // the invariant claims it is not. This makes it mechanical: a file that loads trd_fundamentals and never mentions
  // an effective-date filter is reading the LATEST value at every historical date, which is look-ahead by default.
  // THE RULE OVER-FIRED ON ITS FIRST RUN AND WAS NARROWED, which is the correction that matters more than the rule.
  // It flagged five files and ALL FIVE were correct code: two are GUARDS that merely name the table, and three
  // (going-concern, net-share-issuance, noa-factor) use `period_end` plus an explicit LAG_D knob — "days after
  // period_end before the filing is public" — which is a DIFFERENT AND EQUALLY VALID point-in-time discipline that
  // my regex did not know about. A guard that flags correct code teaches people to waive it, and a waived guard is
  // a guard that is off. Now: only files that read a VALUE column, and any of the three known disciplines counts.
  const readsValue=/trd_fundamentals\?[^"`']*\bvalue\b|trd_fundamentals\?[^"`']*concept=/.test(src);
  const hasPIT=/effective_date|\beff\b|asOf|point.in.time|\bpit\(|period_end[\s\S]{0,4000}?(LAG|lag_d|lagD)/i.test(src);
  // RULE 5 — IGNORE-DUPLICATES WITHOUT AN on_conflict TARGET (D-714). `Prefer: resolution=ignore-duplicates` is
  // INERT unless the request names the constraint: PostgREST has nothing to resolve against and the insert 409s on
  // exactly the case the header was added to handle. Found in THREE places at once — aegis-discovery (logging a
  // WRITE-FAILED every cycle after D-681 correctly made its key idempotent), check-voltiming-survivor, and the
  // trd-edge-backtest function — plus the shared trial-ledger, whose advertised idempotency had never once been
  // exercised because every caller used a fresh runId.
  // MATCH THE HEADER, NOT PROSE. The first version matched the bare phrase and flagged trial-ledger.ts:81 — which is
  // the COMMENT EXPLAINING THIS VERY FIX. A guard that reds on its own documentation gets waived, and a waived guard
  // is off. Requiring `Prefer:` on the same line restricts it to actual requests.
  for(const m of src.matchAll(/Prefer[^\n]*resolution=ignore-duplicates/g)){
    const at=src.slice(0,m.index??0).split("\n").length;
    // D-719: the window must NOT extend past the Prefer line. on_conflict is a URL query param and in a fetch() the
    // URL is argument one, the options (with Prefer) argument two — so on_conflict ALWAYS precedes its Prefer, never
    // follows it. The old +2 forward window let the NEXT statement's on_conflict clear this write: trd-ripshort-scan
    // line 58 (no target, 409s and drops the batch) was waved through because line 60's trd_scan_cursor upsert had
    // on_conflict=id two lines below. Scan backward only, and just far enough for a reasonably-wrapped fetch call.
    const win=lines.slice(Math.max(0,at-4),at).join(" ");
    if(!/on_conflict=/.test(win))
      hits.push({file,line:at,rule:"inert-upsert",snip:"Prefer: resolution=ignore-duplicates with no on_conflict target — the header is inert and the write 409s on any legitimate re-run"});
  }
  if(/trd_fundamentals/.test(src)&&readsValue&&!hasPIT)
    hits.push({file,line:1,rule:"lookahead-risk",snip:"reads fundamental VALUES with no point-in-time discipline anywhere in the file (no effective_date, no asOf, no period_end+lag) — a historical query returning today's value is look-ahead by default"});
}
async function walk(dir:string){
  for await (const e of Deno.readDir(dir)){
    const p=`${dir}/${e.name}`;
    if(e.isDirectory) await walk(p);
    else if(e.name.endsWith(".ts")&&!e.name.endsWith("_test.ts")&&!p.endsWith("plumbing-guard.ts")) lint(p,await Deno.readTextFile(p));
  }
}
for(const r of ROOTS) await walk(r).catch(()=>{});
if(SELFTEST){
  // prove every rule fires on synthetic violations, and that plumbing-ok waives them
  // The last two lines are the D-719 inert-upsert case: w1 has NO on_conflict (must fire), and the very next line w2
  // DOES have on_conflict — with the old forward window w2's target falsely cleared w1 (the trd-ripshort-scan miss).
  // Both writes are .ok-checked so ONLY inert-upsert fires, not silent-write. w2 uses merge-duplicates so the rule's
  // regex never matches it. Expect: truncation + silent-write + frozen-ceiling + inert-upsert = 4.
  const bad=`const a=await fetch(\`\${OWNED}/trd_bars_deep?select=symbol,bars&limit=150\`,{headers:h});
await fetch(\`\${OWNED}/trd_x\`,{method:"POST",body:b}).catch(()=>{});
const ceil=Math.sqrt(2*Math.log(1000));
// plumbing-ok: audited — existence check
const c=await fetch(\`\${OWNED}/trd_y?limit=500\`,{headers:h});
const w1=await fetch(\`\${OWNED}/trd_z\`,{method:"POST",headers:{...h,Prefer:"resolution=ignore-duplicates"},body:b});if(!w1.ok)throw 0;
const w2=await fetch(\`\${OWNED}/trd_w?on_conflict=id\`,{method:"POST",headers:{...h,Prefer:"resolution=merge-duplicates"},body:b});if(!w2.ok)throw 0;`;
  const before=hits.length;
  lint("SELFTEST.ts",bad);
  console.log(`SELFTEST: ${hits.length-before} violations detected (expect 4 — the plumbing-ok line is waived):`);
  for(const h of hits.slice(before)) console.log(`  ${h.rule.padEnd(15)} ${h.snip}`);
  if(hits.length-before!==4){console.error("!! selftest mismatch");Deno.exit(2);}
  Deno.exit(1);   // selftest is a deliberate red
}
// RATCHET (the repo's own pattern — "a CI ratchet keeps unguarded-paid red"). ~150 of these sites predate the rules and
// cannot all be hand-fixed today. The baseline freezes today's count per (rule, file): the guard goes RED only when a
// file EXCEEDS its baseline or a new violating file appears, so the classes cannot GROW while the backlog burns down.
// Run with UPDATE_BASELINE=1 after genuine fixes to ratchet the recorded counts DOWN (never up without editing the file).
const BASE_PATH=new URL("./plumbing-baseline.json",import.meta.url).pathname;
const key=(h:Hit)=>`${h.rule}|${h.file}`;
const now=new Map<string,number>();
for(const h of hits) now.set(key(h),(now.get(key(h))||0)+1);
let base:Record<string,number>={};
try{ base=JSON.parse(await Deno.readTextFile(BASE_PATH)); }catch{ /* no baseline yet */ }
if(Deno.env.get("UPDATE_BASELINE")==="1"){
  await Deno.writeTextFile(BASE_PATH,JSON.stringify(Object.fromEntries([...now.entries()].sort()),null,1));
  console.log(`==> PLUMBING GUARD — baseline written: ${now.size} (rule,file) entries, ${hits.length} sites`);
  Deno.exit(0);
}
const regressions:string[]=[];
for(const [k,n] of now){ const b=base[k]??0; if(n>b) regressions.push(`${k}: ${n} vs baseline ${b}`); }
const totalBase=Object.values(base).reduce((a,b)=>a+b,0);
console.log(`==> PLUMBING GUARD — ${hits.length} site(s) vs baseline ${totalBase}; ${regressions.length} REGRESSION(S)`);
if(hits.length<totalBase) console.log(`    backlog burned down by ${totalBase-hits.length} — run UPDATE_BASELINE=1 to ratchet.`);
if(regressions.length){
  console.log(`\n  NEW violations beyond baseline:`);
  for(const r of regressions) console.log(`    ${r}`);
  const newKeys=new Set(regressions.map(r=>r.split(":")[0]));
  for(const h of hits) if(newKeys.has(key(h))) console.log(`      ${h.file}:${h.line}  [${h.rule}] ${h.snip}`);
  console.log(`\n  Fix the site or waive it with an audited \`// plumbing-ok: <reason>\`.`);
  Deno.exit(1);
}
Deno.exit(0);
