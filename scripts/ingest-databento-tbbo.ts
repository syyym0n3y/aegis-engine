#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-databento-tbbo.ts (D-816) — Nasdaq TotalView trades-with-top-of-book (TBBO) for the most liquid US names, from
// Databento's historical API, aggregated to 5-minute bars with a REAL aggressor delta and a top-of-book size imbalance.
// COST DISCIPLINE (global Hard Rules 4 and 7): every pull is preceded by `metadata.get_cost` (free) for exactly the range
// it will fetch; the run prints the total and REFUSES to fetch unless PULL=1 and the total is under CAP_USD. The account
// and key are the operator's (DATABENTO_API_KEY in infra/.env); nothing is fetched without the key. Sequential, one
// symbol-month per request. Output: data/databento/<SYM>-5m.jsonl, one line per day {d, bars:[[t,o,h,l,c,vol,delta,imb]]}.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-databento-tbbo", [
  { name: "N_NAMES", def: "20", note: "top names by 2025 dollar volume from the liquid decile (equities only)" },
  { name: "START", def: "2025-09-02" }, { name: "END", def: "2026-09-04" },
  { name: "CAP_USD", def: "100", note: "hard cap on metered cost for this run (the credit is $125)" },
  { name: "PULL", def: "0", note: "1 = fetch after the cost check; 0 = cost check only (default)" },
  { name: "OUT", def: "data/databento" }, { name: "DATASET", def: "XNAS.ITCH" },
]);
const KEY = Deno.env.get("DATABENTO_API_KEY"); if (!KEY) { console.error("  RED — DATABENTO_API_KEY is not set in infra/.env: the account is the operator's; nothing fetched"); Deno.exit(1); }
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dbn", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const REPO = new URL("..", import.meta.url).pathname; const OUT = `${REPO}${K.OUT}`; await Deno.mkdir(OUT, { recursive: true });
const AUTH = "Basic " + btoa(`${KEY}:`); const BASE = "https://hist.databento.com/v0";
// universe: liquid decile ∩ equities, ranked by 2025 mean dollar volume (one symbol per read, D-812)
const dec = JSON.parse(await Deno.readTextFile(`${REPO}data/liquid-decile.json`)) as { symbols: string[] };
const eq = new Set<string>(); for (let off = 0; ; off += 1000) { const p = await q(`trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`) as { symbol: string }[]; for (const r of p) eq.add(r.symbol); if (p.length < 1000) break; }
const cands = dec.symbols.filter((s) => eq.has(s) && /^[A-Z]{1,5}$/.test(s)).slice(0, 80);
const dv: [string, number][] = [];
for (const s of cands) { const row = (await q(`trd_bars_deep?symbol=eq.${s}&select=bars`) as { bars: number[][] }[])[0]; const b = (row?.bars ?? []).filter((x) => x[0] >= 1735689600 && x[0] < 1767225600); if (b.length > 200) dv.push([s, b.reduce((a, x) => a + x[4] * x[5], 0) / b.length]); }
dv.sort((a, b) => b[1] - a[1]); const SYMS = dv.slice(0, +K.N_NAMES).map((x) => x[0]); assertNonEmpty("universe", SYMS, 5);
console.log(`  universe (${SYMS.length}, by 2025 $ volume): ${SYMS.join(" ")}`);
// months
const months: [string, string][] = []; { const d = new Date(K.START + "T00:00:00Z"); const end = new Date(K.END + "T00:00:00Z"); while (d < end) { const s = d.toISOString().slice(0, 10); const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); const e = (n < end ? n : end).toISOString().slice(0, 10); months.push([s, e]); d.setTime(n.getTime()); } }
// 1. COST CHECK (free): one call for the whole symbol set per month
let total = 0; const costs: Record<string, number> = {};
for (const [s, e] of months) {
  const u = `${BASE}/metadata.get_cost?dataset=${K.DATASET}&symbols=${SYMS.join(",")}&schema=tbbo&start=${s}&end=${e}&mode=historical&stype_in=raw_symbol`;
  const r = await fetch(u, { headers: { Authorization: AUTH } }); if (!r.ok) { console.error(`  RED — get_cost ${r.status}: ${(await r.text()).slice(0, 200)}`); Deno.exit(1); }
  const c = Number(await r.text()); costs[s] = c; total += c; await new Promise((x) => setTimeout(x, 150));
}
console.log(`  METERED COST for ${SYMS.length} names x ${months.length} months of TBBO: $${total.toFixed(2)} (cap $${K.CAP_USD}, credit $125)`);
for (const [m, c] of Object.entries(costs)) console.log(`    ${m}: $${c.toFixed(2)}`);
if (K.PULL !== "1") { console.log("  PULL=0 — cost check only; nothing fetched. Re-run with PULL=1 to fetch under the cap."); Deno.exit(0); }
if (total > +K.CAP_USD) { console.error(`  RED — $${total.toFixed(2)} exceeds the cap $${K.CAP_USD}; reduce N_NAMES or the span (state the coverage)`); Deno.exit(1); }
// 2. PULL, one symbol-month per request, aggregate to 5-minute bars
const side = (s: string) => s === "B" ? 1 : s === "A" ? -1 : 0;   // B = buy-initiated (aggressor lifted the ask), A = sell-initiated
let spent = 0;
for (const sym of SYMS) {
  const file = `${OUT}/${sym}-5m.jsonl`; const have = new Set<string>(); try { for (const ln of (await Deno.readTextFile(file)).split("\n")) if (ln) have.add(JSON.parse(ln).d); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  for (const [s, e] of months) {
    if ([...have].some((d) => d >= s && d < e)) continue;   // month already present (any day) -> skip
    const body = new URLSearchParams({ dataset: K.DATASET, symbols: sym, schema: "tbbo", start: s, end: e, encoding: "csv", compression: "none", stype_in: "raw_symbol", pretty_px: "true", pretty_ts: "true" });
    const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!r.ok) { console.error(`  ${sym} ${s}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
    const csv = await r.text(); const lines = csv.split("\n"); const hd = lines[0].split(","); const ix = (n: string) => hd.indexOf(n);
    const iTs = ix("ts_recv") >= 0 ? ix("ts_recv") : ix("ts_event"), iPx = ix("price"), iSz = ix("size"), iSide = ix("side"), iBs = ix("bid_sz_00"), iAs = ix("ask_sz_00");
    if ([iTs, iPx, iSz, iSide, iBs, iAs].some((i) => i < 0)) { console.error(`  ${sym} ${s}: unexpected columns ${hd.slice(0, 10).join(",")}`); continue; }
    const bars = new Map<number, number[]>(); const imbs = new Map<number, number[]>();
    for (const ln of lines.slice(1)) { if (!ln) continue; const p = ln.split(","); const t = Math.floor(Date.parse(p[iTs]) / 1000); if (!Number.isFinite(t)) continue; const px = +p[iPx], sz = +p[iSz]; if (!(px > 0 && sz > 0)) continue; const t5 = Math.floor(t / 300) * 300; const b = bars.get(t5); const d = side(p[iSide]) * sz; if (!b) bars.set(t5, [t5, px, px, px, px, sz, d]); else { b[2] = Math.max(b[2], px); b[3] = Math.min(b[3], px); b[4] = px; b[5] += sz; b[6] += d; } const bs = +p[iBs], as = +p[iAs]; if (bs + as > 0) (imbs.get(t5) ?? imbs.set(t5, []).get(t5)!).push((bs - as) / (bs + as)); }
    const byDay = new Map<string, number[][]>(); for (const [t5, b] of [...bars.entries()].sort((a, c) => a[0] - c[0])) { const im = imbs.get(t5); b.push(im?.length ? im.reduce((a, x) => a + x, 0) / im.length : 0); const d = new Date(t5 * 1000).toISOString().slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b); }
    let out = ""; for (const [d, bs] of [...byDay.entries()].sort()) out += JSON.stringify({ d, bars: bs }) + "\n"; await Deno.writeTextFile(file, out, { append: true });
    spent += costs[s] / SYMS.length; console.log(`  ${sym} ${s}: ${lines.length - 1} trades -> ${bars.size} 5m bars, ${byDay.size} days (running cost ~$${spent.toFixed(2)})`);
    await new Promise((x) => setTimeout(x, 200));
  }
}
console.log(`==> DATABENTO TBBO: done, ~$${spent.toFixed(2)} metered of cap $${K.CAP_USD}`);
