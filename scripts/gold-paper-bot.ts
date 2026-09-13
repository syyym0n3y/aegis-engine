#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// gold-paper-bot.ts (D-860) — THE PAPER BOT for the one gold rule that survived (fwd-gold-rangeext-cont-k24).
//
// LADDER stage 1: there is NO broker path. This "enters and exits" on paper, deterministically, every hour, from the
// LIVE series (XAUUSD.yh1h, Yahoo GC=F 60m), and records every fill to an append-only JSON ledger the forward scorer
// reads. Claude never places an order; the kill-switch account 'paper' must read armed or nothing is written.
// RULE (frozen, identical to the backtest in gold-adaptive.ts): first hourly close of the UTC day at which the day's
// range so far reaches >= 1.5x (and < 1.75x) the median range of the prior 20 completed days -> go WITH the day's
// direction (close vs day open); ENTER at the NEXT bar's open (lag-1, D-498); EXIT at the open of the bar 24 bars
// after entry; cost 6bp round trip. Only signals AFTER the clock start count; earlier live bars only build context.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("gold-paper-bot", [
  { name: "SYM", def: "XAUUSD.yh1h", note: "the live series; the research series is a day behind by construction" },
  { name: "CLOCK_START", def: "2026-09-13", note: "trd_forward_rules.clock_started for fwd-gold-rangeext-cont-k24 — signals before it are context only" },
  { name: "LEDGER", def: "data/gold-paper-ledger.json" },
  { name: "EXT_LO", def: "1.5" }, { name: "EXT_HI", def: "1.75" }, { name: "HOLD", def: "24" }, { name: "COST_BP", def: "6" },
  { name: "DRY", def: "0", note: "1 = compute and print, write nothing (positive control: run with an early CLOCK_START to prove the rule fires on live bars)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gpb", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
type B = { ts: number; o: number; h: number; l: number; c: number; vol: number };
type Fill = { signal_ts: number; entry_ts: number; entry: number; dir: 1 | -1; ext: number; exit_ts: number | null; exit: number | null; gross_bp: number | null; net_bp: number | null; status: "open" | "closed" };
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16);

const ks = await q(`trd_kill_switch?account=eq.paper&select=state`) as { state: string }[];
if (ks[0]?.state !== "armed") { console.log(`  paper kill-switch is '${ks[0]?.state ?? "absent"}' — nothing written.`); Deno.exit(0); }
const bars = ((await q(`trd_fx_hourly?symbol=eq.${K.SYM}&select=ts,o,h,l,c,vol&order=ts.asc&limit=5000`) as B[]).filter((b) => b.vol > 0 && b.h > b.l));
if (bars.length < 600) { console.log(`  only ${bars.length} live bars — need ~25 days of context; nothing written.`); Deno.exit(0); }
const LP = new URL(`../${K.LEDGER}`, import.meta.url).pathname;
let ledger: Fill[] = []; try { ledger = JSON.parse(await Deno.readTextFile(LP)); } catch { /* first run */ }
const known = new Set(ledger.map((f) => f.signal_ts));
const start = Date.parse(K.CLOCK_START + "T00:00:00Z") / 1000;
// days
const dayKey = (ts: number) => Math.floor(ts / 86400); const dIdx = new Map<number, number[]>();
bars.forEach((b, i) => { const k = dayKey(b.ts); let a = dIdx.get(k); if (!a) { a = []; dIdx.set(k, a); } a.push(i); });
const days = [...dIdx.keys()].sort((a, b) => a - b);
const dayRng = days.map((k) => { const ix = dIdx.get(k)!; let h = -Infinity, l = Infinity; for (const i of ix) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); } return (h - l) / bars[ix[0]].o; });
let signals = 0, opened = 0, closed = 0;
for (let j = 20; j < days.length; j++) {
  const ix = dIdx.get(days[j])!, o = bars[ix[0]].o, medR = med(dayRng.slice(j - 20, j)); let hi = -Infinity, lo = Infinity;
  for (const i of ix) {
    const b = bars[i]; hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); const ext = (hi - lo) / o / medR;
    if (ext >= +K.EXT_LO && ext < +K.EXT_HI) {
      if (b.ts >= start && b.c !== o) { signals++; if (!known.has(b.ts) && i + 1 < bars.length) { ledger.push({ signal_ts: b.ts, entry_ts: bars[i + 1].ts, entry: bars[i + 1].o, dir: b.c > o ? 1 : -1, ext: +ext.toFixed(3), exit_ts: null, exit: null, gross_bp: null, net_bp: null, status: "open" }); known.add(b.ts); opened++; } }
      break;   // first hit of the day only, like the backtest
    }
  }
}
// close what can be closed: exit = open of the bar HOLD bars after entry
const pos = new Map(bars.map((b, i) => [b.ts, i]));
for (const f of ledger) if (f.status === "open") { const ei = pos.get(f.entry_ts); if (ei === undefined) continue; const xi = ei + +K.HOLD; if (xi < bars.length) { f.exit_ts = bars[xi].ts; f.exit = bars[xi].o; f.gross_bp = +(f.dir * Math.log(f.exit / f.entry) * 1e4).toFixed(2); f.net_bp = +(f.gross_bp - +K.COST_BP).toFixed(2); f.status = "closed"; closed++; } }
const cl = ledger.filter((f) => f.status === "closed"); const meanNet = cl.length ? cl.reduce((s, f) => s + f.net_bp!, 0) / cl.length : NaN;
console.log(`==> GOLD PAPER BOT (${K.SYM}, ${bars.length} live bars to ${iso(bars.at(-1)!.ts)}; clock start ${K.CLOCK_START})`);
console.log(`    signals since start ${signals} | opened this run ${opened} | closed this run ${closed} | ledger ${ledger.length} fills (${cl.length} closed, mean net ${isNaN(meanNet) ? "-" : meanNet.toFixed(2) + "bp"})`);
for (const f of ledger.slice(-5)) console.log(`      ${iso(f.signal_ts)} ${f.dir > 0 ? "LONG " : "SHORT"} ext ${f.ext} entry ${f.entry} @${iso(f.entry_ts)} -> ${f.status === "closed" ? `exit ${f.exit} @${iso(f.exit_ts!)} net ${f.net_bp}bp` : "open"}`);
if (K.DRY === "1") { console.log(`    DRY — nothing written.`); Deno.exit(0); }
await Deno.writeTextFile(LP, JSON.stringify(ledger, null, 1));
console.log(`    ledger written: ${K.LEDGER}`);
