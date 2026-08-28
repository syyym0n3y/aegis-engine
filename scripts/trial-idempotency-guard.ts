#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// trial-idempotency-guard.ts (D-681) — the 22nd guard. A CLOCK IN THE KEY DEFEATS THE UNIQUENESS THE COUNTER RESTS ON.
//
// THE DEFECT. `trd_trial_counter.run_key` is UNIQUE, and that constraint is the entire mechanism making the trial
// count idempotent: `trial-ledger.ts` (D-628) says so in its own header — "a re-run of the same sweep inserts nothing
// and the count does not inflate". `aegis-discovery.ts` bypassed that module and wrote keys of the form
// `${candidate}|${new Date().toISOString()}` directly. The clock made every key unique by construction, so a daemon
// that had recomputed six identical answers for 23 consecutive cycles also wrote 138 rows for 6 specifications.
//
// WHY IT IS WORTH A GUARD DESPITE BEING SMALL TODAY. 132 spurious trials against a live N of 2.9M moves the ceiling
// sqrt(2 ln N) by nothing measurable, and this guard says so rather than inflating the finding. What earns the guard
// is the SHAPE: an always-on daemon writing an unbounded series of keys nobody reads, where the harm is a ceiling too
// HIGH — conservative, incapable of manufacturing a false edge, and perfectly capable of killing a real one. A null
// produced by an inflated bar is evidence about the bar, not about the market.
//
// WHAT A TRIAL IS, STATED PRECISELY SO THE GUARD HAS SOMETHING TO CHECK. The deflation ceiling corrects for
// SELECTION: more distinct specifications searched means the best of them is more likely luck. Re-running one
// specification against unchanged data returns the same number and creates no new opportunity to cherry-pick. So a
// trial is a (SPECIFICATION, DATA-VERSION) pair. The same spec against materially moved data IS a fresh trial.
//
// WHAT THIS GUARD DOES NOT COVER, STATED RATHER THAN IMPLIED. A re-run keyed on a monotonically increasing INTEGER is
// indistinguishable from a genuine sweep enumerating its specifications — `backfill|grammar-search-deep|D-588|681605`
// is a real trial and `run|17` might not be, and no inspection of values can separate them. A guard that implied
// coverage it does not have would be the defect it exists to catch (the D-671 lesson). Only CLOCKS are detected here,
// in both the source and the stored keys.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("trial-idempotency-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "SRC_DIRS", def: "scripts,supabase/functions", note: "trees searched for direct counter writes" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tig", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// A clock rendered into a string: ISO-8601, or a 13-digit millisecond epoch.
const CLOCK_VALUE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|(^|[|_-])1[0-9]{12}([|_-]|$)/;
// A clock CALL inside a template literal assigned to run_key.
const CLOCK_SOURCE = /new Date\(\)\.toISOString\(\)|Date\.now\(\)/;

let red = 0;
console.log(`==> TRIAL IDEMPOTENCY GUARD — a clock in the key defeats the uniqueness the counter rests on`);

// ---------------------------------------------------------------------------
// 1. THE RUNNING CODE. Ten scripts write trd_trial_counter directly and two use
//    the shared idempotent ledger; inspecting only the ledger would have missed
//    this entirely — the D-586 lesson, which is why this half exists at all.
// ---------------------------------------------------------------------------
const dirs = (Deno.env.get("SRC_DIRS") || "scripts,supabase/functions").split(",");
const files: string[] = [];
async function walk(d: string) {
  try {
    for await (const e of Deno.readDir(d)) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.name.endsWith(".ts")) files.push(p);
    }
  } catch { /* a missing tree is reported below by the zero-file check */ }
}
for (const d of dirs) await walk(d);
if (!files.length) { console.error(`!! no source files found under ${dirs.join(", ")} — a guard that reads nothing is not green. RED.`); Deno.exit(1); }

let writers = 0, viaLedger = 0;
for (const f of files) {
  const src = await Deno.readTextFile(f);
  if (f.endsWith("trial-ledger.ts") || f.endsWith("trial-idempotency-guard.ts") || f.endsWith("trial-ledger-guard.ts")) continue;
  // Counted first and independently: a file that imports the shared ledger never names the table, so testing for the
  // table name before the import would report "0 using the ledger" while two scripts do. A guard whose census line is
  // wrong teaches the reader to discount its other lines.
  if (src.includes("trial-ledger.ts")) { viaLedger++; continue; }
  if (!src.includes("trd_trial_counter")) continue;
  // Only the run_key assignments matter — a timestamp elsewhere in the file (counted_at, a log line) is fine.
  const keys = [...src.matchAll(/run_key\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)].map((m) => m[1]);
  if (!keys.length) continue;
  writers++;
  const bad = keys.filter((k) => CLOCK_SOURCE.test(k));
  // A key interpolating a local variable that holds a clock: catch the common `const cyc = new Date()...` shape.
  const viaVar = keys.filter((k) => {
    const vars = [...k.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
    return vars.some((v) => new RegExp(`(const|let)\\s+${v}\\s*=\\s*[^;]*(toISOString\\(\\)|Date\\.now\\(\\))`).test(src));
  });
  const hits = [...new Set([...bad, ...viaVar])];
  if (hits.length) { red++; console.log(`  RED  ${f} — run_key embeds a clock: ${hits.join(" ")}`); }
}
console.log(`  --   ${writers} direct counter-writer(s) inspected, ${viaLedger} using the shared idempotent ledger`);

// ---------------------------------------------------------------------------
// 2. THE STORED KEYS. The source check catches the bug going forward; this
//    catches keys already written, including by code since deleted.
// ---------------------------------------------------------------------------
async function q(path: string) {
  let r: Response;
  try { r = await fetch(`${OWNED}/${path}`, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach trd_trial_counter: ${e instanceof Error ? e.message : e} — RED (a guard that cannot read its input is not green).`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! trd_trial_counter HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! trd_trial_counter returned no rows — RED.`); Deno.exit(1); }
  return j as { family: string; run_key: string }[];
}
// Newest first: a clock-keyed daemon writes continuously, so recent history is where it shows.
const recent = await q(`trd_trial_counter?select=family,run_key,counted_at&order=counted_at.desc&limit=5000`);
if (!recent.length) { console.error(`!! trd_trial_counter is EMPTY — the counter that gates every deflation ceiling has no rows. RED.`); Deno.exit(1); }

// ADOPTION BOUNDARY. The 18 legacy clock keys cannot be removed: trd_trial_counter is append-only EVIDENCE, and
// deleting rows to turn a guard green would lower the ceiling every past conclusion was measured against — a far
// worse act than the defect. But leaving them RED forever makes this guard un-greenable, and a guard that cannot go
// green after its fix gets switched off (the agent-output-guard lesson, D-586). So post-adoption keys turn it RED
// and the legacy backlog is REPORTED every run, never amnestied — the pattern benchmark- and turnover-guard settled.
// A CALENDAR BOUNDARY WOULD NOT WORK HERE, and trying it is how the rule was found: every one of the 5,000 most
// recent keys — legacy clock keys included — was written TODAY, so "on or after 2026-08-28" separated nothing. The
// question is not WHEN a bad key was written but whether the writer is STILL WRITING THEM.
//
// A FIXED GRACE WINDOW WAS THE SECOND WRONG ANSWER, and it was wrong in a way worth recording. It read: a clock key
// inside the last 6h means the writer is live. But `aegis-discovery` — the writer this guard was built for — sleeps
// SIX HOURS between cycles. A window equal to the writer's own period lets the guard flicker green in the gap
// between two broken cycles, which is worse than a stable red because it looks like a fix. Any threshold tuned to a
// cadence breaks when the cadence changes, and nothing tells you it broke.
//
// THE PERIOD-INDEPENDENT RULE: a family is RED if its NEWEST key contains a clock. That asks exactly the right
// question — "is the most recent thing this writer did still broken?" — and it cannot be gamed by waiting, by a
// cadence change, or by a daemon that sleeps longer than any window someone picked.
const at = (r: unknown) => Date.parse(String((r as { counted_at: string }).counted_at ?? "")) || 0;
const newestByFam = new Map<string, { run_key: string; t: number }>();
for (const r of recent) {
  const f = r.family ?? "?", t = at(r);
  const cur = newestByFam.get(f);
  if (!cur || t > cur.t) newestByFam.set(f, { run_key: r.run_key, t });
}
const liveFams = new Set([...newestByFam].filter(([, v]) => CLOCK_VALUE.test(v.run_key)).map(([f]) => f));
const clockRows = recent.filter((r) => CLOCK_VALUE.test(r.run_key));
const live = clockRows.filter((r) => liveFams.has(r.family ?? "?"));
const legacy = clockRows.filter((r) => !liveFams.has(r.family ?? "?"));
if (legacy.length) {
  console.log(`  BACKLOG NOT AMNESTIED: ${legacy.length} clock key(s) remain in the counter from writers since fixed.`);
  console.log(`       Left in place deliberately — the counter is append-only EVIDENCE, and deleting rows to turn a`);
  console.log(`       guard green would lower the ceiling every past conclusion was already measured against.`);
}
const post = live;

const byFam = new Map<string, { rows: number; clock: number; specs: Set<string> }>();
for (const r of post) {
  const f = r.family ?? "?";
  const e = byFam.get(f) ?? { rows: 0, clock: 0, specs: new Set<string>() };
  e.rows++;
  if (CLOCK_VALUE.test(r.run_key)) e.clock++;
  e.specs.add(r.run_key.split("|")[0]);
  byFam.set(f, e);
}
console.log(`  --   ${recent.length} most recent key(s) read; ${post.length} clock key(s) from writers whose NEWEST key still carries one, across ${byFam.size} famil(ies) are in scope`);
for (const [f, e] of [...byFam.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  if (e.clock === 0) { console.log(`  ok   ${f.padEnd(18)} ${String(e.rows).padStart(5)} keys, ${String(e.specs.size).padStart(5)} distinct prefixes, no clock`); continue; }
  red++;
  console.log(`  RED  ${f.padEnd(18)} ${e.clock} of ${e.rows} key(s) contain a timestamp — ${e.rows} rows for ${e.specs.size} distinct prefix(es).`);
  console.log(`       Each re-test of an unchanged spec against unchanged data was counted as a fresh trial.`);
}

// ---------------------------------------------------------------------------
if (Deno.env.get("SELFTEST") === "1") {
  console.log(`\n  SELFTEST:`);
  const srcBad = 'const rows = results.map((r) => ({ run_key: `${r.candidate}|${new Date().toISOString()}` }));';
  const srcVar = 'const cyc = new Date().toISOString();\nconst rows = [{ run_key: `${r.candidate}|${cyc}` }];';
  const srcGood = 'const rows = [{ run_key: `${r.candidate}|${fp}` }];\nconst fp = dv.join(",");';
  const kBad = "base_composite|2026-08-28T18:22:46.785Z";
  const kEpoch = "voltiming-adversarial|1756400000000";
  const kGood = "backfill|grammar-search-deep|D-588|681605";
  const kFp = "base_composite|trd_bars_deep:57000000,trd_fundamentals:1200000";
  const keysOf = (s: string) => [...s.matchAll(/run_key\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)].map((m) => m[1]);
  const varHit = (s: string) => keysOf(s).some((k) => [...k.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1])
    .some((v) => new RegExp(`(const|let)\\s+${v}\\s*=\\s*[^;]*(toISOString\\(\\)|Date\\.now\\(\\))`).test(s)));
  const c1 = keysOf(srcBad).some((k) => CLOCK_SOURCE.test(k));
  const c2 = varHit(srcVar);
  const c3 = !keysOf(srcGood).some((k) => CLOCK_SOURCE.test(k)) && !varHit(srcGood);
  const c4 = CLOCK_VALUE.test(kBad);
  const c5 = CLOCK_VALUE.test(kEpoch);
  const c6 = !CLOCK_VALUE.test(kGood);
  const c7 = !CLOCK_VALUE.test(kFp);
  console.log(`    flags an inline new Date().toISOString() in a key ... ${c1 ? "YES" : "NO"}`);
  console.log(`    flags a key interpolating a clock-valued variable ... ${c2 ? "YES" : "NO"}  (the literal D-681 shape)`);
  console.log(`    passes a key built from a data fingerprint ......... ${c3 ? "YES" : "NO"}`);
  console.log(`    flags a stored ISO timestamp ...................... ${c4 ? "YES" : "NO"}`);
  console.log(`    flags a stored ms-epoch ........................... ${c5 ? "YES" : "NO"}`);
  console.log(`    passes a genuine sweep index ...................... ${c6 ? "YES" : "NO"}  (must not drag in grammar-deep)`);
  console.log(`    passes a stored data-fingerprint key .............. ${c7 ? "YES" : "NO"}`);
  // THE NEWEST-KEY RULE ITSELF, tested rather than assumed. It replaced a fixed grace window that the writer's own
  // 6-hour sleep would have let flicker green, and a replacement rule with no test is exactly what that was.
  const newestOf = (rs: { family: string; run_key: string; counted_at: string }[]) => {
    const m = new Map<string, { run_key: string; t: number }>();
    for (const r of rs) { const t = Date.parse(r.counted_at) || 0; const c = m.get(r.family); if (!c || t > c.t) m.set(r.family, { run_key: r.run_key, t }); }
    return new Set([...m].filter(([, v]) => CLOCK_VALUE.test(v.run_key)).map(([f]) => f));
  };
  const fixed = [
    { family: "base", run_key: "x|2026-08-28T18:22:46.785Z", counted_at: "2026-08-28T18:22:46Z" },
    { family: "base", run_key: "x|trd_bars_deep:4350", counted_at: "2026-08-28T20:04:31Z" },   // newer, clean
  ];
  const stillBroken = [
    { family: "base", run_key: "x|trd_bars_deep:4350", counted_at: "2026-08-28T18:22:46Z" },
    { family: "base", run_key: "x|2026-08-28T20:04:31.000Z", counted_at: "2026-08-28T20:04:31Z" }, // newer, clock
  ];
  const c8 = newestOf(fixed).size === 0;
  const c9 = newestOf(stillBroken).has("base");
  console.log(`    newest-key rule: passes a writer since FIXED ...... ${c8 ? "YES" : "NO"}  (older clock key is backlog)`);
  console.log(`    newest-key rule: reds a writer STILL broken ....... ${c9 ? "YES" : "NO"}  (period-independent, no window)`);
  if (!(c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8 && c9)) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED.`);
}

console.log(`\n  ${red === 0
  ? `TRIAL COUNTER IDEMPOTENT — no clock in any run_key, in source or in stored keys.`
  : `${red} IDEMPOTENCY DEFECT(S) — a re-test of an unchanged spec is being counted as a fresh trial, inflating the ceiling every other result must clear.`}`);
if (red > 0) Deno.exit(1);
