#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-gld-holdings.ts (D-745) — SPDR Gold Trust DAILY HOLDINGS from the issuer's historical archive (XLSX), the
// register's last "RESEARCH DEBT (free and unfetched)" item: ETF FLOW, i.e. the ounces actually held by the trust and
// the shares outstanding, not the GLD price. Loaded to trd_macro_series as gld_tonnes, gld_shares_out (millions),
// gld_premium_pct. Daily from 2004-11-18, LIVE (the archive is republished daily). The old CSV path now serves a PDF;
// the live link is the api.spdrgoldshares.com historical-archive endpoint, found on the issuer's historical-data page.
// Issuer terms: the file is for information only and may not be redistributed — this programme is single-operator
// research that never publishes data or signals (CLAUDE.md invariant), which is the use made of it here.
import * as XLSX from "npm:xlsx@0.18.5";
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-gld-holdings", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gld", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();

const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const parseD = (s: unknown): string | null => { const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); return m && MON[m[2]] ? `${m[3]}-${MON[m[2]]}-${m[1].padStart(2, "0")}` : null; };
const OZ_PER_TONNE = 32150.7466;

const r = await fetch("https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en", { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
if (!r || !r.ok) { console.error(`  GLD archive fetch failed (${r?.status ?? "net"}). RED.`); Deno.exit(1); }
const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
const sheet = wb.SheetNames.find((n) => /archive/i.test(n)) ?? wb.SheetNames[wb.SheetNames.length - 1];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true }) as unknown[][];
const head = (rows[0] || []).map((h) => String(h));
const iDate = 0, iOzPerShare = head.findIndex((h) => /Ounces of Gold per Share/i.test(h)), iPrem = head.findIndex((h) => /Premium\/Discount/i.test(h)), iTotOz = head.findIndex((h) => /Total Ounces/i.test(h));
if (iOzPerShare < 0 || iTotOz < 0) { console.error(`  GLD archive columns changed: ${head.join(" | ")}. RED.`); Deno.exit(1); }

const out: { series: string; d: string; v: number }[] = [];
let n = 0, first = "", last = "";
for (const row of rows.slice(1)) {
  const d = parseD(row[iDate]); const tot = Number(row[iTotOz]), ops = Number(row[iOzPerShare]);
  if (!d || !Number.isFinite(tot) || !Number.isFinite(ops) || !(tot > 0) || !(ops > 0)) continue;   // "US Holiday" rows drop here
  out.push({ series: "gld_tonnes", d, v: tot / OZ_PER_TONNE });
  out.push({ series: "gld_shares_out", d, v: tot / ops / 1e6 });
  const prem = Number(row[iPrem]); if (Number.isFinite(prem)) out.push({ series: "gld_premium_pct", d, v: prem });
  n++; if (!first) first = d; last = d;
}
console.log(`  GLD archive: ${n} trading days ${first} .. ${last} (sheet "${sheet}")`);
assertNonEmpty("gld holdings", out, 3000);

// POSITIVE CONTROLS: GLD's holdings peaked near 1,270 tonnes in Aug-2020 and were ~640 tonnes at the Dec-2015 trough;
// the ordering and rough levels are public record. Wrong => the parse/units are wrong, not the world.
const t = new Map(out.filter((o) => o.series === "gld_tonnes").map((o) => [o.d, o.v]));
const peak20 = Math.max(...[...t.entries()].filter(([d]) => d >= "2020-07-01" && d <= "2020-09-30").map(([, v]) => v), -Infinity);
const trough15 = Math.min(...[...t.entries()].filter(([d]) => d >= "2015-11-01" && d <= "2016-01-31").map(([, v]) => v), Infinity);
console.log(`==> GLD holdings: Aug-2020 peak ${peak20.toFixed(0)}t (must be > 1150) | Dec-2015 trough ${trough15.toFixed(0)}t (must be < 750)`);
if (!(peak20 > 1150 && trough15 < 750 && peak20 > trough15)) { console.error("!! GLD holdings control FAILED. RED."); Deno.exit(1); }

let written = 0;
for (let i = 0; i < out.length; i += 1000) {
  const chunk = out.slice(i, i + 1000);
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(chunk) });
  if (!w.ok && w.status !== 409) { console.error(`  WRITE-FAILED trd_macro_series ${w.status} ${(await w.text()).slice(0, 120)}`); Deno.exit(1); }
  written += chunk.length;
}
console.log(`    ${written} rows upserted -> trd_macro_series (gld_tonnes, gld_shares_out, gld_premium_pct). ETF flow: RESEARCH DEBT -> HELD, live.`);
