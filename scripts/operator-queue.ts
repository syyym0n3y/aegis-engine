#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
// operator-queue.ts (D-854b) — the one page the operator reads instead of prompting a session.
//
// Regenerated at the end of every daily cycle: what is red, what only the operator can move (D-823's four things:
// position, ledger row, gate, clock), the exact command for each, and the state of every feed and clock. The
// standing instruction "keep going and don't stop" is a request for this page to exist — a session that has to be
// prompted to find out what is next is the bottleneck this file removes.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("operator-queue", [{ name: "OUT", def: "docs/OPERATOR_QUEUE.md" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "oq", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
const base = new URL("..", import.meta.url).pathname;
async function sh(cmd: string[]): Promise<{ code: number; out: string }> { try { const p = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "piped", cwd: base }); const o = await p.output(); return { code: o.code, out: new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr) }; } catch (e) { return { code: -1, out: String(e) }; } }
const read = async (f: string) => { try { return await Deno.readTextFile(`${base}${f}`); } catch { return ""; } };

// Reads the board's LOGGED output (the runner writes data/guard-status.log right before this runs) rather than
// re-running 31 guards: the first version re-ran the board inside itself and blew a two-minute budget.
let boardTxt = "", boardAge = "never";
try { boardTxt = await Deno.readTextFile(`${base}data/guard-status.log`); const st = await Deno.stat(`${base}data/guard-status.log`); boardAge = st.mtime ? `${((Date.now() - st.mtime.getTime()) / 3600000).toFixed(1)}h ago` : "unknown"; } catch { boardTxt = ""; }
const boardLines = boardTxt.split("\n").filter((l) => /^\s{2}(GREEN|RED)\s+[a-z][\w-]*\s/.test(l));   // guard lines only, not an indented detail line
const reds = boardLines.filter((l) => /^\s+RED/.test(l));
const marks = await q(`trd_forward_marks?select=rule_id,metric_name,metric_value,n_obs,note,marked_at&order=marked_at.desc&limit=400`) as { rule_id: string; metric_name: string; metric_value: number | null; n_obs: number; note: string; marked_at: string }[];
const latest = new Map<string, typeof marks[number]>(); for (const m of marks) if (!latest.has(m.rule_id)) latest.set(m.rule_id, m);
const rules = await q(`trd_forward_rules?select=id,clock_started,promote_if,kill_if&order=id`) as { id: string; clock_started: string; promote_if: string; kill_if: string }[];
const trades = await q(`trd_manual_trades?select=id&limit=1`) as unknown[];
const ks = await q(`trd_kill_switch?select=*&limit=5`) as Record<string, unknown>[];
const sheet = await read("data/micro-sheet.log"); const fx = await read("data/micro-fx-live.log");
const sheetLine = (sheet.match(/\d+ candidate\(s\); \d+ instrument\(s\) STALE; \d+ instruments live/) ?? ["(sheet not run)"])[0];
const fxLine = (fx.match(/(\d+)\/(\d+) fresh within 3h/) ?? ["(refresh not run)"])[0];
const now = new Date().toISOString().slice(0, 16) + "Z";

const L: string[] = [];
L.push(`# OPERATOR QUEUE — regenerated ${now} (D-854)\n`);
L.push(`> The one page to read. Everything a session could move on its own has been moved; what is listed under **Yours** cannot be done by Claude (accounts, deposits, fills, a support ticket) and is the whole of what stands between this record and its first real fill. Regenerated at the end of every daily cycle by \`scripts/operator-queue.ts\`.\n`);
L.push(`## Board — ${boardLines.length ? (reds.length ? `**${reds.length} RED**` : "all green") : "**NOT LOGGED** — data/guard-status.log missing; run `bash scripts/guard-status.sh > data/guard-status.log`"} (${boardLines.length} guards, board logged ${boardAge})`);
if (reds.length) for (const r of reds) L.push(`- ${r.trim()}`); else L.push(`- nothing to fix. A red here that persists two cycles is the one time a session is worth starting; the guard's own output names the fix.`);
L.push(`\n## Micro rung — live feed and sheet`);
L.push(`- hourly FX/index feed: **${fxLine}** · sheet: **${sheetLine}** · manual fills recorded: **${trades.length ? "yes" : "0"}** · kill-switch rows: ${ks.length}`);
L.push(`- the sheet prints candidates only on fresh bars; a STALE instrument prints no candidate by design.\n`);
L.push(`## Yours — in evidence order, each with its exact act`);
L.push(`1. **Broker ticket (gates D-751 odd-lot tenders, the only measured capacity-inverted mechanism):** ask IBKR support one question — *"When I submit a voluntary tender election through Corporate Action Manager on a holding under 100 shares, is the odd-lot certification transmitted to the tender agent?"* Yes/No. Record the answer with \`ADD=1 REASON="broker: <answer>" deno run --allow-net --allow-env scripts/micro-ledger.ts\` or paste it into DECISIONS.md under D-839.`);
L.push(`2. **The reachable sign-up set (D-851, ~£150–£400 once, non-compounding):** IG (£500 deposit → £50–£1,000 bonus shares, hold to 31 Dec 2026), Trading 212 (£1 → free share), InvestEngine (£100 → £20–£100, 12-month hold), Freetrade (£50 → £10–£100). Each is one per person and a one-off. Claude never opens or funds an account; if you do, note each in the wealth ledger.`);
L.push(`3. **First hand-placed fill:** set the budget and arm — \`MICRO_BUDGET=<£> ARM=1 REASON="first fill" deno run --allow-net --allow-env scripts/micro-ledger.ts\` — then read \`data/micro-sheet.log\` at :05 past the hour and place only what it prints as a candidate. Record every fill with \`ADD=1\`. Thirty fills is an OPERATIONAL review, never an expectancy test (D-832).`);
L.push(`4. **Three wealth-ledger rows (D-735/746/758):** deposits × wrapper are the certain money and are unlogged because they are boring.`);
L.push(`5. **File every settlement notice on any US-listed position you ever hold (D-852):** 75% of eligible investors never do; it is free money with a deadline, not a mechanism.\n`);
L.push(`## Forward clocks — ${rules.length} registered, none may be re-mined`);
L.push(`| clock | started | latest reading | n | note |\n|---|---|---|---|---|`);
for (const r of rules) { const m = latest.get(r.id); L.push(`| ${r.id} | ${r.clock_started} | ${m ? (m.metric_value === null ? (m.metric_name === "scorer-error" ? "**SCORER-ERROR**" : "not yet computable") : m.metric_value.toFixed(3)) : "no mark"} | ${m?.n_obs ?? "-"} | ${(m?.note ?? "").replace(/\|/g, "/").slice(0, 110)} |`); }
L.push(`\n## If you want the sessions to run without you`);
L.push(`A session's job is now: read this page, fix any RED the guard output names, commit, regenerate. That is a routine, not a conversation. To arm it (it spends, so it is not created for you): in Claude Code run \`/schedule\` and give it — *"In /Users/ona/Projects/aegis: run \`bash scripts/guard-status.sh\` and \`deno run --allow-net --allow-env --allow-read --allow-write --allow-run scripts/log-triage-guard.ts\`; for every RED, read the guard's own output, fix the cause, verify the guard green, commit with a D-entry; then regenerate docs/OPERATOR_QUEUE.md. Never open accounts, deposit, or place orders. Stop when the board is green."* — daily, after the 02:00 UTC cycle.\n`);
L.push(`## What this page will not do\nIt will not tell you a strategy is ready. Nothing has cleared the gates (D-070: that is the engine working), and the numbers that matter at this account's scale are per head, not per pound (D-834/851).`);
await Deno.writeTextFile(`${base}${K.OUT}`, L.join("\n") + "\n");
console.log(`==> OPERATOR QUEUE written: ${K.OUT} — board ${reds.length ? reds.length + " RED" : "green"}, ${rules.length} clocks, feed ${fxLine}, ${sheetLine}`);
