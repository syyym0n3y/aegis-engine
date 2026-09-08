#!/usr/bin/env -S deno run --allow-net --allow-env
// mtf-trend-progression.ts (D-827) — PREREG D-827-mtf-trend-progression.
// TREND PROGRESSION ACROSS TIMEFRAMES AS THE GATE ON BREAKOUTS. Higher timeframes (4h, 1d, 1w) are AGGREGATED from the
// same hourly bars, so there is no second data source and no cross-source alignment error. Each timeframe is classified
// from its last two CONFIRMED swings (HH+HL = UP, LH+LL = DOWN, else RANGE) with the confirmation lag respected, so a
// swing is only usable once it could have been known. ALIGNMENT A = sum of (+1/-1/0) over {4h,1d,1w} in [-3,+3].
// EVENT = a 1h close beyond a confirmed 1h swing high/low; entry lag-1 at the next open; exit at the close K bars later.
// The operator's claim is that breakouts CONTINUE when A agrees with them. The record's claim (D-766: five continuation
// setups, all OOS-OPPOSITE at portfolio t -4 to -7) is that they FADE regardless. Both are registered and both scored.
// The benchmark is measured OVER THE SAME WINDOW as the events it judges — D-826b retracted a result today for exactly
// that mismatch — and it is the number the buckets must beat, not zero.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { Bar, decodeBar, swings } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("mtf-trend-progression", [
  { name: "RUN_ID", def: "D-827-mtf-trend-progression" },
  { name: "SPLIT", def: "2023-01-01", note: "train/test boundary, frozen D-455" },
  { name: "W", def: "2", note: "swing pivot half-width (bars each side), same as the D-763/766 family" },
  { name: "KS", def: "6,24", note: "holding horizons in 1h bars" },
  { name: "MIN_EVENTS", def: "20", note: "per-instrument floor for the sign count" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mtp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) || 1e-9) / Math.sqrt(a.length)) : NaN;
const bp = (x: number) => (x * 1e4).toFixed(2);
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
const rtOf = (sym: string) => FX.includes(sym) ? (["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"].includes(sym) ? 4 : 2) : 7;
const KS = K.KS.split(",").map(Number);
const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000, W = +K.W;

/* ---- higher timeframes aggregated from the SAME hourly bars ---- */
function aggregate(bars: Bar[], hours: number): { bar: Bar; endIdx: number }[] {
  const out: { bar: Bar; endIdx: number }[] = [];
  let cur: Bar | null = null, endIdx = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const bucket = Math.floor(b.ts / (hours * 3600));
    if (!cur || Math.floor(cur.ts / (hours * 3600)) !== bucket) {
      if (cur) out.push({ bar: cur, endIdx });
      cur = { ts: bucket * hours * 3600, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    endIdx = i;
  }
  if (cur) out.push({ bar: cur, endIdx });
  return out;
}
/* ---- structure state per higher-timeframe bar, from the last two CONFIRMED swings of each kind ---- */
function stateSeries(tfBars: Bar[]): number[] {
  const sw = swings(tfBars, W);
  const hi = sw.filter((s) => s.kind === "high"), lo = sw.filter((s) => s.kind === "low");
  const st = new Array(tfBars.length).fill(0);
  let hp = 0, lp = 0; const H: number[] = [], L: number[] = [];
  for (let j = 0; j < tfBars.length; j++) {
    while (hp < hi.length && hi[hp].confirmedAt <= j) { H.push(hi[hp].price); hp++; }
    while (lp < lo.length && lo[lp].confirmedAt <= j) { L.push(lo[lp].price); lp++; }
    if (H.length >= 2 && L.length >= 2) {
      const hUp = H[H.length - 1] > H[H.length - 2], lUp = L[L.length - 1] > L[L.length - 2];
      st[j] = (hUp && lUp) ? 1 : (!hUp && !lUp) ? -1 : 0;
    }
  }
  return st;
}
/* map each hourly index to the state of the LAST COMPLETED higher-timeframe bar (no look-ahead) */
function stateAtHour(bars: Bar[], hours: number): number[] {
  const agg = aggregate(bars, hours);
  const st = stateSeries(agg.map((a) => a.bar));
  const out = new Array(bars.length).fill(0);
  let k = 0;
  for (let i = 0; i < bars.length; i++) {
    /* the newest higher-tf bar whose LAST hourly bar is strictly before i — i.e. completed */
    while (k + 1 < agg.length && agg[k + 1].endIdx < i) k++;
    out[i] = (k >= 1 && agg[k].endIdx < i) ? st[k] : (k >= 1 ? st[k - 1] : 0);
  }
  return out;
}
async function loadBars(sym: string): Promise<Bar[]> {
  if (FX.includes(sym)) {
    const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
    return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
  }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
const perpRows = await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[];
const UNIVERSE = [...perpRows.filter((r) => (r.n_bars ?? 0) > 10000).map((r) => r.symbol), ...FX];
assertNonEmpty("universe", UNIVERSE, 20);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-trend", runId: K.RUN_ID, spent: 12 });
console.log(`\n==> D-827 TREND PROGRESSION AS A BREAKOUT GATE — ${UNIVERSE.length} instruments, 1h base with 4h/1d/1w aggregated from it. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()} (mined; the pre-registered bar is scripts/prereg-ceiling.ts).`);
interface Ev { sym: string; ts: number; dir: 1 | -1; align: number; g: Record<number, number>; }
const evs: Ev[] = []; const uncond: Record<number, { train: number[]; test: number[] }> = {};
for (const k of KS) uncond[k] = { train: [], test: [] };
let statesSeen = new Map<string, number>();
for (const sym of UNIVERSE) {
  const b = await loadBars(sym);
  if (b.length < 8000) continue;
  const s4 = stateAtHour(b, 4), s1d = stateAtHour(b, 24), s1w = stateAtHour(b, 168);
  const sw = swings(b, W);
  const hi = sw.filter((x) => x.kind === "high"), lo = sw.filter((x) => x.kind === "low");
  const maxK = Math.max(...KS);
  /* BENCHMARK over the SAME windows as the events (D-826b) */
  for (let i = 1; i < b.length - maxK - 1; i++) {
    const isTest = b[i].ts >= SPLIT;
    for (const k of KS) (isTest ? uncond[k].test : uncond[k].train).push(Math.log(b[i + 1 + k].c / b[i + 1].o));
  }
  let hp = 0, lp = 0; let curHi: number | null = null, curLo: number | null = null;
  for (let i = 1; i < b.length - maxK - 1; i++) {
    while (hp < hi.length && hi[hp].confirmedAt <= i) { curHi = hi[hp].price; hp++; }
    while (lp < lo.length && lo[lp].confirmedAt <= i) { curLo = lo[lp].price; lp++; }
    const align = s4[i] + s1d[i] + s1w[i];
    statesSeen.set(String(align), (statesSeen.get(String(align)) ?? 0) + 1);
    let dir: 1 | -1 | 0 = 0;
    if (curHi !== null && b[i].c > curHi) { dir = 1; curHi = null; }
    else if (curLo !== null && b[i].c < curLo) { dir = -1; curLo = null; }
    if (!dir) continue;
    const g: Record<number, number> = {};
    for (const k of KS) g[k] = dir * Math.log(b[i + 1 + k].c / b[i + 1].o);   /* traded WITH the break */
    evs.push({ sym, ts: b[i].ts, dir, align, g });
  }
}
assertNonEmpty("breakout events", evs, 5000);
console.log(`    ${evs.length.toLocaleString()} breakout events; alignment distribution (hours): ` + [...statesSeen.entries()].sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${(100 * v / [...statesSeen.values()].reduce((s, x) => s + x, 0)).toFixed(0)}%`).join(" "));
if (statesSeen.size < 5) { console.error("!! POSITIVE CONTROL FAILED: fewer than 5 distinct alignment states — the classifier is degenerate."); Deno.exit(1); }
const bucketOf = (e: Ev) => { const a = e.dir * e.align; return a >= 2 ? "ALIGNED" : a <= -2 ? "OPPOSED" : "NEUTRAL"; };
for (const win of ["TRAIN", "TEST"] as const) {
  console.log(`\n  === ${win} (${win === "TEST" ? "decides" : "context only"}) ===`);
  console.log(`  ${"bucket".padEnd(9)} ${"K".padStart(3)} ${"n".padStart(7)} ${"net bp".padStart(8)} ${"t".padStart(7)} ${"gross bp".padStart(9)} ${"uncond".padStart(8)} ${"excess".padStart(8)} ${"day t".padStart(7)} ${"sign +/tested".padStart(14)}`);
  for (const k of KS) {
    const u = mean(win === "TEST" ? uncond[k].test : uncond[k].train);
    for (const bk of ["ALIGNED", "NEUTRAL", "OPPOSED"] as const) {
      const sel = evs.filter((e) => bucketOf(e) === bk && (win === "TEST" ? e.ts >= SPLIT : e.ts < SPLIT));
      if (!sel.length) { console.log(`  ${bk.padEnd(9)} ${String(k).padStart(3)}  (none)`); continue; }
      const net = sel.map((e) => e.g[k] - rtOf(e.sym) / 1e4), gross = sel.map((e) => e.g[k]);
      const byDay = new Map<string, number[]>();
      for (const e of sel) { const d = new Date(e.ts * 1000).toISOString().slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e.g[k] - rtOf(e.sym) / 1e4); }
      const daily = [...byDay.values()].map(mean);
      const bySym = new Map<string, number[]>();
      for (let i = 0; i < sel.length; i++) { const s = sel[i].sym; (bySym.get(s) ?? bySym.set(s, []).get(s)!).push(net[i]); }
      const tested = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS).length;
      const pos = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS && mean(v) > 0).length;
      console.log(`  ${bk.padEnd(9)} ${String(k).padStart(3)} ${String(sel.length).padStart(7)} ${bp(mean(net)).padStart(8)} ${tstat(net).toFixed(2).padStart(7)} ${bp(mean(gross)).padStart(9)} ${bp(u).padStart(8)} ${bp(mean(gross) - u).padStart(8)} ${tstat(daily).toFixed(2).padStart(7)} ${(pos + "/" + tested).padStart(14)}`);
    }
  }
}
/* the registered clauses, computed on TEST */
console.log("");
for (const k of KS) {
  const u = mean(uncond[k].test);
  const pick = (bk: string) => evs.filter((e) => bucketOf(e) === bk && e.ts >= SPLIT);
  const stat = (bk: string) => { const s = pick(bk); const net = s.map((e) => e.g[k] - rtOf(e.sym) / 1e4); const gross = s.map((e) => e.g[k]);
    const bySym = new Map<string, number[]>(); for (let i = 0; i < s.length; i++) { const y = s[i].sym; (bySym.get(y) ?? bySym.set(y, []).get(y)!).push(net[i]); }
    const tested = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS).length, pos = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS && mean(v) > 0).length;
    /* D-661/662 COST-INFLATION COROLLARY: net = gross - a flat round trip, so a LOSING bucket's |t| is bought by the
       assumed fee. The gross t is reported beside it, and the FADE is priced properly: reversing the trade earns
       -gross and STILL PAYS the round trip, so its net is (-gross - rt), never (-net). */
    const rt = mean(gross) - mean(net);
    return { n: s.length, m: mean(net), t: tstat(net), gm: mean(gross), gt: tstat(gross), rt, fade: -mean(gross) - rt,
      ex: mean(gross) - u, frac: tested ? pos / tested : 0, neg: tested ? (tested - pos) / tested : 0 }; };
  const A = stat("ALIGNED"), O = stat("OPPOSED");
  let v: string;
  if (A.n < 200) v = `UNDERPOWERED — aligned test n ${A.n} < 200`;
  else if (A.m <= 0) v = `NULL — aligned net ${bp(A.m)}bp <= 0`;
  else if (A.t < 2.0) v = `NULL — aligned t ${A.t.toFixed(2)} < 2.0`;
  else if (A.ex <= 0) v = `NULL — aligned excess over the same-window unconditional return ${bp(A.ex)}bp <= 0`;
  else if (A.frac < 0.6) v = `NULL — only ${(100 * A.frac).toFixed(0)}% of instruments positive (need 60%)`;
  else if ((A.m - O.m) * 1e4 < 3) v = `NULL — aligned beats opposed by only ${bp(A.m - O.m)}bp (need 3bp)`;
  else v = `SUPPORTED — aligned net ${bp(A.m)}bp t ${A.t.toFixed(2)}, excess ${bp(A.ex)}bp, ${(100 * A.frac).toFixed(0)}% positive, beats opposed by ${bp(A.m - O.m)}bp`;
  console.log(`  K${k} OPERATOR'S CLAIM (aligned continuation): ${v}`);
  console.log(`       ordering by alignment (net): ALIGNED ${bp(A.m)}bp > NEUTRAL ${bp(stat("NEUTRAL").m)}bp > OPPOSED ${bp(O.m)}bp — alignment ${(A.m > stat("NEUTRAL").m && stat("NEUTRAL").m > O.m) ? "DOES order the outcomes monotonically" : "does NOT order the outcomes"}, but every bucket is below zero after cost.`);
  let f: string;
  if (O.n < 200) f = `UNDERPOWERED — opposed test n ${O.n} < 200`;
  else if (O.m < 0 && O.t <= -2.0 && O.ex < 0 && O.neg >= 0.6 && O.fade > 0) f = `SUPPORTED-FADE — counter-trend breakouts lose ${bp(O.m)}bp; REVERSED and charged the same ${bp(O.rt)}bp round trip the fade earns ${bp(O.fade)}bp net: tradable`;
  else if (O.m < 0 && O.t <= -2.0 && O.ex < 0 && O.neg >= 0.6) f = `NULL BY COST, NOT BY SIGN — the loss is real (gross ${bp(O.gm)}bp, GROSS t ${O.gt.toFixed(2)} vs net t ${O.t.toFixed(2)} — the net |t| is partly bought by the fee, D-661/662) but REVERSING it earns ${bp(-O.gm)}bp gross against a ${bp(O.rt)}bp round trip = ${bp(O.fade)}bp net. SUB-FEE: you cannot collect it.`;
  else f = `NULL — opposed net ${bp(O.m)}bp, gross ${bp(O.gm)}bp (gross t ${O.gt.toFixed(2)}), excess ${bp(O.ex)}bp, ${(100 * O.neg).toFixed(0)}% negative; fade after cost ${bp(O.fade)}bp`;
  console.log(`  K${k} RECORD'S CLAIM (counter-trend breakouts fade): ${f}`);
}
