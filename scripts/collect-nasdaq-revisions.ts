#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// collect-nasdaq-revisions.ts (D-817) — daily snapshot of analyst consensus EPS and the 4-week up/down REVISION counts per
// name from Nasdaq's keyless analyst endpoint (browser UA). No history exists free; this is a FORWARD series (the same
// honest response as the options collectors: start the clock). Universe: the top N liquid-decile equities by 2025 dollar
// volume. Series per name (next fiscal quarter): nq_eps_<SYM>, nq_nest_<SYM>, nq_revup_<SYM>, nq_revdn_<SYM>. Idempotent by day.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("collect-nasdaq-revisions", [{ name: "N_NAMES", def: "150", note: "the endpoint answers in 1-3s; 150 names ~ 6 min daily" }, { name: "PAUSE_MS", def: "100" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "nqr", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const REPO = new URL("..", import.meta.url).pathname; const today = new Date().toISOString().slice(0, 10);
const dec = JSON.parse(await Deno.readTextFile(`${REPO}data/liquid-decile.json`)) as { symbols: string[] };
const eq = new Set<string>(); for (let off = 0; ; off += 1000) { const p = await q(`trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`) as { symbol: string }[]; for (const r of p) eq.add(r.symbol); if (p.length < 1000) break; }
const syms = dec.symbols.filter((s) => eq.has(s) && /^[A-Z]{1,5}$/.test(s)).slice(0, +K.N_NAMES); assertNonEmpty("universe", syms, 50);
const rows: { series: string; d: string; v: number }[] = []; let ok = 0, miss = 0;
for (const s of syms) {
  const r = await fetch(`https://api.nasdaq.com/api/analyst/${s}/earnings-forecast`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }).catch(() => null); await new Promise((x) => setTimeout(x, +K.PAUSE_MS));
  const j = r && r.ok ? await r.json().catch(() => null) as { data?: { quarterlyForecast?: { rows?: Record<string, string>[] } } } | null : null;
  const row = j?.data?.quarterlyForecast?.rows?.[0]; if (!row) { miss++; continue; }
  const num = (x: string | undefined) => { const v = Number(String(x ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(v) ? v : NaN; };
  const eps = num(row.consensusEPSForecast), n = num(row.noOfEstimates), up = num(row.up), dn = num(row.down);
  if (Number.isFinite(eps)) rows.push({ series: `nq_eps_${s}`, d: today, v: eps }); if (Number.isFinite(n)) rows.push({ series: `nq_nest_${s}`, d: today, v: n }); if (Number.isFinite(up)) rows.push({ series: `nq_revup_${s}`, d: today, v: up }); if (Number.isFinite(dn)) rows.push({ series: `nq_revdn_${s}`, d: today, v: dn }); ok++;
}
if (ok < 0.6 * syms.length) { console.error(`  RED — only ${ok}/${syms.length} names answered (positive control 60%)`); Deno.exit(1); }
for (let i = 0; i < rows.length; i += 1000) { const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }); if (!w.ok) { console.error(`  RED — write ${w.status}`); Deno.exit(1); } }
const back = (await q(`trd_macro_series?series=eq.nq_revup_AAPL&d=eq.${today}&select=v`) as { v: number }[])[0];
console.log(`==> NASDAQ REVISIONS ${today}: ${ok}/${syms.length} names, ${rows.length} rows (${miss} without a forecast); AAPL revisions up (4w) = ${back?.v ?? "MISSING"}`);
if (!back) { console.error("  RED — AAPL read-back missing"); Deno.exit(1); }
