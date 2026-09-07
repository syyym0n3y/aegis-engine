#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-binance-mirror.ts (D-808) — free, keyless HISTORICAL order-book depth, flow metrics and 5-minute klines from
// Binance's public data mirror (data.binance.vision, allowlisted D-806). This is the crypto half of the operator's
// L2 / footprint / order-flow request; equities and FX L2 have no free source and stay BLOCKED — paid.
//   bookDepth  per-minute notional at +/-1..5% of mid, both sides (from 2023-01-01)  -> hourly aggregates
//   metrics    5-minute OI, top-trader L/S ratios, taker buy/sell ratio (from 2020-09-01) -> kept as-is
//   klines 5m  with taker_buy_volume (footprint proxy)                                  -> [t,o,h,l,c,v,takerBuy]
// Stored as FILES (data/binance-mirror/<ds>/<SYM>.jsonl, one line per day) — no schema change. Idempotent per day
// (a day already present is skipped). Sequential, paced. Positive controls: every symbol x dataset gets >= 90% of
// its requested days, or the run is RED (a missing day is 404-listed, never silently absent).
import { declareKnobs, assertSingleInstance } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-binance-mirror", [
  { name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT" },
  { name: "DATASETS", def: "klines5m,metrics,bookDepth", note: "5m first so the composite can run before depth lands" },
  { name: "FROM_DEPTH", def: "2023-01-01", note: "bookDepth + 5m start" }, { name: "FROM_METRICS", def: "2023-01-01", note: "aligned with depth (metrics exist from 2020-09; a coverage choice, stated in D-808)" },
  { name: "TO", def: "2026-09-04" }, { name: "PAUSE_MS", def: "0", note: "sequential already paces at one request in flight" }, { name: "OUT", def: "data/binance-mirror" },
]);
await assertSingleInstance(import.meta.url);
const REPO = new URL("..", import.meta.url).pathname; const OUT = K.OUT.startsWith("/") ? K.OUT : `${REPO}${K.OUT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const days = (from: string, to: string) => { const out: string[] = []; const d = new Date(from + "T00:00:00Z"); const e = new Date(to + "T00:00:00Z"); while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
async function csvFromZip(url: string): Promise<string | null> {
  // transient 5xx from the mirror: retry with backoff (a 503 killed the first run at day 500 of 1,291); 404 = not published
  let r: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) { r = await fetch(url); if (r.status < 500) break; await r.body?.cancel(); await sleep(2000 * (attempt + 1) ** 2); }
  if (!r) throw new Error(`no response ${url}`); if (r.status === 404) { await r.body?.cancel(); return null; } if (!r.ok) throw new Error(`${r.status} after retries ${url}`);
  // SPEED (operator, 2026-09-06): inflate IN-PROCESS — single-file DEFLATE zip, local-header parse, DecompressionStream
  // (the ingest-french-library.ts approach) — instead of a temp file + an `unzip` subprocess per file.
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error(`not a zip: ${url}`);
  const method = buf[8] | buf[9] << 8, nameLen = buf[26] | buf[27] << 8, extraLen = buf[28] | buf[29] << 8;
  const csize = (buf[18] | buf[19] << 8 | buf[20] << 16 | buf[21] << 24) >>> 0; const start = 30 + nameLen + extraLen;
  const comp = buf.subarray(start, csize > 0 ? start + csize : undefined);
  if (method === 0) return new TextDecoder().decode(comp);
  const out = new Response(new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  return new TextDecoder().decode(new Uint8Array(await out.arrayBuffer()));
}
function aggDepth(csv: string) {   // -> per hour: mean notional bid/ask at 1,2,3,4,5% and imbalance at 1% and 5%
  const H: Record<number, Record<string, number[]>> = {};
  for (const ln of csv.split("\n").slice(1)) { const p = ln.split(","); if (p.length < 4) continue; const hr = Number(p[0].slice(11, 13)); const pct = Number(p[1]), notional = Number(p[3]); if (!Number.isFinite(pct) || !Number.isFinite(notional)) continue; const key = `${pct > 0 ? "a" : "b"}${Math.abs(pct)}`; ((H[hr] ??= {})[key] ??= []).push(notional); }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  return Object.entries(H).map(([hr, m]) => { const g = (k: string) => mean(m[k] ?? []); const b1 = g("b1"), a1 = g("a1"), b5 = g("b5"), a5 = g("a5"); return { hr: Number(hr), n: (m["b1"] ?? []).length, b1, a1, b5, a5, imb1: (b1 - a1) / ((b1 + a1) || 1), imb5: (b5 - a5) / ((b5 + a5) || 1) }; }).sort((x, y) => x.hr - y.hr);
}
let red = false;
for (const ds of K.DATASETS.split(",")) for (const sym of K.SYMBOLS.split(",")) {
  const dir = `${OUT}/${ds}`; await Deno.mkdir(dir, { recursive: true }); const file = `${dir}/${sym}.jsonl`;
  const have = new Set<string>(); try { for (const ln of (await Deno.readTextFile(file)).split("\n")) if (ln) have.add(JSON.parse(ln).d); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const months = (from: string, to: string) => { const out: string[] = []; let y = +from.slice(0, 4), m = +from.slice(5, 7); const ey = +to.slice(0, 4), em = +to.slice(5, 7); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; };
  // 5m klines come as MONTHLY archives (the mirror has no monthly bookDepth/metrics): one record per month, d = YYYY-MM
  const want = (ds === "klines5m" ? months(K.FROM_DEPTH, K.TO) : days(ds === "metrics" ? K.FROM_METRICS : K.FROM_DEPTH, K.TO)).filter((d) => !have.has(d));
  let got = 0, miss = 0; const missing: string[] = [];
  for (const d of want) {
    const url = ds === "klines5m" ? `https://data.binance.vision/data/futures/um/monthly/klines/${sym}/5m/${sym}-5m-${d}.zip` : `https://data.binance.vision/data/futures/um/daily/${ds}/${sym}/${sym}-${ds}-${d}.zip`;
    const csv = await csvFromZip(url); await sleep(+K.PAUSE_MS);
    if (csv == null) { miss++; missing.push(d); await Deno.writeTextFile(file, JSON.stringify({ d, missing: true }) + "\n", { append: true }); continue; }   // remembered: never re-requested
    let rec: unknown;
    if (ds === "bookDepth") rec = { d, hours: aggDepth(csv) };
    else if (ds === "metrics") rec = { d, rows: csv.split("\n").slice(1).filter((l) => l.includes(",")).map((l) => { const p = l.split(","); return [p[0], +p[2], +p[3], +p[4], +p[5], +p[6], +p[7]]; }) };
    else rec = { d, bars: csv.split("\n").slice(1).filter((l) => /^\d/.test(l)).map((l) => { const p = l.split(","); return [Math.floor(+p[0] / 1000), +p[1], +p[2], +p[3], +p[4], +p[5], +p[9]]; }) };
    await Deno.writeTextFile(file, JSON.stringify(rec) + "\n", { append: true }); got++;
    if (got % 100 === 0) console.log(`  ${ds}/${sym}: ${got}/${want.length}`);
  }
  const total = have.size + got, req = have.size + want.length;
  console.log(`==> ${ds}/${sym}: ${got} new, ${have.size} had, ${miss} missing (404) — ${total}/${req} days${missing.length ? "; missing: " + missing.slice(0, 5).join(",") + (missing.length > 5 ? "…" : "") : ""}`);
  if (total < 0.9 * req) { console.error(`  RED — ${ds}/${sym} below 90% of requested days`); red = true; }
}
if (red) Deno.exit(1); console.log("  positive controls passed (>= 90% of requested days for every symbol x dataset)");
// CONTINUITY MARKS (D-809): the data lives in files, and the driver register / continuity guard probe the database — so each
// dataset x symbol writes `binance_mirror_<ds>_<SYM>` = days held, d = today, to trd_macro_series. A register entry that
// cannot be probed is a label, and labels lie green (driver-register memory, twice).
{
  const SECRET = Deno.env.get("JWT_SECRET"); const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
  if (!SECRET) { console.error("  RED — JWT_SECRET unset: continuity marks not written"); Deno.exit(1); }
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const hh = e({ alg: "HS256", typ: "JWT" }), bb = e({ role: "service_role", iss: "bmm", exp: 4102444800 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${hh}.${bb}`)));
  const tok = `${hh}.${bb}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const rows: { series: string; d: string; v: number }[] = []; const today = new Date().toISOString().slice(0, 10);
  for (const ds of K.DATASETS.split(",")) for (const sym of K.SYMBOLS.split(",")) { let n = 0; try { for (const ln of (await Deno.readTextFile(`${OUT}/${ds}/${sym}.jsonl`)).split("\n")) if (ln) n++; } catch (err) { if (!(err instanceof Deno.errors.NotFound)) throw err; } rows.push({ series: `binance_mirror_${ds}_${sym}`, d: today, v: n }); }
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, apikey: tok, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  if (!w.ok) { console.error(`  RED — continuity marks write failed ${w.status}`); Deno.exit(1); }
  console.log(`  continuity marks written: ${rows.map((r) => `${r.series}=${r.v}`).join(", ")}`);
}
