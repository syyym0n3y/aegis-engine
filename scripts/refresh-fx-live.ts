#!/usr/bin/env -S deno run --allow-net --allow-env
// refresh-fx-live.ts (D-823b) — INTRADAY hourly bars for the FX/index/gold half of the micro sheet.
// The research series in trd_fx_hourly comes from Dukascopy day-files, which exist only after the day closes, so those
// seven instruments were always a day behind intraday and the micro sheet could never print a live candidate on them.
// This pulls Yahoo's 60-minute chart (keyless, allowlisted, sequential) and writes COMPLETED hours only, under symbols
// suffixed ".yh1h" so provenance is in the name and nothing that reads the Dukascopy series can pick these up by mistake.
// Proxies are stated: gold = GC=F (futures, not spot), S&P/Nasdaq = ES=F / NQ=F (futures trade ~23h like the CFDs).
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("refresh-fx-live", [{ name: "RANGE", def: "3mo", note: "Yahoo 60m history to pull; 3mo ~ 1,400-1,500 bars so the sheet has sessions for levels and 60+ same-hour samples for rvol" }, { name: "PAUSE_MS", def: "400" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fxl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const MAP: Record<string, string> = { EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", AUDUSD: "AUDUSD=X", USDJPY: "JPY=X", XAUUSD: "GC=F", USA500IDXUSD: "ES=F", USATECHIDXUSD: "NQ=F" };
const nowHour = Math.floor(Date.now() / 3600000) * 3600;
let fresh = 0; const report: string[] = [];
for (const [sym, ysym] of Object.entries(MAP)) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=60m&range=${K.RANGE}`;
  const j = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  const r = j?.chart?.result?.[0]; const t: number[] = r?.timestamp ?? []; const qd = r?.indicators?.quote?.[0];
  if (!t.length || !qd) { report.push(`${sym}: NO DATA from ${ysym}`); await new Promise((z) => setTimeout(z, +K.PAUSE_MS)); continue; }
  const rows: { symbol: string; ts: number; o: number; h: number; l: number; c: number; vol: number }[] = [];
  for (let i = 0; i < t.length; i++) {
    const ts = Math.floor(t[i] / 3600) * 3600;
    if (ts + 3600 > nowHour) continue;                       /* only COMPLETED hours */
    const o = qd.open[i], h = qd.high[i], l = qd.low[i], c = qd.close[i]; if (![o, h, l, c].every((v) => typeof v === "number" && v > 0)) continue;
    rows.push({ symbol: `${sym}.yh1h`, ts, o, h, l, c, vol: +(qd.volume?.[i] ?? 0) });
  }
  // D-853: Yahoo's 60m FUTURES feed (ES=F, NQ=F, GC=F) returns DUPLICATE timestamps at the session roll; FX does not.
  // Two rows with the same (symbol, ts) in one upsert make Postgres raise "ON CONFLICT DO UPDATE command cannot affect
  // row a second time" and PostgREST returns 500 for the WHOLE batch — so the three index series silently stopped at
  // 03:00 UTC while FX kept landing, the refresh printed "write 500" as if it were a status, and the sheet read them
  // STALE an hour after the log said they were fresh. Dedupe keeping the LAST bar for a timestamp (the later Yahoo
  // row is the completed one), and say a failed write is a failure.
  const byTs = new Map<number, typeof rows[number]>(); for (const r of rows) byTs.set(r.ts, r);
  const dupes = rows.length - byTs.size; const uniq = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  const w = await fetch(`${OWNED}/trd_fx_hourly?on_conflict=symbol,ts`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniq) });
  const last = uniq.at(-1); const ageH = last ? (Date.now() / 1000 - last.ts - 3600) / 3600 : NaN;
  if (w.ok && last && ageH <= 3) fresh++;
  const wtxt = w.ok ? `write ${w.status}` : `WRITE FAILED HTTP ${w.status} — nothing landed for this symbol`;
  report.push(`${sym.padEnd(14)} <- ${ysym.padEnd(9)} ${uniq.length} completed bars${dupes ? ` (${dupes} duplicate ts dropped)` : ""}, last ${last ? new Date(last.ts * 1000).toISOString().slice(0, 16) : "none"} (age ${ageH.toFixed(1)}h) ${wtxt}`);
  await new Promise((z) => setTimeout(z, +K.PAUSE_MS));
}
console.log(`==> FX/INDEX LIVE HOURLY (Yahoo 60m -> trd_fx_hourly *.yh1h): ${fresh}/${Object.keys(MAP).length} fresh within 3h`); for (const l of report) console.log("    " + l);
const back = await q(`trd_fx_hourly?symbol=eq.EURUSD.yh1h&select=ts&order=ts.desc&limit=1`) as { ts: number }[];
if (!back.length) { console.error("  RED — read-back of EURUSD.yh1h returned nothing"); Deno.exit(1); }
// D-857: the freshness rule had no notion of a MARKET CLOSE, so every weekend hour it exited RED, the hourly job
// echoed FAILED 94 times in five days, and the true failure of 2026-09-08 (D-853) was one line among them — the
// cry-wolf shape THE CONTINUITY LAW names (a weekly dataset is not stale at three days). FX/CFD close Fri 21:00 UTC
// and reopen Sun 21:00 UTC. Inside that window "fresh" means the newest bar is within 3h of the Friday close.
const nowD = new Date(); const dow = nowD.getUTCDay(), hr = nowD.getUTCHours();
// The reopen is Sun 21:00 UTC but the first COMPLETED bar after it lands at ~22:00 and Yahoo serves it later still, so the
// hours around the reopen are judged against the Friday close too (D-879: a Sunday 21:03 run had read "0/7 fresh on a
// trading day" and echoed FAILED — the second cry-wolf of the weekend rule, found by the log-triage guard).
const closed = (dow === 5 && hr >= 21) || dow === 6 || dow === 0 || (dow === 1 && hr < 1);
if (closed) {
  const friClose = new Date(nowD); friClose.setUTCDate(nowD.getUTCDate() - ((dow + 2) % 7)); friClose.setUTCHours(21, 0, 0, 0);
  const cutoff = friClose.getTime() / 1000 - 3 * 3600;
  const atClose = report.filter((l) => { const m = /last (\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(l); return m && Date.parse(m[1] + ":00Z") / 1000 >= cutoff; }).length;
  console.log(`  WEEKEND CLOSE (Fri 21:00 -> Sun 21:00 UTC): ${atClose}/7 series hold their last bar within 3h of the Friday close — ${atClose >= 5 ? "feed intact, market closed, NOT a failure" : "RED: a series stopped BEFORE the close"}`);
  if (atClose < 5) Deno.exit(1);
} else if (fresh < 5) { console.error(`  RED — only ${fresh}/7 fresh on a trading day (weekend closes are handled above; a weekday below 5 is a broken feed)`); Deno.exit(1); }
