#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write --allow-read
// ingest-nq-yahoo.ts (D-709) — cache ACTUAL NQ futures intraday while it is available.
//
// WHY THIS IS URGENT RATHER THAN OPTIONAL. Yahoo serves 1-minute bars for only ~7 days and 5-minute for ~60. Both
// windows ROLL: what is fetchable today is gone next month, and no amount of later effort recovers it. Every day
// this is not run is a day permanently absent from the record.
//
// WHY IT MATTERS FOR D-708. The NQ Motion Model was tested on USATECHIDXUSD, a Nasdaq-100 CFD, because it is the
// only intraday proxy held. THE INSTRUMENT LAW says a premium must be measured in the instrument that would hold
// it, and the four times this programme ignored that it was wrong every time. NQ=F is the actual futures contract
// the model names, and MNQ tracks it exactly, so this is the placeable instrument. The overlap with the CFD is
// short but it is enough to answer whether the CFD's ten-year history is about the same thing.
//
// APPEND-ONLY BY DESIGN: each run merges into the cache keyed on (interval, timestamp), so running it daily
// accumulates a minute history that Yahoo itself will not serve twice.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ingest-nq-yahoo", [
  { name: "SYMBOL", def: "NQ=F", note: "the actual Nasdaq-100 futures continuous contract" },
  { name: "CACHE", def: "/Users/ona/aegis-data/nq_yahoo_intraday.json", note: "append-only local cache" },
]);

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }
const cachePath = K.CACHE;
let cache: Record<string, Bar[]> = {};
try { cache = JSON.parse(await Deno.readTextFile(cachePath)); } catch { /* first run */ }
const before = Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, v.length]));

// SEQUENTIAL by Hard Rule — one interval at a time, each a separate free request to an allowlisted host.
for (const [interval, range] of [["1m", "7d"], ["5m", "60d"], ["15m", "60d"], ["1h", "730d"]] as [string, string][]) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(K.SYMBOL)}?interval=${interval}&range=${range}`;
  const j = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  await new Promise((r) => setTimeout(r, 400));
  const res = j?.chart?.result?.[0];
  const ts: number[] | undefined = res?.timestamp;
  const q = res?.indicators?.quote?.[0];
  if (!ts || !q?.close) { console.log(`  ${interval}: unavailable`); continue; }
  const merged = new Map<number, Bar>();
  for (const b of cache[interval] ?? []) merged.set(b.t, b);
  let added = 0;
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    if (c == null || !Number.isFinite(c)) continue;
    // A bar already held is NOT overwritten: the cache is the record, and a later vendor revision silently replacing
    // a stored bar is the D-635 data-version problem in miniature.
    if (merged.has(ts[i])) continue;
    merged.set(ts[i], { t: ts[i], o: q.open[i] ?? c, h: q.high[i] ?? c, l: q.low[i] ?? c, c, v: q.volume?.[i] ?? 0 });
    added++;
  }
  cache[interval] = [...merged.values()].sort((a, b) => a.t - b.t);
  const first = cache[interval][0], last = cache[interval][cache[interval].length - 1];
  console.log(`  ${interval.padEnd(4)} ${String(cache[interval].length).padStart(6)} bars (+${added} new)  ${new Date(first.t * 1000).toISOString().slice(0, 10)} .. ${new Date(last.t * 1000).toISOString().slice(0, 10)}`);
}
assertNonEmpty("intervals cached", Object.keys(cache), 1);
await Deno.writeTextFile(cachePath, JSON.stringify(cache));

// Verified by re-read, not by the absence of an exception — a write that silently truncated would look identical.
const back = JSON.parse(await Deno.readTextFile(cachePath)) as Record<string, Bar[]>;
console.log(`\n  cache written to ${cachePath}, verified by re-read:`);
let shrunk = 0;
for (const [k, v] of Object.entries(back)) {
  const b0 = before[k] ?? 0;
  if (v.length < b0) { shrunk++; console.log(`  !! ${k} SHRANK ${b0} -> ${v.length} — refusing to treat this as success`); }
  else console.log(`     ${k.padEnd(4)} ${String(v.length).padStart(6)} bars (was ${b0})`);
}
if (shrunk) Deno.exit(1);
console.log(`\n  RUN THIS DAILY. Yahoo's 1m window is ~7 days and rolls; a day not fetched is a day gone for good.`);
