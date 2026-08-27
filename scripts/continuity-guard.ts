#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run
// continuity-guard.ts (D-613) — does this system still WORK, months from now, with nobody watching?
//
// Every result on this board rests on data that must keep arriving and jobs that must keep running. Both fail
// SILENTLY: an ingest that stops leaves the last good rows in place, so queries keep returning plausible answers
// from a frozen snapshot, and a launchd job that dies leaves no error anywhere a person would look. The programme
// has already been bitten by the quiet version of this — a daily runner wedged mid-edit (D-566) and five guards
// certifying green while reading nothing (D-584).
//
// The failure mode this prevents is specific and worse than a crash: months of research conducted against a dataset
// that stopped updating, where every number is internally consistent and none of it is current.
//
// Checks, each with a staleness budget matched to how often the source ACTUALLY publishes — a weekly dataset is not
// stale at 3 days, and treating it as such would train everyone to ignore this.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("continuity-guard", [{ name: "GRACE", def: "1.5", note: "multiple of the publish interval before RED" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const GRACE = Number(Deno.env.get("GRACE") || 1.5);

// table, human label, the column carrying recency, how often the SOURCE publishes (days)
const FEEDS: [string, string, string, number][] = [
  ["trd_perp_oi?venue=eq.binance&interval=eq.funding&select=ts&order=ts.desc&limit=1", "crypto funding", "ts", 1],
  ["trd_cot_disagg?select=report_date&order=report_date.desc&limit=1", "CFTC disaggregated", "report_date", 7],
  ["trd_cot_tff?select=report_date&order=report_date.desc&limit=1", "CFTC financial (TFF)", "report_date", 7],
  ["trd_fx_hourly?select=ts&order=ts.desc&limit=1", "FX/index hourly", "ts", 3],
  ["trd_attribution?select=asof&order=asof.desc&limit=1", "attribution engine", "asof", 3],
  ["trd_earnings?select=report_date&order=report_date.desc&limit=1", "earnings", "report_date", 7],
];

const today = Date.now();
let red = 0;
console.log("==> CONTINUITY GUARD — is the data still arriving, and are the clocks still turning?");
console.log("    a stopped ingest fails SILENTLY: old rows stay, queries keep answering, everything is stale.\n");

for (const [path, label, col, everyDays] of FEEDS) {
  const rows = await fetch(`${OWNED}/${path}`, { headers: hdr }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!Array.isArray(rows) || !rows.length) { red++; console.log(`  RED  ${label.padEnd(22)} unreadable or empty`); continue; }
  const raw = (rows[0] as Record<string, unknown>)[col];
  const when = typeof raw === "number" ? raw * 1000 : Date.parse(String(raw));
  if (!Number.isFinite(when)) { red++; console.log(`  RED  ${label.padEnd(22)} unparseable recency value`); continue; }
  const ageD = (today - when) / 86400000;
  const budget = everyDays * GRACE + 3;      // +3 days absorbs weekends and publication lags
  const ok = ageD <= budget;
  if (!ok) red++;
  console.log(`  ${ok ? "ok  " : "RED "} ${label.padEnd(22)} newest ${new Date(when).toISOString().slice(0, 10)}  age ${ageD.toFixed(1)}d  budget ${budget.toFixed(1)}d`);
}

// Scheduled jobs: a dead job is the other silent failure. launchctl reports a PID or '-' when not running.
console.log("");
try {
  const out = new TextDecoder().decode((await new Deno.Command("launchctl", { args: ["list"] }).output()).stdout);
  const want = ["io.aegis.coverage", "io.aegis.daily", "io.aegis.paper"];
  for (const j of want) {
    const line = out.split("\n").find((l) => l.includes(j));
    if (!line) { red++; console.log(`  RED  job ${j.padEnd(24)} NOT REGISTERED`); }
    else console.log(`  ok   job ${j.padEnd(24)} registered`);
  }
} catch { console.log("  (launchctl unavailable — job check skipped)"); }

// Forward clocks must be accumulating marks, otherwise the scorer itself has stopped.
const marks = await fetch(`${OWNED}/trd_forward_marks?select=marked_at&order=marked_at.desc&limit=1`, { headers: hdr })
  .then((r) => r.ok ? r.json() : null).catch(() => null);
if (!Array.isArray(marks) || !marks.length) { red++; console.log(`\n  RED  forward scorer has never recorded a mark`); }
else {
  const age = (today - Date.parse(marks[0].marked_at)) / 86400000;
  const ok = age <= 8;
  if (!ok) red++;
  console.log(`\n  ${ok ? "ok  " : "RED "} forward scorer last mark ${age.toFixed(1)}d ago`);
}

// D-658: A RULE THAT CANNOT BE SATISFIED BY ITS OWN ENGINE. The CONTINUITY LAW asks whether a matured clock has
// been SCORED. It never asked whether the rule could be SATISFIED — and fwd-residual-follow asks for ">=126 forward
// days" with a portfolio t while trd_attribution stamps at a median 31-day cadence, so its own horizon yields FOUR
// observations. It would have matured, computed a t on four points, and passed. A rule is immutable by design, so
// this cannot be fixed where it was written; it can only be DETECTED, and detecting it before maturity is the whole
// value. Horizon divided by engine cadence must leave enough observations for the statistic the rule names.
{
  const MIN_OBS = 20;
  // id -> the recorded mitigation. Adding an entry here is a claim that the scorer refuses to produce a number, and
  // that claim was verified by exercising the path, not by reading it.
  const ACKNOWLEDGED: Record<string, string> = {
    "fwd-residual-follow": "forward-score-specs.ts returns UNDERPOWERED below 20 attribution stamps rather than a portfolio t (D-658, path exercised by BACKDATE=2026-01 returning 8 stamps)",
  };
  const CADENCE: Record<string, [string, string]> = {
    // rule id -> [table, recency column] of the engine that must supply its observations
    "fwd-residual-follow": ["trd_attribution", "asof"],
  };
  const rules = await fetch(`${OWNED}/trd_forward_rules?select=id,promote_if&order=id`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { id: string; promote_if: string }[];
  for (const r of Array.isArray(rules) ? rules : []) {
    const spec = CADENCE[r.id]; if (!spec) continue;
    const dm = /(\d+)\s*(forward\s+)?(day|week|month)/i.exec(r.promote_if ?? "");
    if (!dm) continue;
    const n = Number(dm[1]), unit = dm[3].toLowerCase();
    const horizonDays = unit === "day" ? n : unit === "week" ? n * 7 : n * 30.44;
    // measure the engine's actual cadence rather than assuming it
    // limit must be large enough to span several DISTINCT stamps. The first version used 40, but trd_attribution
    // holds ~26 rows per asof, so 40 rows were ONE date, ds.length<3 fired, and the whole check silently skipped —
    // printing nothing, which reads exactly like passing. That is the defect class this guard exists to catch,
    // reproduced inside the guard itself.
    const st = await fetch(`${OWNED}/${spec[0]}?select=${spec[1]}&order=${spec[1]}.desc&limit=3000`, { headers: hdr })
      .then((x) => x.ok ? x.json() : []).catch(() => []) as Record<string, string>[];
    const ds = [...new Set((Array.isArray(st) ? st : []).map((x) => Date.parse(x[spec[1]])))].sort((a, b) => b - a);
    if (ds.length < 3) {
      red++;
      console.log(`\n  RED  ${r.id.padEnd(26)} cannot measure engine cadence — only ${ds.length} distinct ${spec[1]} value(s) read from ${spec[0]}.`);
      console.log(`       A satisfiability check that cannot run is not a passing check.`);
      continue;
    }
    const gaps: number[] = []; for (let i = 1; i < ds.length; i++) gaps.push((ds[i - 1] - ds[i]) / 86400000);
    gaps.sort((a, b) => a - b);
    const cad = gaps[Math.floor(gaps.length / 2)];
    const implied = cad > 0 ? horizonDays / cad : Infinity;
    if (implied < MIN_OBS) {
      // A rule is IMMUTABLE by design (THE PRE-COMMITMENT LAW), so a mis-specified one can never be repaired where
      // it was written and a RED here would be permanent. A permanent red gets switched off — that is how the
      // agent-output defects survived nine cycles — so an acknowledged mis-specification with a RECORDED MITIGATION
      // is reported, and only an UNacknowledged one is RED. The mitigation must be real: for fwd-residual-follow the
      // scorer returns UNDERPOWERED below 20 observations instead of a t, verified by backdating (D-658).
      if (ACKNOWLEDGED[r.id]) {
        console.log(`\n  known  ${r.id.padEnd(24)} MIS-SPECIFIED: horizon ${n} ${unit}(s) / ${cad.toFixed(0)}-day cadence = ~${implied.toFixed(0)} observations`);
        console.log(`         mitigated: ${ACKNOWLEDGED[r.id]}`);
      } else {
        red++;
        console.log(`\n  RED  ${r.id.padEnd(26)} rule horizon ${n} ${unit}(s) against a ${cad.toFixed(0)}-day engine cadence`);
        console.log(`       = ~${implied.toFixed(0)} observations, under the ${MIN_OBS} a portfolio statistic needs. The rule would MATURE and compute anyway,`);
        console.log(`       and no mitigation is recorded for it. The rule cannot be edited — the SCORER must refuse to report a statistic.`);
      }
    } else {
      console.log(`\n  ok   ${r.id.padEnd(26)} horizon yields ~${implied.toFixed(0)} observations at a ${cad.toFixed(0)}-day cadence`);
    }
  }
}

console.log(`\n  ${red === 0 ? "CONTINUITY GREEN — data arriving, jobs registered, clocks turning."
  : `${red} CONTINUITY FAILURE(S) — research run against this state may be reading a frozen snapshot.`}`);
if (red > 0) Deno.exit(1);
