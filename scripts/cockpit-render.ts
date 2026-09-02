#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
// cockpit-render.ts (D-751) — THE OWNED COCKPIT. One self-contained HTML file, rendered from the owned node and the
// daily runner's own outputs, with ZERO dependency on any *.supabase.co host.
//
// WHY IT EXISTS. The oversight surface was `supabase/functions/aegis-cockpit` — an edge function on the CC project
// `glzzoomuhnugsiichnub`, which is INACTIVE behind unpaid invoices. So the engine's operator view was rentable
// infrastructure: an unpaid invoice removed the ability to SEE the system, while the system itself kept running on
// the owned node. That is the D-408 substrate lesson pointed at oversight rather than research — and the honest fix
// is not a second rented host but a file on disk the operator owns.
//
// READ-ONLY BY CONSTRUCTION. It queries, it runs report-only scripts, it writes exactly one file (data/cockpit.html).
// No LLM, no network beyond $OWNED_REST and the local scripts, no writes to any ledger.
//
// POSITIVE CONTROL (D-641): a page that renders beautifully from nothing is worse than no page, because it looks
// like oversight. Two facts must appear or the render is RED: the LIVE trial count (>0, read from trd_trial_counter,
// not a constant) and a guard board carrying at least as many guards as there are `-guard.ts` files on disk minus the
// registry guard's declared exemption. A page missing either is written WITH A RED BANNER and the process exits 1 —
// the failure has to be visible on the page as well as in the log, since the page is what a human actually opens.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("cockpit-render", [
  { name: "COCKPIT_OUT", def: "data/cockpit.html", note: "the single self-contained file this writes" },
  { name: "COCKPIT_LOG", def: "infra/data/coverage.log", note: "the daily runner's log — source of the last guard board and loop timestamp" },
  { name: "COCKPIT_RUN_GUARDS", def: "", note: "1 = run scripts/guard-status.sh live instead of parsing the runner's last block (~3 min)" },
  { name: "COCKPIT_MIN_GUARDS", def: "", note: "override the expected guard count; default = *-guard.ts on disk minus the registry exemption" },
]);

// Paths are resolved against the REPO ROOT, never the cwd — the runner invokes this from infra/, the operator from
// the repo root, and a cwd-relative path silently reads a different (or missing) file in one of those two.
const REPO = new URL("..", import.meta.url).pathname;
const P = (rel: string) => `${REPO}${rel}`;
const OUT = P(K.COCKPIT_OUT), LOG = P(K.COCKPIT_LOG);

const OWNED = Deno.env.get("OWNED_REST") || `http://localhost:${Deno.env.get("REST_PORT") || "33000"}`;
const SECRET = Deno.env.get("JWT_SECRET") || "";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cockpit", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// READS RETRY AND REPORT. The first live render returned 0 trials and 0 clocks while the same queries succeeded from
// a standalone script — the reads ran immediately after 26 guards had just hammered the same PostgREST, and a
// transient non-ok answer collapsed to an empty array indistinguishable from an empty table. That is the D-641
// false-zero shape aimed at the oversight page itself, and the positive control below is what caught it. So a failed
// read now retries and, if it still fails, SAYS SO on stderr instead of quietly rendering a zero.
async function retry<T>(label: string, f: () => Promise<T | null>, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const v = await f();
    if (v !== null) return v;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  console.error(`  !! READ FAILED after ${tries} tries: ${label} — the page will under-report this panel`);
  return null;
}
const q = async (p: string): Promise<unknown[]> =>
  await retry(p, () => fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() as Promise<unknown[]> : null).catch(() => null)) ?? [];
const count = async (p: string): Promise<number> =>
  await retry(p, () => fetch(`${OWNED}/${p}`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } })
    .then((r) => r.ok ? +(r.headers.get("content-range")?.split("/")[1] ?? 0) : null).catch(() => null)) ?? 0;
async function run(cmd: string[], cwd = REPO): Promise<{ out: string; code: number }> {
  try {
    const p = new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped", env: { ...Deno.env.toObject(), OWNED_REST: OWNED } });
    const r = await p.output();
    return { out: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr), code: r.code };
  } catch (e) { return { out: `!! could not run ${cmd.join(" ")}: ${e instanceof Error ? e.message : e}`, code: 127 }; }
}
const readOr = async (p: string, fallback: string) => { try { return await Deno.readTextFile(p); } catch { return fallback; } };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DENO = Deno.execPath();

// ── 1. GUARD BOARD ────────────────────────────────────────────────────────────────────────────────────────────────
// Default source is the runner's own last block, because this script is the LAST step of the same loop that just ran
// guard-status.sh — re-running 26 guards to display what ran 4 minutes ago doubles the cost of every cycle. If the
// block is absent or short, we run them live rather than showing a stale or partial board.
let guardsOn = 0;
for await (const e of Deno.readDir(P("scripts"))) if (e.isFile && e.name.endsWith("-guard.ts")) guardsOn++;
const EXPECTED = Number(K.COCKPIT_MIN_GUARDS || guardsOn - 1);   // registry-guard is exempt from the status list by declaration

const logTxt = await readOr(LOG, "");
function lastGuardBlock(txt: string): { ts: string; rows: [string, string, string][]; tail: string } {
  const i = txt.lastIndexOf("== AEGIS GUARD STATUS");
  if (i < 0) return { ts: "", rows: [], tail: "" };
  const block = txt.slice(i);
  const ts = block.match(/live, (\S+) ==/)?.[1] ?? "";
  const rows: [string, string, string][] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s{2}(GREEN|RED)\s+(\S+)\s*(.*)$/);
    if (m) rows.push([m[1], m[2], m[3].trim()]);
    if (/^--\s/.test(line)) break;
  }
  const tail = block.split("\n").find((l) => /^--\s/.test(l)) ?? "";
  return { ts, rows, tail };
}
let board = lastGuardBlock(logTxt);
let boardSource = `runner log ${K.COCKPIT_LOG} (cycle of ${board.ts || "never"})`;
if (K.COCKPIT_RUN_GUARDS === "1" || board.rows.length < EXPECTED) {
  const live = await run(["bash", P("scripts/guard-status.sh")]);
  const b = lastGuardBlock(live.out);
  if (b.rows.length >= board.rows.length) { board = b; boardSource = `run live (${new Date().toISOString()})`; }
}
const reds = board.rows.filter((r) => r[0] === "RED");

// ── 2. LIVE STATE FROM THE OWNED NODE ─────────────────────────────────────────────────────────────────────────────
const trials = await count("trd_trial_counter?select=id");
const leads = await count("trd_lineage_roster?select=name");
const jobs = await q("trd_compute_jobs?select=status&limit=1000") as { status: string }[];
const jobsBy: Record<string, number> = {};
for (const j of jobs) jobsBy[j.status] = (jobsBy[j.status] || 0) + 1;

// ── 3. FORWARD CLOCKS ─────────────────────────────────────────────────────────────────────────────────────────────
// One row per registered clock, carrying its LATEST append-only mark. A clock with no mark is shown as such rather
// than omitted — an unscored clock is the exact failure THE CONTINUITY LAW exists to make visible (D-613).
const rules = await q("trd_forward_rules?select=id,spec,clock_started") as { id: string; spec: string; clock_started: string }[];
const marks = await q("trd_forward_marks?select=rule_id,marked_at,metric_name,metric_value,n_obs,matured,verdict,note&order=id.desc&limit=500") as
  { rule_id: string; marked_at: string; metric_name: string; metric_value: number | null; n_obs: number; matured: boolean; verdict: string | null; note: string }[];
const latest = new Map<string, typeof marks[number]>();
for (const m of marks) if (!latest.has(m.rule_id)) latest.set(m.rule_id, m);

// ── 4/5/6. THE REPORT-ONLY SCRIPTS ────────────────────────────────────────────────────────────────────────────────
// Run fresh (all three are seconds), falling back to the runner's log file if a run fails — a stale-but-labelled
// report beats a blank panel, and the label says which it is.
async function report(script: string, logFile: string, args: string[] = []): Promise<{ text: string; src: string }> {
  const r = await run([DENO, "run", "--allow-net", "--allow-env", P(`scripts/${script}`), ...args]);
  if (r.code === 0 && r.out.trim()) return { text: r.out, src: `live (${script})` };
  const f = await readOr(P(logFile), "");
  return { text: f || r.out || "(no output)", src: f ? `stale: ${logFile}` : `FAILED: ${script}` };
}
const odds = await report("market-odds-map.ts", "data/odds-map.log");
const sizer = await report("holdability-sizer.ts", "data/sizer.log");
const drv = await run([DENO, "run", "--allow-net", "--allow-env", P("scripts/driver-register.ts")]);
const drvLine = drv.out.split("\n").find((l) => /HELD\s+\|/.test(l))?.trim() ?? "(driver register produced no summary line)";

// ── 7. RE-TEST HARNESS STATE ──────────────────────────────────────────────────────────────────────────────────────
const retest = JSON.parse(await readOr(P("data/retest-state.json"), "{}")) as Record<string, number>;
const retestLog = (await readOr(P("data/retest.log"), "")).trim();

// ── 8. LAST RUNNER LOOP ───────────────────────────────────────────────────────────────────────────────────────────
let loopMtime = "unknown";
try { loopMtime = (await Deno.stat(LOG)).mtime?.toISOString() ?? "unknown"; } catch { /* absent */ }
const loopAgeH = loopMtime === "unknown" ? NaN : (Date.now() - Date.parse(loopMtime)) / 3.6e6;

// ── 9. WHAT NEEDS THE OPERATOR (from STATE.md, verbatim) ──────────────────────────────────────────────────────────
// Pulled verbatim rather than summarised: this panel's whole job is to carry the operator's own words back to them
// unedited, so a paraphrase that softens a blocker would defeat it.
const stateMd = await readOr(P("STATE.md"), "");
const blockedRaw = (() => {
  const i = stateMd.indexOf("## Blocked on operator");
  if (i < 0) return "(STATE.md has no '## Blocked on operator' section)";
  const rest = stateMd.slice(i);
  const j = rest.indexOf("\n## ", 3);
  return (j < 0 ? rest : rest.slice(0, j)).trim();
})();

// ── POSITIVE CONTROL ──────────────────────────────────────────────────────────────────────────────────────────────
const ctl: [string, boolean, string][] = [
  ["live trial count from trd_trial_counter", trials > 0, `${trials.toLocaleString()} trials (must be > 0; a constant would pass a weaker check)`],
  ["guard board carries every guard on disk", board.rows.length >= EXPECTED, `${board.rows.length} shown, ${EXPECTED} expected (${guardsOn} *-guard.ts on disk, 1 declared exemption)`],
];
const ctlOk = ctl.every((c) => c[1]);

// ── RENDER ────────────────────────────────────────────────────────────────────────────────────────────────────────
const pill = (ok: boolean, t: string) => `<span class="pill ${ok ? "ok" : "bad"}">${esc(t)}</span>`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aegis cockpit — owned node</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#16181d;--mut:#5c6270;--card:#fff;--line:#e2e4e9;--ok:#0a7f3f;--bad:#c02626;--warn:#a35a00;--code:#f0f1f4}
@media(prefers-color-scheme:dark){:root{--bg:#0e1014;--fg:#e6e8ee;--mut:#98a0b0;--card:#161a21;--line:#252a34;--ok:#3ecf8e;--bad:#ff6b6b;--warn:#e0a458;--code:#0b0d11}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:28px 0 8px}
.sub{color:var(--mut);font-size:12.5px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.banner{border-radius:10px;padding:12px 16px;margin-bottom:18px;font-weight:600;border:1px solid}
.banner.ok{border-color:var(--ok);color:var(--ok)}.banner.bad{border-color:var(--bad);color:var(--bad)}
.pill{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11.5px;font-weight:700;letter-spacing:.03em}
.pill.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.pill.bad{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{text-align:left;padding:4px 10px 4px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.kv{font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--mut)}.kv b{display:block;font:600 19px/1.3 -apple-system,sans-serif;color:var(--fg)}
.note{color:var(--mut);font-size:12px}
.gcol{columns:2;column-gap:22px}@media(max-width:720px){.gcol{columns:1}}
.g{break-inside:avoid;font:12.5px/1.7 ui-monospace,Menlo,monospace}
</style></head><body><div class="wrap">

<h1>Aegis cockpit</h1>
<div class="sub">Rendered ${new Date().toISOString()} from the OWNED node <code>${esc(OWNED)}</code>. Self-contained file, no external assets,
no <code>*.supabase.co</code> dependency. Read-only: this page is a view, not a control surface.</div>

<div class="banner ${ctlOk ? "ok" : "bad"}">${ctlOk ? "POSITIVE CONTROL PASSED" : "RED — POSITIVE CONTROL FAILED; DO NOT READ THIS PAGE AS OVERSIGHT"}</div>
<div class="card"><table><tr><th>positive control</th><th></th><th>measured</th></tr>
${ctl.map(([n, ok, d]) => `<tr><td>${esc(n)}</td><td>${pill(ok, ok ? "PASS" : "FAIL")}</td><td class="note">${esc(d)}</td></tr>`).join("")}
</table></div>

<div class="grid">
  <div class="card kv"><b>${trials.toLocaleString()}</b>trials in trd_trial_counter</div>
  <div class="card kv"><b>${leads}</b>leads in the lineage roster</div>
  <div class="card kv"><b>${board.rows.length - reds.length}/${board.rows.length}</b>guards green</div>
  <div class="card kv"><b>${Number.isNaN(loopAgeH) ? "?" : loopAgeH.toFixed(1) + "h"}</b>since last runner loop</div>
</div>

<h2>Guard board</h2>
<div class="card">
  <div class="note" style="margin-bottom:8px">source: ${esc(boardSource)} &middot; ${esc(board.tail || "no summary line")}</div>
  <div class="gcol">${board.rows.map(([s, n, d]) =>
    `<div class="g">${pill(s === "GREEN", s)} <b>${esc(n)}</b> <span class="note">${esc(d)}</span></div>`).join("")}</div>
  ${reds.length ? `<div class="note" style="margin-top:10px;color:var(--bad)">${reds.length} RED — a red guard means the conclusion it protects is UNKNOWN, not null.</div>` : ""}
</div>

<h2>Forward clocks</h2>
<div class="card"><table>
<tr><th>clock</th><th>statistic</th><th>value</th><th>n</th><th>state</th><th>last mark</th></tr>
${rules.sort((a, b) => a.id < b.id ? -1 : 1).map((r) => {
  const m = latest.get(r.id);
  const state = !m ? "NO MARK — unscored clock" : m.verdict ? `VERDICT ${m.verdict}` : m.matured ? "MATURED, no verdict" : m.metric_value === null ? "not-yet-computable" : "accruing";
  const bad = !m || (m.matured && !m.verdict);
  return `<tr><td><b>${esc(r.id)}</b><div class="note">${esc(r.spec)} &middot; started ${esc(r.clock_started)}</div></td>
  <td class="note">${esc(m?.metric_name ?? "—")}</td><td>${m && m.metric_value !== null ? m.metric_value.toFixed(3) : "—"}</td>
  <td>${m?.n_obs ?? 0}</td><td>${pill(!bad, state)}</td><td class="note">${esc(m?.marked_at?.slice(0, 19) ?? "—")}</td></tr>`;
}).join("")}
</table>
<div class="note" style="margin-top:8px">"not-yet-computable" is deliberately distinct from "computed and inconclusive" (D-613). A clock with NO mark is the
failure the continuity law exists to surface, and is flagged red here rather than hidden.</div></div>

<h2>Re-test harness — has any verdict moved?</h2>
<div class="card"><table><tr><th>verdict</th><th>last statistic</th></tr>
${Object.entries(retest).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("") || "<tr><td colspan=2>data/retest-state.json is empty or absent</td></tr>"}
</table>${retestLog ? `<pre style="margin-top:10px">${esc(retestLog.slice(-3000))}</pre>` : ""}</div>

<h2>Compute queue (owned node)</h2>
<div class="card"><div class="g">${Object.keys(jobsBy).length ? Object.entries(jobsBy).map(([s, n]) => `${esc(s)}: ${n}`).join(" &middot; ") : "queue empty"}</div>
<div class="note">Drained by <code>scripts/aegis-worker.ts</code>, which now defaults to this node directly (set AEGIS_BROKER only for a remote box).</div></div>

<h2>Driver register</h2>
<div class="card"><div class="g">${esc(drvLine)}</div></div>

<h2>Holdability sizer</h2>
<div class="card"><pre>${esc(sizer.text)}</pre><div class="note" style="margin-top:8px">source: ${esc(sizer.src)}</div></div>

<h2>Market odds map</h2>
<div class="card"><pre>${esc(odds.text)}</pre><div class="note" style="margin-top:8px">source: ${esc(odds.src)}</div></div>

<h2>What needs the operator</h2>
<div class="card"><pre>${esc(blockedRaw)}</pre>
<div class="note" style="margin-top:8px">Verbatim from STATE.md. Nothing on this page depends on the CC Supabase project; that item is oversight/billing, not research validity.</div></div>

<div class="note" style="margin-top:26px">Last runner loop: ${esc(loopMtime)} (${esc(K.COCKPIT_LOG)}). Regenerate: <code>deno run -A scripts/cockpit-render.ts</code> &middot; open: <code>scripts/cockpit-open.sh</code></div>
</div></body></html>
`;

await Deno.writeTextFile(OUT, html);
console.log(`==> COCKPIT RENDERED ${OUT}  (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
console.log(`    guards ${board.rows.length - reds.length}/${board.rows.length} green (${boardSource}) | trials ${trials.toLocaleString()} | clocks ${rules.length} | last loop ${loopMtime}`);
for (const [n, ok, d] of ctl) console.log(`    ${ok ? "ok " : "RED"} ${n}: ${d}`);
if (!ctlOk) { console.log(`    RED — positive control failed; the page is written WITH a red banner so the failure is visible where a human looks.`); Deno.exit(1); }
