#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// intraday-orb-sweep.ts (D-710) — the opening-range-breakout family run across EVERY instrument held at intraday
// resolution, at every resolution held, with the laws applied.
//
// WHY GENERALISE. D-708 tested one externally-supplied ORB checklist on one instrument and reached UNTESTED. But the
// SETUP CLASS — "define a range over an opening window, trade the break, hold to a horizon" — is not specific to NQ,
// and this programme holds intraday data for 33 instruments it has never run it on. Testing one instrument and
// stopping is how a family gets called dead on a sample of one, and it is the mirror of the error that produced the
// coverage map: assuming absence of evidence in one place is evidence about everywhere.
//
// THE FOUR THINGS THAT MAKE THIS DIFFERENT FROM A NAIVE ORB SWEEP, each learned the hard way this session:
//
//   AMBIGUITY IS NOT DROPPED (D-708). When both sides of the range break inside one bar, the day is a WHIPSAW and
//   excluding it selects on the outcome — it moved the NQ result from t 7.30 to t 4.27 and more than halved the
//   mean. Ambiguous days are carried at a coin flip and their share is REPORTED, because a sweep whose ambiguity
//   rate is 40% is not measuring breakouts, it is measuring its own resolution.
//
//   EVERYTHING IS IN PERCENT, NEVER POINTS (D-708). The instruments here span EURUSD at ~1.1 and NQ at ~27,000, and
//   a threshold in points is a different threshold on every one of them and in every year.
//
//   THE BENCHMARK IS HOLDING, NOT ZERO (D-636). A directional rule on a drifting instrument shows a positive mean
//   that is the drift. Every number is reported beside what the same window returns unconditionally.
//
//   EVERY SPECIFICATION IS A TRIAL (D-628). Instruments x windows x horizons is a large search, and the ceiling has
//   to reflect it or the best of them is luck with a good haircut.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("intraday-orb-sweep", [
  { name: "OPEN_HOURS", def: "1,2", note: "length of the opening range, in bars of the source resolution" },
  { name: "HORIZONS", def: "3,6", note: "bars after the opening range in which the trade resolves" },
  { name: "COST_BP", def: "2", note: "round-trip cost in bp for INDEX/FX/COMMODITY futures and CFDs" },
  { name: "COST_BP_CRYPTO", def: "10", note: "round-trip cost in bp for perps — Binance taker is ~4-5bp PER SIDE, so 2bp would flatter every crypto row" },
  { name: "MIN_DAYS", def: "250", note: "below this an instrument is UNTESTED, not null" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "orb", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const iso = (t: number) => new Date(t * 1000).toISOString();

type Bar = { ts: number; o: number; h: number; l: number; c: number };
const universe: { name: string; res: string; bars: Bar[] }[] = [];

// ---- source 1: trd_fx_hourly (FX, indices, commodities) ---------------------------------------------------------
for (const sym of ["USATECHIDXUSD", "USA500IDXUSD", "XAUUSD", "BRENTCMDUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]) {
  const bars: Bar[] = []; let after = 0;
  for (;;) {
    const p = await fetch(`${OWNED}/trd_fx_hourly?select=ts,o,h,l,c&symbol=eq.${encodeURIComponent(sym)}&order=ts.asc&limit=10000&ts=gt.${after}`, { headers: hdr })
      .then((r) => r.ok ? r.json() : []) as Bar[];
    if (!p.length) break;
    bars.push(...p); after = p[p.length - 1].ts;
    if (p.length < 10000) break;
  }
  if (bars.length > 2000) universe.push({ name: sym, res: "1h", bars });
}
// ---- source 2: trd_bars_intraday tf=1h (crypto + a few equities) ------------------------------------------------
{
  const rows = await fetch(`${OWNED}/trd_bars_intraday?select=symbol,bars&tf=eq.1h&limit=100`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const bars: Bar[] = (r.bars || []).filter((b) => b[4] > 0).map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }));
    if (bars.length > 2000) universe.push({ name: r.symbol, res: "1h", bars });
  }
}
// ---- source 3: the NQ=F cache, at every resolution it holds -----------------------------------------------------
try {
  const j = JSON.parse(await Deno.readTextFile("/Users/ona/aegis-data/nq_yahoo_intraday.json")) as Record<string, { t: number; o: number; h: number; l: number; c: number }[]>;
  for (const [res, arr] of Object.entries(j)) {
    const bars: Bar[] = arr.filter((b) => b.c > 0).map((b) => ({ ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
    if (bars.length > 2000) universe.push({ name: "NQ=F", res, bars });
  }
} catch { console.log("  (NQ=F cache not present — run ingest-nq-yahoo.ts)"); }

assertNonEmpty("instruments loaded", universe, 5);
console.log(`==> INTRADAY ORB SWEEP — ${universe.length} instrument/resolution series\n`);

const OPENS = K.OPEN_HOURS.split(",").map(Number);
const HORIZ = K.HORIZONS.split(",").map(Number);
const COST = Number(K.COST_BP) / 1e4;
const COST_C = Number(K.COST_BP_CRYPTO) / 1e4;
// A single cost for a universe spanning EURUSD and altcoin perps is not a cost model. Perps pay taker fees an order
// of magnitude above an index future's spread, and applying 2bp to both would flatter exactly the rows with the
// largest headline numbers.
const costOf = (name: string) => /USDT$/.test(name) ? COST_C : COST;

interface Res { name: string; res: string; ow: number; hz: number; n: number; ambPct: number;
  meanPct: number; t: number; benchPct: number; excessPct: number; netPct: number; eras: number[] }
const out: Res[] = [];

for (const u of universe) {
  // group into UTC days; the "opening" is the first bar of each day present in the series
  const byDay = new Map<string, Bar[]>();
  for (const b of u.bars) { const d = iso(b.ts).slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b); }
  for (const ow of OPENS) for (const hz of HORIZ) {
    const rets: number[] = [], bench: number[] = [], keys: string[] = [];
    let amb = 0, tot = 0;
    for (const [d, v] of [...byDay.entries()].sort()) {
      if (v.length < ow + hz) continue;
      tot++;
      const opening = v.slice(0, ow);
      const hi = Math.max(...opening.map((b) => b.h)), lo = Math.min(...opening.map((b) => b.l));
      const ref = opening[opening.length - 1].c;
      if (!(hi > lo) || !(ref > 0)) continue;
      const win = v.slice(ow, ow + hz);
      const last = win[win.length - 1];
      bench.push((last.c - ref) / ref);        // BENCHMARK: hold long the same window, no conditioning
      let dir: 0 | 1 | -1 = 0, entry = 0, ambiguous = false;
      for (const bar of win) {
        const up = bar.h > hi, dn = bar.l < lo;
        if (up && dn) { ambiguous = true; break; }
        if (up) { dir = 1; entry = hi; break; }
        if (dn) { dir = -1; entry = lo; break; }
      }
      if (ambiguous) {
        // D-708: carried at a coin flip, never dropped. Dropping them selects on the outcome.
        amb++;
        rets.push((((last.c - hi) / hi) + ((lo - last.c) / lo)) / 2);
        keys.push(d);
        continue;
      }
      if (dir === 0) continue;                  // no break at all — genuinely no trade, not a hidden loser
      rets.push(dir === 1 ? (last.c - entry) / entry : (entry - last.c) / entry);
      keys.push(d);
    }
    if (rets.length < Number(K.MIN_DAYS)) continue;
    const q4 = [0, 1, 2, 3].map((e) => {
      const a = Math.floor(e * rets.length / 4), b = Math.floor((e + 1) * rets.length / 4);
      return mean(rets.slice(a, b)) * 100;
    });
    out.push({ name: u.name, res: u.res, ow, hz, n: rets.length, ambPct: 100 * amb / Math.max(1, tot),
      meanPct: mean(rets) * 100, t: tstat(rets), benchPct: mean(bench) * 100,
      excessPct: (mean(rets) - mean(bench)) * 100,
      // D-710 CORRECTION: `net` must subtract cost from the EXCESS, not from the raw mean. Taking it off the raw
      // mean reports a spread as a return without subtracting its universe — the exact D-627 error, committed in
      // my own summary column. On the one spec that cleared the ceiling it is the difference between +0.008%
      // (looks tradable) and -0.004% (is not).
      netPct: (mean(rets) - mean(bench) - costOf(u.name)) * 100, eras: q4 });
  }
}
assertNonEmpty("specifications evaluated", out, 10);

// EVERY SPEC IS A TRIAL and the ceiling must reflect the search that produced the best of them.
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "intraday-orb",
  runId: `orb|${universe.length}series|${OPENS.join("-")}|${HORIZ.join("-")}`, spent: out.length });
console.log(`    ${out.length} specifications evaluated across ${universe.length} series`);
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()}  |  DEFLATION CEILING ${spend.ceiling.toFixed(4)}\n`);

out.sort((a, b) => b.t - a.t);
console.log(`    TOP BY t (the bar is the ceiling above, NOT 2.0):`);
console.log(`    ${"instrument".padEnd(16)}${"res".padStart(5)}${"ow/hz".padStart(7)}${"n".padStart(6)}${"amb%".padStart(7)}${"mean%".padStart(8)}${"t".padStart(7)}${"bench%".padStart(8)}${"excess%".padStart(9)}${"net%".padStart(8)}${"eras".padStart(7)}`);
for (const r of out.slice(0, 14)) {
  const es = r.eras.map((x) => x > 0 ? "+" : "-").join("");
  console.log(`    ${r.name.slice(0, 15).padEnd(16)}${r.res.padStart(5)}${`${r.ow}/${r.hz}`.padStart(7)}${String(r.n).padStart(6)}${r.ambPct.toFixed(0).padStart(6)}%${r.meanPct.toFixed(3).padStart(8)}${r.t.toFixed(2).padStart(7)}${r.benchPct.toFixed(3).padStart(8)}${r.excessPct.toFixed(3).padStart(9)}${r.netPct.toFixed(3).padStart(8)}${es.padStart(7)}`);
}

const clears = out.filter((r) => r.t > spend.ceiling);
const clearsNet = out.filter((r) => r.t > spend.ceiling && r.netPct > 0);
const netPos = out.filter((r) => r.netPct > 0);
const beatsBench = out.filter((r) => r.excessPct > 0);
console.log(`\n    SPECIFICATIONS CLEARING THE ${spend.ceiling.toFixed(2)} CEILING: ${clears.length} of ${out.length}`);
console.log(`    ...and ALSO net-positive on the EXCESS after cost: ${clearsNet.length}`);
console.log(`    net-positive after ${K.COST_BP}bp round trip: ${netPos.length}  |  beating the hold-long benchmark: ${beatsBench.length}`);
const ambs = out.map((r) => r.ambPct).sort((a, b) => a - b);
console.log(`    AMBIGUITY RATE across specs: p10 ${ambs[Math.floor(0.1 * ambs.length)].toFixed(0)}%  median ${ambs[Math.floor(0.5 * ambs.length)].toFixed(0)}%  p90 ${ambs[Math.floor(0.9 * ambs.length)].toFixed(0)}%`);
console.log(`    A spec whose ambiguity rate is high is not measuring breakouts, it is measuring its own resolution.`);
if (clears.length) {
  console.log(`\n    THE CLEARING SPECS STILL FACE EVERY OTHER LAW — benchmark excess, cost, era sign, and the fact that`);
  console.log(`    they are the best of ${out.length}. None is promoted by appearing here.`);
}
await stampDataVersion(OWNED, hdr, { trd_fx_hourly: null, trd_bars_intraday: null });
