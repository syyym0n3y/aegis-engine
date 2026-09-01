#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-cboe.ts (D-737) — CBOE's FREE daily vol/options indices, closing PART of the options gap without paying.
// The full per-strike equity options surface is genuinely paid (OptionMetrics/ORATS), but the INDEX-LEVEL
// options-sentiment and vol-regime signals CBOE publishes free are real drivers: SKEW (tail-risk / crash pricing),
// VVIX (vol-of-vol / dealer stress), VIX3M (term structure vs spot VIX). These are the "dealer positioning / tail
// pricing" family the register had as options-gated. Loaded to trd_macro_series, keyless, from cdn.cboe.com.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-cboe", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cboe", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

// index -> our series name, and which CSV column holds the value (single-value CSVs vs OHLC).
const IDX: [string, string, "single" | "close"][] = [
  ["SKEW", "cboe_skew", "single"], ["VVIX", "cboe_vvix", "single"], ["VIX3M", "cboe_vix3m", "close"],
];
const parseUS = (d: string): string | null => {   // CBOE dates are MM/DD/YYYY
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) { const iso = d.match(/^\d{4}-\d\d-\d\d/); return iso ? iso[0] : null; }
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};

const out: { series: string; d: string; v: number }[] = [];
for (const [idx, name, kind] of IDX) {
  const txt = await fetch(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${idx}_History.csv`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.text() : "").catch(() => "");
  if (!txt || txt.startsWith("<")) { console.log(`  ${idx}: fetch failed`); continue; }
  const lines = txt.trim().split("\n"); const head = lines[0].split(",").map((s) => s.trim().toUpperCase());
  const di = head.indexOf("DATE"); const vi = kind === "single" ? head.findIndex((h) => h !== "DATE") : head.indexOf("CLOSE");
  let n = 0;
  for (const line of lines.slice(1)) {
    const c = line.split(","); const d = parseUS((c[di] || "").trim()); const v = Number((c[vi] || "").trim());
    if (!d || !Number.isFinite(v) || v <= 0) continue;
    out.push({ series: name, d, v }); n++;
  }
  console.log(`  ${idx} -> ${name}: ${n} obs`);
}
assertNonEmpty("cboe observations", out, 1000);

// POSITIVE CONTROL: SKEW spikes on crash-fear; VVIX spiked in the 2020 COVID vol-of-vol blowout. If the newest SKEW
// is not a plausible 100-170 level the parse/scale is wrong.
const skewNow = out.filter((o) => o.series === "cboe_skew").sort((a, b) => a.d < b.d ? 1 : -1)[0]?.v;
console.log(`==> CBOE vol indices — newest SKEW ${skewNow?.toFixed(0)} (plausible band 100-170)`);
if (!(skewNow && skewNow > 90 && skewNow < 200)) { console.error("!! SKEW control FAILED — value out of band. RED."); Deno.exit(1); }

let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series (cboe_skew, cboe_vvix, cboe_vix3m). Options-regime family, free.`);
