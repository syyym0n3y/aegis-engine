#!/usr/bin/env -S deno run --allow-net --allow-env
// ingest-spot-full.ts (D-605) — close the spot coverage gap found while killing D-603.
//
// THE GAP. We hold 33 daily spot series. Binance lists 484 TRADING USDT spot pairs. That gap is not neutral: it
// silently defined "placeable" in D-603's first run, which is the research programme narrating its own data hole as
// a market property — the precise failure THE COVERAGE LAW exists to prevent. It also caps D-582's perp-vs-spot
// comparison at THIRTY-ONE shared names, well under the BREADTH LAW floor.
//
// An unfetched FREE dataset is a research failure, not a market finding. Binance spot klines are free and the
// endpoint is allowlisted.
//
// SEQUENTIAL BY CONSTRUCTION. One request at a time, awaited, with a pause between — no backgrounding, no
// concurrency. These calls are free, but the sequential discipline is a standing rule and a rate-limit courtesy.
// Idempotent: existing symbols are skipped unless REFRESH=1, so a re-run costs nothing and cannot duplicate.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-spot-full", [
  { name: "LIMIT_SYMBOLS", def: "0", note: "0 = all missing" },
  { name: "REFRESH", def: "", note: "1 = refetch symbols already held" },
  { name: "PAUSE_MS", def: "120", note: "delay between sequential calls" },
  { name: "MIN_BARS", def: "200", note: "skip series too short to be useful" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "is", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The exchange's own listing is the authority on what exists — not our ingest, which is the mistake being fixed.
const ex = await fetch("https://api.binance.com/api/v3/exchangeInfo", { headers: { "User-Agent": "Mozilla/5.0" } })
  .then((r) => r.json()).catch(() => null);
const listed: string[] = [];
for (const s of ex?.symbols ?? []) if (s.status === "TRADING" && s.quoteAsset === "USDT") listed.push(s.symbol);
if (listed.length < 100) { console.error(`!! exchangeInfo returned only ${listed.length} pairs — refusing to ingest against that. RED.`); Deno.exit(1); }

const haveRows = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSPOT&select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
const have = new Set((Array.isArray(haveRows) ? haveRows : []).map((x) => x.symbol));
let todo = K.REFRESH === "1" ? listed : listed.filter((s) => !have.has(s));
todo.sort();
if (Number(K.LIMIT_SYMBOLS) > 0) todo = todo.slice(0, Number(K.LIMIT_SYMBOLS));

console.log(`==> SPOT INGEST — ${listed.length} listed, ${have.size} held, ${todo.length} to fetch (sequential)`);
let ok = 0, thin = 0, failed = 0, bars = 0;

for (let i = 0; i < todo.length; i++) {
  const sym = todo[i];
  // Daily klines, oldest first, paged. Binance caps at 1000 per call.
  const all: number[][] = [];
  let startTime = 0;
  for (;;) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=1000${startTime ? `&startTime=${startTime}` : ""}`;
    let j: unknown;
    try { j = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()); }
    catch { break; }
    if (!Array.isArray(j) || !j.length) break;
    const chunk = j as (string | number)[][];
    for (const c of chunk) {
      const ts = Math.floor(Number(c[0]) / 1000);
      const o = +c[1], h = +c[2], l = +c[3], cl = +c[4], v = +c[5], qv = +c[7], tb = +c[9], n = +c[8];
      if ([o, h, l, cl].every((x) => Number.isFinite(x) && x > 0)) all.push([ts, o, h, l, cl, v, qv, tb, n]);
    }
    if (chunk.length < 1000) break;
    startTime = Number(chunk[chunk.length - 1][0]) + 86400000;
    await sleep(Number(K.PAUSE_MS));
  }
  if (all.length < Number(K.MIN_BARS)) { thin++; }
  else {
    const res = await fetch(`${OWNED}/trd_bars_intraday`, {
      method: "POST",
      headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ symbol: sym, tf: "1dSPOT", bars: all, n_bars: all.length }),
    }).catch(() => null);
    if (res && res.ok) { ok++; bars += all.length; } else { failed++; console.log(`    WRITE-FAILED ${sym} ${res ? res.status : "net"}`); }
  }
  if ((i + 1) % 25 === 0 || i === todo.length - 1) {
    console.log(`    ${String(i + 1).padStart(4)}/${todo.length}  written ${ok}  thin ${thin}  failed ${failed}  bars ${bars.toLocaleString()}`);
  }
  await sleep(Number(K.PAUSE_MS));
}

// Verify the write LANDED rather than trusting the POST responses.
const after = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSPOT&select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
console.log(`\n    DONE. written ${ok}, thin ${thin}, failed ${failed}, ${bars.toLocaleString()} bars.`);
console.log(`    spot symbols in DB: ${have.size} before -> ${Array.isArray(after) ? new Set(after.map((x) => x.symbol)).size : "?"} after (verified by re-reading, not inferred from POST status).`);
