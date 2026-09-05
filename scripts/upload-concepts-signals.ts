#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// upload-concepts-signals.ts (D-794 a/b/c/e/f) — the SIGNAL concepts from the operator's uploads that the stack had
// not measured, each made mechanical and run on held 1h data, lag-1, net of class cost, OOS 2023+, cross-instrument sign.
//   (a) STOCHASTIC DIVERGENCE  ("Stochastic Divergence AW.ex5")  price lower-low at a confirmed fractal swing low while
//       stoch %K(14,3) makes a higher low -> LONG; mirror at highs -> SHORT.
//   (b) BULL/BEAR POWER        ("Buy and Sell Power.ex5", Elder's canonical form)  EMA13 rising & bear power (low-EMA)
//       < 0 and rising -> LONG; EMA falling & bull power (high-EMA) > 0 and falling -> SHORT.
//   (c) SMT DIVERGENCE         (steel.nq)  NQ confirmed swing low is a LOWER low while SPX's low at the same bars is
//       NOT -> LONG NQ; mirror at highs -> SHORT. Also SPX-led. 1h is the finest held (no 5m index bars — stated).
//   (e) ADR WALLS              (atraintrades "average ranges")  today's UTC open +/- ADR(20 completed days); first
//       touch of a wall -> FADE (short upper / long lower) vs CONTINUE, both reported.
//   (f) 4H PO3                 (steel.nq)  at a 4H block close, sign(close - block open) -> does the NEXT 4H continue?
// Every (concept x horizon x direction) is a counted trial. DESCRIPTIVE ONLY — no lineage/clock writes.
import { Bar, decodeBar, swings, utcDayKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("upload-concepts-signals", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "MIN_EVENTS", def: "50" }, { name: "MIN_INST", def: "20" },
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" }, { name: "FX_RT_BP", def: "2" },
  { name: "STOCH_N", def: "14" }, { name: "STOCH_SMOOTH", def: "3" }, { name: "SWING_W", def: "2" },
  { name: "ADR_N", def: "20" },
]);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const MIN_EVENTS = Number(K.MIN_EVENTS), MIN_INST = Number(K.MIN_INST), W = Number(K.SWING_W);
const SN = Number(K.STOCH_N), SS = Number(K.STOCH_SMOOTH), ADR_N = Number(K.ADR_N);
const KSET = [6, 12, 24];
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ucs", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

type Klass = "crypto" | "idx" | "fx";
interface Inst { symbol: string; klass: Klass; rt: number; bars: Bar[] }
const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"], FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  return ((row?.bars || []) as number[][]).filter((b) => b[5] > 0).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
async function loadFx(sym: string): Promise<Bar[]> {
  const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
}
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP) / 1e4, bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP) / 1e4, bars: await loadFx(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP) / 1e4, bars: await loadFx(s) });
for (const i of insts) assertNonEmpty(`bars ${i.symbol}`, i.bars, 3000);

function stats(xs: number[]) { const n = xs.length; if (!n) return { n: 0, mean: 0, t: 0 }; const m = xs.reduce((a, c) => a + c, 0) / n; const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0; const sd = Math.sqrt(s2); return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 }; }
const bp = (x: number) => (x * 1e4).toFixed(2);
// event = (symbol, bar index i, direction); trade at bars[i+1].o (lag-1), exit bars[i+1+k].c, net of RT, signed by dir
interface Ev { sym: string; ts: number; train: boolean; net: Record<number, number> }
function mkEv(inst: Inst, i: number, dir: 1 | -1): Ev | null {
  const b = inst.bars; if (i + 1 + 24 >= b.length) return null; const e = b[i + 1].o; if (!(e > 0)) return null;
  const net: Record<number, number> = {}; for (const k of KSET) net[k] = dir * Math.log(b[i + 1 + k].c / e) - inst.rt;
  return { sym: inst.symbol, ts: b[i].ts, train: b[i].ts < SPLIT_TS, net };
}
let TRIALS = 0;
function report(name: string, evs: Ev[]) {
  for (const k of KSET) {
    TRIALS++;
    const te = evs.filter((e) => !e.train); const s = stats(te.map((e) => e.net[k]));
    let pos = 0, tested = 0; for (const inst of insts) { const xs = te.filter((e) => e.sym === inst.symbol).map((e) => e.net[k]); if (xs.length < MIN_INST) continue; tested++; if (stats(xs).mean > 0) pos++; }
    const flag = s.n >= MIN_EVENTS && s.mean > 0 && s.t >= 2 && tested >= 6 && pos >= Math.ceil(tested / 2) ? "  <= +OOS cross-panel" : (s.n >= MIN_EVENTS && s.t <= -2 ? "  <= -OOS (opposite)" : "");
    console.log(`    ${name.padEnd(30)} K${String(k).padStart(2)}  n ${String(s.n).padStart(6)}  net ${bp(s.mean).padStart(8)}bp  t ${s.t.toFixed(2).padStart(6)}  sign ${pos}/${tested}${flag}`);
  }
}
console.log(`==> UPLOAD CONCEPTS — SIGNALS (D-794 a/b/c/e/f) — 17 instruments, 1h, lag-1, net of cost, OOS ${K.SPLIT}+`);

// ---------- (a) STOCHASTIC DIVERGENCE ----------
function stochK(b: Bar[]): number[] {
  const raw = new Array(b.length).fill(NaN);
  for (let i = SN - 1; i < b.length; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - SN + 1; j <= i; j++) { hh = Math.max(hh, b[j].h); ll = Math.min(ll, b[j].l); } raw[i] = hh > ll ? 100 * (b[i].c - ll) / (hh - ll) : 50; }
  const out = new Array(b.length).fill(NaN);
  for (let i = SN - 1 + SS - 1; i < b.length; i++) { let s = 0; for (let j = i - SS + 1; j <= i; j++) s += raw[j]; out[i] = s / SS; }
  return out;
}
const stochLong: Ev[] = [], stochShort: Ev[] = [];
for (const inst of insts) {
  const b = inst.bars, k = stochK(b), sw = swings(b, W);
  const lows = sw.filter((s) => s.kind === "low"), highs = sw.filter((s) => s.kind === "high");
  for (let n = 1; n < lows.length; n++) { const p = lows[n], pr = lows[n - 1]; if (!(p.price < pr.price) || !(k[p.index] > k[pr.index]) || isNaN(k[pr.index])) continue; const e = mkEv(inst, p.confirmedAt, 1); if (e) stochLong.push(e); }
  for (let n = 1; n < highs.length; n++) { const p = highs[n], pr = highs[n - 1]; if (!(p.price > pr.price) || !(k[p.index] < k[pr.index]) || isNaN(k[pr.index])) continue; const e = mkEv(inst, p.confirmedAt, -1); if (e) stochShort.push(e); }
}
console.log(`\n  (a) STOCHASTIC DIVERGENCE — %K(${SN},${SS}) vs fractal swings (w=${W}); events long ${stochLong.length} short ${stochShort.length}`);
report("stoch-div bullish -> LONG", stochLong); report("stoch-div bearish -> SHORT", stochShort);

// ---------- (b) ELDER BULL/BEAR POWER ----------
const bbLong: Ev[] = [], bbShort: Ev[] = [];
for (const inst of insts) {
  const b = inst.bars, ema: number[] = new Array(b.length).fill(NaN); const a = 2 / 14; ema[0] = b[0].c;
  for (let i = 1; i < b.length; i++) ema[i] = a * b[i].c + (1 - a) * ema[i - 1];
  for (let i = 30; i < b.length; i++) {
    const bear = b[i].l - ema[i], bearP = b[i - 1].l - ema[i - 1], bull = b[i].h - ema[i], bullP = b[i - 1].h - ema[i - 1];
    if (ema[i] > ema[i - 1] && bear < 0 && bear > bearP) { const e = mkEv(inst, i, 1); if (e) bbLong.push(e); }
    if (ema[i] < ema[i - 1] && bull > 0 && bull < bullP) { const e = mkEv(inst, i, -1); if (e) bbShort.push(e); }
  }
}
console.log(`\n  (b) ELDER BULL/BEAR POWER (EMA13) — events long ${bbLong.length} short ${bbShort.length}`);
report("bear-power rising -> LONG", bbLong); report("bull-power falling -> SHORT", bbShort);

// ---------- (c) SMT DIVERGENCE NQ vs SPX (1h — the finest held; no 5m index bars) ----------
{
  const nq = insts.find((x) => x.symbol === "USATECHIDXUSD")!, sp = insts.find((x) => x.symbol === "USA500IDXUSD")!;
  const spByTs = new Map(sp.bars.map((x) => [x.ts, x])), nqByTs = new Map(nq.bars.map((x) => [x.ts, x]));
  function smt(lead: Inst, other: Map<number, Bar>, outL: Ev[], outS: Ev[]) {
    const sw = swings(lead.bars, W), lows = sw.filter((s) => s.kind === "low"), highs = sw.filter((s) => s.kind === "high");
    for (let n = 1; n < lows.length; n++) { const p = lows[n], pr = lows[n - 1]; const o1 = other.get(lead.bars[p.index].ts), o0 = other.get(lead.bars[pr.index].ts); if (!o1 || !o0) continue; if (p.price < pr.price && o1.l >= o0.l) { const e = mkEv(lead, p.confirmedAt, 1); if (e) outL.push(e); } }
    for (let n = 1; n < highs.length; n++) { const p = highs[n], pr = highs[n - 1]; const o1 = other.get(lead.bars[p.index].ts), o0 = other.get(lead.bars[pr.index].ts); if (!o1 || !o0) continue; if (p.price > pr.price && o1.h <= o0.h) { const e = mkEv(lead, p.confirmedAt, -1); if (e) outS.push(e); } }
  }
  const nqL: Ev[] = [], nqS: Ev[] = [], spL: Ev[] = [], spS: Ev[] = [];
  smt(nq, spByTs, nqL, nqS); smt(sp, nqByTs, spL, spS);
  console.log(`\n  (c) SMT DIVERGENCE 1h — NQ-led (SPX fails to confirm): long ${nqL.length} short ${nqS.length}; SPX-led: long ${spL.length} short ${spS.length}  [single-instrument cells: sign map is 1 instrument]`);
  const one = (name: string, evs: Ev[]) => { for (const k of KSET) { TRIALS++; const te = evs.filter((e) => !e.train); const s = stats(te.map((e) => e.net[k])); console.log(`    ${name.padEnd(30)} K${String(k).padStart(2)}  n ${String(s.n).padStart(6)}  net ${bp(s.mean).padStart(8)}bp  t ${s.t.toFixed(2).padStart(6)}${s.n >= MIN_EVENTS && Math.abs(s.t) >= 2 ? (s.t > 0 ? "  <= +OOS" : "  <= -OOS") : ""}`); } };
  one("NQ lower-low, SPX not -> LONG NQ", nqL); one("NQ higher-high, SPX not -> SHORT", nqS); one("SPX lower-low, NQ not -> LONG SPX", spL); one("SPX higher-high, NQ not -> SHORT", spS);
}

// ---------- (e) ADR WALLS ----------
const adrFadeUp: Ev[] = [], adrFadeDn: Ev[] = [], adrContUp: Ev[] = [], adrContDn: Ev[] = [];
for (const inst of insts) {
  const b = inst.bars; const dayRange = new Map<string, number>(); const dayOpen = new Map<string, number>();
  for (const x of b) { const d = utcDayKey(x.ts); if (!dayOpen.has(d)) dayOpen.set(d, x.o); dayRange.set(d, Math.max(dayRange.get(d) ?? -Infinity, x.h) - 0); }
  // recompute true daily range
  const hi = new Map<string, number>(), lo = new Map<string, number>();
  for (const x of b) { const d = utcDayKey(x.ts); hi.set(d, Math.max(hi.get(d) ?? -Infinity, x.h)); lo.set(d, Math.min(lo.get(d) ?? Infinity, x.l)); }
  const days = [...hi.keys()].sort(); const adr = new Map<string, number>();
  for (let n = ADR_N; n < days.length; n++) { let s = 0; for (let j = n - ADR_N; j < n; j++) s += hi.get(days[j])! - lo.get(days[j])!; adr.set(days[n], s / ADR_N); }
  let curDay = "", touchedUp = false, touchedDn = false;
  for (let i = 0; i < b.length; i++) {
    const d = utcDayKey(b[i].ts); if (d !== curDay) { curDay = d; touchedUp = false; touchedDn = false; }
    const a = adr.get(d), o = dayOpen.get(d); if (a === undefined || o === undefined) continue;
    if (!touchedUp && b[i].h >= o + a) { touchedUp = true; const f = mkEv(inst, i, -1), c = mkEv(inst, i, 1); if (f) adrFadeUp.push(f); if (c) adrContUp.push(c); }
    if (!touchedDn && b[i].l <= o - a) { touchedDn = true; const f = mkEv(inst, i, 1), c = mkEv(inst, i, -1); if (f) adrFadeDn.push(f); if (c) adrContDn.push(c); }
  }
}
console.log(`\n  (e) ADR WALLS — day open +/- ADR(${ADR_N}); first touch per day; events upper ${adrFadeUp.length} lower ${adrFadeDn.length}`);
report("upper wall touch -> FADE short", adrFadeUp); report("lower wall touch -> FADE long", adrFadeDn);
report("upper wall touch -> CONTINUE long", adrContUp); report("lower wall touch -> CONTINUE short", adrContDn);

// ---------- (f) 4H PO3 ----------
const po3Cont: Ev[] = [];
for (const inst of insts) {
  const b = inst.bars;
  for (let i = 1; i < b.length - 5; i++) {
    const h = new Date(b[i].ts * 1000).getUTCHours(), hn = new Date(b[i + 1].ts * 1000).getUTCHours();
    if (Math.floor(h / 4) === Math.floor(hn / 4) && utcDayKey(b[i].ts) === utcDayKey(b[i + 1].ts)) continue;   // i = last bar of a 4H block
    let j = i; while (j > 0 && Math.floor(new Date(b[j - 1].ts * 1000).getUTCHours() / 4) === Math.floor(h / 4) && utcDayKey(b[j - 1].ts) === utcDayKey(b[i].ts)) j--;
    const x = b[i].c - b[j].o; if (x === 0) continue;
    const e = mkEv(inst, i, x > 0 ? 1 : -1); if (e) po3Cont.push(e);     // hypothesis: next block CONTINUES the sign
  }
}
console.log(`\n  (f) 4H PO3 — sign(4H close - 4H open) -> continuation into the next hours; events ${po3Cont.length} (mean<0 = the next block REVERSES)`);
report("4H block sign -> CONTINUE", po3Cont);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "upload-concepts-signals", runId: `ucs|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  TRIALS ${TRIALS} | program ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(2)}`);
console.log(`  DESCRIPTIVE ONLY. A cell is believed only with cross-panel sign AND net>0 AND t>=2 OOS; every cell above is a counted trial.`);
