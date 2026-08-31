#!/usr/bin/env -S deno run --allow-net --allow-env
// resolve-spinoff-tickers.ts (D-733) — resolve each spin-off 10-12B filing to its registrant TICKER via the EDGAR
// submissions API (data.sec.gov, allowlisted D-733). The accession prefix IS the registrant CIK (verified: CIK
// 1868275 -> Constellation Energy CEG); the submissions API returns the ticker(s) that CIK ever had, which the
// current company_tickers.json map misses for spincos that later delisted/merged (why the naive match was 2.6%).
// Writes the resolved ticker back to trd_raw_filings.ticker so the event study can join to prices. Idempotent.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("resolve-spinoff-tickers", [{ name: "SLEEP_MS", def: "150", note: "SEC asks <=10 req/s" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rst", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Unresolved spin-off filings (ticker still null).
async function pageAll(path: string) {
  const out: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) { const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr }); if (!r.ok) break; const j = await r.json(); if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break; }
  return out;
}
const filings = await pageAll("trd_raw_filings?filing_type=like.10-12B%25&ticker=is.null&select=id,source_id&order=id");
console.log(`==> resolving ${filings.length} spin-off filings via EDGAR submissions API`);
assertNonEmpty("unresolved spinoff filings", filings, 1);

const cikCache = new Map<string, string | null>();
let resolved = 0, noTicker = 0, failed = 0;
for (const f of filings) {
  const cik = String(f.source_id).split("-")[0].replace(/\D/g, "");
  if (!cik) { failed++; continue; }
  let ticker = cikCache.get(cik);
  if (ticker === undefined) {
    const padded = cik.padStart(10, "0");
    try {
      const j = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: { "User-Agent": "aegis-research ona@revitalise.io" } }).then((r) => r.ok ? r.json() : null);
      const tks = (j?.tickers as string[]) || [];
      ticker = tks.length ? tks[0] : null;   // primary listed ticker for that registrant
      cikCache.set(cik, ticker);
    } catch { ticker = null; cikCache.set(cik, null); }
    await sleep(150);
  }
  if (!ticker) { noTicker++; continue; }
  // Write the resolved ticker back (idempotent — only rows still null are selected).
  const w = await fetch(`${OWNED}/trd_raw_filings?id=eq.${f.id}`, { method: "PATCH", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({ ticker }) });
  if (!w.ok) { failed++; continue; }
  resolved++;
  if (resolved % 100 === 0) console.log(`    ${resolved} resolved, ${noTicker} no-ticker (agent/private), ${failed} failed`);
}
console.log(`\n==> DONE: ${resolved} resolved to a ticker, ${noTicker} had none (filing agent or never-listed), ${failed} failed.`);
