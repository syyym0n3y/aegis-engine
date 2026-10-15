#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-uk-macro.ts (D-989) — the UK rates and releases every GBP row of the basket was blocked on (D-987).
//
// Sources, both free and keyless, allowlisted by the operator 2026-10-15, each PROBED WITH ONE CALL before this was
// written (D-989 records the probe output):
//   * Bank of England IADB CSV (`_iadb-fromshowcolumns.asp?csv.x=yes`): Bank Rate IUDBEDR, SONIA IUDSOIA, nominal
//     zero-coupon gilt yields 5/10/20y IUDSNZC/IUDMNZC/IUDLNZC, real (index-linked) 10y IUDMRZC, implied inflation 10y
//     IUDMIZC. Daily; the fitted curves land ~1 business day after the close (the probe's newest row was blank).
//     The IADB rejects non-browser user agents, so a browser UA is sent (stated, not hidden).
//   * ONS time-series JSON (`www.ons.gov.uk/<path>/timeseries/<cdid>/<dataset>/data`): CPI annual rate D7G7, CPIH annual
//     rate L55O, CPI index D7BT (MM23); unemployment rate MGSX, employment rate LF24, AWE total pay 3m-avg YoY KAC3 (LMS).
//     Every series' TITLE is asserted (a wrong CDID returns a valid series about something else — the D-743 SPR lesson).
// RELEASE DATES: ONS stamps each observation with the `updateDate` of the release that last touched it. For CPI, which
// is never revised, an observation whose stamp falls 35-60 days after its reference month is its FIRST release; those
// are stored as `ons_release:cpi` (d = release date in London, v = YYYYMM of the reference month). Re-stamped history
// (e.g. the 2015 rebasing) fails the window and is excluded, never guessed. Same rule for the labour release (35-75d).
// Stored in trd_macro_series (series, d, v) — no schema change. Idempotent upsert. Sequential, paced.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-uk-macro", [
  { name: "BOE_FROM", def: "", note: "dd/Mon/yyyy; empty = incremental from 10 days before the newest Bank Rate held (full 1975+ if none)" },
  { name: "PAUSE_MS", def: "1200", note: "between ONS calls (sequential by Hard Rule)" },
  { name: "DRY", def: "0" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ukm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const tok = await jwt();
const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rows: { series: string; d: string; v: number }[] = [];
let red = 0;

// ---------------------------------------------------------------------------------------------------- BoE
const BOE: [string, string][] = [["IUDBEDR", "boe_bank_rate"], ["IUDSOIA", "boe_sonia"], ["IUDSNZC", "gilt_nom_zc_5y"], ["IUDMNZC", "gilt_nom_zc_10y"],
  ["IUDLNZC", "gilt_nom_zc_20y"], ["IUDMRZC", "gilt_real_zc_10y"], ["IUDMIZC", "gilt_infl_zc_10y"]];
let from = K.BOE_FROM;
if (!from) {
  const nb = await q(`trd_macro_series?series=eq.boe_bank_rate&select=d&order=d.desc&limit=1`) as { d: string }[];
  if (nb.length) { const t = new Date(Date.parse(nb[0].d + "T00:00:00Z") - 10 * 86400e3); from = `${String(t.getUTCDate()).padStart(2, "0")}/${MON[t.getUTCMonth()]}/${t.getUTCFullYear()}`; }
  else from = "01/Jan/1975";
}
const boeUrl = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${from}&Dateto=now&SeriesCodes=${BOE.map((b) => b[0]).join(",")}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
const csv = await fetch(boeUrl, { headers: UA }).then((r) => r.ok ? r.text() : "").catch(() => "");
const lines = csv.trim().split(/\r?\n/);
const head = lines[0]?.split(",") ?? [];
if (head[0] !== "DATE" || BOE.some(([c]) => !head.includes(c))) { console.error(`!! RED BoE: header ${JSON.stringify(head).slice(0, 160)} — not the requested columns (HTML error page or changed format)`); red++; }
else {
  let n = 0;
  for (const ln of lines.slice(1)) {
    const c = ln.split(","); const m = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(c[0]); if (!m) continue;
    const d = `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1]}`;
    for (const [code, name] of BOE) { const raw = c[head.indexOf(code)]; if (raw === undefined || raw === "") continue; const v = Number(raw); if (Number.isFinite(v)) { rows.push({ series: name, d, v }); n++; } }
  }
  console.log(`  BoE IADB from ${from}: ${lines.length - 1} dates, ${n} values`);
  // POSITIVE CONTROL: Bank Rate must sit in a sane band and SONIA must track it within 0.5pp on the newest common date.
  const br = rows.filter((r) => r.series === "boe_bank_rate").at(-1), so = rows.filter((r) => r.series === "boe_sonia").at(-1);
  if (!br || !so || !(br.v >= 0 && br.v <= 20) || Math.abs(br.v - so.v) > 0.5) { console.error(`!! RED BoE positive control: Bank Rate ${br?.v} / SONIA ${so?.v}`); red++; }
  else console.log(`  BoE control ok: Bank Rate ${br.v}% (${br.d}), SONIA ${so.v}% (${so.d})`);
}

// ---------------------------------------------------------------------------------------------------- ONS
const ONS: { cdid: string; path: string; ds: string; name: string; title: RegExp; release?: [string, number, number] }[] = [
  { cdid: "d7g7", path: "economy/inflationandpriceindices", ds: "mm23", name: "ons_cpi_yoy", title: /CPI ANNUAL RATE 00: ALL ITEMS/i, release: ["ons_release:cpi", 35, 60] },
  { cdid: "l55o", path: "economy/inflationandpriceindices", ds: "mm23", name: "ons_cpih_yoy", title: /CPIH ANNUAL RATE 00: ALL ITEMS/i },
  { cdid: "d7bt", path: "economy/inflationandpriceindices", ds: "mm23", name: "ons_cpi_index", title: /CPI INDEX 00: ALL ITEMS/i },
  { cdid: "mgsx", path: "employmentandlabourmarket/peoplenotinwork/unemployment", ds: "lms", name: "ons_unemp_rate", title: /unemployment rate/i, release: ["ons_release:lms", 35, 75] },
  { cdid: "lf24", path: "employmentandlabourmarket/peopleinwork/employmentandemployeetypes", ds: "lms", name: "ons_emp_rate", title: /employment rate/i },
  { cdid: "kac3", path: "employmentandlabourmarket/peopleinwork/earningsandworkinghours", ds: "lms", name: "ons_awe_total_3m_yoy", title: /average weekly earnings|AWE/i },
];
const MONU = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const london = (isoZ: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoZ));
for (const s of ONS) {
  await new Promise((z) => setTimeout(z, +K.PAUSE_MS));
  const j = await fetch(`https://www.ons.gov.uk/${s.path}/timeseries/${s.cdid}/${s.ds}/data`, { headers: UA }).then((r) => r.ok ? r.json() : null).catch(() => null) as
    { description?: { title?: string }; months?: { date: string; value: string; updateDate?: string }[] } | null;
  const title = j?.description?.title ?? "";
  if (!j || !Array.isArray(j.months) || !s.title.test(title)) { console.error(`!! RED ONS ${s.cdid}: ${j ? `title "${title}" does not match ${s.title}` : "no JSON"}`); red++; continue; }
  let n = 0, nr = 0;
  for (const m of j.months) {
    const [y, mo] = m.date.split(" "); const mi = MONU.indexOf(mo); const v = Number(m.value);
    if (mi < 0 || m.value === "" || !Number.isFinite(v)) continue;
    const d = `${y}-${String(mi + 1).padStart(2, "0")}-01`; rows.push({ series: s.name, d, v }); n++;
    if (s.release && m.updateDate) {
      const rd = london(m.updateDate.replace(/(\.\d+)?Z$/, "Z")); const lag = (Date.parse(rd) - Date.parse(d)) / 86400e3;
      if (lag >= s.release[1] && lag <= s.release[2]) { rows.push({ series: s.release[0], d: rd, v: Number(y) * 100 + mi + 1 }); nr++; }
    }
  }
  console.log(`  ONS ${s.cdid.toUpperCase()} -> ${s.name}: ${n} months ("${title.slice(0, 60)}")${s.release ? `, ${nr} first-release dates -> ${s.release[0]}` : ""}`);
  if (n < 100) { console.error(`!! RED ONS ${s.cdid}: only ${n} months`); red++; }
}

// ---------------------------------------------------------------------------------------------------- write
if (K.DRY === "1") { console.log(`  DRY: ${rows.length} rows not written`); Deno.exit(red ? 1 : 0); }
const seen = new Set<string>(); const uniq = rows.filter((r) => { const k = `${r.series}|${r.d}`; if (seen.has(k)) return false; seen.add(k); return true; });
for (let i = 0; i < uniq.length; i += 1000) {
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniq.slice(i, i + 1000)) }); // plumbing-ok: status checked next line
  if (!w.ok) { console.error(`!! WRITE FAILED HTTP ${w.status}: ${(await w.text()).slice(0, 160)}`); Deno.exit(1); }
}
const back = await q(`trd_macro_series?series=eq.boe_bank_rate&select=d,v&order=d.desc&limit=1`) as { d: string; v: number }[];
console.log(`==> UK macro: ${uniq.length} rows upserted; read-back Bank Rate ${back[0]?.v}% @ ${back[0]?.d}`);
if (red) { console.error(`!! ${red} source(s) RED above`); Deno.exit(1); }
