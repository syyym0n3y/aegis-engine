#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-blockchair.ts (D-966) — the Blockchair half of the coingecko-blockchair gap row. Blockchair's keyless free
// tier serves CURRENT multi-chain stats only (deep history is paid), so this is a FEED that accrues value daily —
// planted now, wired into daily-up.sh, one row per chain-metric per day into trd_macro_series (series,d,v scalars,
// same shape as onchain_btc_* from D-928). Extends on-chain coverage from BTC-only (blockchain.info) to 6 chains.
// Sequential, 1.5s spacing, ~6 calls/day. Positive control: bitcoin block height must exceed 900,000.
// Honest scope note: with no free history, no backtest is claimable from this for months — the value IS the accrual,
// and a continuity budget gets registered the day any verdict leans on these series.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-blockchair", []);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t };
const CHAINS = ["bitcoin", "ethereum", "litecoin", "dogecoin", "bitcoin-cash", "monero"];
const METRICS = ["transactions_24h", "mempool_transactions", "average_transaction_fee_usd_24h", "hashrate_24h", "blocks"];
const d = new Date().toISOString().slice(0, 10); const rows: { series: string; d: string; v: number }[] = [];
let btcBlocks = 0;
for (const c of CHAINS) {
  const r = await fetch(`https://api.blockchair.com/${c}/stats`); // plumbing-ok: audited — status checked next line
  if (!r.ok) { console.log(`  ${c}: HTTP ${r.status} — skipped (partial day kept)`); continue; }
  const j = (await r.json()).data as Record<string, unknown>;
  for (const m of METRICS) { const v = Number(j?.[m]); if (isFinite(v) && v !== 0) rows.push({ series: `bc_${c.replace("-", "")}_${m}`, d, v }); }
  if (c === "bitcoin") btcBlocks = Number(j?.blocks) || 0;
  await new Promise((x) => setTimeout(x, 1500));
}
if (btcBlocks < 900000) { console.error(`!! POSITIVE CONTROL FAILED: bitcoin blocks=${btcBlocks} (< 900,000) — refusing to write.`); Deno.exit(1); }
if (!rows.length) { console.error("!! no rows parsed — refusing to certify an empty day."); Deno.exit(1); }
const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }); // plumbing-ok: audited — status checked next line
if (!w.ok) { console.error(`!! write FAILED HTTP ${w.status}: ${(await w.text()).slice(0, 150)}`); Deno.exit(1); }
// verify the write LANDED (accountability directive): read one row back
const rb = await fetch(`${OWNED}/trd_macro_series?series=eq.bc_bitcoin_blocks&d=eq.${d}&select=v`, { headers: hdr }).then((x) => x.json()); // plumbing-ok: audited — read-back check
console.log(`==> D-966 BLOCKCHAIR FEED — ${rows.length} chain-metric rows for ${d} written; read-back bc_bitcoin_blocks=${rb?.[0]?.v ?? "MISSING"} (control ${btcBlocks})`);
