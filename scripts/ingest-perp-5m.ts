#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-perp-5m.ts (D-881) — MAGNIFY THE DATA: 5-minute bars (2 years) and 1-minute bars (90 days) for the deepest
// perps, from Binance futures klines (allowlisted, keyless), so direction can be studied below the hour with every field
// the venue gives per bar: [ts, o, h, l, c, vol, quoteVol, takerBuyBase, nTrades]. Sequential, paced, idempotent (upsert
// on symbol,tf), one symbol per write (D-812). Positive control: bar count per symbol must be within 2% of the expected
// grid count for the span, or the fetch was throttled and the run says so.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-perp-5m", [{ name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT" }, { name: "DAYS_5M", def: "730" }, { name: "DAYS_1M", def: "90" }, { name: "PAUSE_MS", def: "150" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "p5m", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, apikey: tok };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pull(sym: string, interval: string, days: number): Promise<number[][]> {
  const step = interval === "1m" ? 60 : 300; const start = Math.floor(Date.now() / 1000 / 86400) * 86400 - days * 86400; let cursor = start * 1000; const out = new Map<number, number[]>();
  for (let page = 0; page < 5000; page++) { const j = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=1500&startTime=${cursor}`).then((r) => r.ok ? r.json() : null).catch(() => null); await sleep(+K.PAUSE_MS); if (!Array.isArray(j) || !j.length) break;
    for (const k of j as (string | number)[][]) { const t = Math.floor(+k[0] / 1000); if (+k[6] < Date.now() && +k[4] > 0) out.set(t, [t, +k[1], +k[2], +k[3], +k[4], +k[5], +k[7], +k[9], +k[8]]); }
    const last = +(j[j.length - 1] as (string | number)[])[0]; if (j.length < 1500) break; cursor = last + step * 1000; }
  const bars = [...out.values()].sort((a, b) => a[0] - b[0]); const expected = days * 86400 / step; console.log(`  ${sym} ${interval}: ${bars.length.toLocaleString()} bars (${(100 * bars.length / expected).toFixed(1)}% of the ${expected.toLocaleString()}-bar grid) ${bars.length / expected < 0.98 ? "<- SHORT: throttled or gaps" : ""}`); return bars;
}
for (const sym of K.SYMBOLS.split(",")) for (const [tf, interval, days] of [["5m", "5m", +K.DAYS_5M], ["1m90", "1m", +K.DAYS_1M]] as [string, string, number][]) {
  const bars = await pull(sym, interval, days); if (bars.length < 1000) { console.log(`  ${sym} ${tf}: too few bars, not written`); continue; }
  // one 210k-bar row is a ~12MB body and the REST layer closed the connection on it (first run); chunk by calendar quarter
  // under tf "<tf>-YYYYQn" (~26k bars, ~1.5MB each). Readers concatenate tf=like.<tf>-*.
  const byQ = new Map<string, number[][]>(); for (const b of bars) { const d = new Date(b[0] * 1000); const k = `${tf}-${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; let a = byQ.get(k); if (!a) { a = []; byQ.set(k, a); } a.push(b); }
  for (const [qtf, qb] of byQ) { const w = await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ symbol: sym, tf: qtf, bars: qb, n_bars: qb.length, first_ts: qb[0][0], last_ts: qb[qb.length - 1][0], updated_at: new Date().toISOString() }]) }).catch(() => null); if (!w || !w.ok) { console.error(`!! ${sym} ${qtf}: WRITE FAILED ${w ? w.status + " " + (await w.text()).slice(0, 160) : "network error"} — a chunk that does not land leaves a hole the grid check would not see`); Deno.exit(1); }
    console.log(`  ${sym} ${qtf}: ${qb.length} bars write ${w.status}`); await sleep(200); }
}
