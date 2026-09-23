#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write
// rebuild-spxw-oi-from-csv.ts (D-967) — distill a raw SPXW statistics CSV (Databento, kept on disk) into the
// per-day OI jsonl WITHOUT re-buying anything. Exists because the 2026-09-23 pull was killed mid-run when the
// operator surfaced there is no payment method: the raw CSV (2021-01..2022-04, the squeeze + bear onset) survived;
// the in-memory distillate did not. Same parsing as ingest-databento-spxw-oi.ts (stat_type=9, ts_event day).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("rebuild-spxw-oi-from-csv", [
  { name: "IN", def: "data/databento-2021/spxw-statistics.csv" },
  { name: "OUT_JSONL", def: "data/databento-2021/spxw-oi.jsonl" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const f = await Deno.open(`${REPO}${K.IN}`, { read: true });
const reader = f.readable.pipeThrough(new TextDecoderStream()).getReader();
let rest = "", hd: string[] | null = null, iSym = -1, iType = -1, iQty = -1, iEv = -1, n = 0;
const oi = new Map<string, Map<string, number>>();
const handle = (ln: string) => {
  if (!hd) { hd = ln.split(","); iSym = hd.indexOf("symbol"); iType = hd.indexOf("stat_type"); iQty = hd.indexOf("quantity"); iEv = hd.indexOf("ts_event"); if ([iSym, iType, iQty, iEv].some((i) => i < 0)) throw new Error(`columns: ${hd.slice(0, 12).join(",")}`); return; }
  if (!ln) return; const p = ln.split(","); if (p[iType] !== "9") return; n++;
  const d = p[iEv].slice(0, 10); const m = /^SPXW\s+(\d{6})([CP])(\d{8})$/.exec(p[iSym]); if (!m) return;
  const key = `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}|${m[2]}|${+m[3] / 1000}`;
  (oi.get(d) ?? oi.set(d, new Map()).get(d)!).set(key, +p[iQty]);
};
while (true) { const { value, done } = await reader.read(); if (done) break; rest += value; let nl; while ((nl = rest.indexOf("\n")) >= 0) { handle(rest.slice(0, nl)); rest = rest.slice(nl + 1); } }
if (rest) handle(rest);
if (oi.size < 60) { console.error(`!! positive control: only ${oi.size} OI days parsed — refusing.`); Deno.exit(1); }
let out = ""; for (const [d, m] of [...oi.entries()].sort()) out += JSON.stringify({ d, rows: [...m.entries()].map(([k, v]) => { const [ex, cp, st] = k.split("|"); return [ex, cp, +st, v]; }) }) + "\n";
await Deno.writeTextFile(`${REPO}${K.OUT_JSONL}`, out);
const days = [...oi.keys()].sort();
console.log(`==> rebuilt ${oi.size} OI days (${days[0]} .. ${days[days.length - 1]}) from ${n.toLocaleString()} OI rows -> ${K.OUT_JSONL}`);
