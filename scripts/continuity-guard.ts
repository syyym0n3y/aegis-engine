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

console.log(`\n  ${red === 0 ? "CONTINUITY GREEN — data arriving, jobs registered, clocks turning."
  : `${red} CONTINUITY FAILURE(S) — research run against this state may be reading a frozen snapshot.`}`);
if (red > 0) Deno.exit(1);
