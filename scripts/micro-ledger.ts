#!/usr/bin/env -S deno run --allow-net --allow-env
// micro-ledger.ts (D-823) — the OPERATOR's record of REAL fills on the micro rung, in trd_manual_trades (LADDER stage 2).
// Open a position:   ADD=1 SYM=BTCUSDT SIDE=long QTY=0.001 INTENDED=<price the sheet implied> FILL=<actual> [FEES=<usd>] [NOTE="..."]
// Close it:          CLOSE=<row id> EXIT=<price> [FEES=<usd added>]
// No knobs:          summary the review clause reads (30 fills -> live vs model; MICRO->SMALL needs 50 within ~1 sd).
// Append-only in spirit: a row is opened once and closed once; a mistake is a new row with a note, never an edit.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("micro-ledger", [
  { name: "ADD", def: "0" }, { name: "SYM", def: "" }, { name: "SIDE", def: "long" }, { name: "QTY", def: "" }, { name: "INTENDED", def: "" }, { name: "FILL", def: "" }, { name: "FEES", def: "0" }, { name: "NOTE", def: "" },
  { name: "FAMILY", def: "micro-psl-fade-k24" }, { name: "CLOSE", def: "" }, { name: "EXIT", def: "" },
  { name: "TRIP", def: "0", note: "1 = trip the micro kill-switch (REASON required): no opens until ARM" }, { name: "ARM", def: "0", note: "1 = re-arm after a trip (REASON required)" }, { name: "REASON", def: "" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mled", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
if (K.TRIP === "1" || K.ARM === "1") {
  if (!K.REASON) { console.error("!! TRIP/ARM needs REASON=..."); Deno.exit(1); }
  const state = K.TRIP === "1" ? "tripped" : "armed";
  const r = await fetch(`${OWNED}/trd_kill_switch?account=eq.micro`, { method: "PATCH", headers: { ...hdr, Prefer: "return=representation" }, body: JSON.stringify({ state, reason: K.REASON, tripped_at: state === "tripped" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }) });
  const n = r.ok ? (await r.json()).length : 0; if (n !== 1) { console.error(`!! kill-switch update touched ${n} row(s) (HTTP ${r.status})`); Deno.exit(1); }
  console.log(`==> kill-switch micro -> ${state} (${K.REASON})`); Deno.exit(0);
}
if (K.ADD === "1") {
  const qty = +K.QTY, intended = +K.INTENDED, fill = +K.FILL; const dir = K.SIDE === "short" ? -1 : 1;
  if (!K.SYM || !(qty > 0) || !(intended > 0) || !(fill > 0)) { console.error("!! ADD needs SYM, QTY, INTENDED, FILL (all positive)"); Deno.exit(1); }
  const ks = (await q(`trd_kill_switch?account=eq.micro&select=state`) as { state: string }[])[0];
  if (ks?.state !== "armed") { console.error(`!! kill-switch micro is ${ks?.state ?? "MISSING"} — refusing to record an open (a tripped switch means no new fills)`); Deno.exit(1); }
  const slippage = dir * (fill - intended) / intended * 1e4;
  const r = await fetch(`${OWNED}/trd_manual_trades`, { method: "POST", headers: { ...hdr, Prefer: "return=representation" }, body: JSON.stringify({ symbol: K.SYM, side: K.SIDE, intended_price: intended, actual_fill_price: fill, shares: qty, opened_at: new Date().toISOString(), fees: +K.FEES, slippage_bps: slippage, strategy_family: K.FAMILY, confidence: "micro", note: K.NOTE }) });
  if (!r.ok) { console.error(`!! write failed HTTP ${r.status}: ${await r.text()}`); Deno.exit(1); }
  const row = (await r.json())[0]; console.log(`==> OPENED ${row.id}  ${K.SYM} ${K.SIDE} ${qty} @ ${fill} (intended ${intended}, slippage ${slippage.toFixed(1)}bp)`); Deno.exit(0);
}
if (K.CLOSE) {
  const exit = +K.EXIT; if (!(exit > 0)) { console.error("!! CLOSE needs EXIT=<price>"); Deno.exit(1); }
  const row = (await q(`trd_manual_trades?id=eq.${K.CLOSE}&select=id,side,shares,actual_fill_price,fees,closed_at`) as { id: string; side: string; shares: number; actual_fill_price: number; fees: number; closed_at: string | null }[])[0];
  if (!row) { console.error("!! no such row"); Deno.exit(1); } if (row.closed_at) { console.error(`!! ${row.id} already closed at ${row.closed_at} — a correction is a NEW row with a note`); Deno.exit(1); }
  const dir = row.side === "short" ? -1 : 1; const gross = dir * (exit - +row.actual_fill_price) * +row.shares;
  const r = await fetch(`${OWNED}/trd_manual_trades?id=eq.${row.id}&closed_at=is.null`, { method: "PATCH", headers: { ...hdr, Prefer: "return=representation" }, body: JSON.stringify({ exit_price: exit, closed_at: new Date().toISOString(), gross_pnl: gross, fees: +row.fees + +K.FEES }) });
  const n = r.ok ? (await r.json()).length : 0; if (n !== 1) { console.error(`!! close touched ${n} row(s) (HTTP ${r.status}) — expected exactly 1`); Deno.exit(1); }
  console.log(`==> CLOSED ${row.id} @ ${exit}: gross ${gross.toFixed(2)}, fees ${(+row.fees + +K.FEES).toFixed(2)}`); Deno.exit(0);
}
const rows = await q(`trd_manual_trades?strategy_family=eq.${K.FAMILY}&select=id,symbol,side,shares,actual_fill_price,exit_price,gross_pnl,fees,slippage_bps,opened_at,closed_at&order=opened_at.asc&limit=5000`) as { id: string; symbol: string; side: string; shares: number; actual_fill_price: number; exit_price: number | null; gross_pnl: number | null; fees: number; slippage_bps: number; opened_at: string; closed_at: string | null }[];
const closed = rows.filter((r) => r.closed_at); const open = rows.filter((r) => !r.closed_at);
console.log(`==> MICRO LEDGER — ${K.FAMILY}: ${rows.length} fill(s), ${closed.length} closed, ${open.length} open`);
if (!rows.length) { console.log("    no real fills yet. The rung goes live with the first hand-placed fill; the sheet is scripts/micro-sheet.ts."); Deno.exit(0); }
const netBp = closed.map((r) => ((+r.gross_pnl! - +r.fees) / (+r.actual_fill_price * +r.shares)) * 1e4);
if (closed.length) {
  const m = mean(netBp), s = sd(netBp), t = closed.length > 1 ? m / (s / Math.sqrt(closed.length)) : NaN;
  console.log(`    closed: net ${m.toFixed(2)}bp/fill (t ${Number.isFinite(t) ? t.toFixed(2) : "n/a"}), win ${(100 * netBp.filter((x) => x > 0).length / netBp.length).toFixed(0)}%, mean slippage ${mean(rows.map((r) => +r.slippage_bps)).toFixed(1)}bp vs model +7.15bp (rvol-hi) / +2.09bp (base)`);
  console.log(`    review clause (D-823): at 30 closed fills, live vs model decides continue/stop — ${Math.max(0, 30 - closed.length)} to go. MICRO->SMALL: 50 closed fills within ~1 sd of the model.`);
}
for (const r of open) console.log(`    OPEN ${r.id} ${r.symbol} ${r.side} ${r.shares} @ ${r.actual_fill_price} since ${r.opened_at.slice(0, 16)}`);
