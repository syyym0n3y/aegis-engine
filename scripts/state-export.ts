#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// state-export.ts (D-973) — THE CLOUD/LOCAL BRIDGE. The engine's live state lives in the owned Postgres on the
// operator's own machine. A cloud Claude session (or any session on another device) gets the REPO, not the node —
// so without this it is blind to clocks, registrations, kill-switches and the board, and would reason from a
// DECISIONS.md that says what we concluded rather than what the machine currently holds.
//
// The sovereign-consistent fix is NOT to expose the database to the internet (that trades ownership for
// convenience and puts an attack surface on the operator's metal). It is to EXPORT a compact, read-only snapshot
// into the repo, which the daily runner already commits. Cloud reads git; the node stays closed.
//
// Honest limit, printed in the artefact itself: this is a SNAPSHOT with a timestamp, not a live view. Anything
// read from it must be treated as "as of" — the D-613 staleness discipline applied to our own convenience.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("state-export", [{ name: "OUT", def: "docs/LIVE_STATE.md" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sx", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${t}`, apikey: t });
const REPO = new URL("..", import.meta.url).pathname;
const L: string[] = [];
L.push(`# LIVE STATE — snapshot of the owned node\n`);
L.push(`> Written by \`state-export.ts\` at **${new Date().toISOString()}**. This is a SNAPSHOT, not a live view:`);
L.push(`> a session reading it off git (cloud, another device) must treat every number as "as of" that timestamp.`);
L.push(`> The node itself is never exposed — the repo is the only bridge.\n`);

// 1. kill switches + gates (what would govern any execution)
const ks = await q(`trd_kill_switch?select=account,state`) as { account: string; state: string }[];
L.push(`## Kill switches\n`);
for (const r of ks) L.push(`- \`${r.account}\`: **${r.state}**`);

// 2. forward clocks — the pending facts
const rules = await q(`trd_forward_rules?select=id,spec,clock_started&order=id`) as { id: string; spec: string; clock_started: string }[];
const marks = await q(`trd_forward_marks?select=rule_id,marked_at&order=marked_at.desc&limit=400`) as { rule_id: string; marked_at: string }[];
const lastMark = new Map<string, string>(); for (const m of marks) if (!lastMark.has(m.rule_id)) lastMark.set(m.rule_id, m.marked_at);
L.push(`\n## Forward clocks (${rules.length})\n`);
L.push(`| clock | started | last mark |`); L.push(`|---|---|---|`);
for (const r of rules) L.push(`| ${r.id} | ${r.clock_started} | ${(lastMark.get(r.id) ?? "—").slice(0, 10)} |`);

// 3. pre-registrations — decisions whose rules were written before their data
const pre = await q(`trd_prereg?select=id,outcome,registered_at&order=registered_at.desc&limit=40`) as { id: string; outcome: string | null; registered_at: string }[];
L.push(`\n## Pre-registrations (most recent 40)\n`);
L.push(`| id | outcome | registered |`); L.push(`|---|---|---|`);
for (const p of pre) L.push(`| ${p.id} | ${p.outcome ?? "_open_"} | ${p.registered_at.slice(0, 10)} |`);

// 4. gap register — what is blocked, and on whom
const gaps = await q(`trd_gap_register?select=id,status,actionable_by&order=status`) as { id: string; status: string; actionable_by: string }[];
L.push(`\n## Gap register\n`);
L.push(`| gap | status | actionable by |`); L.push(`|---|---|---|`);
for (const g of gaps) L.push(`| ${g.id} | ${g.status} | ${g.actionable_by} |`);

// 5. the board, from the runner's own log (the guard board cannot run off-node)
let board = "unknown — no guard-status.log found";
try { const log = await Deno.readTextFile(`${REPO}data/guard-status.log`); const line = log.trim().split("\n").reverse().find((l) => /guards (green|RED)/.test(l)); if (line) board = line.trim(); } catch { /* absent */ }
L.push(`\n## Guard board (last local run)\n\n\`${board}\`\n`);
L.push(`> The 32-guard board reads the owned node directly and therefore CANNOT run off-machine. Any session`);
L.push(`> without node access must not claim a green board — it can only quote this line and its timestamp.\n`);

// positive control (D-641): an export that silently read nothing must not look like a healthy empty system
if (!ks.length || !rules.length) { console.error(`!! POSITIVE CONTROL FAILED: kill-switches ${ks.length}, clocks ${rules.length} — refusing to write an empty snapshot.`); Deno.exit(1); }
await Deno.writeTextFile(`${REPO}${K.OUT}`, L.join("\n") + "\n");
console.log(`==> D-973 LIVE STATE exported -> ${K.OUT} (${ks.length} switches, ${rules.length} clocks, ${pre.length} preregs, ${gaps.length} gaps)`);
