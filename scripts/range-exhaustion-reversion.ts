#!/usr/bin/env -S deno run --allow-net --allow-env
// range-exhaustion-reversion.ts (D-829) — PREREG D-829-range-exhaustion-reversion.
// The atlas (D-828) measured two things that barely move between train and test: range is predictable (corr with the
// prior day 0.61, with the first 4 hours 0.60) and direction is a coin flip (50.1% up days). It also measured that the
// average day gives back most of what it travels (body/range 0.43). This asks the only question those facts license:
// when a day has already travelled its EXPECTED range and price is at the extreme of that travel, does it revert?
// Expected range is CAUSAL: the median true range of the prior 20 completed days. Nothing is fitted.
// Every control the record has paid for is here: same-window benchmark (D-826b), the fade priced as (-gross - cost)
// rather than (-net) (D-661/662, which contaminated D-827's fade clause), per-instrument decomposition (D-590),
// both thresholds reported so a threshold artifact cannot hide, and the trend-day subset reported separately.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { Bar, decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("range-exhaustion-reversion", [
  { name: "RUN_ID", def: "D-829-range-exhaustion-reversion" },
  { name: "SPLIT", def: "2023-01-01" }, { name: "LOOKBACK_D", def: "20", note: "completed days for the causal range forecast" },
  { name: "THRESH", def: "1.0,1.5", note: "extension multiples of the expected range, both reported" },
  { name: "KS", def: "4,8", note: "holding horizons in 1h bars" },
  { name: "EDGE_PCT", def: "0.20", note: "close must sit within this share of the travelled range from its extreme" },
  { name: "MIN_EVENTS", def: "20" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rev", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) || 1e-9) / Math.sqrt(a.length)) : NaN;
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const bp = (x: number) => (x * 1e4).toFixed(2);
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
const rtOf = (s: string) => FX.includes(s) ? (["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"].includes(s) ? 4 : 2) : 7;
async function loadBars(sym: string): Promise<Bar[]> {
  if (FX.includes(sym)) { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
const perpRows = await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[];
const UNIVERSE = [...perpRows.filter((r) => (r.n_bars ?? 0) > 10000).map((r) => r.symbol), ...FX];
const THRESH = K.THRESH.split(",").map(Number), KS = K.KS.split(",").map(Number);
const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000, LB = +K.LOOKBACK_D, EDGE = +K.EDGE_PCT;
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "range-exhaustion", runId: K.RUN_ID, spent: 12 });
console.log(`\n==> D-829 RANGE EXHAUSTION -> REVERSION — fade the extreme once the day has travelled its expected range. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()} (mined; the pre-registered bar is scripts/prereg-ceiling.ts).`);
interface Ev { sym: string; ts: number; thr: number; g: Record<number, number>; trendDay: boolean; }
const evs: Ev[] = [];
const uncond: Record<number, { train: number[]; test: number[] }> = {};
for (const k of KS) uncond[k] = { train: [], test: [] };
const hiE: Record<number, { train: number[]; test: number[] }> = {};
for (const k of KS) hiE[k] = { train: [], test: [] };
for (const sym of UNIVERSE) {
  const b = await loadBars(sym); if (b.length < 8000) continue;
  const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const days: { key: string; idx: number[] }[] = [];
  for (let i = 0; i < b.length; i++) { const d = dayKey(b[i].ts); if (!days.length || days[days.length - 1].key !== d) days.push({ key: d, idx: [] }); days[days.length - 1].idx.push(i); }
  const maxK = Math.max(...KS);
  const dayRange: number[] = days.map((d) => { let h = -Infinity, l = Infinity; for (const i of d.idx) { h = Math.max(h, b[i].h); l = Math.min(l, b[i].l); } return (h - l) / b[d.idx[0]].o; });
  for (let di = LB; di < days.length; di++) {
    const d = days[di]; if (d.idx.length < 12) continue;
    const expR = med(dayRange.slice(di - LB, di));                    /* CAUSAL: prior completed days only */
    if (!(expR > 0)) continue;
    const o0 = b[d.idx[0]].o;
    let hi = -Infinity, lo = Infinity; let fired = false;
    /* the day's trend character, known only at the close - used ONLY to split the report, never to select */
    let dh = -Infinity, dl = Infinity; for (const i of d.idx) { dh = Math.max(dh, b[i].h); dl = Math.min(dl, b[i].l); }
    const trendDay = Math.abs(b[d.idx[d.idx.length - 1]].c - o0) / ((dh - dl) || 1e-12) > 0.6;
    for (let j = 0; j < d.idx.length; j++) {
      const i = d.idx[j];
      hi = Math.max(hi, b[i].h); lo = Math.min(lo, b[i].l);
      if (i + 1 + maxK >= b.length) break;
      const trav = (hi - lo) / o0, E = trav / expR;
      const isTest = b[i].ts >= SPLIT;
      if (E >= 1.0) for (const k of KS) (isTest ? hiE[k].test : hiE[k].train).push(Math.log(b[i + 1 + k].c / b[i + 1].o));
      for (const k of KS) (isTest ? uncond[k].test : uncond[k].train).push(Math.log(b[i + 1 + k].c / b[i + 1].o));
      if (fired) continue;
      const pos = (b[i].c - lo) / ((hi - lo) || 1e-12);
      const atHigh = pos >= 1 - EDGE, atLow = pos <= EDGE;
      if (!atHigh && !atLow) continue;
      for (const thr of THRESH) {
        if (E < thr) continue;
        const dir = atHigh ? -1 : 1;                                   /* FADE the extreme */
        const g: Record<number, number> = {};
        for (const k of KS) g[k] = dir * Math.log(b[i + 1 + k].c / b[i + 1].o);
        evs.push({ sym, ts: b[i].ts, thr, g, trendDay });
      }
      if (E >= Math.max(...THRESH)) fired = true;                      /* one event per day per threshold set */
    }
  }
}
assertNonEmpty("exhaustion events", evs, 2000);
console.log(`    ${evs.length.toLocaleString()} events across ${new Set(evs.map((e) => e.sym)).size} instruments; expected range = median true range of the prior ${LB} completed days (causal).`);
for (const win of ["TRAIN", "TEST"] as const) {
  console.log(`\n  === ${win} (${win === "TEST" ? "decides" : "context only"}) ===`);
  console.log(`  ${"thr".padStart(4)} ${"K".padStart(3)} ${"n".padStart(7)} ${"net bp".padStart(8)} ${"t".padStart(7)} ${"gross".padStart(8)} ${"uncond".padStart(8)} ${"uncond|E>=1".padStart(12)} ${"excess".padStart(8)} ${"day t".padStart(7)} ${"sign".padStart(8)} ${"trend-day n/net".padStart(16)}`);
  for (const thr of THRESH) for (const k of KS) {
    const sel = evs.filter((e) => e.thr === thr && (win === "TEST" ? e.ts >= SPLIT : e.ts < SPLIT));
    if (sel.length < 10) { console.log(`  ${String(thr).padStart(4)} ${String(k).padStart(3)}  (thin)`); continue; }
    const net = sel.map((e) => e.g[k] - rtOf(e.sym) / 1e4), gross = sel.map((e) => e.g[k]);
    const u = mean(win === "TEST" ? uncond[k].test : uncond[k].train);
    const uh = mean(win === "TEST" ? hiE[k].test : hiE[k].train);
    const byDay = new Map<string, number[]>();
    for (let i = 0; i < sel.length; i++) { const d = new Date(sel[i].ts * 1000).toISOString().slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(net[i]); }
    const bySym = new Map<string, number[]>();
    for (let i = 0; i < sel.length; i++) { const s = sel[i].sym; (bySym.get(s) ?? bySym.set(s, []).get(s)!).push(net[i]); }
    const tested = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS).length, pos = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS && mean(v) > 0).length;
    const td = sel.filter((e) => e.trendDay), tdNet = td.map((e) => e.g[k] - rtOf(e.sym) / 1e4);
    console.log(`  ${String(thr).padStart(4)} ${String(k).padStart(3)} ${String(sel.length).padStart(7)} ${bp(mean(net)).padStart(8)} ${tstat(net).toFixed(2).padStart(7)} ${bp(mean(gross)).padStart(8)} ${bp(u).padStart(8)} ${bp(uh).padStart(12)} ${bp(mean(gross) - uh).padStart(8)} ${tstat([...byDay.values()].map(mean)).toFixed(2).padStart(7)} ${(pos + "/" + tested).padStart(8)} ${(td.length + "/" + bp(mean(tdNet))).padStart(16)}`);
  }
}
console.log("");
for (const k of KS) {
  const res = THRESH.map((thr) => {
    const sel = evs.filter((e) => e.thr === thr && e.ts >= SPLIT);
    const net = sel.map((e) => e.g[k] - rtOf(e.sym) / 1e4), gross = sel.map((e) => e.g[k]);
    const uh = mean(hiE[k].test);
    const bySym = new Map<string, number[]>();
    for (let i = 0; i < sel.length; i++) { const s = sel[i].sym; (bySym.get(s) ?? bySym.set(s, []).get(s)!).push(net[i]); }
    const tested = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS).length, pos = [...bySym.values()].filter((v) => v.length >= +K.MIN_EVENTS && mean(v) > 0).length;
    return { thr, n: sel.length, m: mean(net), t: tstat(net), ex: mean(gross) - uh, frac: tested ? pos / tested : 0 };
  });
  const [a, bq] = res;
  let v: string;
  if (Math.min(a.n, bq.n) < 200) v = `UNDERPOWERED — test n ${a.n} / ${bq.n}, need 200 in each`;
  else if (a.m <= 0 || bq.m <= 0) v = `NULL — net ${bp(a.m)}bp / ${bp(bq.m)}bp, one or both <= 0`;
  else if (a.t < 2.0 || bq.t < 2.0) v = `NULL — t ${a.t.toFixed(2)} / ${bq.t.toFixed(2)}, one or both < 2.0`;
  else if (a.ex <= 0 || bq.ex <= 0) v = `NULL — excess over the same-window high-extension benchmark ${bp(a.ex)}bp / ${bp(bq.ex)}bp`;
  else if (a.frac < 0.6 || bq.frac < 0.6) v = `NULL — instrument agreement ${(100 * a.frac).toFixed(0)}% / ${(100 * bq.frac).toFixed(0)}%, need 60%`;
  else v = `SUPPORTED at BOTH thresholds — net ${bp(a.m)}/${bp(bq.m)}bp, t ${a.t.toFixed(2)}/${bq.t.toFixed(2)}, excess ${bp(a.ex)}/${bp(bq.ex)}bp, agreement ${(100 * a.frac).toFixed(0)}%/${(100 * bq.frac).toFixed(0)}%`;
  console.log(`  K${k}: ${v}`);
}
