#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-databento-spxw-oi.ts (D-820) — SPXW per-strike daily statistics (open interest and settlement) from Databento OPRA,
// on the operator's remaining credit. COST DISCIPLINE: metadata.get_cost (free) for the exact span, refuse above CAP_USD;
// PULL=1 required. Streamed line by line, one month per request. Raw rows kept as CSV (data/databento/spxw-statistics.csv),
// plus a compact per-day map: data/databento/spxw-oi.jsonl {d, rows:[[expiry, cp, strike, oi]]} built from stat_type=9.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-databento-spxw-oi", [{ name: "START", def: "2026-03-15" }, { name: "END", def: "2026-09-04" }, { name: "CAP_USD", def: "27" }, { name: "PULL", def: "0" }, { name: "OUT", def: "data/databento" }]);
const KEY = Deno.env.get("DATABENTO_API_KEY"); if (!KEY) { console.error("  RED — DATABENTO_API_KEY unset"); Deno.exit(1); }
const REPO = new URL("..", import.meta.url).pathname; const OUT = `${REPO}${K.OUT}`; await Deno.mkdir(OUT, { recursive: true });
const AUTH = "Basic " + btoa(`${KEY}:`); const BASE = "https://hist.databento.com/v0";
const months: [string, string][] = []; { const d = new Date(K.START + "T00:00:00Z"); const end = new Date(K.END + "T00:00:00Z"); while (d < end) { const s = d.toISOString().slice(0, 10); const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); const e = (n < end ? n : end).toISOString().slice(0, 10); months.push([s, e]); d.setTime(n.getTime()); } }
let total = 0; const costs: Record<string, number> = {};
for (const [s, e] of months) { const r = await fetch(`${BASE}/metadata.get_cost?dataset=OPRA.PILLAR&symbols=SPXW.OPT&schema=statistics&start=${s}&end=${e}&mode=historical&stype_in=parent`, { headers: { Authorization: AUTH } }); if (!r.ok) { console.error(`  RED — get_cost ${r.status}`); Deno.exit(1); } const c = Number(await r.text()); costs[s] = c; total += c; await new Promise((x) => setTimeout(x, 150)); }
console.log(`  METERED COST SPXW statistics ${K.START}..${K.END}: $${total.toFixed(2)} (cap $${K.CAP_USD})`);
if (K.PULL !== "1") { console.log("  PULL=0 — nothing fetched"); Deno.exit(0); } if (total > +K.CAP_USD) { console.error("  RED — over cap"); Deno.exit(1); }
const raw = await Deno.open(`${OUT}/spxw-statistics.csv`, { write: true, create: true, truncate: true }); const enc = new TextEncoder(); let header = false, rows = 0;
const oi = new Map<string, Map<string, number>>();   // day -> "expiry|cp|strike" -> oi
for (const [s, e] of months) {
  const body = new URLSearchParams({ dataset: "OPRA.PILLAR", symbols: "SPXW.OPT", schema: "statistics", start: s, end: e, encoding: "csv", compression: "none", stype_in: "parent", pretty_px: "true", pretty_ts: "true", map_symbols: "true" });
  const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) { console.error(`  ${s}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader(); let rest = "", hd: string[] | null = null, iTs = -1, iSym = -1, iType = -1, iQty = -1, iPx = -1;
  const handle = async (ln: string) => {
    if (!hd) { hd = ln.split(","); iTs = hd.indexOf("ts_ref") >= 0 ? hd.indexOf("ts_ref") : hd.indexOf("ts_event"); iSym = hd.indexOf("symbol"); iType = hd.indexOf("stat_type"); iQty = hd.indexOf("quantity"); iPx = hd.indexOf("price"); if (!header) { await raw.write(enc.encode(ln + "\n")); header = true; } if ([iTs, iSym, iType, iQty].some((i) => i < 0)) throw new Error(`columns: ${hd.slice(0, 12).join(",")}`); return; }
    if (!ln) return; await raw.write(enc.encode(ln + "\n")); rows++;
    const p = ln.split(","); if (p[iType] !== "9") return;   // 9 = open interest
    /* D-820: ts_ref renders EMPTY for OI rows; the day is ts_event (10:30Z publish = prior close) */ const d = p[hd.indexOf("ts_event")].slice(0, 10); const sym = p[iSym]; const m = /^SPXW\s+(\d{6})([CP])(\d{8})$/.exec(sym); if (!m) return;
    const key = `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}|${m[2]}|${+m[3] / 1000}`; (oi.get(d) ?? oi.set(d, new Map()).get(d)!).set(key, +p[iQty]);
  };
  while (true) { const { value, done } = await reader.read(); if (done) break; rest += value; let nl; while ((nl = rest.indexOf("\n")) >= 0) { await handle(rest.slice(0, nl)); rest = rest.slice(nl + 1); } }
  if (rest) await handle(rest);
  console.log(`  ${s}: ${rows.toLocaleString()} rows so far, OI days ${oi.size}`);
}
raw.close();
let out = ""; for (const [d, m] of [...oi.entries()].sort()) out += JSON.stringify({ d, rows: [...m.entries()].map(([k, v]) => { const [ex, cp, st] = k.split("|"); return [ex, cp, +st, v]; }) }) + "\n";
await Deno.writeTextFile(`${OUT}/spxw-oi.jsonl`, out);
console.log(`==> SPXW OI: ${oi.size} days, ${rows.toLocaleString()} statistics rows, ~$${total.toFixed(2)} metered`);
if (oi.size < 60) { console.error("  RED — positive control: fewer than 60 OI days"); Deno.exit(1); }
