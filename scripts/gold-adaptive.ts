#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// gold-adaptive.ts (D-859) — PREREG: D-859-gold-adaptive-ensemble.
//
// THE OPERATOR'S DIRECTION, stated so the code can be checked against it: do not conclude a setup "fails" when, in
// the category where it fails, another setup wins — find where each works and combine them. This engine does exactly
// that, and does it INSIDE the laws that exist because that idea, done loosely, is the single most reliable way to
// manufacture an edge that is not there (SELECTION LAW, D-455: a pick made on the full sample is in-sample whatever
// the split says). So: every setup x exit x category is a counted trial; the per-category choice is made on TRAIN,
// written to disk, and only THEN applied to TEST; TEST is judged against the single best cell AND the unconditional
// drift of the same events; the bar is the pre-registered ceiling for this id, not t=2.
//
// Data: XAUUSD hourly, zero-volume placeholders dropped (D-858). Lag-1 entry at the next bar's open (D-498).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
import { sessionOf } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("gold-adaptive", [
  { name: "SYM", def: "XAUUSD" },
  { name: "SPLIT", def: "2023-01-01", note: "train < SPLIT <= test — frozen (D-455)" },
  { name: "RT_BP", def: "4", note: "gold CFD round trip" }, { name: "SLIP_BP", def: "2", note: "slippage on top" },
  { name: "MIN_TRAIN", def: "30", note: "events a (category, cell) needs on TRAIN to be eligible for the map" },
  { name: "MIN_TEST", def: "300", note: "ensemble TEST events below which the verdict is UNTESTED (registered)" },
  { name: "MAP", def: "data/gold-adaptive-map.json", note: "the frozen category -> cell map, written from TRAIN before TEST is read" },
  { name: "RUN_ID", def: "D-859-gold-adaptive-ensemble" },
  { name: "DESIGN", def: "split", note: "split = D-859 as registered; walkforward = D-859b (coarse categories, yearly refits 2019-2026, shrunk pick statistic)" },
  { name: "WF_FROM", def: "2019", note: "first out-of-sample year in walkforward mode" },
  { name: "LEAD", def: "range-ext|1.5|cont|K24", note: "the single fixed rule carried from D-859, evaluated in the same walk-forward" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gad", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
type B = { ts: number; o: number; h: number; l: number; c: number; vol: number };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const dayKey = (ts: number) => Math.floor(ts / 86400);
const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000, COST = (+K.RT_BP + +K.SLIP_BP) / 1e4;

// ---- data ----------------------------------------------------------------------------------------------------
const raw: B[] = []; let from = 0;
for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${K.SYM}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as B[]; if (!p.length) break; raw.push(...p); from = p.at(-1)!.ts; if (p.length < 20000) break; }
const bars = raw.filter((r) => r.vol > 0 && r.h > r.l);        // D-858: placeholders are not data
assertNonEmpty("hourly bars after the placeholder filter", bars, 60000);
console.log(`\n==> D-859 GOLD ADAPTIVE ENSEMBLE — ${bars.length.toLocaleString()} hourly bars ${new Date(bars[0].ts * 1e3).toISOString().slice(0, 10)}..${new Date(bars.at(-1)!.ts * 1e3).toISOString().slice(0, 10)}, cost ${(COST * 1e4).toFixed(0)}bp/round trip`);

// ---- daily / 4h aggregates and per-bar context (all from PRIOR completed periods) ------------------------------
const dIdx = new Map<number, number[]>(); for (let i = 0; i < bars.length; i++) { const k = dayKey(bars[i].ts); let a = dIdx.get(k); if (!a) { a = []; dIdx.set(k, a); } a.push(i); }
const days = [...dIdx.keys()].sort((a, b) => a - b);
type Day = { k: number; o: number; h: number; l: number; c: number; rng: number; first: number; last: number };
const D: Day[] = days.map((k) => { const ix = dIdx.get(k)!; let h = -Infinity, l = Infinity; for (const i of ix) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); } return { k, o: bars[ix[0]].o, h, l, c: bars[ix.at(-1)!].c, rng: (h - l) / bars[ix[0]].o, first: ix[0], last: ix.at(-1)! }; });
const dayPos = new Map(D.map((d, j) => [d.k, j]));
// daily context computed for day j from days < j
const ctxDay = D.map((_, j) => {
  if (j < 25) return null;
  const cl = D.slice(j - 24, j).map((d) => d.c); const sma = mean(cl); const slope = cl[23] - cl[0];
  const rets = []; for (let t = j - 20; t < j; t++) rets.push(Math.log(D[t].c / D[t - 1].c));
  const rv = sd(rets) * Math.sqrt(252); const medRng = med(D.slice(j - 20, j).map((d) => d.rng));
  const trend = D[j - 1].c > sma && slope > 0 ? "up" : D[j - 1].c < sma && slope < 0 ? "down" : "flat";
  const nr7 = D[j - 1].rng < Math.min(...D.slice(j - 7, j - 1).map((d) => d.rng));
  return { sma, rv, medRng, trend, pdh: D[j - 1].h, pdl: D[j - 1].l, pdc: D[j - 1].c, nr7 };
});
// 4h trend: close vs mean of the previous 24 four-hour closes (computed on the hourly grid, 4h buckets at 0/4/8/..)
const h4Close = new Map<number, number>(); for (const b of bars) h4Close.set(Math.floor(b.ts / 14400), b.c);
const h4Keys = [...h4Close.keys()].sort((a, b) => a - b); const h4Arr = h4Keys.map((k) => h4Close.get(k)!); const h4Pos = new Map(h4Keys.map((k, i) => [k, i]));
const h4Trend = (ts: number) => { const p = h4Pos.get(Math.floor(ts / 14400) - 1); if (p === undefined || p < 25) return "flat"; const m = mean(h4Arr.slice(p - 24, p)); return h4Arr[p] > m ? "up" : h4Arr[p] < m ? "down" : "flat"; };
// ATR(24h) from prior bars
const atr = new Float64Array(bars.length); for (let i = 1; i < bars.length; i++) { const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)) / bars[i].o; atr[i] = i < 25 ? tr : atr[i - 1] + (tr - atr[i - 1]) / 24; }
// rv terciles frozen on TRAIN
const rvTrain = D.map((d, j) => ({ d, j })).filter(({ d, j }) => ctxDay[j] && bars[d.first].ts < SPLIT).map(({ j }) => ctxDay[j]!.rv).sort((a, b) => a - b);
const T1 = rvTrain[Math.floor(rvTrain.length / 3)], T2 = rvTrain[Math.floor(2 * rvTrain.length / 3)];
const WF = K.DESIGN === "walkforward";
const catOf = (i: number): string | null => { const j = dayPos.get(dayKey(bars[i].ts))!; const c = ctxDay[j]; if (!c) return null; const rv = c.rv < T1 ? "lo" : c.rv < T2 ? "mid" : "hi"; if (WF) return `${rv}|${c.trend}`; const al = c.trend !== "flat" && h4Trend(bars[i].ts) === c.trend ? "aligned" : "mixed"; return `${rv}|${c.trend}|${al}|${sessionOf(bars[i].ts)}`; };

// ---- events --------------------------------------------------------------------------------------------------
type Ev = { cell: string; ts: number; i: number; dir: 1 | -1; cat: string; train: boolean };
const events: Ev[] = [];
const push = (setup: string, param: string, i: number, dir: 1 | -1) => { if (i + 30 >= bars.length || i < 30) return; const cat = catOf(i); if (!cat) return; events.push({ cell: `${setup}|${param}`, ts: bars[i].ts, i, dir, cat, train: bars[i].ts < SPLIT }); };
for (let j = 25; j < D.length; j++) {
  const c = ctxDay[j]!, d = D[j]; let brokeH = false, brokeL = false, sweptH = false, sweptL = false, hi = -Infinity, lo = Infinity, sessBars: Record<string, number[]> = {}; const hitDO = new Set<number>(), hitRE = new Set<number>();
  for (let i = d.first; i <= d.last; i++) {
    const b = bars[i]; hi = Math.max(hi, b.h); lo = Math.min(lo, b.l);
    // S1 prior-day level BREAK (first close beyond) -> continuation; S2 SWEEP-RECLAIM (wick beyond, close back) -> fade
    if (!brokeH && b.c > c.pdh) { brokeH = true; push("pdh-break", "cont", i, 1); push("pdh-break", "fade", i, -1); }
    if (!brokeL && b.c < c.pdl) { brokeL = true; push("pdl-break", "cont", i, -1); push("pdl-break", "fade", i, 1); }
    if (!sweptH && b.h > c.pdh && b.c < c.pdh) { sweptH = true; push("pdh-sweep", "fade", i, -1); push("pdh-sweep", "cont", i, 1); }
    if (!sweptL && b.l < c.pdl && b.c > c.pdl) { sweptL = true; push("pdl-sweep", "fade", i, 1); push("pdl-sweep", "cont", i, -1); }
    // S3 session drive: after the first 3 bars of London / NY, persist in their net direction
    const s = sessionOf(b.ts); (sessBars[s] ??= []).push(i);
    if ((s === "london" || s === "ny") && sessBars[s].length === 3) { const f = bars[sessBars[s][0]].o, dir = b.c > f ? 1 : b.c < f ? -1 : 0; if (dir) { push("sess-drive", s, i, dir as 1 | -1); push("sess-fade", s, i, -dir as 1 | -1); } }
    // S4 day-open reversion at 30 / 60 bp — FIRST hit per day per band (D-860 correction: the first version pushed an
    // event at EVERY hour the deviation sat inside the band, so one slow drift through 30-45bp produced several
    // overlapping "events" — within-day pseudo-replication, the D-416 trap, which inflated n and t)
    for (const X of [30, 60]) { const dev = (b.c - d.o) / d.o * 1e4; if (!hitDO.has(X) && Math.abs(dev) >= X && Math.abs(dev) < X + 15) { hitDO.add(X); push("dayopen-rev", `${X}`, i, dev > 0 ? -1 : 1); push("dayopen-cont", `${X}`, i, dev > 0 ? 1 : -1); } }
    // S5 range extension vs the prior-20-day median range — FIRST hit per day per band (same correction; this is
    // exactly what the paper bot does, and the bot's dry run is what exposed the mismatch)
    const ext = (hi - lo) / d.o / c.medRng; for (const E of [1.0, 1.5]) if (!hitRE.has(E) && ext >= E && ext < E + 0.25 && b.c !== d.o) { hitRE.add(E); const dir = b.c > d.o ? 1 : -1; push("range-ext", `${E}|cont`, i, dir as 1 | -1); push("range-ext", `${E}|fade`, i, -dir as 1 | -1); }
    // S6 4h trend alignment entry: hourly close crosses in the 4h trend direction at the 4h boundary
    if (b.ts % 14400 === 0) { const t4 = h4Trend(b.ts); if (t4 !== "flat") { push("h4-trend", "cont", i, t4 === "up" ? 1 : -1); push("h4-trend", "fade", i, t4 === "up" ? -1 : 1); } }
    // S7 NR7 breakout: yesterday narrow, first close beyond yesterday's range
    if (c.nr7 && !brokeH && b.c > c.pdh) push("nr7", "up", i, 1); if (c.nr7 && !brokeL && b.c < c.pdl) push("nr7", "down", i, -1);
  }
}
assertNonEmpty("events", events, 5000);
// ---- exits: fixed K and an ATR stop/target path -----------------------------------------------------------------
type X = { name: string; f: (e: Ev) => number };   // returns signed GROSS log return
const fixedK = (k: number): X => ({ name: `K${k}`, f: (e) => e.dir * Math.log(bars[Math.min(bars.length - 1, e.i + 1 + k)].o / bars[e.i + 1].o) });
const atrExit = (stopM: number, tgtM: number, maxK: number): X => ({ name: `ATR${stopM}x${tgtM}`, f: (e) => { const en = bars[e.i + 1].o, a = atr[e.i] * en; const stop = en - e.dir * stopM * a, tgt = en + e.dir * tgtM * a; for (let k = e.i + 1; k <= Math.min(bars.length - 1, e.i + maxK); k++) { const b = bars[k]; const hitS = e.dir > 0 ? b.l <= stop : b.h >= stop; const hitT = e.dir > 0 ? b.h >= tgt : b.l <= tgt; if (hitS && hitT) return e.dir * Math.log(stop / en); if (hitS) return e.dir * Math.log(stop / en); if (hitT) return e.dir * Math.log(tgt / en); } return e.dir * Math.log(bars[Math.min(bars.length - 1, e.i + maxK)].c / en); } });
const EXITS: X[] = [fixedK(4), fixedK(12), fixedK(24), atrExit(1, 2, 24), atrExit(1.5, 1.5, 24), atrExit(1, 3, 48)];
type Row = { cell: string; cat: string; train: boolean; day: number; net: number; dir: number; i: number; k: number };
const rows: Row[] = [];
for (const e of events) for (const x of EXITS) rows.push({ cell: `${e.cell}|${x.name}`, cat: e.cat, train: e.train, day: dayKey(e.ts), net: x.f(e) - COST, dir: e.dir, i: e.i, k: x.name.startsWith("K") ? +x.name.slice(1) : 24 });
const cells = [...new Set(rows.map((r) => r.cell))], cats = [...new Set(rows.map((r) => r.cat))].sort();
console.log(`  ${events.length.toLocaleString()} events x ${EXITS.length} exits = ${rows.length.toLocaleString()} trades across ${cells.length} cells and ${cats.length} categories; train/test split ${K.SPLIT}\n`);

const key = (c: string, k: string) => `${c}||${k}`;
const dayT = (rs: Row[]) => { const byD = new Map<number, number>(); for (const r of rs) byD.set(r.day, (byD.get(r.day) ?? 0) + r.net); const v = [...byD.values()]; return { t: tstat(v), days: v.length }; };
// ---- D-859b WALK-FORWARD: refit the coarse map each year on ALL prior years, score that year, pool the OOS years ----
if (WF) {
  const yearOf = (r: Row) => new Date(r.day * 86400 * 1000).getUTCFullYear();
  const shrunkT = (a: number[]) => tstat(a) * Math.min(1, Math.sqrt(a.length / 30) / Math.sqrt(a.length / 30 + 1)) * Math.sqrt(a.length / (a.length + 30));
  const years = [...new Set(rows.map(yearOf))].sort().filter((y) => y >= +K.WF_FROM);
  const oos: Row[] = [], lead: Row[] = []; const perYear: string[] = []; let trials = 0; const maps: Record<string, unknown> = {};
  for (const y of years) {
    const tr = rows.filter((r) => yearOf(r) < y), grid = new Map<string, number[]>();
    for (const r of tr) { const kk = key(r.cat, r.cell); let a = grid.get(kk); if (!a) { a = []; grid.set(kk, a); } a.push(r.net); }
    const m: Record<string, string> = {}; const cs = [...new Set(tr.map((r) => r.cat))];
    for (const cat of cs) { let best = "", bt = 0; for (const cell of cells) { const a = grid.get(key(cat, cell)); if (!a || a.length < 150) continue; trials++; const t = shrunkT(a); if (t > bt) { bt = t; best = cell; } } if (best) m[cat] = best; }
    maps[y] = m;
    await Deno.writeTextFile(new URL(`../data/gold-walkforward-map-${y}.json`, import.meta.url).pathname, JSON.stringify({ prereg: "D-859b-gold-walkforward", year: y, trained_on: `< ${y}`, map: m }, null, 2));
    const yr = rows.filter((r) => yearOf(r) === y && m[r.cat] === r.cell); const ld = rows.filter((r) => yearOf(r) === y && r.cell === K.LEAD);
    oos.push(...yr); lead.push(...ld);
    perYear.push(`    ${y}  ensemble n=${String(yr.length).padStart(4)} net ${(mean(yr.map((r) => r.net)) * 1e4).toFixed(1).padStart(7)}bp t ${dayT(yr).t.toFixed(2).padStart(5)}   | lead n=${String(ld.length).padStart(4)} net ${(mean(ld.map((r) => r.net)) * 1e4).toFixed(1).padStart(7)}bp t ${dayT(ld).t.toFixed(2).padStart(5)}   | map ${Object.keys(m).length} cats`);
  }
  const T = await spendTrials({ rest: OWNED, headers: hdr, family: "gold-adaptive", runId: "D-859b-gold-walkforward", spent: trials + 1 });
  const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: "D-859b-gold-walkforward" });
  const drift = new Map<number, number>(); for (const k of [4, 12, 24]) { const a: number[] = []; for (let i = 0; i + k + 1 < bars.length; i++) if (new Date(bars[i].ts * 1e3).getUTCFullYear() >= +K.WF_FROM) a.push(Math.log(bars[i + 1 + k].o / bars[i + 1].o)); drift.set(k, mean(a)); }
  const ex = oos.map((r) => r.net - r.dir * (drift.get(r.k) ?? 0));
  const E = { n: oos.length, bp: mean(oos.map((r) => r.net)) * 1e4, ...dayT(oos), exbp: mean(ex) * 1e4, ext: tstat(ex), posY: years.filter((y) => mean(oos.filter((r) => yearOf(r) === y).map((r) => r.net)) > 0).length };
  const L = { n: lead.length, bp: mean(lead.map((r) => r.net)) * 1e4, ...dayT(lead), posY: years.filter((y) => mean(lead.filter((r) => yearOf(r) === y).map((r) => r.net)) > 0).length };
  console.log(`  D-859b WALK-FORWARD (coarse categories ${[...new Set(rows.map((r) => r.cat))].length}, MIN_TRAIN 150, shrunk t, refit each year on all prior years):`);
  console.log(perYear.join("\n"));
  console.log(`\n  POOLED OOS ${years[0]}-${years.at(-1)}: ensemble n=${E.n} net ${E.bp.toFixed(2)}bp/trade, day-clustered t ${E.t.toFixed(2)} over ${E.days} days, excess over drift ${E.exbp.toFixed(2)}bp t ${E.ext.toFixed(2)}, positive years ${E.posY}/${years.length}`);
  console.log(`                          fixed lead ${K.LEAD}: n=${L.n} net ${L.bp.toFixed(2)}bp/trade, t ${L.t.toFixed(2)}, positive years ${L.posY}/${years.length}`);
  console.log(`  trials +${trials + 1}; pre-registered ceiling for this id ${ceil.ceiling.toFixed(3)} (programme ${T.ceiling.toFixed(3)})`);
  const untested = E.n < 800;
  const ok = !untested && E.bp > 0 && E.t >= ceil.ceiling && E.exbp > 6 && E.ext >= 2 && E.posY >= 5 && E.bp > L.bp;
  console.log(`\n  VERDICT (D-859b rule): ${untested ? `UNTESTED — ${E.n} OOS events < 800` : ok ? "SUPPORTED" : `NULL — ${[E.bp <= 0 && "net <= 0", E.t < ceil.ceiling && `t ${E.t.toFixed(2)} < ceiling ${ceil.ceiling.toFixed(2)}`, !(E.exbp > 6 && E.ext >= 2) && "excess over drift fails", E.posY < 5 && `only ${E.posY}/${years.length} positive years`, E.bp <= L.bp && "does not beat the fixed lead"].filter(Boolean).join("; ")}`}`);
  console.log(`  LEAD on its own, judged at the same bar: ${L.bp > 0 && L.t >= ceil.ceiling && L.posY >= 5 ? "clears" : `does not clear (t ${L.t.toFixed(2)} vs ${ceil.ceiling.toFixed(2)}, ${L.posY}/${years.length} positive years)`}.`);
  Deno.exit(0);
}
// ---- TRAIN: grid, single best cell, and the frozen category map -----------------------------------------------
const grid = new Map<string, number[]>();
for (const r of rows) if (r.train) { const kk = key(r.cat, r.cell); let a = grid.get(kk); if (!a) { a = []; grid.set(kk, a); } a.push(r.net); }
const cellTrain = new Map<string, number[]>(); for (const r of rows) if (r.train) { let a = cellTrain.get(r.cell); if (!a) { a = []; cellTrain.set(r.cell, a); } a.push(r.net); }
let bestCell = "", bestT = -Infinity; for (const [c, a] of cellTrain) if (a.length >= 200) { const t = tstat(a); if (t > bestT) { bestT = t; bestCell = c; } }
const map: Record<string, { cell: string; n: number; t: number; mean_bp: number }> = {}; let unmapped = 0;
for (const cat of cats) { let b: { cell: string; n: number; t: number; mean_bp: number } | null = null; for (const cell of cells) { const a = grid.get(key(cat, cell)); if (!a || a.length < +K.MIN_TRAIN) continue; const t = tstat(a); if (!b || t > b.t) b = { cell, n: a.length, t, mean_bp: mean(a) * 1e4 }; } if (b && b.t > 0) map[cat] = b; else unmapped++; }
const trialsSpent = grid.size + cellTrain.size + 2;
const mapPath = new URL(`../${K.MAP}`, import.meta.url).pathname;
await Deno.writeTextFile(mapPath, JSON.stringify({ prereg: K.RUN_ID, split: K.SPLIT, cost_bp: COST * 1e4, rv_terciles: [T1, T2], best_single_cell: { cell: bestCell, train_t: bestT }, map, written: new Date().toISOString(), note: "FROZEN on TRAIN before TEST was read (D-455). The paper bot reads this file; nothing edits it." }, null, 2));
console.log(`  TRAIN: ${grid.size.toLocaleString()} (category, cell) trials evaluated; ${Object.keys(map).length} of ${cats.length} categories mapped (${unmapped} had no cell with n>=${K.MIN_TRAIN} and t>0).`);
console.log(`  single best cell on TRAIN: ${bestCell} (t ${bestT.toFixed(2)}); map written to ${K.MAP} BEFORE any TEST row is read.\n`);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "gold-adaptive", runId: K.RUN_ID, spent: trialsSpent });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`  trials +${trialsSpent}; programme ceiling ${T.ceiling.toFixed(3)}; PRE-REGISTERED ceiling for this id ${ceil.ceiling.toFixed(3)} (the bar that decides)\n`);

// ---- TEST: apply the frozen map ----------------------------------------------------------------------------------
const ens = rows.filter((r) => !r.train && map[r.cat] && map[r.cat].cell === r.cell);
const single = rows.filter((r) => !r.train && r.cell === bestCell);
// unconditional drift per horizon over ALL test bars, for the benchmark
const drift = new Map<number, number>(); for (const k of [4, 12, 24]) { const a: number[] = []; for (let i = 0; i + k + 1 < bars.length; i++) if (bars[i].ts >= SPLIT) a.push(Math.log(bars[i + 1 + k].o / bars[i + 1].o)); drift.set(k, mean(a)); }
const excess = ens.map((r) => r.net - r.dir * (drift.get(r.k) ?? 0));
const E = { n: ens.length, mean_bp: mean(ens.map((r) => r.net)) * 1e4, gross_bp: mean(ens.map((r) => r.net + COST)) * 1e4, ...dayT(ens), pos: ens.filter((r) => r.net > 0).length / Math.max(1, ens.length), ex_bp: mean(excess) * 1e4, ex_t: tstat(excess) };
const S = { n: single.length, mean_bp: mean(single.map((r) => r.net)) * 1e4, ...dayT(single) };
console.log(`  TEST (${K.SPLIT}+), frozen map applied:`);
console.log(`    ensemble        n=${E.n}  net ${E.mean_bp.toFixed(2)}bp/trade  gross ${E.gross_bp.toFixed(2)}bp  day-clustered t ${E.t.toFixed(2)} over ${E.days} days  win ${(100 * E.pos).toFixed(0)}%  excess over drift ${E.ex_bp.toFixed(2)}bp t ${E.ex_t.toFixed(2)}`);
console.log(`    single best cell n=${S.n}  net ${S.mean_bp.toFixed(2)}bp/trade  day-clustered t ${S.t.toFixed(2)}   [${bestCell}]`);
console.log(`    drift benchmark per horizon (bp): ${[...drift].map(([k, v]) => `K${k} ${(v * 1e4).toFixed(2)}`).join("  ")}`);
console.log(`\n  PER-CATEGORY on TEST — where the chosen setup did and did not survive (the map the operator asked for):`);
console.log(`  ${"category".padEnd(24)} ${"chosen cell".padEnd(30)} ${"trainT".padStart(7)} ${"testN".padStart(6)} ${"test bp".padStart(8)} ${"testT".padStart(6)}`);
for (const cat of cats) { const m = map[cat]; if (!m) continue; const a = ens.filter((r) => r.cat === cat).map((r) => r.net); console.log(`  ${cat.padEnd(24)} ${m.cell.padEnd(30)} ${m.t.toFixed(2).padStart(7)} ${String(a.length).padStart(6)} ${(mean(a) * 1e4).toFixed(1).padStart(8)} ${tstat(a).toFixed(2).padStart(6)}`); }
for (const [c, bp] of [["6bp", 6], ["10bp", 10]] as [string, number][]) { const extra = (bp - (+K.RT_BP + +K.SLIP_BP)) / 1e4; console.log(`  at ${c} round trip: ensemble net ${(E.mean_bp - extra * 1e4).toFixed(2)}bp/trade`); }
const untested = E.n < +K.MIN_TEST;
const supported = !untested && E.mean_bp > 0 && E.t >= ceil.ceiling && E.ex_bp > 6 && E.ex_t >= 2 && E.mean_bp > S.mean_bp;
console.log(`\n  VERDICT against the registered rule: ${untested ? `UNTESTED — only ${E.n} TEST events (needs ${K.MIN_TEST})` : supported ? "SUPPORTED — every registered condition met on TEST" : `NULL — ${[E.mean_bp <= 0 && "net <= 0", E.t < ceil.ceiling && `t ${E.t.toFixed(2)} < ceiling ${ceil.ceiling.toFixed(2)}`, !(E.ex_bp > 6 && E.ex_t >= 2) && "excess over drift fails", E.mean_bp <= S.mean_bp && "does not beat the single best cell"].filter(Boolean).join("; ")}`}`);
console.log(`  The map above is the deliverable either way: it says, per category, which setup was chosen on train and whether it held.`);
