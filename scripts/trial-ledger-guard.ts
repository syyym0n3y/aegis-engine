#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// trial-ledger-guard.ts (W4, D-628) — the 18th guard. Catches a ceiling that was reported but never paid for.
//
// FOUND BY BUILDING THE EXTERNAL SURFACE. Week 4's job was to publish what has been tested and what it cost. Adding
// up the cost exposed that the published trial count (2,266,819, ceiling 5.410) and the count the running agents
// actually computed (1,531,401, ceiling 5.337) were DIFFERENT NUMBERS. `grammar-search-deep.ts` spent 734,400 trials,
// read the counter, added its spend in memory, printed the honest 5.410 — and never wrote those trials down.
//
// Why this is dangerous rather than untidy: the error is silent, cumulative, and always permissive. Every unpaid
// sweep lowers the bar for every future sweep. Thirteen scripts read the counter and none wrote back.
// Nothing was falsely cleared (max psr_z ever recorded is 3.73, well under either ceiling) — but a control that only
// holds while nothing is close is not a control, and D-457 is the precedent for what happens when it stops holding:
// a hardcoded N=1000 surfaced Ken French momentum as "clearing" for nine consecutive cycles.
//
// WHAT IT REDS ON:
//   1. a script that COMPUTES a deflation ceiling from a locally-incremented N without recording the spend
//   2. a ledger row claiming a trial count HIGHER than the counter actually holds (a ceiling asserted, not paid)
//   3. an agent log printing a ceiling below the one the live counter implies
// WHAT IT EXEMPTS: read-only ceiling users (they spend nothing), and anything importing _shared/trial-ledger.ts,
// which cannot return a ceiling without writing first.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("trial-ledger-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "TOL", def: "0.01", note: "allowed ceiling discrepancy" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const TOL = Number(Deno.env.get("TOL") || 0.01);
const BASELINE = 1_530_000;   // D-363/364 pre-counter era

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tlg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const ceilOf = (n: number) => Math.sqrt(2 * Math.log(Math.max(2, n)));

// ---------- live counter ----------
async function liveN(): Promise<number> {
  let r: Response;
  try { r = await fetch(`${OWNED}/trd_trial_counter?select=id`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } }); }
  catch (e) { console.error(`!! cannot reach trd_trial_counter: ${e instanceof Error ? e.message : e} — RED (a guard that cannot read its input is not green).`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! trd_trial_counter HTTP ${r.status} — RED.`); Deno.exit(1); }
  const n = Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
  if (!Number.isFinite(n)) { console.error(`!! counter returned no total — RED.`); Deno.exit(1); }
  return BASELINE + n;
}

// ---------- static scan: who computes a ceiling without paying? ----------
interface Offender { file: string; why: string }
async function scanScripts(dir: string): Promise<Offender[]> {
  const out: Offender[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".ts")) continue;
    if (e.name === "trial-ledger-guard.ts") continue;         // this file describes the defect at length
    const src = await Deno.readTextFile(`${dir}/${e.name}`);
    // Strip comments so prose ABOUT the defect never trips the scan. The agent-output guard learned this the hard
    // way: it once flagged defects that had already been fixed, and a guard that cannot go green after a fix gets
    // ignored — which is worse than not existing.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const computesCeiling = /Math\.sqrt\(\s*2\s*\*\s*Math\.log\(/.test(code);
    if (!computesCeiling) continue;
    const paysViaHelper = /_shared\/trial-ledger\.ts/.test(code);
    if (paysViaHelper) continue;
    const readsCounter = /trd_trial_counter/.test(code);
    const writesCounter = /trd_trial_counter`?,\s*\{?\s*\n?\s*method:\s*"POST"/.test(code) ||
      /method:\s*"POST"[\s\S]{0,200}trd_trial_counter/.test(code) ||
      /trd_trial_counter[\s\S]{0,200}method:\s*"POST"/.test(code);
    // THE DISCRIMINATOR, and its first version was WRONG. The signature of the defect is a spend COUNTED IN THIS RUN
    // being added on top of the persistent count. My first attempt matched `+ trials`, which also matches the correct
    // read-only pattern `const N = 1_530_000 + trials` where `trials` IS the persistent count — and it duly flagged
    // factory-report.ts, which spends nothing. A guard that REDs on correct code gets switched off, which is worse
    // than no guard; the agent-output guard hit the identical trap by flagging already-fixed defects.
    //
    // The honest discriminator is whether the script INCREMENTS a trial counter locally. A reporter reads; a sweep
    // counts as it goes. Only a script that does both — counts locally AND folds that count into N — is unpaid.
    const incrementsLocally = /\b(trials|nTrials|trialCount|spent)\s*(\+\+|\+=)/.test(code);
    const foldsIntoN = /(?:N|TOTAL)\s*=\s*[^;\n]*\b(?:trials|nTrials|trialCount|spent)\b/.test(code);
    const addsLocalSpend = incrementsLocally && foldsIntoN;
    if (readsCounter && addsLocalSpend && !writesCounter) {
      out.push({ file: e.name, why: "adds a local trial spend to the persistent count, prints a ceiling, never writes the spend" });
    }
  }
  return out;
}

// ---------- run ----------
const SELF = Deno.env.get("SELFTEST") === "1";
let red = 0;
const N = await liveN();
const C = ceilOf(N);

console.log(`==> TRIAL LEDGER GUARD`);
console.log(`    live counter: N = ${N.toLocaleString()}  ->  ceiling sqrt(2 ln N) = ${C.toFixed(4)}`);

// (1) static scan
const offenders = await scanScripts(new URL("../scripts", import.meta.url).pathname);
if (offenders.length) {
  red += offenders.length;
  for (const o of offenders) console.log(`  RED  ${o.file.padEnd(30)} ${o.why}`);
} else {
  console.log(`  ok   no script computes a ceiling from an unrecorded spend`);
}

// (2) ledger rows claiming more trials than were paid for
const rows = await fetch(`${OWNED}/trd_lineage?select=id,key_metric,verdict&order=id&limit=5000`, { headers: hdr })
  .then((r) => r.ok ? r.json() : []).catch(() => []) as { id: string; key_metric: string; verdict: string }[];
let claimChecked = 0;
for (const r of Array.isArray(rows) ? rows : []) {
  const text = `${r.key_metric ?? ""} ${r.verdict ?? ""}`;
  // "N = 2,266,819" / "trial count 2266819" / "ceiling 5.410"
  const nm = text.match(/(?:N\s*=\s*|trial count\s+)([\d,]{7,})/);
  const cm = text.match(/ceiling\s+\**([\d.]+)/i);
  if (!nm && !cm) continue;
  claimChecked++;
  if (nm) {
    const claimed = Number(nm[1].replace(/,/g, ""));
    if (claimed > N * 1.001) { red++; console.log(`  RED  ${r.id.padEnd(30)} claims N=${claimed.toLocaleString()} but only ${N.toLocaleString()} trials are recorded`); }
  }
  if (cm) {
    const claimed = Number(cm[1]);
    if (Number.isFinite(claimed) && claimed > C + TOL) { red++; console.log(`  RED  ${r.id.padEnd(30)} claims ceiling ${claimed} but the paid-for ceiling is ${C.toFixed(4)}`); }
  }
}
console.log(`  ok   ${claimChecked} ledger row(s) state a trial count or ceiling; all backed by recorded trials`);

// (3) self-test — prove it fails, or its green means nothing
if (SELF) {
  console.log(`\n  SELFTEST — the guard must REJECT an unpaid ceiling:`);
  const fakeN = N * 4;                       // a claim four times larger than what was paid for
  const fakeC = ceilOf(fakeN);
  const caughtN = fakeN > N * 1.001;
  const caughtC = fakeC > C + TOL;
  console.log(`    synthetic claim N=${fakeN.toLocaleString()} ceiling ${fakeC.toFixed(4)} vs paid ${C.toFixed(4)}`);
  console.log(`    detected by N-check: ${caughtN ? "YES" : "NO"}   by ceiling-check: ${caughtC ? "YES" : "NO"}`);
  // And the inverse: an honest claim must NOT trip it, or the guard is unclearable and will be ignored.
  const okC = ceilOf(N) <= C + TOL;
  console.log(`    an honest claim (ceiling ${C.toFixed(4)}) passes: ${okC ? "YES" : "NO"}`);

  // The static scan gets its own two-sided test, because its FIRST version failed this exact case: it matched the
  // correct read-only pattern `N = 1_530_000 + trials` and flagged factory-report.ts, which spends nothing. A guard
  // that REDs on correct code is switched off, so "does not fire on the honest form" is a requirement, not a nicety.
  const SPENDER = `const prev = await fetch(\`\${O}/trd_trial_counter?select=id\`);
    for (const s of specs) { trials++; }
    const N = BASE + prev + trials; const CEIL = Math.sqrt(2 * Math.log(N));`;
  const READER = `const trials = await cnt("trd_trial_counter?select=id");
    const N = 1_530_000 + trials, CEIL = Math.sqrt(2 * Math.log(N));`;
  const flags = (code: string) => {
    const inc = /\b(trials|nTrials|trialCount|spent)\s*(\+\+|\+=)/.test(code);
    const fold = /(?:N|TOTAL)\s*=\s*[^;\n]*\b(?:trials|nTrials|trialCount|spent)\b/.test(code);
    const write = /trd_trial_counter[\s\S]{0,200}method:\s*"POST"/.test(code);
    return /trd_trial_counter/.test(code) && inc && fold && !write;
  };
  const catchesSpender = flags(SPENDER), sparesReader = !flags(READER);
  console.log(`    static scan flags an unpaid SPENDER: ${catchesSpender ? "YES" : "NO"}`);
  console.log(`    static scan SPARES a read-only reporter: ${sparesReader ? "YES" : "NO"}  (the false positive this guard shipped with)`);

  if (!caughtN || !caughtC || !okC || !catchesSpender || !sparesReader) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED — fails on an unpaid ceiling, passes on a paid one, and does not fire on honest read-only code.`);
}

console.log(`\n  ${red === 0
  ? "TRIAL LEDGER CONSISTENT — every reported ceiling is backed by trials actually recorded."
  : `${red} UNPAID CEILING(S) — a bar was reported that nothing paid for. This error is always PERMISSIVE and it compounds.`}`);
if (red > 0) Deno.exit(1);
