// ingest-onchain.ts (D-928) — BTC on-chain fundamentals from blockchain.info (free, keyless, allowlisted).
// The first non-price/non-flow data class: network usage. Stored to trd_macro_series as onchain_btc_<metric>.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-onchain", []);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "oc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const CHARTS = ["market-price", "n-unique-addresses", "n-transactions", "estimated-transaction-volume-usd", "hash-rate", "miners-revenue", "transaction-fees-usd", "mempool-size"];
for (const c of CHARTS) {
  const url = `https://api.blockchain.info/charts/${c}?timespan=all&format=json&sampled=false`;
  const j = await fetch(url).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const vals = (j.values ?? []) as { x: number; y: number }[];
  if (!vals.length) { console.log(`  ${c}: FAILED (${j.error ?? "no values"})`); continue; }
  const series = "onchain_btc_" + c.replace(/-/g, "_");
  const byDay = new Map<string, number>(); for (const v of vals) if (isFinite(v.y)) byDay.set(new Date(v.x * 1000).toISOString().slice(0, 10), v.y);
  const rows = [...byDay].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => ({ series, d, v }));
  // upsert in chunks
  let ok = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const r = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) }); // plumbing-ok: audited — status checked next line
    if (r.ok) ok += chunk.length; else { console.log(`  ${series}: chunk ${i} -> ${r.status} ${(await r.text()).slice(0,120)}`); break; }
  }
  const first = rows[0]?.d, last = rows[rows.length - 1]?.d;
  console.log(`  ${series}: ${ok}/${rows.length} rows, ${first}..${last}, latest value ${rows[rows.length-1]?.v}`);
}
console.log("ingest-onchain done.");
