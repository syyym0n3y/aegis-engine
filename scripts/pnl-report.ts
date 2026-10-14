#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
// pnl-report.ts (D-980) — THE P&L REPORT, TAKEN LOCAL. Replaces the `aegis-pnl-report` Claude-app routine, which
// was externally dependent twice over: it burned a Claude session every market hour, and every number it quoted came
// from the RENTED oversight project (CC ref glzzoomuhnugsiichnub) paused behind unpaid invoices. Verified
// 2026-10-14: that host answers **HTTP 000, connection refused in 38ms**. The routine could not have produced a true number.
//
// This reads ONLY the owned node and the owned ballast ledger. No LLM, no subscription, no network beyond localhost,
// so it runs whether or not any Claude session, cloud account or vendor invoice exists. Deterministic: same state in,
// same report out.
//
// THE FRAMING IS LOAD-BEARING, not decoration. The old routine carried a mandatory warning that its headline P&L
// included "a large LEGACY crypto gain that is NOT edge". That number is now unreachable and unverifiable, so it is
// not quoted at all. What this prints instead separates, always: REAL capital (fills that happened) from PAPER
// (a book marked daily at $0 risk). Paper is never presented as proof.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("pnl-report", [
  { name: "OUT", def: "docs/PNL.md", note: "written so the report is readable off-machine via git, like LIVE_STATE" },
  { name: "CLOCK", def: "fwd-distress-ivol-blend-5", note: "the deployed candidate's forward clock" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pnl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${t}`, apikey: t });
const L: string[] = []; const say = (s = "") => { L.push(s); console.log(s); };

// --- REAL capital: fills that actually happened ---
type Fill = { symbol: string; side: string; shares: number | null; actual_fill_price: number | null; exit_price: number | null; gross_pnl: number | null; fees: number | null; closed_at: string | null; opened_at: string };
const fills = (await q(`trd_manual_trades?select=symbol,side,shares,actual_fill_price,exit_price,gross_pnl,fees,closed_at,opened_at&order=opened_at`) as Fill[]) ?? [];
const closed = fills.filter((f) => f.closed_at);
const realized = closed.reduce((s, f) => s + (f.gross_pnl ?? 0) - (f.fees ?? 0), 0);
const ks = (await q(`trd_kill_switch?select=account,state`) as { account: string; state: string }[]) ?? [];

say(`# P&L — owned node only (no rented infra, no LLM)\n`);
say(`> Generated ${new Date().toISOString()} by \`pnl-report.ts\` from the local database. The predecessor routine`);
say(`> read the rented CC oversight project, which is dead (HTTP 000). Nothing here depends on any subscription.\n`);
say(`## REAL capital\n`);
if (!fills.length) {
  say(`**No real fills on record.** ${fills.length} rows in \`trd_manual_trades\`. Realized P&L: **$0.00** — because nothing has been placed, not because something lost.`);
  say(`Kill switches: ${ks.map((k2) => `\`${k2.account}\`=${k2.state}`).join(", ") || "none"}. Arming them does not place anything; fills are the operator's, by invariant.`);
} else {
  say(`| fills | closed | realized net |`); say(`|---|---|---|`);
  say(`| ${fills.length} | ${closed.length} | ${realized >= 0 ? "+" : ""}$${realized.toFixed(2)} |`);
}

// --- PAPER book: the deployed candidate, marked daily at $0 ---
const marks = (await q(`trd_forward_marks?rule_id=eq.${K.CLOCK}&select=marked_at,elapsed_days,metric_name,metric_value,n_obs&order=marked_at.desc&limit=1`) as { marked_at: string; elapsed_days: number; metric_name: string; metric_value: number | null; n_obs: number | null }[]) ?? [];
const all = (await q(`trd_forward_marks?rule_id=eq.${K.CLOCK}&select=marked_at&order=marked_at`) as { marked_at: string }[]) ?? [];
say(`\n## PAPER book — \`${K.CLOCK}\` (DORMANT, $0 at risk)\n`);
if (marks.length) {
  const m = marks[0];
  say(`- marks on record: **${all.length}**, latest **${m.marked_at.slice(0, 10)}** (elapsed ${m.elapsed_days}d)`);
  say(`- ${m.metric_name}: **${m.metric_value !== null ? m.metric_value.toFixed(3) : "not yet computable"}**${m.n_obs ? ` (n=${m.n_obs})` : ""}`);
  say(`\n> This is a PAPER number on a book nobody has funded. It is not proof the edge works, and a forward Sharpe on`);
  say(`> a few dozen observations moves a long way as n grows — treat the trend, not the level. Promote/kill floors`);
  say(`> live in \`trd_forward_rules\` and were written before this data existed.`);
} else say(`No marks found for \`${K.CLOCK}\`.`);

// --- MARKET CONTEXT: the regime these numbers were produced in (D-976) ---
say(`\n## Regime these numbers were produced in\n`);
const CTX = ["ctx_spy_vs200_pct", "ctx_spy_rvol20_pct", "ctx_spy_dd1y_pct", "ctx_breadth_above50_pct"];
say(`| series | latest | as of |`); say(`|---|---|---|`);
for (const s of CTX) { const r = (await q(`trd_macro_series?series=eq.${s}&select=d,v&order=d.desc&limit=1`) as { d: string; v: number }[]) ?? [];
  if (r.length) say(`| ${s.replace("ctx_", "")} | ${r[0].v} | ${r[0].d} |`); }

// --- WEALTH ledger (ballast, separate owned node) ---
say(`\n## Wealth ledger (ballast)\n`);
try {
  const p = new Deno.Command("docker", { args: ["exec", "ballast-db", "psql", "-t", "-A", "-U", "postgres", "-d", "postgres", "-c", "select coalesce(sum(amount),0)||'|'||count(*) from bal_ledger where event in ('deposit','interest','pnl_mark')"] });
  const o = await p.output(); const raw = new TextDecoder().decode(o.stdout).trim().split("|");
  const n = +(raw[1] ?? 0);
  say(n > 1 ? `- ${n} entries, net logged **$${(+raw[0]).toFixed(2)}**` : `- **Empty** (${n} row${n === 1 ? "" : "s"}). The certain money (deposits × wrapper) is still unlogged — named at D-823 as the programme's real failure, and still true.`);
} catch { say(`- ballast node unreachable from here (reported, not hidden).`); }

say(`\n## Dependencies of this report\n`);
say(`- owned Postgres \`aegis-db\` (localhost) · owned \`ballast-db\` (localhost)`);
say(`- **no** rented Supabase, **no** LLM call, **no** scheduled Claude session, **no** paid vendor.`);
await Deno.writeTextFile(new URL(`../${K.OUT}`, import.meta.url).pathname, L.join("\n") + "\n");
console.log(`\n==> written -> ${K.OUT}`);
