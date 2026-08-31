#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-fred-macro.ts (D-729) — REAL YIELDS, breakeven inflation and CPI from FRED's KEYLESS fredgraph.csv,
// closing drivers #1 (CPI/inflation expectations) and #3 (real yields) of the coverage matrix (D-726) from GATED to
// HELD. The register had these as FRED-credential-gated, and memory recorded "FRED blocks the Supabase edge" — but
// that was the EDGE environment; the stack runs on the owned node now, where fredgraph.csv is reachable with no key.
// Real yield (DFII10) is gold's stated #1 driver and had been entirely absent; the nominal curve is NOT a substitute.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-fred-macro", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fred", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

// FRED id -> our series name. Real yields (DFII*, TIPS), breakevens (T*YIE), CPI.
const MAP: [string, string][] = [
  ["DFII5", "real_yield_5y"], ["DFII10", "real_yield_10y"], ["DFII30", "real_yield_30y"],
  ["T5YIE", "breakeven_5y"], ["T10YIE", "breakeven_10y"],
  ["CPIAUCSL", "cpi"], ["CPILFESL", "cpi_core"],
];

const out: { series: string; d: string; v: number }[] = [];
for (const [id, name] of MAP) {
  const txt = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`).then((r) => r.ok ? r.text() : "").catch(() => "");
  if (!txt) { console.log(`  ${id}: fetch failed — skipping`); continue; }
  let n = 0;
  for (const line of txt.trim().split("\n").slice(1)) {   // slice(1) drops the "DATE,ID" header
    const [d, raw] = line.split(",");
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || raw === "." || raw == null) continue;   // FRED marks missing as "."
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push({ series: name, d, v }); n++;
  }
  console.log(`  ${id} -> ${name}: ${n} obs`);
}
assertNonEmpty("fred observations", out, 1000);

// POSITIVE CONTROL: the 10-year REAL yield was deeply NEGATIVE at the 2021 ZIRP peak (~ -1.1%) and firmly POSITIVE by
// end-2023 (~ +2%). If that ordering is wrong the parse/series is wrong, not the world.
const ry = new Map(out.filter((o) => o.series === "real_yield_10y").map((o) => [o.d, o.v]));
const zirp = [...ry.entries()].filter(([d]) => d >= "2021-11-01" && d <= "2021-12-31").map(([, v]) => v).sort((a, b) => a - b)[0];
const tight = [...ry.entries()].filter(([d]) => d >= "2023-10-01" && d <= "2023-11-15").map(([, v]) => v).sort((a, b) => b - a)[0];
console.log(`==> FRED macro: real_yield_10y 2021-ZIRP=${zirp?.toFixed(2)}% (deeply negative) vs 2023-tightening=${tight?.toFixed(2)}% (firmly positive)`);
if (!(zirp != null && tight != null && zirp < 0 && tight > 1.5 && tight > zirp)) { console.error("!! real-yield control FAILED — 2021 not negative or 2023 not positive. RED."); Deno.exit(1); }

let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series. Drivers #1 (CPI/inflation) & #3 (real yields) GATED -> HELD.`);
