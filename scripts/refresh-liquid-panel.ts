#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// refresh-liquid-panel.ts (D-799) — the live input refresher for clock #18. `refresh-bars.ts` keeps ~53 attribution
// symbols fresh BY DESIGN; nothing refreshed the 12,300-symbol daily panel (`trd_bars_deep`), whose newest bar froze at
// 2026-08-28 — and `fwd-eq-belowPML-liquid-K5-day-clustered` scores its forward events on that panel. A frozen input means
// the clock accrues ZERO forward event-days while reporting "not-yet-computable": the D-613 failure the clock exists to
// avoid. This refreshes exactly the universe the clock trades — the liquid top-decile by pre-SPLIT median dollar volume,
// the SAME definition the scorer uses — daily, sequentially, idempotently.
//
// FETCH DISCIPLINE. Incremental: period1 = held newest − LOOKBACK_D, period2 = now (NEVER range=max — Yahoo silently
// downgrades that to monthly bars, D-750). Bars are split/dividend-adjusted the same way refresh-bars.ts does (whole bar
// scaled by adjclose/close). Because held history was adjusted at ITS pull time, an ex-dividend or split since then moves
// the basis: the OVERLAP CHECK compares held vs incoming closes on the overlapping dates and, if any differs by more than
// OVERLAP_TOL, falls back to a FULL-history pull for that symbol (with the D-687 ticker-recycling refusal). Otherwise the
// incoming window replaces the held tail and the row is upserted on `symbol` with the same {symbol, bars} shape.
//
// PATHS resolve from import.meta.url (the D-798 lesson — the runner's cwd is infra/). The decile list is cached
// (data/liquid-decile.json) and rebuilt when older than REBUILD_D so the daily run loads 1,226 rows, not 12,300.
// CONTINUITY: writes trd_macro_series `liquid_panel_refresh` (d=today, v=refreshed) and reads it back; the continuity
// guard watches that series with a 3-day budget. Positive controls abort loud; a write that lands nothing exits RED.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("refresh-liquid-panel", [
  { name: "TOP_PCT", def: "10", note: "liquid decile = top TOP_PCT% by pre-SPLIT median dollar volume (clock #18's definition)" },
  { name: "MIN_BARS", def: "500", note: "universe floor, same as the scorer" },
  { name: "SPLIT", def: "2023-01-01", note: "MDV window ends here — identical to the scorer's train/test boundary" },
  { name: "STALE_D", def: "3", note: "only refetch symbols whose newest bar is older than this many days" },
  { name: "LOOKBACK_D", def: "15", note: "incremental window starts this many days before the held newest bar" },
  { name: "OVERLAP_TOL", def: "0.005", note: "held vs incoming close disagreement on an overlapping date beyond this => basis moved => full pull" },
  { name: "PAUSE_MS", def: "250", note: "between fetches; sequential by Hard Rule" },
  { name: "CACHE", def: "data/liquid-decile.json", note: "repo-relative decile cache" },
  { name: "REBUILD_D", def: "7", note: "rebuild the decile cache when older than this" },
  { name: "MAX_SYMBOLS", def: "0", note: "0 = all; >0 caps the run (verification runs only)" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const abs = (p: string) => p.startsWith("/") ? p : `${REPO}${p}`;
const CACHE = abs(K.CACHE), TOP = Number(K.TOP_PCT) / 100, MIN_BARS = Number(K.MIN_BARS);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const STALE_MS = Number(K.STALE_D) * 864e5, LOOKBACK_S = Number(K.LOOKBACK_D) * 86400, TOL = Number(K.OVERLAP_TOL);
const PAUSE = Number(K.PAUSE_MS), MAXS = Number(K.MAX_SYMBOLS);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rlp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

// ---------- 1. the liquid decile (cached; rebuilt when stale) — SAME definition as the clock #18 scorer ----------
interface Cache { built: string; cutoffMdv: number; universe: number; symbols: string[] }
async function buildDecile(): Promise<Cache> {
  const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
  assertNonEmpty("universe meta", meta, 1000);
  const mdv: { sym: string; mdv: number }[] = [];
  let loaded = 0;
  for (const m of meta) {
    const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(m.symbol)}&select=bars`))?.[0];
    const b = ((row?.bars || []) as number[][]).filter((x) => Array.isArray(x) && x.length >= 5 && x[4] > 0);
    const dv: number[] = []; for (const x of b) { if (x[0] >= SPLIT_TS) break; dv.push(x[4] * (x[5] ?? 0)); }
    // Keep zero-MDV symbols (no pre-SPLIT bars) in the DENOMINATOR: the scorer does, so the decile boundary matches it
    // exactly. The first bounded run dropped them and produced 1,088 of 10,888 at a $9.2M cutoff — a strict subset of
    // the scorer's 1,226 of ~12,260 at $7.5M. A refresher whose universe is smaller than the scorer's leaves part of
    // the clock's input frozen while reporting fresh.
    mdv.push({ sym: m.symbol, mdv: dv.length ? dv.sort((a, c) => a - c)[Math.floor(dv.length / 2)] : 0 });
    if (++loaded % 2000 === 0) console.error(`  decile build: ${loaded}/${meta.length}`);
  }
  mdv.sort((a, c) => c.mdv - a.mdv);
  const n = Math.floor(mdv.length * TOP);
  const c: Cache = { built: today, cutoffMdv: mdv[n - 1]?.mdv ?? 0, universe: mdv.length, symbols: mdv.slice(0, n).map((x) => x.sym) };
  await Deno.mkdir(CACHE.slice(0, CACHE.lastIndexOf("/")), { recursive: true }).catch(() => {});
  await Deno.writeTextFile(CACHE, JSON.stringify(c));
  return c;
}
let cache: Cache | null = null;
try { const c = JSON.parse(await Deno.readTextFile(CACHE)) as Cache; if ((now - Date.parse(c.built + "T00:00:00Z")) / 864e5 <= Number(K.REBUILD_D) && c.symbols.length > 100) cache = c; } catch { /* no cache */ }
if (!cache) { console.log(`  decile cache absent or older than ${K.REBUILD_D}d — rebuilding from the panel (loads every symbol once)`); cache = await buildDecile(); }
// POSITIVE CONTROL 1: the decile must be the size the scorer sees (D-785/790: 1,226–1,231 of ~12,260)
if (cache.symbols.length < 1000 || cache.symbols.length > 1400) { console.error(`!! decile has ${cache.symbols.length} symbols — expected ~1,226. The universe or the MDV window is wrong. RED.`); Deno.exit(1); }
console.log(`==> REFRESH LIQUID PANEL — ${cache.symbols.length} symbols (top ${K.TOP_PCT}% by pre-${K.SPLIT} MDV, cutoff $${(cache.cutoffMdv / 1e6).toFixed(2)}M of ${cache.universe}; cache built ${cache.built})`);

// ---------- 2. Yahoo pull (adjusted bars, identical packing to refresh-bars.ts) ----------
async function pull(sym: string, period1: number): Promise<number[][] | null> {
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${period1}&period2=${Math.floor(now / 1000)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  await sleep(PAUSE);
  const res = j?.chart?.result?.[0], qq = res?.indicators?.quote?.[0];
  const adj = res?.indicators?.adjclose?.[0]?.adjclose, ts = res?.timestamp;
  if (!qq?.close || !ts) return null;
  const bars: number[][] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = qq.close[i]; if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const a = adj?.[i]; const f = (a != null && Number.isFinite(a) && a > 0) ? a / c : 1;
    bars.push([ts[i], +((qq.open[i] ?? c) * f).toFixed(6), +((qq.high[i] ?? c) * f).toFixed(6), +((qq.low[i] ?? c) * f).toFixed(6), +(c * f).toFixed(6), qq.volume[i] ?? 0]);
  }
  return bars;
}

// ---------- 3. per-symbol: stale? -> incremental pull -> overlap check -> merge or full pull -> upsert ----------
let due = 0, skipped = 0, ok = 0, fullPulls = 0; const failed: string[] = [];
const syms = MAXS > 0 ? cache.symbols.slice(0, MAXS) : cache.symbols;
for (const sym of syms) {
  const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`))?.[0];
  const held = ((row?.bars || []) as number[][]).filter((x) => Array.isArray(x) && x.length >= 5).sort((a, c) => a[0] - c[0]);
  if (!held.length) { failed.push(`${sym}(no held bars)`); continue; }
  const newestMs = held[held.length - 1][0] * 1000;
  if (now - newestMs < STALE_MS) { skipped++; continue; }
  due++;
  const p1 = held[held.length - 1][0] - LOOKBACK_S;
  let inc = await pull(sym, p1);
  if (!inc || !inc.length) { failed.push(`${sym}(unavailable)`); continue; }
  // OVERLAP CHECK: same dates must agree on close, else the adjustment basis moved -> full pull
  const heldByTs = new Map(held.map((b) => [b[0] - (b[0] % 86400), b[4]]));
  let basisMoved = false, overlap = 0;
  for (const b of inc) { const hc = heldByTs.get(b[0] - (b[0] % 86400)); if (hc === undefined) continue; overlap++; if (Math.abs(b[4] / hc - 1) > TOL) { basisMoved = true; break; } }
  let merged: number[][];
  if (basisMoved || overlap === 0) {
    const full = await pull(sym, 0); fullPulls++;
    if (!full || full.length < MIN_BARS) { failed.push(`${sym}(full pull ${full ? full.length : "n/a"} bars)`); continue; }
    // D-687 ticker-recycling refusal: incoming must still cover the held start and not be materially shorter
    if (full[0][0] > held[0][0] + 30 * 86400 || full.length < held.length * 0.9) { failed.push(`${sym}(RECYCLED? held ${held.length} from ${iso(held[0][0])}, incoming ${full.length} from ${iso(full[0][0])} — NOT WRITTEN)`); continue; }
    merged = full;
  } else {
    const cut = inc[0][0] - (inc[0][0] % 86400);
    merged = [...held.filter((b) => (b[0] - (b[0] % 86400)) < cut), ...inc];
  }
  // POSITIVE CONTROL 2: the merge must EXTEND the series, never shrink it below 90% or move its start
  if (merged.length < held.length * 0.9 || merged[merged.length - 1][0] < held[held.length - 1][0]) { failed.push(`${sym}(merge would shrink/regress — NOT WRITTEN)`); continue; }
  // Write the metadata columns WITH the bars. refresh-bars.ts writes {symbol, bars} only, so first_date/last_date/n_bars
  // stay at whatever the bulk ingest set — the first full run of this script refreshed 1,156 symbols and then its own
  // sentinel read `last_date` = 08-21 and declared the panel frozen. Metadata that lags the data is a false "stale"
  // waiting to happen for every consumer that trusts the column (universe queries on n_bars, freshness checks).
  const w = await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ symbol: sym, bars: merged, first_date: iso(merged[0][0]), last_date: iso(merged[merged.length - 1][0]), n_bars: merged.length, updated_at: new Date(now).toISOString() }) }).catch(() => null);
  if (!w || !w.ok) { failed.push(`${sym}(write ${w ? w.status : "net"})`); continue; }
  ok++;
  if (ok % 100 === 0) console.error(`  refreshed ${ok}/${due} (${fullPulls} full pulls, ${failed.length} failed)`);
}
console.log(`  due ${due} | skipped (fresh) ${skipped} | refreshed ${ok} | full pulls ${fullPulls} | failed ${failed.length}${failed.length ? ": " + failed.slice(0, 12).join(" ") + (failed.length > 12 ? ` (+${failed.length - 12})` : "") : ""}`);

// ---------- 4. positive controls on the outcome + continuity mark + read-back ----------
// The control is the FRESH FRACTION OF THE DECILE, not "refreshed / due". The first full run refreshed 1,156 of 1,183 due;
// the re-run then found 31 due of which 27 were the same permanently-unavailable tickers (delisted or renamed: ATVI, TWTR,
// PXD, SIVBQ, SQ→XYZ, synthetic -EX pairs; AVB refused by the D-687 guard on a 27-bar vendor series) and declared 4/31 a
// failure — a denominator made of corpses. Dead names are the panel's survivorship-correct history and generate no forward
// events; they are LISTED every run so a growing list is visible, and the panel is fresh when >=95% of the decile is.
const fresh = skipped + ok, freshPct = fresh / syms.length;
if (freshPct < 0.95) { console.error(`!! only ${fresh}/${syms.length} of the decile fresh (${(100 * freshPct).toFixed(1)}% < 95%) — the panel is NOT fresh. RED.`); Deno.exit(1); }
if (failed.length) console.log(`  unavailable/refused (${failed.length}, likely delisted/renamed — history kept, no forward events): ${failed.map((f) => f.replace(/\(.*$/, "")).join(" ")}`);
// In a bounded verification run only symbols actually processed can have advanced — a sentinel outside the slice would
// be a FALSE RED (the first bounded run flagged AAPL at 16d old having never touched it).
const sentinel = ["AAPL", "MSFT", "NVDA", "JPM", "XOM"].find((s) => syms.includes(s));
if (!sentinel && MAXS > 0) console.log(`  sentinel: none of AAPL/MSFT/NVDA/JPM/XOM in this bounded slice — freshness control deferred to the full run.`);
if (sentinel) {
  // Freshness is read from the BARS, not from a metadata column (the first full run's false RED came from `last_date`).
  const r = (await q(`trd_bars_deep?symbol=eq.${sentinel}&select=bars`))?.[0] as { bars: number[][] } | undefined;
  const nb = r?.bars?.length ? r.bars[r.bars.length - 1][0] : 0;
  const newest = nb ? iso(nb) : "n/a", age = nb ? (now - nb * 1000) / 864e5 : Infinity;
  // 4 calendar days covers a weekend + the vendor's next-morning posting; a Friday bar read on Monday is 3d.
  if (!(age <= 4)) { console.error(`!! sentinel ${sentinel} newest bar ${newest} is ${age.toFixed(1)}d old after the run — the panel did not advance. RED.`); Deno.exit(1); }
  console.log(`  sentinel ${sentinel}: newest bar ${newest} (${age.toFixed(1)}d) — panel advanced.`);
}
if (MAXS === 0) {
  const mark = { series: "liquid_panel_refresh", d: today, v: ok + skipped };
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify([mark]) });
  if (!w.ok) { console.error(`!! continuity mark WRITE FAILED HTTP ${w.status}`); Deno.exit(1); }
  const back = await q(`trd_macro_series?series=eq.liquid_panel_refresh&d=eq.${today}&select=v`) as { v: number }[];
  if (!back.length) { console.error(`!! continuity mark READ-BACK missing. RED.`); Deno.exit(1); }
  console.log(`  continuity mark liquid_panel_refresh@${today} = ${back[0].v} (fresh symbols in the decile) — landed and read back.`);
} else console.log(`  MAX_SYMBOLS=${MAXS}: verification run — continuity mark NOT written.`);
console.log(`==> LIQUID PANEL FRESH — clock #18's input universe is current within ${K.STALE_D} days.`);
