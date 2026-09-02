#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// refresh-cef.ts — keep the closed-end-fund panel LIVE, so the fwd-cef-discount clock scores real forward months.
//
// WHY THIS EXISTS. D-750 measured the widest-discount tercile's excess over the CEF universe at +5.54%/yr (t 8.09)
// on a panel that was built ONCE, by hand, into two gitignored files. A forward clock registered against a frozen
// snapshot is not a forward clock: THE CONTINUITY LAW (D-613) is explicit that an ingest which stops leaves the last
// good rows in place, so every query keeps answering plausibly from a dead dataset. This is the refresher that owns
// the feed.
//
// WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT.
//  - The EDGAR N-CEN sweep that builds the universe is slow (hundreds of full-text windows + a Yahoo NAV probe per
//    candidate) and the membership of the closed-end universe changes on a yearly, not daily, cadence. So the cached
//    universe is REUSED unless REFRESH_UNIVERSE=1, which re-runs scripts/cef-universe.ts as a subprocess.
//  - Bars are re-pulled for the last CEF_DAYS calendar days ONLY, per fund, price and NAV, sequentially with courtesy
//    pacing. The full history already sits in the cache and is never refetched.
//  - period1/period2, NEVER range=max. Yahoo silently downgrades range=max to MONTHLY bars regardless of interval=1d
//    (XGABX: 329 points over 27 years). The first CEF build was caught by its positive control precisely here, and
//    the mistake is cheap to repeat, so it is written down at the call site.
//  - The merge is IDEMPOTENT: bars are keyed on date, a re-run of the same day overwrites the same slots and adds
//    nothing. Running this twice in one day is a no-op.
//  - It also writes a COMPACT MONTHLY PANEL (data/cef-panel.json) — the scorer must not have to parse a 160MB bar
//    cache every morning, and a small file is the difference between a scorer that runs daily and one that gets
//    quietly commented out of the runner.
//
// POSITIVE CONTROL (D-641). A refresh that fetches nothing and a refresh that fetches everything both end by writing
// a file, and both look identical. GAB and PDI are two of the most heavily traded US closed-end funds; if either is
// absent from the panel, or its newest bar is older than 7 trading days, the run FAILS LOUDLY instead of reporting
// a clean count.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("refresh-cef", [
  { name: "REFRESH_UNIVERSE", def: "", note: "1 = re-run the slow EDGAR N-CEN universe build first; empty = reuse the cache" },
  { name: "CEF_DAYS", def: "90", note: "calendar days of price+NAV bars re-pulled per fund; the rest is already cached" },
  { name: "CEF_SLEEP_MS", def: "250", note: "Yahoo courtesy pacing; strictly sequential" },
  { name: "CEF_STALE_D", def: "10", note: "calendar days a positive-control fund's newest bar may lag before this run is RED" },
]);
const DAYS = Number(K.CEF_DAYS), SLEEP = Number(K.CEF_SLEEP_MS), STALE_D = Number(K.CEF_STALE_D);

// cwd-safe: the daily runner invokes this from infra/, not from the repo root (D-749 precedent).
const UNI_F = new URL("../data/cef-universe.json", import.meta.url).pathname;
const BARS_F = new URL("../data/cef-bars.json", import.meta.url).pathname;
const PANEL_F = new URL("../data/cef-panel.json", import.meta.url).pathname;
const UNI_SCRIPT = new URL("./cef-universe.ts", import.meta.url).pathname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- step 0: universe (cached unless asked) ----------------
if (K.REFRESH_UNIVERSE === "1") {
  console.log(`==> REFRESH_UNIVERSE=1 — re-running the EDGAR N-CEN universe build (slow, minutes)`);
  const st = await new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", UNI_SCRIPT],
    stdout: "inherit", stderr: "inherit",
  }).output();
  if (!st.success) { console.error(`!! cef-universe.ts exited ${st.code} — REFUSING to continue on a half-built universe`); Deno.exit(1); }
} else {
  console.log(`==> universe REUSED from ${UNI_F} (set REFRESH_UNIVERSE=1 to rebuild; the EDGAR pass takes minutes)`);
}

const uni = JSON.parse(await Deno.readTextFile(UNI_F)) as { built: string; universe: { ticker: string }[] };
const tickers = uni.universe.map((u) => u.ticker);
assertNonEmpty("CEF universe tickers", tickers, 20);
console.log(`    ${tickers.length} funds in the universe (built ${uni.built})`);

// ---------------- step 1: incremental bars ----------------
type YF = { d: string[]; c: number[]; a: number[]; v: number[] };
const P2 = Math.floor(Date.now() / 1000);
const P1 = P2 - DAYS * 86400;

// period1/period2 ONLY. range=max returns MONTHLY bars — see the header note; this is not a stylistic choice.
async function yahoo(sym: string): Promise<YF | null> {
  try {
    const j = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${P1}&period2=${P2}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((r) => r.ok ? r.json() : null);
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp?.length) return null;
    const q = r.indicators.quote[0];
    const adj = r.indicators?.adjclose?.[0]?.adjclose;
    const d: string[] = [], c: number[] = [], a: number[] = [], v: number[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const px = q.close?.[i];
      if (px == null || !Number.isFinite(px) || px <= 0) continue;
      const ap = adj?.[i];
      d.push(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10));
      c.push(px); a.push(ap != null && Number.isFinite(ap) && ap > 0 ? ap : px); v.push(Number(q.volume?.[i]) || 0);
    }
    return d.length ? { d, c, a, v } : null;
  } catch { return null; }
}

// Merge keyed on DATE, so re-running is a no-op rather than a duplication. Yahoo restates adjclose after every
// distribution, so a date present in BOTH takes the NEW value — the fresh adjclose is the corrected one.
function merge(old: YF | undefined, fresh: YF): YF {
  const m = new Map<string, [number, number, number]>();
  if (old) for (let i = 0; i < old.d.length; i++) m.set(old.d[i], [old.c[i], old.a[i], old.v[i]]);
  for (let i = 0; i < fresh.d.length; i++) m.set(fresh.d[i], [fresh.c[i], fresh.a[i], fresh.v[i]]);
  const ds = [...m.keys()].sort();
  return { d: ds, c: ds.map((x) => m.get(x)![0]), a: ds.map((x) => m.get(x)![1]), v: ds.map((x) => m.get(x)![2]) };
}

let cache: Record<string, { px: YF; nav: YF }> = {};
try { cache = JSON.parse(await Deno.readTextFile(BARS_F)); } catch { console.log(`    (no bar cache at ${BARS_F} — this run builds only the last ${DAYS}d, which is NOT a full history)`); }
const before = Object.keys(cache).length;

console.log(`\n==> re-pulling the last ${DAYS} calendar days of price+NAV per fund, sequential, ~${SLEEP}ms apart`);
let touched = 0, added = 0, noData = 0, i = 0;
for (const t of tickers) {
  i++;
  if (i % 50 === 0) console.log(`    ...${i}/${tickers.length} probed, ${touched} updated`);
  const px = await yahoo(t); await sleep(SLEEP);
  const nav = await yahoo(`X${t}X`); await sleep(SLEEP);
  if (!px || !nav) { noData++; continue; }
  const prev = cache[t];
  if (!prev) added++;
  const beforeN = (prev?.px.d.length ?? 0);
  cache[t] = { px: merge(prev?.px, px), nav: merge(prev?.nav, nav) };
  if (cache[t].px.d.length !== beforeN || prev) touched++;
}
await Deno.writeTextFile(BARS_F, JSON.stringify(cache));
console.log(`    funds in cache ${before} -> ${Object.keys(cache).length} (new ${added}); updated ${touched}; no price or no NAV ${noData}`);

// ---------------- step 2: the compact monthly panel the scorer reads ----------------
// Month-end close of price, NAV and 21d mean dollar volume. Identical construction to scripts/cef-discount.ts —
// discount = price/NAV - 1, |75%| rejected as a data error rather than a discount.
interface PRow { t: string; m: string; apx: number; disc: number; dv: number }
const monthEnd = (s: YF): Map<string, { c: number; a: number; dv: number }> => {
  const out = new Map<string, { c: number; a: number; dv: number }>();
  for (let j = 0; j < s.d.length; j++) {
    let dv = 0, n = 0;
    for (let k = Math.max(0, j - 20); k <= j; k++) { dv += s.c[k] * s.v[k]; n++; }
    out.set(s.d[j].slice(0, 7), { c: s.c[j], a: s.a[j], dv: dv / n });   // ascending -> last obs of the month wins
  }
  return out;
};
const panel: PRow[] = [];
for (const t of Object.keys(cache)) {
  const P = monthEnd(cache[t].px), N = monthEnd(cache[t].nav);
  for (const [m, p] of P) {
    const nv = N.get(m); if (!nv || !(nv.c > 0) || !(p.c > 0)) continue;
    const disc = p.c / nv.c - 1;
    if (!Number.isFinite(disc) || Math.abs(disc) > 0.75) continue;
    panel.push({ t, m, apx: p.a, disc, dv: p.dv });
  }
}
assertNonEmpty("CEF monthly panel rows", panel, 1000);
const months = [...new Set(panel.map((r) => r.m))].sort();

// ---------------- POSITIVE CONTROL (D-641) ----------------
// A broken fetch and a genuinely empty market both write a file. These must be non-zero and must be CURRENT.
const CONTROLS = ["GAB", "PDI"];
const today = Date.now();
let ctlFail = 0;
console.log(`\n    POSITIVE CONTROL (D-641) — a refresh that fetched nothing writes a file that looks exactly like one that worked:`);
for (const c of CONTROLS) {
  const b = cache[c];
  if (!b) { ctlFail++; console.log(`      FAIL ${c}: absent from the bar cache entirely`); continue; }
  const newest = b.px.d[b.px.d.length - 1];
  const ageD = (today - Date.parse(newest + "T00:00:00Z")) / 86400000;
  const inPanel = panel.some((r) => r.t === c);
  const ok = ageD <= STALE_D && inPanel;
  if (!ok) ctlFail++;
  console.log(`      ${ok ? "PASS" : "FAIL"} ${c}: newest bar ${newest} (age ${ageD.toFixed(1)}d, budget ${STALE_D}d), in monthly panel: ${inPanel}`);
}
const nWide = panel.filter((r) => r.disc < -0.05).length, nPrem = panel.filter((r) => r.disc > 0.02).length;
console.log(`      ${nWide && nPrem ? "PASS" : "FAIL"} discount series non-degenerate: ${nWide.toLocaleString()} obs below -5%, ${nPrem.toLocaleString()} above +2%`);
if (!nWide || !nPrem) ctlFail++;

await Deno.writeTextFile(PANEL_F, JSON.stringify({
  built: new Date().toISOString(),
  source: `data/cef-bars.json (last ${DAYS}d refreshed live) over data/cef-universe.json built ${uni.built}`,
  funds: [...new Set(panel.map((r) => r.t))].length,
  months: months.length, span: [months[0], months[months.length - 1]],
  rows: panel,
}));
console.log(`\n    wrote ${PANEL_F}: ${panel.length.toLocaleString()} fund-months, ${[...new Set(panel.map((r) => r.t))].length} funds, ${months[0]} .. ${months[months.length - 1]}`);
if (ctlFail) { console.error(`\n!! ${ctlFail} POSITIVE CONTROL FAILURE(S) — the panel is stale or broken. Anything scored off it is UNTESTED, not a finding.`); Deno.exit(2); }
console.log(`    CEF PANEL LIVE.`);
