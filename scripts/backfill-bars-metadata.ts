#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// backfill-bars-metadata.ts (D-806) — one-off: set first_date/last_date/n_bars/updated_at FROM THE BARS for a symbol list.
// refresh-bars.ts wrote bars only until D-806, so consumers reading last_date saw a stale column (SPY: bars to 09-04,
// last_date 08-28). Bounded to a list (default: the refresh-bars consumer set) — a panel-wide pass is a heavy load and
// the liquid decile is already maintained by refresh-liquid-panel.ts. Positive control: every listed symbol must be found.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("backfill-bars-metadata", [
  { name: "SYMBOLS_FILE", def: "", note: "one symbol per line; empty = derive from the refresh-bars CONSUMER file" },
  { name: "CONSUMER", def: "scripts/aegis-attribution.ts", note: "same knob + same parse as refresh-bars.ts" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
const REPO = new URL("..", import.meta.url).pathname; const abs = (p: string) => p.startsWith("/") ? p : `${REPO}${p}`;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bfm", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
let syms: string[];
if (K.SYMBOLS_FILE) syms = (await Deno.readTextFile(abs(K.SYMBOLS_FILE))).split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
else {
  // The SAME two parses refresh-bars.ts uses on its consumer (scripts/aegis-attribution.ts): the UNIVERSE array and the
  // ticker (second element) of each ALL_FORCES pair. A restated list is a second thing to remember (D-798).
  const src = await Deno.readTextFile(abs(K.CONSUMER));
  const m = src.match(/const\s+UNIVERSE\s*=\s*\[([^\]]*)\]/); const fm = src.match(/const\s+ALL_FORCES[^=]*=\s*\[([\s\S]*?)\];/);
  if (!m || !fm) { console.error(`!! cannot parse UNIVERSE / ALL_FORCES out of ${K.CONSUMER} — RED`); Deno.exit(1); }
  syms = [...new Set([...[...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), ...[...fm[1].matchAll(/\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*\]/g)].map((x) => x[1])])];
}
assertNonEmpty("symbols", syms, 10);
let done = 0, changed = 0; const missing: string[] = [];
for (let i = 0; i < syms.length; i += 20) {
  const chunk = syms.slice(i, i + 20);
  const r = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${chunk.map((s) => `"${s}"`).join(",")})&select=symbol,bars,last_date,n_bars`, { headers: hdr });
  if (!r.ok) throw new Error(`read ${r.status}`);
  const rows = await r.json() as { symbol: string; bars: number[][]; last_date: string | null; n_bars: number | null }[];
  const seen = new Set(rows.map((x) => x.symbol)); for (const s of chunk) if (!seen.has(s)) missing.push(s);
  for (const x of rows) {
    const b = x.bars; if (!b?.length) continue;
    const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    const last = iso(b[b.length - 1][0]);
    if (x.last_date === last && x.n_bars === b.length) { done++; continue; }
    const w = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(x.symbol)}`, { method: "PATCH", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({ first_date: iso(b[0][0]), last_date: last, n_bars: b.length, updated_at: new Date().toISOString() }) });
    if (!w.ok) throw new Error(`write ${x.symbol} ${w.status}`);
    console.log(`    ${x.symbol.padEnd(10)} last_date ${x.last_date} -> ${last}   n_bars ${x.n_bars} -> ${b.length}`); changed++; done++;
  }
}
console.log(`  metadata backfill: ${done} symbols checked, ${changed} corrected, ${missing.length} not in panel${missing.length ? ": " + missing.join(" ") : ""}`);
if (missing.length) { console.error("  RED — positive control: listed symbols absent from the panel"); Deno.exit(1); }
