// ingest-attention.ts (D-929) — Wikipedia daily pageviews as a public-attention/sentiment data class (keyless, allowlisted).
// Stored to trd_macro_series as attention_wiki_<article>. The first crowd-attention (non-price/flow/positioning) class.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-attention", []);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "at", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const ARTICLES = ["Bitcoin", "Ethereum", "Cryptocurrency", "Stock_market", "S%26P_500", "Recession", "Inflation", "Gold", "Silver", "Federal_Reserve"];
const START = "20150701", END = "20260915";
for (const a of ARTICLES) {
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${a}/daily/${START}/${END}`; // Analytics API host (needs wikimedia.org allowlisted)
  const j = await fetch(url, { headers: { "User-Agent": "aegis-research/1.0 (research)" } }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const items = (j.items ?? []) as { timestamp: string; views: number }[];
  if (!items.length) { console.log(`  ${a}: FAILED (${j.error ?? JSON.stringify(j).slice(0,100)})`); continue; }
  const series = "attention_wiki_" + decodeURIComponent(a).replace(/%26/g, "and").replace(/[^A-Za-z0-9]/g, "_").toLowerCase();
  const rows = items.filter((v) => isFinite(v.views)).map((v) => ({ series, d: `${v.timestamp.slice(0,4)}-${v.timestamp.slice(4,6)}-${v.timestamp.slice(6,8)}`, v: v.views }));
  let ok = 0;
  for (let i = 0; i < rows.length; i += 2000) { const chunk = rows.slice(i, i + 2000); const r = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) }); if (r.ok) ok += chunk.length; else { console.log(`  ${series}: chunk ${i} -> ${r.status} ${(await r.text()).slice(0,100)}`); break; } } // plumbing-ok: audited — status checked
  console.log(`  ${series}: ${ok}/${rows.length} rows, ${rows[0]?.d}..${rows[rows.length-1]?.d}, peak ${Math.max(...rows.map(r=>r.v)).toLocaleString()}`);
}
console.log("ingest-attention done.");
