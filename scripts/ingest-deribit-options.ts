#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-deribit-options.ts (D-792) — daily FORWARD-ONLY snapshot of the Deribit BTC/ETH option book, the one
// genuinely new mechanism in the operator's screenshots ("market-maker positioning"). Deribit's public API returns
// the CURRENT book only (per-strike open_interest, mark_iv, underlying_price) — there is no per-strike history, so
// this feed cannot be backtested; it accumulates from today and becomes a conditioner only once it has months of
// marks. Stated up front so nobody later reads a 30-day series as a tested edge (COVERAGE LAW).
//
// Aggregates stored per currency per UTC day in trd_macro_series (generic keyed store, on_conflict=series,d):
//   deribit_<ccy>_opt_call_oi       total call OI, coin units (1 contract = 1 coin)
//   deribit_<ccy>_opt_put_oi        total put OI, coin units
//   deribit_<ccy>_opt_pcr           put/call OI ratio
//   deribit_<ccy>_opt_oi_usd        (call+put OI) x spot
//   deribit_<ccy>_opt_atm_iv        mark IV (%) of the nearest-ATM contract with 7-45 days to expiry
//   deribit_<ccy>_opt_naive_gex_usd Black-Scholes dollar gamma per 1% move, summed: +calls -puts. THIS IS A CONVENTION
//                                   (SpotGamma-style "dealers long calls / short puts"), not observed dealer inventory.
// Sequential fetches (one per currency), allowlisted host, $0. PRECONDITION LAW: declareKnobs + positive controls +
// read-back count (assertTouched-style) so a silent non-write cannot pass as success.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-deribit-options", [
  { name: "CURRENCIES", def: "BTC,ETH", note: "comma list of Deribit option currencies to snapshot" },
  { name: "MIN_INSTRUMENTS", def: "100", note: "positive-control floor: a book with fewer live instruments is a broken fetch" },
]);
const CCYS = K.CURRENCIES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const MIN_INST = Number(K.MIN_INSTRUMENTS);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dbo", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { instrument_name: string; open_interest: number; mark_iv: number; underlying_price: number }
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
// Deribit names: BTC-11SEP26-72000-C  (expiry DDMMMYY, settles 08:00 UTC)
function parseName(n: string): { expMs: number; strike: number; cp: "C" | "P" } | null {
  const p = n.split("-"); if (p.length !== 4) return null;
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(p[1]); if (!m) return null;
  const mon = MON[m[2]]; if (mon === undefined) return null;
  const expMs = Date.UTC(2000 + Number(m[3]), mon, Number(m[1]), 8);
  const strike = Number(p[2]); if (!(strike > 0)) return null;
  const cp = p[3] === "C" ? "C" : p[3] === "P" ? "P" : null; if (!cp) return null;
  return { expMs, strike, cp };
}
const pdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const today = new Date().toISOString().slice(0, 10);
const nowMs = Date.now();
const rows: { series: string; d: string; v: number }[] = [];

for (let ci = 0; ci < CCYS.length; ci++) {
  const ccy = CCYS[ci];
  if (ci > 0) await sleep(300);                                         // sequential + polite
  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${ccy}&kind=option`;
  const j = await fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null) as { result?: Row[] } | null;
  const book = j?.result ?? [];
  // POSITIVE CONTROL 1: a live book has hundreds of instruments
  if (book.length < MIN_INST) { console.error(`!! ${ccy}: ${book.length} instruments (< ${MIN_INST}) — fetch broken or allowlist/host issue. Aborting.`); Deno.exit(1); }

  let callOi = 0, putOi = 0, gex = 0, spot = 0, parsed = 0;
  let atm: { dist: number; iv: number } | null = null;
  for (const r of book) {
    const p = parseName(r.instrument_name); if (!p) continue;
    const S = Number(r.underlying_price), oi = Number(r.open_interest) || 0, iv = Number(r.mark_iv) / 100;
    if (!(S > 0)) continue;
    spot = S; parsed++;
    if (p.cp === "C") callOi += oi; else putOi += oi;
    const T = (p.expMs - nowMs) / (365.25 * 86400e3);
    if (T <= 0 || !(iv > 0)) continue;
    const sig = iv * Math.sqrt(T);
    const d1 = (Math.log(S / p.strike) + 0.5 * iv * iv * T) / sig;
    const gamma = pdf(d1) / (S * sig);                                  // BS gamma, r=0
    const dollarGamma1pct = gamma * S * S * 0.01 * oi;                  // per 1% spot move, all OI contracts
    gex += p.cp === "C" ? dollarGamma1pct : -dollarGamma1pct;           // CONVENTION: +calls -puts
    const days = T * 365.25;
    if (days >= 7 && days <= 45) {
      const dist = Math.abs(Math.log(S / p.strike));
      if (!atm || dist < atm.dist) atm = { dist, iv: Number(r.mark_iv) };
    }
  }
  // POSITIVE CONTROLS 2-4: both sides carry OI, spot sane, ATM IV in a plausible band
  if (!(callOi > 0 && putOi > 0)) { console.error(`!! ${ccy}: call OI ${callOi} / put OI ${putOi} — one side empty, field mapping wrong. Aborting.`); Deno.exit(1); }
  if (!atm || atm.iv < 10 || atm.iv > 300) { console.error(`!! ${ccy}: ATM IV ${atm?.iv ?? "none"} outside 10-300 — parse/expiry logic wrong. Aborting.`); Deno.exit(1); }
  const pre = `deribit_${ccy.toLowerCase()}_opt_`;
  rows.push(
    { series: pre + "call_oi", d: today, v: callOi },
    { series: pre + "put_oi", d: today, v: putOi },
    { series: pre + "pcr", d: today, v: putOi / callOi },
    { series: pre + "oi_usd", d: today, v: (callOi + putOi) * spot },
    { series: pre + "atm_iv", d: today, v: atm.iv },
    { series: pre + "naive_gex_usd", d: today, v: gex },
  );
  console.log(`  ${ccy}: ${book.length} instruments (${parsed} parsed), spot ${spot.toFixed(0)}, call OI ${callOi.toFixed(0)} / put OI ${putOi.toFixed(0)} (PCR ${(putOi / callOi).toFixed(2)}), OI $${((callOi + putOi) * spot / 1e9).toFixed(2)}B, ATM IV ${atm.iv.toFixed(1)}%, naive GEX $${(gex / 1e6).toFixed(1)}M per 1%`);
}

// WRITE — same upsert pattern as ingest-fred-macro.ts / ingest-cboe.ts
const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, {
  method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows),
});
if (!w.ok) { console.error(`!! WRITE FAILED HTTP ${w.status}: ${(await w.text()).slice(0, 300)}`); Deno.exit(1); }

// READ-BACK (assertTouched): every row we sent must be present for today, or the write silently missed (D-598 class)
const names = rows.map((r) => r.series);
const back = await q(`trd_macro_series?d=eq.${today}&series=in.(${names.join(",")})&select=series,v`) as { series: string; v: number }[];
if (back.length !== rows.length) { console.error(`!! READ-BACK: expected ${rows.length} rows for ${today}, found ${back.length}. Aborting RED.`); Deno.exit(1); }
console.log(`==> DERIBIT OPTIONS SNAPSHOT ${today}: ${rows.length} series landed and read back (${CCYS.join(", ")}). Forward-only feed — no history exists; not a tested conditioner until months accumulate.`);
