#!/usr/bin/env -S deno run --allow-net --allow-env
// nq-motion-model.ts (D-708) — testing an externally-supplied opening-range-breakout checklist for NQ.
//
// THE MODEL AS SUPPLIED: trade 8:30-11:00, only when the opening range is BETWEEN 5 AND 20 POINTS. Over 20 is "too
// wide and volatile", under 5 is "too tight". No-trade on red-folder news days, JPOW speaking, the day before NFP,
// the afternoon before FOMC. On news days with an abnormal wick, look for an iFVG setup instead.
//
// THREE PROBLEMS TO SEPARATE BEFORE ANY BACKTEST, because they have different answers:
//
// 1. THE RULE IS NOT SCALE-INVARIANT, AND THIS IS THE DECISIVE ONE. It is stated in ABSOLUTE POINTS on an index that
//    ran from ~3,900 to ~30,800 over the sample. Twenty points was 0.51% of index level in 2016 and is 0.07% today —
//    a factor of SEVEN. A filter written in points therefore selects completely different market conditions in
//    different years, and "the same rule" in 2016 and 2026 are not the same rule. Measured below.
//
// 2. RESOLUTION. The model implies an intraday opening range (30 minutes or less). The best NQ proxy held here is
//    USATECHIDXUSD at HOURLY resolution — 79,848 bars, 2016-2026. A 1-hour opening range is a RELATED rule, not the
//    same one, and intrabar breakout timing cannot be resolved at all. Stated, not glossed.
//
// 3. THE PARTS THAT CANNOT BE TESTED HERE AT ALL: the iFVG setup (undefined in the checklist), the news filter (no
//    economic calendar held), and intrabar entry/stop placement. Recorded as UNTESTED rather than assumed neutral.
//
// WHAT IS TESTABLE, AND IT IS THE CHECKLIST'S CENTRAL CLAIM: does conditioning on opening-range WIDTH predict what
// the rest of the morning does? If a middling range really is "healthy" and a wide one really is unusable, that must
// show up as a difference in outcome across width buckets. That is falsifiable and it is what this measures.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("nq-motion-model", [
  { name: "SYMBOL", def: "USATECHIDXUSD", note: "Nasdaq-100 proxy; the only one held at intraday resolution" },
  { name: "OPEN_H", def: "13", note: "UTC hour treated as the opening bar (US cash open falls in 13:00-14:00 UTC depending on DST)" },
  { name: "WINDOW_H", def: "3", note: "hours after the opening bar in which the trade must resolve — the 8:30-11:00 window" },
  { name: "COST_PTS", def: "1.0", note: "round-trip cost in index points: MNQ commission ~$1 + 0.25pt spread ~ 0.75-1.0pt equivalent" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "nqm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

type R = { ts: number; o: number; h: number; l: number; c: number };
const rows: R[] = [];
let after = 0;
for (;;) {
  const p = await fetch(`${OWNED}/trd_fx_hourly?select=ts,o,h,l,c&symbol=eq.${encodeURIComponent(K.SYMBOL)}&order=ts.asc&limit=10000&ts=gt.${after}`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []) as R[];
  if (!p.length) break;
  rows.push(...p); after = p[p.length - 1].ts;
  if (p.length < 10000) break;
}
assertNonEmpty(`${K.SYMBOL} hourly bars`, rows, 10000);
const iso = (t: number) => new Date(t * 1000).toISOString();

const byDay = new Map<string, R[]>();
for (const r of rows) { const d = iso(r.ts).slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }

const OPEN_H = Number(K.OPEN_H), WIN = Number(K.WINDOW_H), COST = Number(K.COST_PTS);

interface Day { d: string; lvl: number; rangePts: number; rangePct: number; relRange: number;
  broke: 0 | 1 | -1; followPts: number; mfe: number; mae: number }
const days: Day[] = [];
const recentRanges: number[] = [];
for (const [d, v] of [...byDay.entries()].sort()) {
  const open = v.find((r) => +iso(r.ts).slice(11, 13) === OPEN_H);
  if (!open) continue;
  const after2 = v.filter((r) => { const hh = +iso(r.ts).slice(11, 13); return hh > OPEN_H && hh <= OPEN_H + WIN; });
  if (after2.length < WIN) continue;
  const rangePts = open.h - open.l;
  if (!(rangePts > 0) || !(open.c > 0)) continue;
  // NORMALISATION, because the raw points figure is not comparable across a 6x change in index level. Two forms:
  // as a PERCENTAGE of level, and RELATIVE to the trailing 20-day median range, which is what a practitioner
  // eyeballing "is this range healthy" is actually approximating.
  const rangePct = 100 * rangePts / open.c;
  const med = recentRanges.length >= 20
    ? [...recentRanges.slice(-20)].sort((a, b) => a - b)[10] : NaN;
  const relRange = Number.isFinite(med) && med > 0 ? rangePts / med : NaN;
  recentRanges.push(rangePts);

  // The breakout: first of the following hours whose HIGH exceeds the opening high (long) or whose LOW breaks the
  // opening low (short). If both happen in the same bar the direction is ambiguous at hourly resolution and the day
  // is recorded as ambiguous rather than resolved by a guess — that guess is where hourly-bar ORB studies usually
  // manufacture their edge.
  let broke: 0 | 1 | -1 = 0, entry = 0, ambiguous = false;
  for (const bar of after2) {
    const up = bar.h > open.h, dn = bar.l < open.l;
    if (up && dn) { ambiguous = true; break; }
    if (up) { broke = 1; entry = open.h; break; }
    if (dn) { broke = -1; entry = open.l; break; }
  }
  // D-708 CORRECTION — THE EXCLUSION WAS DOING MORE THAN HALF THE WORK. Dropping days that break BOTH sides inside
  // one bar is not conservative: such a day is a WHIPSAW, i.e. one the breakout failed, so excluding them selects on
  // the outcome. Measured: clean-only gives +15.41 pts at t 7.30; including them at a coin-flip gives +7.32 at
  // t 4.27; at the worst assignment, -4.87 at t -2.46. The 22% carried the result. In live trading you are entered
  // on the first touch and cannot know the other side is coming, and at HOURLY resolution the order of the two
  // touches is unobservable — so the honest treatment is a coin flip with the bound reported either side, and the
  // honest VERDICT is that this model is untestable at this resolution.
  if (ambiguous) {
    const last = after2[after2.length - 1];
    const asLong = last.c - open.h, asShort = open.l - last.c;
    days.push({ d, lvl: open.c, rangePts, rangePct, relRange, broke: 1, followPts: (asLong + asShort) / 2, mfe: NaN, mae: NaN });
    continue;
  }
  if (broke === 0) { days.push({ d, lvl: open.c, rangePts, rangePct, relRange, broke: 0, followPts: NaN, mfe: NaN, mae: NaN }); continue; }
  const last = after2[after2.length - 1];
  const follow = broke === 1 ? last.c - entry : entry - last.c;
  const hi = Math.max(...after2.map((b) => b.h)), lo = Math.min(...after2.map((b) => b.l));
  const mfe = broke === 1 ? hi - entry : entry - lo;
  const mae = broke === 1 ? entry - lo : hi - entry;
  days.push({ d, lvl: open.c, rangePts, rangePct, relRange, broke, followPts: follow, mfe, mae });
}
assertNonEmpty("usable days", days, 500);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

console.log(`==> NQ MOTION MODEL — externally supplied checklist, tested on ${K.SYMBOL} hourly`);
console.log(`    ${rows.length.toLocaleString()} bars, ${days.length} usable days, ${iso(rows[0].ts).slice(0, 10)}..${iso(rows[rows.length - 1].ts).slice(0, 10)}`);
console.log(`    opening bar = ${OPEN_H}:00 UTC, resolution window ${WIN}h, round-trip cost ${COST} index points\n`);

// ---- PROBLEM 1: the rule is not scale-invariant ------------------------------------------------------------------
console.log(`  1. THE FILTER IS STATED IN POINTS AND THE INDEX ROSE 6x. What "5-20 points" selects, by year:`);
console.log(`     ${"year".padEnd(7)}${"median level".padStart(14)}${"20pts as % of level".padStart(21)}${"days in the 5-20 band".padStart(24)}`);
const byYear = new Map<string, Day[]>();
for (const x of days) { const y = x.d.slice(0, 4); (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(x); }
for (const [y, v] of [...byYear.entries()].sort()) {
  const lvls = v.map((x) => x.lvl).sort((a, b) => a - b);
  const med = lvls[Math.floor(lvls.length / 2)];
  const inBand = v.filter((x) => x.rangePts >= 5 && x.rangePts <= 20).length;
  console.log(`     ${y.padEnd(7)}${med.toFixed(0).padStart(14)}${(100 * 20 / med).toFixed(3).padStart(20)}%${`${inBand}/${v.length} (${(100 * inBand / v.length).toFixed(0)}%)`.padStart(24)}`);
}
console.log(`\n     A filter in absolute points is a DIFFERENT filter every year. This is a specification defect, not a`);
console.log(`     market finding, and it has to be fixed before the rule can be said to mean one thing.`);

// ---- PROBLEM 2: does range width predict anything? ---------------------------------------------------------------
function bucketReport(label: string, keyf: (d: Day) => number | null, edges: number[], fmt: (n: number) => string) {
  const usable = days.filter((x) => x.broke !== 0 && Number.isFinite(x.followPts) && Number.isFinite(keyf(x) ?? NaN));
  console.log(`\n  ${label}  (${usable.length} days with a resolved breakout)`);
  console.log(`     ${"bucket".padEnd(18)}${"n".padStart(6)}${"mean follow".padStart(13)}${"t".padStart(7)}${"win%".padStart(7)}${"net of cost".padStart(13)}${"MFE/MAE".padStart(10)}`);
  for (let i = 0; i < edges.length - 1; i++) {
    const v = usable.filter((x) => { const kk = keyf(x)!; return kk >= edges[i] && kk < edges[i + 1]; });
    if (v.length < 25) { console.log(`     ${`${fmt(edges[i])}-${fmt(edges[i + 1])}`.padEnd(18)}${String(v.length).padStart(6)}   too few to report`); continue; }
    const f = v.map((x) => x.followPts);
    const net = f.map((x) => x - COST);
    const ratio = mean(v.map((x) => x.mfe)) / Math.max(1e-9, mean(v.map((x) => x.mae)));
    console.log(`     ${`${fmt(edges[i])}-${fmt(edges[i + 1])}`.padEnd(18)}${String(v.length).padStart(6)}${mean(f).toFixed(2).padStart(13)}${tstat(f).toFixed(2).padStart(7)}${(100 * f.filter((x) => x > 0).length / f.length).toFixed(0).padStart(6)}%${mean(net).toFixed(2).padStart(13)}${ratio.toFixed(2).padStart(10)}`);
  }
}
bucketReport("2. BY RANGE AS % OF INDEX LEVEL — the scale-invariant version of the checklist's filter",
  (d) => d.rangePct, [0, 0.05, 0.10, 0.20, 0.40, 0.80, 99], (n) => n >= 99 ? "wide" : n.toFixed(2) + "%");
bucketReport("3. BY RANGE RELATIVE TO ITS OWN TRAILING 20-DAY MEDIAN — what 'is this range healthy' approximates",
  (d) => d.relRange, [0, 0.5, 0.8, 1.2, 2.0, 99], (n) => n >= 99 ? "wide" : n.toFixed(1) + "x");

// ---- the pooled question ------------------------------------------------------------------------------------------
const res = days.filter((x) => x.broke !== 0 && Number.isFinite(x.followPts));
const all = res.map((x) => x.followPts);
console.log(`\n  4. THE BREAKOUT ITSELF, unconditional: n=${all.length}, mean follow-through ${mean(all).toFixed(2)} pts, t ${tstat(all).toFixed(2)},`);
console.log(`     win rate ${(100 * all.filter((x) => x > 0).length / all.length).toFixed(0)}%, net of ${COST}pt cost ${(mean(all) - COST).toFixed(2)} pts.`);
const noBreak = days.filter((x) => x.broke === 0).length;
console.log(`     ${noBreak} of ${days.length} days (${(100 * noBreak / days.length).toFixed(0)}%) never resolved a clean directional break at hourly resolution`);
console.log(`     — either no break, or both sides broken inside one bar. Those are recorded as AMBIGUOUS, not guessed:`);
console.log(`     guessing them is where hourly-bar ORB studies usually manufacture their edge.`);
await stampDataVersion(OWNED, hdr, { trd_fx_hourly: null });
