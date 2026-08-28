#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// refresh-bars.ts (D-683) — THE FEED THAT NOTHING WAS FEEDING.
//
// HOW THIS WAS FOUND, AND WHY IT MATTERS MORE THAN THE STALENESS. `io.aegis.daily` ran `aegis-attribution.ts` every
// morning without error and wrote 27 clean attribution rows on 2026-08-28. Every row was dated 2026-08-21. The
// engine was faithfully re-attributing the same week-old day, forever, and its log said "27 attribution rows
// written" each time — the exact failure D-613 names: "an ingest that stops leaves the last good rows in place, so
// every query keeps answering plausibly from a frozen snapshot."
//
// The cause was not a broken ingest. There was NO ingest. `trd_bars_deep` for the attribution universe was refreshed
// by hand, and `ingest-force-instruments.ts` (22 ETFs) is scheduled nowhere. The one bar-writer that IS a daemon,
// `aegis-worker.ts`, talks to the rented Supabase broker that has been DNS-dead since the project was paused — so
// the automated path was doubly absent. The continuity guard caught the symptom at 7.8 days against a 7.5-day
// budget; nothing was responsible for the cause.
//
// WHY IT REFRESHES A DECLARED SET RATHER THAN EVERYTHING. `trd_bars_deep` holds 4,348 symbols. Refreshing all of
// them against a free endpoint at a polite rate is hours of daily traffic to keep ~50 symbols current, and a job
// that slow gets disabled the first time it inconveniences someone. This refreshes what the DAILY consumers read.
//
// THE COVERAGE CHECK IS THE POINT. A hand-maintained list here would drift from the hand-maintained list in
// `aegis-attribution.ts` the moment either changed, and the failure would look exactly like today's: a job running
// green while a consumer reads stale rows. So the refresher PARSES its consumer's universe and REFUSES to report
// success while any symbol the consumer reads is absent from what it refreshed. The list cannot silently diverge.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("refresh-bars", [
  { name: "CONSUMER", def: "scripts/aegis-attribution.ts", note: "source of truth for the universe that must stay fresh" },
  { name: "PAUSE_MS", def: "250", note: "between fetches; sequential by Hard Rule, never parallel" },
  { name: "MIN_BARS", def: "300", note: "a short series means a bad symbol, not a refresh" },
  { name: "STALE_D", def: "3", note: "only refetch symbols whose newest bar is older than this" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rb", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Extra instruments other analyses read on a daily cadence. NOT the attribution forces — those are parsed below,
// because a hand-written copy of them is precisely the mistake this file was written to stop, and I made it anyway on
// the first version: I listed plausible force ETFs from memory, missed `^GSPC` (the MKT force), refreshed 52 symbols
// to today, and the engine still produced a report dated a week earlier. The fix is not a better memory.
const EXTRA = ["LQD", "IEF", "JNK", "IWD", "MTUM", "QUAL", "USMV", "VLUE",
  "EEM", "EFA", "VGK", "EWJ", "XLF", "XLK", "XLE", "XLU", "XLP", "XLI", "XLV", "XLY", "UUP"];

// Parse the consumer's own lists rather than restating them. A restated list is a second thing to remember, and this
// whole defect is what happens when a second thing to remember is not remembered.
const src = await Deno.readTextFile(K.CONSUMER);
const m = src.match(/const\s+UNIVERSE\s*=\s*\[([^\]]*)\]/);
if (!m) { console.error(`!! cannot parse a UNIVERSE array out of ${K.CONSUMER} — refusing to guess at what must stay fresh. RED.`); Deno.exit(1); }
const consumerUniverse = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
assertNonEmpty(`universe parsed from ${K.CONSUMER}`, consumerUniverse, 10);

// The regressors. `[["MKT","^GSPC"],...]` — the ticker is the SECOND element of each pair; taking the first would
// silently refresh a list of force NAMES, fetch nothing real, and report a confident green.
const fm = src.match(/const\s+ALL_FORCES[^=]*=\s*\[([\s\S]*?)\];/);
if (!fm) { console.error(`!! cannot parse ALL_FORCES out of ${K.CONSUMER} — the regressors would go stale invisibly. RED.`); Deno.exit(1); }
const forceTickers = [...fm[1].matchAll(/\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*\]/g)].map((x) => x[1]);
assertNonEmpty(`force tickers parsed from ${K.CONSUMER}`, forceTickers, 5);

// Both lists are consumed, so both must be fresh: a stale regressor corrupts every loading in the report exactly as
// surely as a stale target corrupts its return.
const REQUIRED = [...new Set([...consumerUniverse, ...forceTickers])];
const TARGETS = [...new Set([...REQUIRED, ...EXTRA])];
console.log(`==> REFRESH BARS — ${consumerUniverse.length} target(s) + ${forceTickers.length} force ticker(s) parsed from ${K.CONSUMER}, +${EXTRA.length} extra = ${TARGETS.length} distinct`);
console.log(`    forces: ${forceTickers.join(" ")}`);

// Current watermark per symbol, so an already-fresh symbol costs nothing.
const now = Date.now();
const staleMs = Number(K.STALE_D) * 864e5;
const watermark = new Map<string, number>();
for (const sym of TARGETS) {
  const r = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).catch(() => null);
  if (!r || !r.ok) continue;
  const j = await r.json().catch(() => null) as { bars: number[][] }[] | null;
  const bars = j?.[0]?.bars;
  if (Array.isArray(bars) && bars.length) watermark.set(sym, bars[bars.length - 1][0] * 1000);
}

const due = TARGETS.filter((s) => (now - (watermark.get(s) ?? 0)) > staleMs);
console.log(`    ${watermark.size} of ${TARGETS.length} already present; ${due.length} stale beyond ${K.STALE_D}d and due for refresh`);
if (!due.length) {
  console.log(`\n  ALL FRESH — nothing older than ${K.STALE_D} days. No fetches made.`);
  Deno.exit(0);
}

let ok = 0;
const failed: string[] = [];
for (const sym of due) {
  // SEQUENTIAL BY HARD RULE. One request, read the result, then the next — never a batch, never backgrounded.
  const j = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(now / 1000)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  ).then((r) => r.ok ? r.json() : null).catch(() => null);
  await sleep(Number(K.PAUSE_MS));
  const res = j?.chart?.result?.[0], q = res?.indicators?.quote?.[0];
  const adj = res?.indicators?.adjclose?.[0]?.adjclose, ts = res?.timestamp;
  if (!q?.close || !ts) { failed.push(`${sym}(unavailable)`); continue; }
  const bars: number[][] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    // Split/dividend adjustment applied to the WHOLE bar, not just the close: an unadjusted high/low beside an
    // adjusted close makes every range and gap statistic wrong across a split, silently and only in history.
    const a = adj?.[i];
    const f = (a != null && Number.isFinite(a) && a > 0) ? a / c : 1;
    bars.push([ts[i], +((q.open[i] ?? c) * f).toFixed(6), +((q.high[i] ?? c) * f).toFixed(6),
      +((q.low[i] ?? c) * f).toFixed(6), +(c * f).toFixed(6), q.volume[i] ?? 0]);
  }
  if (bars.length < Number(K.MIN_BARS)) { failed.push(`${sym}(${bars.length} bars)`); continue; }

  // D-687 — TICKER RECYCLING. This write REPLACES the stored series wholesale, so a reissued ticker would silently
  // overwrite one company's decades of history with another company's few weeks. It is not hypothetical: Yahoo
  // returns 31 bars dated 2026-07-17.. for BBBY, whose original registrant delisted in 2023. The hazard was found
  // an hour after this script shipped, in this script.
  // The check is a CONTINUITY assertion, not a length one: an honest refresh EXTENDS what is held, so the incoming
  // series must still cover the stored start date and must not be materially shorter. Refuse and report — a refusal
  // is recoverable, an overwrite of history that no longer exists anywhere is not.
  const heldWm = watermark.get(sym);
  if (heldWm) {
    const heldRes = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).catch(() => null);
    const heldJ = heldRes && heldRes.ok ? await heldRes.json().catch(() => null) as { bars: number[][] }[] | null : null;
    const held = heldJ?.[0]?.bars;
    if (Array.isArray(held) && held.length) {
      const heldStart = held[0][0], newStart = bars[0][0];
      const startedLater = newStart > heldStart + 30 * 86400;     // a month of slack for vendor history trims
      const muchShorter = bars.length < held.length * 0.9;
      if (startedLater || muchShorter) {
        failed.push(`${sym}(RECYCLED? held ${held.length} bars from ${new Date(heldStart * 1000).toISOString().slice(0, 10)}, incoming ${bars.length} from ${new Date(newStart * 1000).toISOString().slice(0, 10)} — NOT WRITTEN)`);
        continue;
      }
    }
  }
  // fetch() does not throw on HTTP errors; an unchecked write is how a "successful" run writes nothing (D-467). The
  // check is kept ADJACENT to the fetch on purpose — the plumbing guard matches within a proximity window, and prose
  // wedged between the two reads to it as an unchecked write. That false positive was produced twice today, in this
  // file and in check-voltiming-survivor.ts, by comments that were correct and merely in the wrong place.
  const wres = await fetch(`${OWNED}/trd_bars_deep?on_conflict=symbol`, { method: "POST",
    headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ symbol: sym, bars }) }).catch(() => null);
  if (!wres || !wres.ok) { failed.push(`${sym}(write ${wres ? wres.status : "net"})`); continue; }
  ok++;
  const last = new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10);
  console.log(`    ${sym.padEnd(10)} ${String(bars.length).padStart(6)} bars, newest ${last}`);
}

console.log(`\n    refreshed ${ok}  |  failed ${failed.length}${failed.length ? ": " + failed.join(" ") : ""}`);

// THE COVERAGE ASSERTION. Success is not "the fetches returned 200" — it is "every symbol the consumer reads is now
// fresh". A symbol that is stale AND was not refreshed is the exact state that produced this defect, so it is RED.
const stillStale: string[] = [];
for (const sym of REQUIRED) {
  const r = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => null) as { bars: number[][] }[] | null : null;
  const bars = j?.[0]?.bars;
  const wm = Array.isArray(bars) && bars.length ? bars[bars.length - 1][0] * 1000 : 0;
  if ((now - wm) > staleMs) stillStale.push(`${sym}@${wm ? new Date(wm).toISOString().slice(0, 10) : "ABSENT"}`);
}
if (stillStale.length) {
  // The denominator is REQUIRED, not consumerUniverse: the loop above checks targets AND forces, and printing the
  // smaller number produced the line "31 of 28 symbol(s)". A count that exceeds its own denominator is small, and it
  // is exactly the kind of thing that teaches a reader to stop believing the rest of the output.
  console.log(`\n  RED — ${stillStale.length} of ${REQUIRED.length} symbol(s) the consumer reads are STILL stale:`);
  console.log(`  ${stillStale.join(" ")}`);
  console.log(`  ${K.CONSUMER} will run tomorrow and produce a confident report about a frozen market. That is the defect this exists to stop.`);
  Deno.exit(1);
}
console.log(`\n  ALL ${REQUIRED.length} CONSUMER SYMBOL(S) FRESH within ${K.STALE_D} days (${consumerUniverse.length} targets + ${forceTickers.length} forces).`);
