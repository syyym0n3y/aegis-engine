#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-gpr.ts (D-727) — the Caldara-Iacoviello GEOPOLITICAL RISK index, closing driver #2 of the coverage matrix
// (D-726) from DEBT to HELD. Free, monthly since 1900, from the now-allowlisted matteoiacoviello.com. Loads the
// headline GPR plus its threats/acts decomposition into trd_macro_series as a conditioning driver for gold, oil,
// safe-haven FX and equity risk. It is a CONDITION driver (a level/change that precedes moves), not EXPLAIN-only.
import * as XLSX from "npm:xlsx@0.18.5";
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-gpr", [
  { name: "URL", def: "https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls", note: "monthly GPR export (allowlisted)" },
  { name: "CACHE", def: "/Users/ona/Projects/aegis/data/gpr/gpr_monthly.xls", note: "local cache of the workbook" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gpr", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

// Fetch fresh (falls back to cache on a network error so a re-run is offline-safe).
let buf: Uint8Array;
try {
  const r = await fetch(K.URL);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  buf = new Uint8Array(await r.arrayBuffer());
  await Deno.writeFile(K.CACHE, buf).catch(() => {});
} catch (e) {
  console.log(`  fetch failed (${e instanceof Error ? e.message : e}); using cache`);
  buf = await Deno.readFile(K.CACHE);
}
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][];
assertNonEmpty("gpr rows", rows, 100);
const head = (rows[0] as unknown[]).map((x) => String(x));
const col = (name: string) => head.indexOf(name);
const iMonth = col("month"), iGpr = col("GPR"), iT = col("GPRT"), iA = col("GPRA");
if (iMonth < 0 || iGpr < 0) { console.error(`!! GPR columns not found (month=${iMonth}, GPR=${iGpr}). RED.`); Deno.exit(1); }

// `month` is an EXCEL SERIAL date (1 = 1900-01, ~46200 = 2026), monthly spacing. Convert serial -> UTC date via the
// standard 25569-day Excel/Unix epoch offset, then snap to that month's LAST day so it aligns with how the stack
// stamps monthly data. Anything outside a sane [1900, 2100] window is refused rather than guessed.
function monthEnd(m: unknown): string | null {
  const n = Number(m);
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;      // 80000 ~= year 2119, a generous upper guard
  const dt = new Date(Math.round((n - 25569) * 86400 * 1000));
  const y = dt.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  return new Date(Date.UTC(y, dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); // last day of the month
}

const series: { series: string; d: string; v: number }[] = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i] as unknown[];
  const d = monthEnd(r[iMonth]);
  if (!d) continue;
  const push = (name: string, idx: number) => { if (idx >= 0) { const v = Number(r[idx]); if (Number.isFinite(v)) series.push({ series: name, d, v }); } };
  push("gpr", iGpr); push("gpr_threats", iT); push("gpr_acts", iA);
}
assertNonEmpty("gpr observations", series, 500);

// POSITIVE CONTROL: known geopolitical spikes must read HIGH. If they do not, the parse/scale is wrong, not the world.
const byd = new Map(series.filter((s) => s.series === "gpr").map((s) => [s.d, s.v]));
const gulf = byd.get("1990-08-31"), sept11 = byd.get("2001-09-30"), calm = byd.get("2019-06-30");
console.log(`==> GPR ingest — ${series.length} obs across gpr/threats/acts, ${byd.size} months`);
console.log(`    positive control: Gulf War 1990-08 = ${gulf?.toFixed(0)}, 9/11 2001-09 = ${sept11?.toFixed(0)}, calm 2019-06 = ${calm?.toFixed(0)}`);
if (!(gulf && sept11 && calm && gulf > calm && sept11 > calm)) { console.error(`!! positive control FAILED — spikes not above calm. Parse/scale suspect. RED.`); Deno.exit(1); }

// Idempotent upsert in chunks.
let written = 0;
for (let i = 0; i < series.length; i += 1000) {
  const chunk = series.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series (gpr, gpr_threats, gpr_acts). Driver #2 DEBT -> HELD.`);
