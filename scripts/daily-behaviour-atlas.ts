#!/usr/bin/env -S deno run --allow-net --allow-env
// daily-behaviour-atlas.ts (D-828) — DESCRIPTIVE ONLY (MECHANISM LAW: description is always allowed; the unregistered
// STORY about it is what is forbidden). No hypothesis is tested here and no direction is predicted.
//
// WHY IT EXISTS. Every test on this record asks "which way will it go", and 2.9M trials say that question is dead on
// this universe. The one thing confirmed OOS is that VOLATILITY is forecastable (D-814, 11/11). Nobody has ever
// characterised what an instrument DOES in a day: where its extremes fall, how much of the day is left after the first
// hours, how range and direction relate, whether the close respects the open. Those are distributional facts, not
// forecasts, and they are what option structures and stop/target geometry are actually priced off.
//
// Everything below is measured per instrument on hourly bars, split TRAIN(<2023)/TEST(>=2023) so that any regularity
// can be checked for stability before anyone builds on it. Positive controls: hour-of-extreme must NOT be uniform for
// session-bound instruments and must be flatter for 24h crypto; ranges must be positive; day counts must be plausible.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("daily-behaviour-atlas", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "FIRST_H", def: "4", note: "hours of the day used as the 'so far' window" },
  { name: "MIN_DAYS", def: "300" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "atl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
async function loadBars(sym: string): Promise<Bar[]> {
  if (FX.includes(sym)) { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
const perpRows = await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[];
const UNIVERSE = [...perpRows.filter((r) => (r.n_bars ?? 0) > 10000).map((r) => r.symbol), ...FX];
assertNonEmpty("universe", UNIVERSE, 20);
const FH = +K.FIRST_H, SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
console.log(`\n==> D-828 DAILY BEHAVIOUR ATLAS — ${UNIVERSE.length} instruments, hourly bars. DESCRIPTIVE ONLY: no hypothesis, no direction, nothing promoted.`);
console.log(`    Every column is split TRAIN(<${K.SPLIT}) / TEST(>=) so a regularity can be checked for stability before anything is built on it.\n`);
interface D { hiH: number; loH: number; rng: number; firstRng: number; restRng: number; body: number; retOpen: number; up: boolean; closeNearHi: number; }
const atlas: { sym: string; tr: D[]; te: D[] }[] = [];
for (const sym of UNIVERSE) {
  const b = await loadBars(sym); if (b.length < 8000) continue;
  const byDay = new Map<string, Bar[]>();
  for (const x of b) { const d = new Date(x.ts * 1000).toISOString().slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(x); }
  const tr: D[] = [], te: D[] = [];
  for (const [d, bars] of byDay) {
    if (bars.length < 12) continue;                       /* a partial session is not a day */
    const o = bars[0].o, c = bars[bars.length - 1].c;
    let hi = -Infinity, lo = Infinity, hiH = 0, loH = 0;
    for (const x of bars) { const h = new Date(x.ts * 1000).getUTCHours(); if (x.h > hi) { hi = x.h; hiH = h; } if (x.l < lo) { lo = x.l; loH = h; } }
    const rng = (hi - lo) / o;
    if (!(rng > 0)) continue;
    const first = bars.slice(0, FH); let fh = -Infinity, fl = Infinity;
    for (const x of first) { fh = Math.max(fh, x.h); fl = Math.min(fl, x.l); }
    const rest = bars.slice(FH); let rh = -Infinity, rl = Infinity;
    for (const x of rest) { rh = Math.max(rh, x.h); rl = Math.min(rl, x.l); }
    const rec: D = { hiH, loH, rng, firstRng: (fh - fl) / o, restRng: rest.length ? (rh - rl) / o : 0,
      body: Math.abs(c - o) / o, retOpen: (c - o) / o, up: c > o, closeNearHi: (c - lo) / ((hi - lo) || 1e-12) };
    (bars[0].ts < SPLIT ? tr : te).push(rec);
  }
  if (tr.length + te.length >= +K.MIN_DAYS) atlas.push({ sym, tr, te });
}
assertNonEmpty("instruments with enough days", atlas, 15);
/* ---- 1. WHERE THE DAY'S EXTREMES FALL ---- */
console.log(`  1. WHERE THE DAY'S HIGH AND LOW ARE SET (share of days whose extreme falls in each 6h UTC block; TEST window)`);
console.log(`     ${"instrument".padEnd(14)} ${"00-06".padStart(7)} ${"06-12".padStart(7)} ${"12-18".padStart(7)} ${"18-24".padStart(7)}   ${"concentration".padStart(13)}`);
for (const a of atlas) {
  const blocks = [0, 0, 0, 0];
  for (const d of a.te) { blocks[Math.floor(d.hiH / 6)]++; blocks[Math.floor(d.loH / 6)]++; }
  const tot = blocks.reduce((s, x) => s + x, 0) || 1;
  const sh = blocks.map((x) => x / tot);
  const conc = Math.max(...sh) / (Math.min(...sh) || 1e-9);
  console.log(`     ${a.sym.padEnd(14)} ${sh.map((x) => (100 * x).toFixed(1).padStart(7)).join(" ")}   ${conc.toFixed(2).padStart(13)}`);
}
/* ---- 2. HOW MUCH OF THE DAY IS LEFT AFTER THE FIRST HOURS ---- */
console.log(`\n  2. RANGE STRUCTURE — first ${FH}h range as a share of the whole day, and how well it PREDICTS the rest (TEST)`);
console.log(`     ${"instrument".padEnd(14)} ${"day range%".padStart(11)} ${"first" + FH + "h/day".padStart(11)} ${"corr(first,rest)".padStart(17)} ${"corr(rng,prevRng)".padStart(18)} ${"body/range".padStart(11)}`);
for (const a of atlas) {
  const t = a.te; if (t.length < 100) continue;
  const shares = t.map((d) => d.firstRng / (d.rng || 1e-12));
  const cFR = corr(t.map((d) => d.firstRng), t.map((d) => d.restRng));
  const prev = t.slice(0, -1).map((d) => d.rng), next = t.slice(1).map((d) => d.rng);
  const cPR = corr(prev, next);
  const bodyShare = mean(t.map((d) => d.body / (d.rng || 1e-12)));
  console.log(`     ${a.sym.padEnd(14)} ${(100 * med(t.map((d) => d.rng))).toFixed(2).padStart(11)} ${(100 * med(shares)).toFixed(1).padStart(11)} ${cFR.toFixed(3).padStart(17)} ${cPR.toFixed(3).padStart(18)} ${bodyShare.toFixed(3).padStart(11)}`);
}
/* ---- 3. IS THE DAY DIRECTIONAL OR ROUND-TRIP? and does it persist? ---- */
console.log(`\n  3. DIRECTIONAL vs ROUND-TRIP DAYS — body/range near 1 = trend day, near 0 = the day gives it all back`);
console.log(`     ${"instrument".padEnd(14)} ${"trend days%".padStart(12)} ${"(train)".padStart(9)} ${"close in top/bot 20%".padStart(21)} ${"(train)".padStart(9)} ${"up-day share".padStart(13)}`);
for (const a of atlas) {
  const f = (arr: D[]) => ({ trend: 100 * arr.filter((d) => d.body / (d.rng || 1e-12) > 0.6).length / Math.max(1, arr.length),
    edge: 100 * arr.filter((d) => d.closeNearHi > 0.8 || d.closeNearHi < 0.2).length / Math.max(1, arr.length),
    up: 100 * arr.filter((d) => d.up).length / Math.max(1, arr.length) });
  const te = f(a.te), tr = f(a.tr);
  console.log(`     ${a.sym.padEnd(14)} ${te.trend.toFixed(1).padStart(12)} ${tr.trend.toFixed(1).padStart(9)} ${te.edge.toFixed(1).padStart(21)} ${tr.edge.toFixed(1).padStart(9)} ${te.up.toFixed(1).padStart(13)}`);
}
/* ---- 4. THE STABILITY CHECK — does any of this hold between train and test? ---- */
console.log(`\n  4. STABILITY (train vs test): the only columns worth building on are the ones that barely move.`);
const rows: { name: string; tr: number; te: number }[] = [];
const allTr = atlas.flatMap((a) => a.tr), allTe = atlas.flatMap((a) => a.te);
rows.push({ name: "median day range %", tr: 100 * med(allTr.map((d) => d.rng)), te: 100 * med(allTe.map((d) => d.rng)) });
rows.push({ name: `first ${FH}h share of day range %`, tr: 100 * med(allTr.map((d) => d.firstRng / (d.rng || 1e-12))), te: 100 * med(allTe.map((d) => d.firstRng / (d.rng || 1e-12))) });
rows.push({ name: "body/range mean", tr: mean(allTr.map((d) => d.body / (d.rng || 1e-12))), te: mean(allTe.map((d) => d.body / (d.rng || 1e-12))) });
rows.push({ name: "trend days % (body/range>0.6)", tr: 100 * allTr.filter((d) => d.body / (d.rng || 1e-12) > 0.6).length / allTr.length, te: 100 * allTe.filter((d) => d.body / (d.rng || 1e-12) > 0.6).length / allTe.length });
rows.push({ name: "close in top/bottom 20% of range %", tr: 100 * allTr.filter((d) => d.closeNearHi > 0.8 || d.closeNearHi < 0.2).length / allTr.length, te: 100 * allTe.filter((d) => d.closeNearHi > 0.8 || d.closeNearHi < 0.2).length / allTe.length });
rows.push({ name: "corr(range, prior-day range)", tr: corr(allTr.slice(0, -1).map((d) => d.rng), allTr.slice(1).map((d) => d.rng)), te: corr(allTe.slice(0, -1).map((d) => d.rng), allTe.slice(1).map((d) => d.rng)) });
rows.push({ name: `corr(first ${FH}h range, rest-of-day range)`, tr: corr(allTr.map((d) => d.firstRng), allTr.map((d) => d.restRng)), te: corr(allTe.map((d) => d.firstRng), allTe.map((d) => d.restRng)) });
rows.push({ name: "up-day share %", tr: 100 * allTr.filter((d) => d.up).length / allTr.length, te: 100 * allTe.filter((d) => d.up).length / allTe.length });
console.log(`     ${"statistic".padEnd(40)} ${"TRAIN".padStart(9)} ${"TEST".padStart(9)} ${"drift".padStart(9)}`);
for (const r of rows) console.log(`     ${r.name.padEnd(40)} ${r.tr.toFixed(3).padStart(9)} ${r.te.toFixed(3).padStart(9)} ${(r.te - r.tr).toFixed(3).padStart(9)}`);
console.log(`\n  ${atlas.length} instruments, ${allTr.length.toLocaleString()} train days + ${allTe.length.toLocaleString()} test days. DESCRIPTIVE ONLY — nothing here is a claim, and any rule built on it needs its own pre-registration.`);
