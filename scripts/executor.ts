#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// executor.ts (D-957) — the DETERMINISTIC execution layer, shipped DORMANT. Consumes the deploy-sheet TICKET (the
// target book as data), diffs it against the operator's REAL open positions (trd_manual_trades), applies every gate,
// and emits an ORDER LIST. It contains NO model and NO discretion — the whole point (invariant: no LLM in the order
// path, ever). Submission is a pluggable broker adapter that DOES NOT EXIST YET: until the operator opens the broker
// account, provides creds via env, and the endpoint is allowlisted, SUBMIT=1 exits 1 with the exact missing steps.
// Claude never runs this with SUBMIT=1; arming is the operator's act, and even then the kill-switch row rules.
//
//   dry-run (default):  deno run ... executor.ts                       (prints + writes the order list)
//   gates checked, in order: (1) ticket fresh today  (2) trd_kill_switch[ACCOUNT] = armed  (3) per-order + gross caps
import { declareKnobs, mkStrictRead, assertFresh } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("executor", [
  { name: "TICKET", def: "data/deploy-ticket.json", note: "target-book ticket written by deploy-sheet.ts TICKET=..." },
  { name: "ACCOUNT", def: "micro", note: "kill-switch account row that must read 'armed' (paper|micro|small)" },
  { name: "MAX_ORDER_USD", def: "500", note: "hard per-order cap — a target above it is CLIPPED and flagged" },
  { name: "MAX_GROSS_USD", def: "5000", note: "hard gross cap — beyond it the run REFUSES (rung budget)" },
  { name: "SUBMIT", def: "0", note: "0 = dry-run order list (DORMANT default). 1 = requires BROKER adapter + operator arming; refuses loudly otherwise" },
  { name: "BROKER", def: "none", note: "none | ibkr (adapter NOT BUILT — needs operator account, creds, allowlist entry)" },
  { name: "OUT", def: "data/orders-latest.json", note: "where the order list is written for the operator" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "exec", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${t}`, apikey: t });

// GATE 1 — the ticket must have been written TODAY by this machine (a stale book is a book about nothing, D-598).
const tp = new URL(`../${K.TICKET}`, import.meta.url).pathname;
assertFresh(tp, 24 * 3600 * 1000);
type Tgt = { symbol: string; sleeve: string; side: string; dollars: number };
const ticket = JSON.parse(await Deno.readTextFile(tp)) as { written: string; book_date: string; capital: number; degrossed: boolean; targets: Tgt[] };
console.log(`==> D-957 EXECUTOR (DORMANT) — ticket ${ticket.book_date}, capital $${ticket.capital.toLocaleString()}, de-gross ${ticket.degrossed ? "ACTIVE" : "off"}, ${ticket.targets.length} targets`);

// GATE 2 — durable kill-switch row must read 'armed'. Absent/tripped => report and stop. Executor NEVER writes it.
const ks = (await q(`trd_kill_switch?account=eq.${K.ACCOUNT}&select=state`) as { state: string }[])[0];
if (ks?.state !== "armed") { console.log(`  KILL-SWITCH '${K.ACCOUNT}' reads '${ks?.state ?? "ABSENT"}' — no order list emitted. Arm it via micro-ledger.ts ARM=1 REASON=... (operator act).`); Deno.exit(0); }

// current REAL positions: open rows in the operator's manual-fill ledger (shares*fill ~ held dollars; approximation stated)
type Pos = { symbol: string; side: string; shares: number | null; actual_fill_price: number | null; closed_at: string | null };
const open = ((await q(`trd_manual_trades?select=symbol,side,shares,actual_fill_price,closed_at&order=opened_at`) as Pos[]) ?? []).filter((p) => p.closed_at == null);
const held = new Map<string, number>();  // signed dollars
for (const p of open) held.set(p.symbol, (held.get(p.symbol) ?? 0) + (p.side === "short" ? -1 : 1) * (p.shares ?? 0) * (p.actual_fill_price ?? 0));
console.log(`  open positions in trd_manual_trades: ${open.length} (held notional ~$${Math.round([...held.values()].reduce((s, x) => s + Math.abs(x), 0)).toLocaleString()})`);

// diff -> orders. Name-level rows only; OPERATOR-CHOICE sleeve rows pass through as reminders (venue decides instrument).
const MAXO = +K.MAX_ORDER_USD, MAXG = +K.MAX_GROSS_USD;
type Ord = { symbol: string; sleeve: string; action: string; dollars: number; clipped?: boolean };
const orders: Ord[] = []; const reminders: Tgt[] = [];
for (const tg of ticket.targets) {
  if (tg.symbol.startsWith("OPERATOR-CHOICE")) { reminders.push(tg); continue; }
  const want = (tg.side === "short" ? -1 : 1) * tg.dollars; const have = held.get(tg.symbol) ?? 0; const delta = want - have;
  if (Math.abs(delta) < 25) continue;                                   // no churn under $25 (turnover discipline, D-654)
  const clip = Math.min(Math.abs(delta), MAXO);
  orders.push({ symbol: tg.symbol, sleeve: tg.sleeve, action: delta > 0 ? "BUY" : "SELL/SHORT", dollars: Math.round(clip), clipped: clip < Math.abs(delta) || undefined });
}
for (const [sym, have] of held) if (!ticket.targets.some((x) => x.symbol === sym) && Math.abs(have) >= 25)
  orders.push({ symbol: sym, sleeve: "close", action: have > 0 ? "SELL (exit)" : "COVER (exit)", dollars: Math.round(Math.abs(have)) });

// GATE 3 — caps
const gross = orders.reduce((s, o) => s + o.dollars, 0);
if (gross > MAXG) { console.error(`!! REFUSED: order gross $${gross.toLocaleString()} exceeds MAX_GROSS_USD $${MAXG.toLocaleString()} (rung budget). Reduce capital on the ticket or raise the cap DELIBERATELY.`); Deno.exit(1); }

console.log(`\n  ORDER LIST (${orders.length} orders, gross $${gross.toLocaleString()}, per-order cap $${MAXO}):`);
for (const o of orders) console.log(`    ${o.action.padEnd(12)} $${String(o.dollars).padStart(6)}  ${o.symbol.padEnd(8)} [${o.sleeve}]${o.clipped ? "  (CLIPPED at cap)" : ""}`);
for (const r of reminders) console.log(`    SLEEVE       $${String(r.dollars).padStart(6)}  ${r.sleeve.padEnd(9)} -> ${r.symbol}`);
const outP = new URL(`../${K.OUT}`, import.meta.url).pathname;
await Deno.writeTextFile(outP, JSON.stringify({ ts: new Date().toISOString(), account: K.ACCOUNT, ticket_date: ticket.book_date, gross, orders, reminders }, null, 1));
console.log(`  written -> ${K.OUT}`);

if (K.SUBMIT !== "1") { console.log(`\n  DRY-RUN (SUBMIT=0). Fill by hand and log each fill in micro-ledger.ts — the measurement layer is the point.`); Deno.exit(0); }
// SUBMIT PATH — honest about what does not exist yet. No creds are read from anywhere until ALL steps are done.
console.error(`!! SUBMIT=1 refused — the broker adapter is NOT BUILT. Missing, in order:
   1. operator opens the broker account (IBKR UK recommended: API + shorting + SLB borrow data) — Claude cannot do this
   2. operator enables API access + provides creds via env (IBKR_*) — never committed, never typed by Claude
   3. operator allowlists the broker API endpoint in ~/.claude/hooks/endpoints.allowlist — Claude may not edit it
   4. the ibkr adapter is then built against the REAL gateway and verified on a $0/1-share order with the kill-switch honoured
   Until then this daemon is exactly as autonomous as it is safe to be: it computes; you fill.`);
Deno.exit(1);
