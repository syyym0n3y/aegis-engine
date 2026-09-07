#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-deribit-dvol.ts (D-817) — Deribit's implied-volatility index (DVOL) DAILY history for BTC and ETH, keyless, from
// 2021-03 -> today: the IV history the variance-premium retest (D-574) and any vol-as-input test needs, in the placeable
// venue. Series: deribit_<ccy>_dvol (close of the daily bar, annualised %). Incremental from the newest held day; windows
// of <= 1,000 days per request (the API caps points); positive controls: >= 1,500 days per ccy after a full run, read-back.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-deribit-dvol", [{ name: "CCYS", def: "BTC,ETH" }, { name: "FROM", def: "2021-03-01" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dvol", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
for (const ccy of K.CCYS.split(",")) {
  const series = `deribit_${ccy.toLowerCase()}_dvol`; const newest = (await q(`trd_macro_series?series=eq.${series}&select=d&order=d.desc&limit=1`) as { d: string }[])[0]?.d;
  let start = Date.parse((newest ?? K.FROM) + "T00:00:00Z") + (newest ? 86400000 : 0); const end = Date.now(); const rows: { series: string; d: string; v: number }[] = [];
  while (start < end) {
    const stop = Math.min(end, start + 900 * 86400000);
    const r = await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${ccy}&resolution=86400&start_timestamp=${start}&end_timestamp=${stop}`); if (!r.ok) { console.error(`  RED — ${ccy} ${r.status}`); Deno.exit(1); }
    const j = await r.json() as { result?: { data?: number[][] } }; const data = j.result?.data ?? [];
    for (const p of data) { const v = Number(p[4]); if (Number.isFinite(v)) rows.push({ series, d: new Date(p[0]).toISOString().slice(0, 10), v }); }
    start = stop + 1; await new Promise((x) => setTimeout(x, 200));
  }
  // dedupe (series, d): a point on a window boundary can arrive twice, and one statement cannot upsert the same key twice (500)
  const seen = new Set<string>(); const uniq = rows.filter((x) => { const k = x.series + x.d; if (seen.has(k)) return false; seen.add(k); return true; }); rows.length = 0; rows.push(...uniq);
  for (let i = 0; i < rows.length; i += 1000) { const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }); if (!w.ok) { console.error(`  RED — write ${w.status}`); Deno.exit(1); } }
  const held = await q(`trd_macro_series?series=eq.${series}&select=d&limit=1`).then(() => q(`trd_macro_series?series=eq.${series}&select=d&order=d.asc&limit=1`)) as { d: string }[]; const cnt = (await fetch(`${OWNED}/trd_macro_series?series=eq.${series}&select=d&limit=1`, { headers: { ...hdr, Prefer: "count=exact" } })).headers.get("content-range")?.split("/")[1];
  console.log(`==> DVOL ${ccy}: +${rows.length} days written; held ${cnt} days from ${held[0]?.d}; newest ${rows[rows.length - 1]?.d ?? newest} = ${rows[rows.length - 1]?.v ?? "-"}`);
  if (Number(cnt) < 1500) { console.error(`  RED — ${ccy}: only ${cnt} days held (expected >= 1,500)`); Deno.exit(1); }
}
console.log("  positive controls passed");
