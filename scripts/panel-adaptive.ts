#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// panel-adaptive.ts (D-861) — PREREG: D-861-panel-adaptive-walkforward. The gold engine (D-859/859b/860) generalised
// to the 24-instrument hourly panel: one POOLED category map (class x rv-tercile x daily trend), 7 setup families x 6
// exits, FIRST-HIT-PER-DAY events exactly as a bot fires them (D-860), class-specific costs, lag-1 entry, yearly
// walk-forward 2019-2026 refit on all prior years. Judged on pooled OOS, per-instrument agreement, per-class, per-year.
// Two passes so memory holds: (1) aggregate (year, category, cell) statistics and fit each year's map; (2) recompute
// only the chosen trades for scoring. Every fit is a counted trial; each year's map is written before it is scored.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
import { sessionOf, decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("panel-adaptive", [
  { name: "WF_FROM", def: "2019" }, { name: "MIN_TRAIN", def: "150" }, { name: "MIN_INST", def: "50", note: "OOS events an instrument needs to count toward agreement" },
  { name: "CRYPTO_BP", def: "7" }, { name: "IDX_BP", def: "4" }, { name: "FX_BP", def: "2" }, { name: "SLIP_BP", def: "2" },
  { name: "RUN_ID", def: "D-861-panel-adaptive-walkforward" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pad", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
type B = { ts: number; o: number; h: number; l: number; c: number };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const dayKey = (ts: number) => Math.floor(ts / 86400); const yearOfTs = (ts: number) => new Date(ts * 1e3).getUTCFullYear();
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"], IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
const classOf = (s: string) => FX.includes(s) ? "fx" : IDX.includes(s) ? "idx" : "crypto";
const costOf = (s: string) => ((classOf(s) === "fx" ? +K.FX_BP : classOf(s) === "idx" ? +K.IDX_BP : +K.CRYPTO_BP) + +K.SLIP_BP) / 1e4;
async function load(sym: string): Promise<B[]> {
  if (FX.includes(sym) || IDX.includes(sym)) { const out: B[] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as (B & { vol: number })[]; if (!p.length) break; out.push(...p.filter((r) => r.vol > 0 && r.h > r.l)); from = p.at(-1)!.ts; if (p.length < 20000) break; } return out; }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).filter((b) => b.v > 0 && b.h > b.l).sort((a, b) => a.ts - b.ts);
}
const perps = (await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 10000).map((r) => r.symbol);
const U = [...perps, ...FX, ...IDX];
// ---- events per instrument (first-hit-per-day, D-860) + per-instrument context ----
type Ev = { sym: string; cell: string; i: number; dir: 1 | -1; cat: string; day: number; year: number };
const EXITS = ["K4", "K12", "K24", "ATR1x2", "ATR1.5x1.5", "ATR1x3"];
const barsOf = new Map<string, B[]>(), atrOf = new Map<string, Float64Array>(), rvAll: number[] = []; const evs: Ev[] = [];
const rvOfEv: number[] = []; // rv at each event, for tercile assignment after thresholds are fixed on pre-WF_FROM data
for (const sym of U) {
  const bars = await load(sym); if (bars.length < 10000) continue; barsOf.set(sym, bars);
  const atr = new Float64Array(bars.length); for (let i = 1; i < bars.length; i++) { const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)) / bars[i].o; atr[i] = i < 25 ? tr : atr[i - 1] + (tr - atr[i - 1]) / 24; } atrOf.set(sym, atr);
  const dIdx = new Map<number, number[]>(); bars.forEach((b, i) => { const k = dayKey(b.ts); let a = dIdx.get(k); if (!a) { a = []; dIdx.set(k, a); } a.push(i); });
  const days = [...dIdx.keys()].sort((a, b) => a - b);
  const D = days.map((k) => { const ix = dIdx.get(k)!; let h = -Infinity, l = Infinity; for (const i of ix) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); } return { o: bars[ix[0]].o, h, l, c: bars[ix.at(-1)!].c, rng: (h - l) / bars[ix[0]].o, first: ix[0], last: ix.at(-1)! }; });
  for (let j = 25; j < D.length; j++) {
    const cl = D.slice(j - 24, j).map((d) => d.c), sma = mean(cl), slope = cl[23] - cl[0]; const rets = []; for (let t = j - 20; t < j; t++) rets.push(Math.log(D[t].c / D[t - 1].c));
    const rv = sd(rets) * Math.sqrt(365), medRng = med(D.slice(j - 20, j).map((d) => d.rng)), trend = D[j - 1].c > sma && slope > 0 ? "up" : D[j - 1].c < sma && slope < 0 ? "down" : "flat";
    const pdh = D[j - 1].h, pdl = D[j - 1].l, nr7 = D[j - 1].rng < Math.min(...D.slice(j - 7, j - 1).map((d) => d.rng)); const d = D[j];
    if (bars[d.first].ts < Date.parse("2016-01-01T00:00:00Z") / 1000) continue;
    const push = (setup: string, param: string, i: number, dir: 1 | -1) => { if (i + 50 >= bars.length || i < 30) return; evs.push({ sym, cell: `${setup}|${param}`, i, dir, cat: `${classOf(sym)}|RV|${trend}`, day: dayKey(bars[i].ts), year: yearOfTs(bars[i].ts) }); rvOfEv.push(rv); };
    let brokeH = false, brokeL = false, sweptH = false, sweptL = false, hi = -Infinity, lo = Infinity; const sess: Record<string, number[]> = {}; const hitDO = new Set<number>(), hitRE = new Set<number>();
    for (let i = d.first; i <= d.last; i++) {
      const b = bars[i]; hi = Math.max(hi, b.h); lo = Math.min(lo, b.l);
      if (!brokeH && b.c > pdh) { brokeH = true; push("pdh-break", "cont", i, 1); push("pdh-break", "fade", i, -1); if (nr7) push("nr7", "up", i, 1); }
      if (!brokeL && b.c < pdl) { brokeL = true; push("pdl-break", "cont", i, -1); push("pdl-break", "fade", i, 1); if (nr7) push("nr7", "down", i, -1); }
      if (!sweptH && b.h > pdh && b.c < pdh) { sweptH = true; push("pdh-sweep", "fade", i, -1); push("pdh-sweep", "cont", i, 1); }
      if (!sweptL && b.l < pdl && b.c > pdl) { sweptL = true; push("pdl-sweep", "fade", i, 1); push("pdl-sweep", "cont", i, -1); }
      const s = sessionOf(b.ts); (sess[s] ??= []).push(i); if ((s === "london" || s === "ny") && sess[s].length === 3) { const f = bars[sess[s][0]].o, dir = b.c > f ? 1 : b.c < f ? -1 : 0; if (dir) { push("sess-drive", s, i, dir as 1 | -1); push("sess-fade", s, i, -dir as 1 | -1); } }
      for (const X of [30, 60]) { const dev = (b.c - d.o) / d.o * 1e4; if (!hitDO.has(X) && Math.abs(dev) >= X && Math.abs(dev) < X + 15) { hitDO.add(X); push("dayopen-rev", `${X}`, i, dev > 0 ? -1 : 1); push("dayopen-cont", `${X}`, i, dev > 0 ? 1 : -1); } }
      const ext = (hi - lo) / d.o / medRng; for (const E of [1.0, 1.5]) if (!hitRE.has(E) && ext >= E && ext < E + 0.25 && b.c !== d.o) { hitRE.add(E); const dir = b.c > d.o ? 1 : -1; push("range-ext", `${E}|cont`, i, dir as 1 | -1); push("range-ext", `${E}|fade`, i, -dir as 1 | -1); }
    }
  }
}
assertNonEmpty("instruments", [...barsOf.keys()], 20); assertNonEmpty("events", evs, 50000);
// rv terciles per class, fixed on events before WF_FROM
const TH: Record<string, [number, number]> = {};
for (const cls of ["crypto", "fx", "idx"]) { const a = rvOfEv.filter((_, k) => evs[k].cat.startsWith(cls) && evs[k].year < +K.WF_FROM).sort((x, y) => x - y); TH[cls] = [a[Math.floor(a.length / 3)], a[Math.floor(2 * a.length / 3)]]; }
for (let k = 0; k < evs.length; k++) { const cls = evs[k].cat.split("|")[0], [t1, t2] = TH[cls]; evs[k].cat = evs[k].cat.replace("RV", rvOfEv[k] < t1 ? "lo" : rvOfEv[k] < t2 ? "mid" : "hi"); }
const tradeNet = (e: Ev, x: string): number => {
  const bars = barsOf.get(e.sym)!, en = bars[e.i + 1].o, cost = costOf(e.sym);
  if (x.startsWith("K")) { const k = +x.slice(1); return e.dir * Math.log(bars[Math.min(bars.length - 1, e.i + 1 + k)].o / en) - cost; }
  const [sm, tm] = x.slice(3).split("x").map(Number), maxK = tm === 3 ? 48 : 24, a = atrOf.get(e.sym)![e.i] * en, stop = en - e.dir * sm * a, tgt = en + e.dir * tm * a;
  for (let k = e.i + 1; k <= Math.min(bars.length - 1, e.i + maxK); k++) { const b = bars[k]; const hs = e.dir > 0 ? b.l <= stop : b.h >= stop, ht = e.dir > 0 ? b.h >= tgt : b.l <= tgt; if (hs) return e.dir * Math.log(stop / en) - cost; if (ht) return e.dir * Math.log(tgt / en) - cost; }
  return e.dir * Math.log(bars[Math.min(bars.length - 1, e.i + maxK)].c / en) - cost;
};
const cells = [...new Set(evs.map((e) => e.cell))].flatMap((c) => EXITS.map((x) => `${c}|${x}`)); const cats = [...new Set(evs.map((e) => e.cat))].sort();
console.log(`\n==> D-861 PANEL ADAPTIVE WALK-FORWARD — ${barsOf.size} instruments, ${evs.length.toLocaleString()} first-hit events x ${EXITS.length} exits, ${cells.length} cells, ${cats.length} categories (class x rv x trend)`);
// ---- pass 1: per (year, cat, cell) sufficient statistics ----
type St = { n: number; s: number; ss: number }; const agg = new Map<string, St>();
const years = [...new Set(evs.map((e) => e.year))].sort((a, b) => a - b);
for (const e of evs) for (const x of EXITS) { const v = tradeNet(e, x); const k = `${e.year}|${e.cat}|${e.cell}|${x}`; let s = agg.get(k); if (!s) { s = { n: 0, s: 0, ss: 0 }; agg.set(k, s); } s.n++; s.s += v; s.ss += v * v; }
const shrunkT = (n: number, s: number, ss: number) => { if (n < 3) return 0; const m = s / n, v = (ss - n * m * m) / (n - 1); const t = m / (Math.sqrt(v / n) || 1e-12); return t * Math.sqrt(n / (n + 30)); };
let trials = 0; const maps: Record<number, Record<string, string>> = {};
const oosYears = years.filter((y) => y >= +K.WF_FROM);
for (const y of oosYears) {
  const m: Record<string, string> = {};
  for (const cat of cats) { let best = "", bt = 0; for (const cell of cells) { let n = 0, s = 0, ss = 0; for (const yy of years) if (yy < y) { const a = agg.get(`${yy}|${cat}|${cell}`); if (a) { n += a.n; s += a.s; ss += a.ss; } } if (n < +K.MIN_TRAIN) continue; trials++; const t = shrunkT(n, s, ss); if (t > bt) { bt = t; best = cell; } } if (best) m[cat] = best; }
  maps[y] = m; await Deno.writeTextFile(new URL(`../data/panel-walkforward-map-${y}.json`, import.meta.url).pathname, JSON.stringify({ prereg: K.RUN_ID, year: y, map: m }, null, 2));
}
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "panel-adaptive", runId: K.RUN_ID, spent: trials + 1 });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`  maps written for ${oosYears.join(",")}; ${trials.toLocaleString()} fits counted; pre-registered ceiling ${ceil.ceiling.toFixed(3)} (programme ${T.ceiling.toFixed(3)})\n`);
// ---- pass 2: score the chosen trades OOS ----
type Row = { sym: string; cls: string; year: number; day: number; net: number; dir: number; k: number };
const rows: Row[] = [];
for (const e of evs) { if (e.year < +K.WF_FROM) continue; const chosen = maps[e.year][e.cat]; if (!chosen) continue; const x = chosen.slice(chosen.lastIndexOf("|") + 1), cell = chosen.slice(0, chosen.lastIndexOf("|")); if (cell !== e.cell) continue; rows.push({ sym: e.sym, cls: classOf(e.sym), year: e.year, day: e.day, net: tradeNet(e, x), dir: e.dir, k: x.startsWith("K") ? +x.slice(1) : 24 }); }
const dayT = (rs: Row[]) => { const byD = new Map<number, number>(); for (const r of rs) byD.set(r.day, (byD.get(r.day) ?? 0) + r.net); const v = [...byD.values()]; return { t: tstat(v), days: v.length }; };
// drift control per class per horizon over OOS bars
const drift = new Map<string, number>();
for (const cls of ["crypto", "fx", "idx"]) for (const k of [4, 12, 24]) { const a: number[] = []; for (const [sym, bars] of barsOf) if (classOf(sym) === cls) for (let i = 0; i + k + 1 < bars.length; i += 7) if (yearOfTs(bars[i].ts) >= +K.WF_FROM) a.push(Math.log(bars[i + 1 + k].o / bars[i + 1].o)); drift.set(`${cls}|${k}`, mean(a)); }
const ex = rows.map((r) => r.net - r.dir * (drift.get(`${r.cls}|${r.k}`) ?? 0));
const E = { n: rows.length, bp: mean(rows.map((r) => r.net)) * 1e4, ...dayT(rows), exbp: mean(ex) * 1e4, ext: tstat(ex) };
console.log(`  POOLED OOS ${oosYears[0]}-${oosYears.at(-1)}: n=${E.n.toLocaleString()} net ${E.bp.toFixed(2)}bp/trade, day-clustered t ${E.t.toFixed(2)} over ${E.days} days, excess over class drift ${E.exbp.toFixed(2)}bp t ${E.ext.toFixed(2)}`);
console.log(`\n  BY YEAR:`); for (const y of oosYears) { const a = rows.filter((r) => r.year === y); console.log(`    ${y}  n=${String(a.length).padStart(5)}  net ${(mean(a.map((r) => r.net)) * 1e4).toFixed(1).padStart(6)}bp  t ${dayT(a).t.toFixed(2)}`); }
console.log(`\n  BY CLASS (the INSTRUMENT LAW question — where does it live?):`); for (const cls of ["crypto", "fx", "idx"]) { const a = rows.filter((r) => r.cls === cls); console.log(`    ${cls.padEnd(7)} n=${String(a.length).padStart(5)}  net ${(mean(a.map((r) => r.net)) * 1e4).toFixed(1).padStart(6)}bp  t ${dayT(a).t.toFixed(2)}  cost ${(costOf(a[0]?.sym ?? "EURUSD") * 1e4).toFixed(0)}bp`); }
console.log(`\n  BY INSTRUMENT (agreement):`); let pos = 0, cnt = 0;
for (const sym of [...barsOf.keys()]) { const a = rows.filter((r) => r.sym === sym); if (a.length < +K.MIN_INST) continue; cnt++; const m = mean(a.map((r) => r.net)) * 1e4; if (m > 0) pos++; console.log(`    ${sym.padEnd(14)} n=${String(a.length).padStart(4)} net ${m.toFixed(1).padStart(6)}bp t ${tstat(a.map((r) => r.net)).toFixed(2)}`); }
const posYears = oosYears.filter((y) => mean(rows.filter((r) => r.year === y).map((r) => r.net)) > 0).length;
const costAvg = mean(rows.map((r) => costOf(r.sym))) * 1e4;
const ok = E.bp > 0 && E.t >= ceil.ceiling && pos / Math.max(1, cnt) >= 0.6 && E.exbp > costAvg && E.ext >= 2 && posYears >= 5;
console.log(`\n  instrument agreement ${pos}/${cnt} positive (needs 60%); positive years ${posYears}/${oosYears.length}; mean class cost ${costAvg.toFixed(1)}bp`);
console.log(`  VERDICT (D-861 rule): ${ok ? "SUPPORTED" : `NULL — ${[E.bp <= 0 && "net <= 0", E.t < ceil.ceiling && `t ${E.t.toFixed(2)} < ceiling ${ceil.ceiling.toFixed(2)}`, pos / Math.max(1, cnt) < 0.6 && "instrument agreement fails", !(E.exbp > costAvg && E.ext >= 2) && "excess over drift fails", posYears < 5 && "years fail"].filter(Boolean).join("; ")}`}`);
