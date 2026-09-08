#!/usr/bin/env -S deno run --allow-net --allow-env
// refresh-perp-panels.ts (D-813) — INCREMENTAL daily refresh of the three Binance perp panels the forward clocks read:
//   tf=1dSF (512 contracts, survivor-free daily), tf=1hSF (97 perps hourly), tf=1h (25 perps hourly with taker volume).
// Found 2026-09-07 (Monday): 1hSF stopped 2026-08-29, 1h stopped 2026-08-21, 1dSF 2026-08-27 — their writers
// (ingest-crypto-hourly.ts, ingest-perp-survivorfree.ts) were invoked by NO job and no continuity row watched them, so
// four registered clocks (three panel-17 hourly sweeps, persist-real K24) were starving silently — the CONTINUITY LAW's
// named failure (D-613). Tuple layout (all three): [t, o, h, l, c, v, quoteVol, takerBuyBase, trades].
// Per symbol: read last_ts, fetch klines from last_ts + interval (1500/page), keep c>0 && v>0 (delisted contracts serve
// zero-volume placeholders), append, write bars + first_ts/last_ts/n_bars/updated_at. Reads ONE symbol per request
// (D-812: never a whole panel). Sequential, paced. A contract no longer TRADING is skipped and counted, not failed.
// Positive control: >= 90% of TRADING symbols per panel are fresh (newest bar within 2 intervals) after the run, else RED.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("refresh-perp-panels", [
  { name: "PANELS", def: "1dSF:1d,1hSF:1h,1h:1h", note: "tf:interval pairs" }, { name: "PAUSE_MS", def: "120" },
  { name: "SYMBOLS", def: "", note: "D-823e: comma list to refresh ONLY those symbols (empty = the whole panel, the runner default). The hourly micro job needs 5 of 25; refreshing 25 every hour piles avoidable load on a DB the daily cycle is already using." },
  { name: "MAX_PAGES", def: "40", note: "1500 bars per page; 40 pages covers ~2.5 months of hourly or ~160 years of daily" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rpp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const info = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then((r) => r.ok ? r.json() : null) as { symbols: { symbol: string; status: string }[] } | null;
if (!info) { console.error("  RED — exchangeInfo unreachable; refusing to guess which contracts trade"); Deno.exit(1); }
const trading = new Set(info.symbols.filter((s) => s.status === "TRADING").map((s) => s.symbol));
const SEC: Record<string, number> = { "1d": 86400, "1h": 3600 }; let red = false; const nowS = Math.floor(Date.now() / 1000);
for (const pair of K.PANELS.split(",")) {
  const [tf, interval] = pair.split(":"); const step = SEC[interval];
  let meta = await q(`trd_bars_intraday?tf=eq.${tf}&select=symbol,last_ts,n_bars&order=symbol`) as { symbol: string; last_ts: number | null; n_bars: number }[];
  assertNonEmpty(`${tf} symbols`, meta, 10);
  /* D-823e: an explicit subset narrows the work; a filter matching NOTHING is a mistake, not an empty panel (PRECONDITION LAW). */
  if (K.SYMBOLS) {
    const want = new Set(K.SYMBOLS.split(",").map((x) => x.trim()).filter(Boolean));
    const before = meta.length; meta = meta.filter((m) => want.has(m.symbol));
    if (!meta.length) { console.error(`  RED — SYMBOLS matched 0 of ${before} rows in ${tf}: UNTESTED, not an empty panel`); Deno.exit(1); }
    console.log(`    ${tf}: SYMBOLS filter -> ${meta.length} of ${before}`);
  }
  let fresh = 0, refreshed = 0, skippedDelisted = 0, failed: string[] = [], tradingN = 0;
  for (const m of meta) {
    const isTrading = trading.has(m.symbol); if (isTrading) tradingN++;
    // last_ts may be stale metadata (D-806); read the true newest from the bars of THIS symbol only
    const row = (await q(`trd_bars_intraday?tf=eq.${tf}&symbol=eq.${m.symbol}&select=bars`) as { bars: number[][] }[])[0];
    const bars = (row?.bars ?? []).filter((b) => b.length >= 6); if (!bars.length) { failed.push(`${m.symbol}(empty)`); continue; }
    const last = bars[bars.length - 1][0];
    if (nowS - last <= 2 * step) { fresh++; continue; }
    if (!isTrading) { skippedDelisted++; continue; }
    const seen = new Map<number, number[]>(); let cursor = (last + step) * 1000; let pages = 0;
    for (; pages < +K.MAX_PAGES; pages++) {
      const j = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${m.symbol}&interval=${interval}&limit=1500&startTime=${cursor}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      await sleep(+K.PAUSE_MS);
      if (!Array.isArray(j) || !j.length) break;
      for (const kk of j as (string | number)[][]) { const t = Math.floor(+kk[0] / 1000), c = +kk[4], v = +kk[5]; if (t > last && c > 0 && v > 0 && +kk[6] < Date.now()) seen.set(t, [t, +kk[1], +kk[2], +kk[3], c, v, +kk[7], +kk[9], +kk[8]]); }
      const lastOpen = +(j[j.length - 1] as (string | number)[])[0]; if (j.length < 1500) break; cursor = lastOpen + step * 1000;
    }
    const add = [...seen.values()].sort((a, b) => a[0] - b[0]);
    if (!add.length) { failed.push(`${m.symbol}(no new bars)`); continue; }
    const merged = bars.concat(add);
    const w = await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ symbol: m.symbol, tf, bars: merged, n_bars: merged.length, first_ts: merged[0][0], last_ts: merged[merged.length - 1][0], updated_at: new Date().toISOString() }]) });
    if (!w.ok) { failed.push(`${m.symbol}(write ${w.status})`); continue; }
    refreshed++; if (nowS - merged[merged.length - 1][0] <= 2 * step) fresh++;
  }
  const freshTrading = fresh; const need = Math.ceil(0.9 * tradingN);
  console.log(`==> ${tf}: ${meta.length} symbols (${tradingN} trading) — ${refreshed} refreshed, ${fresh} fresh, ${skippedDelisted} delisted-stale (expected), ${failed.length} failed${failed.length ? ": " + failed.slice(0, 8).join(" ") : ""}`);
  if (freshTrading < need) { console.error(`  RED — ${tf}: ${freshTrading} fresh of ${tradingN} trading (need ${need})`); red = true; }
}
if (red) Deno.exit(1); console.log("  positive controls passed (>= 90% of trading symbols fresh in every panel)");
