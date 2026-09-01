#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-eia-inventories.ts (D-743) — EIA WEEKLY INVENTORIES, free and keyless, from the same dnav XLS mirror as the
// futures curve (D-742). Closes the last "free, unfetched" item on the commodity line of the odds map: US commercial
// crude stocks ex-SPR (WCESTUS1, weekly from 1982) and Lower-48 working natural-gas storage (weekly from 1993/2010 series).
// These are the physical-balance drivers for CL and NG — the thing the weekly EIA report moves prices on. Loaded to
// trd_macro_series as eia_crude_stocks_w / eia_ng_storage_w with d = the WEEK-ENDING date (the report comes out
// ~5-6 days later; the consuming test must apply that publication lag, and does — see inventory-surprise.ts).
import * as XLSX from "npm:xlsx@0.18.5";
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-eia-inventories", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eiainv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

const FILES: [string, string][] = [
  ["pet/hist_xls/WCESTUS1w.xls", "eia_crude_stocks_w"],           // thousand barrels, US commercial crude EXCLUDING SPR (WCRSTUS1 is total incl. SPR ~800M — the control caught that)
  ["ng/hist_xls/NW2_EPG0_SWO_R48_BCFw.xls", "eia_ng_storage_w"],  // bcf, Lower-48 working gas
];
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);

const out: { series: string; d: string; v: number }[] = [];
for (const [path, name] of FILES) {   // sequential fetches (Hard Rule 1)
  const r = await fetch(`https://www.eia.gov/dnav/${path}`, { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
  if (!r || !r.ok) { console.log(`  ${name}: fetch failed (${r?.status ?? "net"})`); continue; }
  const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Data 1"], { header: 1, raw: true }) as unknown[][];
  let n = 0, first = "", last = "";
  for (const row of rows) {
    if (typeof row[0] !== "number" || typeof row[1] !== "number" || !Number.isFinite(row[1])) continue;
    const d = serial(row[0]); out.push({ series: name, d, v: row[1] }); n++; if (!first) first = d; last = d;
  }
  console.log(`  ${name}: ${n} obs, ${first} .. ${last}`);
}
assertNonEmpty("eia inventory observations", out, 1000);

// POSITIVE CONTROLS: US commercial crude stocks have sat in a 400-550 million-barrel band (i.e. 400,000-550,000
// thousand bbl) throughout 2023-2024; Lower-48 working gas peaked above 3,500 bcf in Nov-2023. Either wrong => the
// parse/units are wrong, not the world.
const crude24 = out.filter((o) => o.series === "eia_crude_stocks_w" && o.d.startsWith("2024")).map((o) => o.v);
const ngNov23 = Math.max(...out.filter((o) => o.series === "eia_ng_storage_w" && o.d >= "2023-10-15" && o.d <= "2023-12-15").map((o) => o.v), -Infinity);
const crudeOk = crude24.length > 20 && Math.min(...crude24) > 380_000 && Math.max(...crude24) < 560_000;
console.log(`==> EIA inventories: crude 2024 range ${Math.min(...crude24)}-${Math.max(...crude24)} kbbl (band 380k-560k) | NG storage Nov-2023 peak ${ngNov23} bcf (must be > 3500)`);
if (!(crudeOk && ngNov23 > 3500)) { console.error("!! EIA inventory control FAILED. RED."); Deno.exit(1); }

let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series (eia_crude_stocks_w, eia_ng_storage_w). Inventories: unfetched -> HELD, free.`);
