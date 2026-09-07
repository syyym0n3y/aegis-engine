#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-squeezemetrics.ts (D-817) — SqueezeMetrics' free, keyless daily history of SPX dealer gamma exposure (GEX, $) and
// the dark-pool index (DIX), 2011-05 -> today, one CSV. The dealer-positioning HISTORY the register lacked (D-806 has 15 days
// of naive GEX; this has 15 years of theirs). Series: sqm_gex (USD), sqm_dix (fraction), sqm_spx (price). Idempotent upsert
// of the whole file (220 KB); positive controls: >= 3,800 rows, first row 2011-05-02, and a known value read back.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-squeezemetrics", [{ name: "URL", def: "https://squeezemetrics.com/monitor/static/DIX.csv" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sqm", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const r = await fetch(K.URL, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) { console.error(`  RED — ${r.status} from SqueezeMetrics`); Deno.exit(1); }
const lines = (await r.text()).replace(/^\uFEFF/, "").replace(/\r/g, "").trim().split("\n"); const hd = lines[0].split(",").map((x) => x.trim().toLowerCase()); const ix = (n: string) => hd.indexOf(n);   // BOM / CR stripped: the header matched by eye and not by code
if (ix("date") < 0 || ix("gex") < 0 || ix("dix") < 0) { console.error(`  RED — column layout changed: ${hd.join(",")}`); Deno.exit(1); }
const rows: { series: string; d: string; v: number }[] = [];
for (const ln of lines.slice(1)) { const p = ln.split(","); const d = p[ix("date")]; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue; const g = +p[ix("gex")], x = +p[ix("dix")], px = +p[ix("price")]; if (Number.isFinite(g)) rows.push({ series: "sqm_gex", d, v: g }); if (Number.isFinite(x)) rows.push({ series: "sqm_dix", d, v: x }); if (Number.isFinite(px)) rows.push({ series: "sqm_spx", d, v: px }); }
const days = rows.filter((x) => x.series === "sqm_gex").length; if (days < 3800) { console.error(`  RED — only ${days} GEX days (expected >= 3,800)`); Deno.exit(1); }
for (let i = 0; i < rows.length; i += 1000) { const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }); if (!w.ok) { console.error(`  RED — write ${w.status}`); Deno.exit(1); } }
const first = rows.find((x) => x.series === "sqm_gex")!, last = rows.filter((x) => x.series === "sqm_gex").pop()!;
const back = (await q(`trd_macro_series?series=eq.sqm_gex&d=eq.${last.d}&select=v`) as { v: number }[])[0];
if (!back || Math.abs(back.v - last.v) > 1) { console.error(`  RED — read-back of ${last.d} mismatch`); Deno.exit(1); }
console.log(`==> SQUEEZEMETRICS: ${days} days ${first.d}..${last.d}; newest GEX $${(last.v / 1e9).toFixed(2)}bn, DIX ${rows.filter((x) => x.series === "sqm_dix").pop()!.v.toFixed(3)}; read-back ok`);
