#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-bls-calendar.ts (D-877) — the macro RELEASE CALENDAR, the first non-price data on this record. Sources, both
// keyless and allowlisted by the operator on 2026-09-13: the BLS .ics feed (2025-2026, times to the minute) and the
// per-year archived schedule pages 2016-2024 (Date | Time ET | Release). Stored in trd_macro_series as
// series "bls:<slug>" with d = release date and v = the release time as a DECIMAL UTC HOUR (DST-aware), so an hourly
// panel can join on the exact hour. Idempotent (upsert on series,d). POSITIVE CONTROL: CPI and Employment Situation
// must each appear ~12 times per year or the parse is wrong.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-bls-calendar", [{ name: "YEARS", def: "2016,2017,2018,2019,2020,2021,2022,2023,2024" }, { name: "PAUSE_MS", def: "800" }, { name: "DRY", def: "0" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bls", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, apikey: tok };
const UA = { "User-Agent": "Aegis research ona@revitalise.io" };
const slug = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\bfor\b.*$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
// ET -> UTC decimal hour, DST-aware
const utcHour = (ymd: string, hh: number, mm: number) => { const guess = new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`); const etStr = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(guess); const [eh, em] = etStr.split(":").map(Number); const offset = ((hh * 60 + mm) - (eh * 60 + em) + 1440) % 1440; const off = offset > 720 ? offset - 1440 : offset; const utc = new Date(guess.getTime() + off * 60000); return utc.getUTCHours() + utc.getUTCMinutes() / 60; };
type Row = { series: string; d: string; v: number; name: string };
const rows: Row[] = [];
// 1. the .ics (2025-2026)
const ics = await fetch("https://www.bls.gov/schedule/news_release/bls.ics", { headers: UA }).then((r) => r.ok ? r.text() : "");
for (const ev of ics.split("BEGIN:VEVENT").slice(1)) { const dt = /DTSTART[^:]*:(\d{8})T(\d{2})(\d{2})/.exec(ev); const tz = /DTSTART;TZID=([^:]+):/.exec(ev); const su = /SUMMARY:(.*)/.exec(ev); if (!dt || !su) continue; const ymd = `${dt[1].slice(0, 4)}-${dt[1].slice(4, 6)}-${dt[1].slice(6, 8)}`; const hh = +dt[2], mm = +dt[3]; const v = tz && /New_York|Eastern/.test(tz[1]) ? utcHour(ymd, hh, mm) : hh + mm / 60; rows.push({ series: `bls:${slug(su[1])}`, d: ymd, v: +v.toFixed(3), name: su[1].trim() }); }
console.log(`  .ics: ${rows.length} events`);
// 2. archived per-year pages
for (const y of K.YEARS.split(",")) { const html = await fetch(`https://www.bls.gov/schedule/${y}/home.htm`, { headers: UA }).then((r) => r.ok ? r.text() : ""); await new Promise((z) => setTimeout(z, +K.PAUSE_MS)); let n = 0;
  const re = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})[\s\S]*?(\d{1,2}):(\d{2})\s*(AM|PM)[\s\S]*?<strong>([^<]+)<\/strong>/g;
  for (const m of html.matchAll(re)) { const mon = new Date(`${m[2]} 1, 2000`).getMonth() + 1; if (isNaN(mon)) continue; const ymd = `${m[4]}-${String(mon).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`; let hh = +m[5] % 12; if (m[7] === "PM") hh += 12; const v = utcHour(ymd, hh, +m[6]); rows.push({ series: `bls:${slug(m[8])}`, d: ymd, v: +v.toFixed(3), name: m[8].trim() }); n++; }
  console.log(`  ${y}: ${n} rows parsed`); }
// dedupe on (series, d)
const seen = new Set<string>(); const uniq = rows.filter((r) => { const k = `${r.series}|${r.d}`; if (seen.has(k)) return false; seen.add(k); return true; });
// POSITIVE CONTROL
const perYear = (s: string) => { const c = new Map<string, number>(); for (const r of uniq) if (r.series === s) c.set(r.d.slice(0, 4), (c.get(r.d.slice(0, 4)) ?? 0) + 1); return [...c.entries()].sort().map(([y, n]) => `${y}:${n}`).join(" "); };
console.log(`  CPI per year: ${perYear("bls:consumer-price-index")}`); console.log(`  Employment Situation per year: ${perYear("bls:employment-situation")}`);
const cpiYears = [...new Set(uniq.filter((r) => r.series === "bls:consumer-price-index").map((r) => r.d.slice(0, 4)))].length;
if (cpiYears < 8) { console.error(`  RED — CPI found in only ${cpiYears} year(s); the parse is wrong, nothing written.`); Deno.exit(1); }
console.log(`  ${uniq.length} unique (series, date) rows across ${new Set(uniq.map((r) => r.series)).size} series; sample: ${uniq.slice(0, 2).map((r) => `${r.series} ${r.d} ${r.v}h UTC`).join(" | ")}`);
if (K.DRY === "1") Deno.exit(0);
for (let i = 0; i < uniq.length; i += 500) { const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniq.slice(i, i + 500).map((r) => ({ series: r.series, d: r.d, v: r.v }))) }); if (!w.ok) { console.error(`  WRITE FAILED HTTP ${w.status}: ${(await w.text()).slice(0, 200)}`); Deno.exit(1); } }
const { q } = mkStrictRead(OWNED, hdr); const back = await q(`trd_macro_series?series=eq.bls:consumer-price-index&select=d&order=d.desc&limit=1`) as { d: string }[];
console.log(`  written; read-back newest CPI date ${back[0]?.d}`);
