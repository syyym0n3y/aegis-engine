#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-cboe-putcall.ts (D-809) — CBOE's daily market-statistics JSON, one request per trading day, keyless and free
// (cdn.cboe.com, allowlisted). Gives the INDEX / TOTAL / EQUITY / VIX put-call ratios as a HISTORY — the options-pressure
// input the SPX side of the D-809 composite lacked (per-strike SPX OI and naive GEX have ~15 days, D-806).
// Series in trd_macro_series: cboe_pc_index, cboe_pc_total, cboe_pc_equity, cboe_pc_vix (ratio, dimensionless).
// Incremental (starts after the newest held day), sequential, paced; a 404 on a weekday is recorded as a holiday/missing
// day; positive control: at least 60% of weekdays in the requested span must return a ratio, and a known day must match.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-cboe-putcall", [{ name: "FROM", def: "2019-01-02", note: "first day requested if nothing held (probe: reachable from 2019)" }, { name: "TO", def: "" }, { name: "PAUSE_MS", def: "250" }, { name: "MAX_DAYS", def: "0", note: "0 = all" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cpc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newest = (await q(`trd_macro_series?series=eq.cboe_pc_index&select=d&order=d.desc&limit=1`) as { d: string }[])[0]?.d;
const start = newest ? (() => { const x = new Date(newest + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })() : K.FROM;
const end = K.TO || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const days: string[] = []; { const d = new Date(start + "T00:00:00Z"); const e = new Date(end + "T00:00:00Z"); while (d <= e) { if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }
const todo = +K.MAX_DAYS > 0 ? days.slice(0, +K.MAX_DAYS) : days;
console.log(`  cboe put/call: newest held ${newest ?? "none"} -> requesting ${todo.length} weekdays ${todo[0] ?? "-"}..${todo[todo.length - 1] ?? "-"}`);
const MAP: Record<string, string> = { "INDEX PUT/CALL RATIO": "cboe_pc_index", "TOTAL PUT/CALL RATIO": "cboe_pc_total", "EQUITY PUT/CALL RATIO": "cboe_pc_equity", "CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO": "cboe_pc_vix" };
let rows: { series: string; d: string; v: number }[] = [], got = 0, miss = 0;
async function flush() { if (!rows.length) return; const r = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }); if (!r.ok) throw new Error(`write ${r.status}: ${(await r.text()).slice(0, 120)}`); rows = []; }
for (const d of todo) {
  let r: Response | null = null; for (let a = 0; a < 3; a++) { r = await fetch(`https://cdn.cboe.com/data/us/options/market_statistics/daily/${d}_daily_options`); if (r.status < 500) break; await r.body?.cancel(); await sleep(2000 * (a + 1)); }
  await sleep(+K.PAUSE_MS);
  if (!r || r.status === 404 || r.status === 403) { miss++; if (r) await r.body?.cancel(); continue; } if (!r.ok) throw new Error(`${r.status} ${d}`);
  const j = await r.json().catch(() => null) as { ratios?: { name: string; value: string }[] } | null; if (!j?.ratios) { miss++; continue; }
  let any = false; for (const x of j.ratios) { const s = MAP[x.name]; const v = Number(x.value); if (s && Number.isFinite(v)) { rows.push({ series: s, d, v }); any = true; } }
  if (any) got++; else miss++;
  if (rows.length >= 400) await flush();
}
await flush();
console.log(`==> CBOE PUT/CALL: ${got} days written, ${miss} missing/holiday of ${todo.length} weekdays`);
if (todo.length >= 20 && got < 0.6 * todo.length) { console.error("  RED — positive control: fewer than 60% of weekdays returned a ratio"); Deno.exit(1); }
const chk = (await q(`trd_macro_series?series=eq.cboe_pc_index&d=eq.2026-09-04&select=v`) as { v: number }[])[0]; if (todo.includes("2026-09-04") && chk?.v !== 0.89) { console.error(`  RED — positive control: 2026-09-04 INDEX P/C expected 0.89, read ${chk?.v}`); Deno.exit(1); }
console.log("  positive controls passed");
