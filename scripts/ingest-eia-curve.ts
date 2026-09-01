#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-eia-curve.ts (D-742) — the commodity FUTURES CURVE, free and keyless, from EIA's dnav XLS mirror. Closes the
// "no 2nd contract" block that kept commodity CARRY/ROLL UNTESTED (odds map). Yahoo serves dated contracts only while
// they are listed (every historical front month is 404 — verified in D-742's probe), and EIA's v2 API needs a key;
// but EIA also publishes the same series as static XLS: Contract 1..4 daily settlements, WTI (RCLC1..4, from 1983)
// and Henry Hub NG (RNGC1..4, from 1994). Loaded to trd_macro_series as eia_cl_c1.. / eia_ng_c1.. — the generic keyed
// store, no schema change. Only CL and NG are published this way; GC/ZC/ZW/ZS/HG/SI have no free curve source found.
//
// KNOWN LIMIT, stated not hidden: the XLS mirror's data ended 2024-04-05 at ingest time (file stamp 2026-08), so this
// is a RESEARCH history for the backtest, not a live feed — it is NOT wired into the daily runner as a fresh source.
import * as XLSX from "npm:xlsx@0.18.5";
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-eia-curve", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eia", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

// EIA file -> our series. Contracts 1 and 2 are what roll yield needs; 3 and 4 are cheap and give curve slope context.
const FILES: [string, string][] = [
  ["pet/hist_xls/RCLC1d.xls", "eia_cl_c1"], ["pet/hist_xls/RCLC2d.xls", "eia_cl_c2"],
  ["pet/hist_xls/RCLC3d.xls", "eia_cl_c3"], ["pet/hist_xls/RCLC4d.xls", "eia_cl_c4"],
  ["ng/hist_xls/RNGC1d.xls", "eia_ng_c1"], ["ng/hist_xls/RNGC2d.xls", "eia_ng_c2"],
  ["ng/hist_xls/RNGC3d.xls", "eia_ng_c3"], ["ng/hist_xls/RNGC4d.xls", "eia_ng_c4"],
];
const serial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); // Excel 1900 epoch

const out: { series: string; d: string; v: number }[] = [];
for (const [path, name] of FILES) {   // sequential — one fetch, read it, next (Hard Rule 1)
  const r = await fetch(`https://www.eia.gov/dnav/${path}`, { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
  if (!r || !r.ok) { console.log(`  ${name}: fetch failed (${r?.status ?? "net"})`); continue; }
  const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Data 1"], { header: 1, raw: true }) as unknown[][];
  let n = 0, last = "";
  for (const row of rows) {
    if (typeof row[0] !== "number" || typeof row[1] !== "number" || !Number.isFinite(row[1])) continue;
    const d = serial(row[0]); out.push({ series: name, d, v: row[1] }); n++; last = d;
  }
  console.log(`  ${name}: ${n} obs, last ${last}`);
}
assertNonEmpty("eia curve observations", out, 5000);

// POSITIVE CONTROLS: WTI front settled NEGATIVE on 2020-04-20 (-37.63) — a value no broken parse produces by accident;
// and NG front exceeded $8 in 2022. Either wrong => the parse/series is wrong, not the world.
const cl = new Map(out.filter((o) => o.series === "eia_cl_c1").map((o) => [o.d, o.v]));
const ngMax22 = Math.max(...out.filter((o) => o.series === "eia_ng_c1" && o.d.startsWith("2022")).map((o) => o.v), -Infinity);
console.log(`==> EIA curve: CL c1 on 2020-04-20 = ${cl.get("2020-04-20")} (must be < 0) | NG c1 2022 max = ${ngMax22.toFixed(2)} (must be > 8)`);
if (!((cl.get("2020-04-20") ?? 1) < 0 && ngMax22 > 8)) { console.error("!! EIA curve control FAILED. RED."); Deno.exit(1); }

let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series (eia_cl_c1..c4, eia_ng_c1..c4). Commodity curve: UNTESTED -> testable for CL/NG.`);
