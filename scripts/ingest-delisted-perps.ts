#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// ingest-delisted-perps.ts (D-806) — the crypto delisted cohort, closed. D-639 found the name list was the binding constraint
// (fapi serves klines for contracts exchangeInfo no longer lists) and that the one source enumerating every contract that
// ever had futures data — data.binance.vision — was off the allowlist. It is on it now (operator-authorized free host):
// 874 USDT-M contracts ever; 510 held; 352 currently listed but under the 400-day minimum-history threshold (D-646, a
// threshold not a hole); 12 absent from exchangeInfo entirely = the delisted cohort. This ingests those 12 (or SYMBOLS).
// Controls: bars need close>0 AND volume>0 (LENDUSDT's post-delisting history is flat zero-volume placeholders — a
// "history" that would pass a close>0 check and mean nothing); a contract with < MIN_BARS usable bars is recorded as
// NO USABLE HISTORY, never written; a held symbol is never overwritten with fewer bars (the D-724 rule).
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-delisted-perps", [
  { name: "SYMBOLS", def: "1000BTTCUSDT,AERGOUSDT,ANCUSDT,BDXNUSDT,BLUEBIRDUSDT,BTCSTUSDT,DOTECOUSDT,FOOTBALLUSDT,LENDUSDT,MBLUSDT,NUUSDT,SXPUSDT", note: "the 12 measured absent from exchangeInfo, 2026-09-06" },
  { name: "MIN_BARS", def: "400", note: "the panel's minimum-history threshold (D-646)" },
  { name: "PAUSE_MS", def: "250", note: "sequential by Hard Rule" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "idp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { q } = mkStrictRead(OWNED, hdr);   // a transport failure is LOUD, never an empty result (SILENT-READ class)
const syms = assertNonEmpty("symbols", K.SYMBOLS.split(/[,\s]+/).filter(Boolean));
let written = 0; const skipped: string[] = [], nohist: string[] = [];
for (const sym of syms) {
  const cur = await q(`trd_bars_intraday?tf=eq.1dSF&symbol=eq.${sym}&select=n_bars`) as { n_bars: number }[];
  const held = cur[0]?.n_bars ?? 0;
  const seen = new Map<number, number[]>(); let cursor = 0, placeholders = 0;
  for (let page = 0; page < 12; page++) {
    const j = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1500&startTime=${cursor}`).then((r) => r.ok ? r.json() : null).catch(() => null);
    await sleep(+K.PAUSE_MS);
    if (!Array.isArray(j) || !j.length) break;
    for (const kk of j as (string | number)[][]) { const t = Math.floor(+kk[0] / 1000), c = +kk[4], v = +kk[5]; if (c > 0 && v > 0) seen.set(t, [t, +kk[1], +kk[2], +kk[3], c, v, +kk[7], +kk[9], +kk[8]]); else placeholders++; }
    if (j.length < 1500) break;
    cursor = +(j[j.length - 1] as (string | number)[])[0] + 86400000;
  }
  const bars = [...seen.values()].sort((a, b) => a[0] - b[0]);
  const span = bars.length ? `${new Date(bars[0][0] * 1000).toISOString().slice(0, 10)}..${new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10)}` : "-";
  if (bars.length < +K.MIN_BARS) { nohist.push(`${sym}(${bars.length} usable, ${placeholders} zero-volume, ${span})`); continue; }
  if (bars.length <= held) { skipped.push(`${sym}(held ${held} >= ${bars.length})`); continue; }
  const res = await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ symbol: sym, tf: "1dSF", bars, n_bars: bars.length }]) });
  if (!res.ok) throw new Error(`write ${sym} ${res.status}`);
  written++; console.log(`    ${sym.padEnd(14)} ${String(bars.length).padStart(5)} bars  ${span}  (${placeholders} zero-volume placeholders dropped)`);
}
console.log(`\n==> DELISTED PERPS: ${written} written | ${skipped.length} already held | ${nohist.length} below ${K.MIN_BARS} usable bars: ${nohist.join(" ")}`);
console.log(`    coverage statement: USDT-M contracts ever 874 = 510 held + 352 currently listed under the ${K.MIN_BARS}-day threshold + 12 delisted (this run).`);
