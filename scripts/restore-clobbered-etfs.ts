#!/usr/bin/env -S deno run --allow-net --allow-env
// restore-clobbered-etfs.ts (D-725) — REPAIR the data loss D-723 caused. The delisted backfill computed its target
// list as "short-interest tickers MINUS the asset_class='equity' panel", so ETFs/indices stored under etf/sector/
// index classes were seen as MISSING, became targets, and — because trd_bars_deep's PK is symbol ALONE — the
// on_conflict=symbol upsert OVERWROTE their full multi-decade Yahoo histories with ~5y Alpaca IEX stubs. SPY/QQQ/HYG/
// LQD/GLD and dozens more were truncated; every test that reads them (breadth, the U-shape, regime-snapshot) silently
// ran on the stub. No usable backup existed. Recovery: re-fetch full adjusted history from Yahoo (the original source
// per reingest-adjusted.ts, D-478) and restore, with a RECYCLING GUARD so it only ever replaces a series with a
// LONGER one — it can never make the panel worse, and it leaves a genuinely-short delisted stub untouched.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

declareKnobs("restore-clobbered-etfs", []);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rce", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t, "Content-Type": "application/json" }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The symbols the programme actually uses, with their correct class. ETFs/sector/bond/commodity funds go to non-equity
// classes so they leave the equity breadth universe (where they never belonged — original breadth was 4,184 equities);
// genuine single-name stocks caught by the clobber stay equity. Tests read these by SYMBOL, so history is what matters.
const RESTORE: [string, string][] = [
  // broad / style ETFs
  ...["SPY", "QQQ", "IWM", "DIA", "EEM", "EFA", "VGK", "EWJ", "EWZ", "FXI", "VNQ", "GDX", "SMH", "XBI", "JETS", "MTUM", "VLUE", "QUAL", "USMV", "SIZE", "IWF", "IWD", "QYLD", "SVXY", "VXX", "PBP"].map((s) => [s, "etf"] as [string, string]),
  // sector ETFs
  ...["XLF", "XLE", "XLK", "XLI", "XLP", "XLV", "XLY", "XLU", "XLB", "XLC", "XLRE", "KRE", "ITB", "SMH"].map((s) => [s, "sector"] as [string, string]),
  // bond ETFs
  ...["TLT", "IEF", "SHY", "LQD", "HYG", "JNK", "TIP", "NEAR"].map((s) => [s, "etf"] as [string, string]),
  // commodity / fx ETFs
  ...["GLD", "SLV", "UUP", "USD"].map((s) => [s, "etf"] as [string, string]),
];
const seen = new Set<string>(); const list = RESTORE.filter(([s]) => (seen.has(s) ? false : (seen.add(s), true)));

async function held(sym: string): Promise<number> {
  const r = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=n_bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  return Array.isArray(r) && r[0] ? Number(r[0].n_bars) : 0;
}

console.log(`==> RESTORE ${list.length} clobbered symbols from Yahoo full adjusted history (recycling-guarded)\n`);
let restored = 0, skipped = 0, failed = 0;
for (const [sym, cls] of list) {
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
  await sleep(200);
  const res = j?.chart?.result?.[0], q = res?.indicators?.quote?.[0], adj = res?.indicators?.adjclose?.[0]?.adjclose, ts = res?.timestamp;
  if (!res || !q || !ts || !Array.isArray(ts)) { console.log(`  ${sym}: Yahoo returned nothing — FAILED`); failed++; continue; }
  // Total-return series: scale O/H/L by the per-day adjclose/close factor so bars stay internally coherent (D-478).
  const bars: number[][] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i], a = adj?.[i];
    if (c == null || a == null || c <= 0) continue;
    const f = a / c;
    bars.push([ts[i], (q.open?.[i] ?? c) * f, (q.high?.[i] ?? c) * f, (q.low?.[i] ?? c) * f, a, q.volume?.[i] ?? 0]);
  }
  if (bars.length < 100) { console.log(`  ${sym}: only ${bars.length} usable bars — FAILED`); failed++; continue; }
  const cur = await held(sym);
  // RECYCLING GUARD: only write if Yahoo is materially LONGER than what we hold — never shorten a series.
  if (bars.length <= cur * 1.1) { console.log(`  ${sym}: held ${cur} >= Yahoo ${bars.length} — left as-is`); skipped++; continue; }
  const row = { symbol: sym, asset_class: cls, first_date: new Date(bars[0][0] * 1000).toISOString().slice(0, 10), last_date: new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10), n_bars: bars.length, bars, updated_at: new Date().toISOString() };
  const w = await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify([row]) });
  if (!w.ok && w.status !== 409) { console.log(`  ${sym}: WRITE-FAILED ${w.status} ${(await w.text()).slice(0, 100)}`); failed++; continue; }
  console.log(`  ${sym} (${cls}): ${cur} -> ${bars.length} bars, ${row.first_date}..${row.last_date}  RESTORED`);
  restored++;
}
assertNonEmpty("symbols processed", list, 20);
console.log(`\n==> ${restored} restored, ${skipped} already-full, ${failed} failed. ETFs moved out of asset_class='equity' — they never belonged in the equity breadth universe.`);
