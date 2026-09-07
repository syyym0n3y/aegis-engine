#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// fx-footprint-test.ts (D-811) — the FX footprint from REAL tick side-volume (Dukascopy: askVol/bidVol per tick), pre-registered
// D-811-fx-footprint-ticks. (i) plain hourly delta -> next hour; (ii) 5-minute footprint proxy (top-third minus bottom-third
// share of the hour's delta) -> next hour; both OLS bp per 1 sd vs the round trip (EURUSD 2bp, XAUUSD 4bp), rank IC reported.
// (iii) composite: first 5-min touch of the prior-session value-area edge (VA from tick volume-at-price, 70%) + 15/45-minute
// delta reversal toward the level -> K=6h net; ablation level-only. Trials 6.
import { valueArea, PBar } from "../supabase/functions/_shared/trd-auction.ts";
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("fx-footprint-test", [{ name: "SYMBOLS", def: "EURUSD,XAUUSD" }, { name: "DIR", def: "data/dukascopy-ticks" }, { name: "Z_WIN", def: "720" }, { name: "RUN_ID", def: "D-811-fx-footprint" }]);
const FEE: Record<string, number> = { EURUSD: 2, XAUUSD: 4 };
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fxf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const REPO = new URL("..", import.meta.url).pathname; const DIR = K.DIR.startsWith("/") ? K.DIR : `${REPO}${K.DIR}`;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
function ols(x: number[], y: number[]) { const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); let sse = 0; for (let i = 0; i < n; i++) sse += (y[i] - my - b * (x[i] - mx)) ** 2; return { b, t: b / (Math.sqrt(sse / Math.max(1, n - 2) / (sxx || 1e-12)) || 1e-12), n }; }
function rankIC(x: number[], y: number[]) { const r = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const out = new Array(a.length); idx.forEach(([, i], k) => out[i] = k); return out as number[]; }; const rx = r(x), ry = r(y), mx = mean(rx), my = mean(ry); let s = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { s += (rx[i] - mx) * (ry[i] - my); sx += (rx[i] - mx) ** 2; sy += (ry[i] - my) ** 2; } return s / Math.sqrt(sx * sy || 1e-12); }
function zs(x: number[], W: number) { const out = new Array(x.length).fill(NaN); let s = 0, s2 = 0; for (let i = 0; i < x.length; i++) { s += x[i]; s2 += x[i] * x[i]; if (i >= W) { s -= x[i - W]; s2 -= x[i - W] ** 2; const m = s / W, v = Math.max(0, s2 / W - m * m); out[i] = v > 0 ? (x[i] - m) / Math.sqrt(v) : NaN; } } return out; }
type B5 = { t: number; o: number; h: number; l: number; c: number; v: number; d: number };
const res: { sym: string; sig: string; bpPerSd: number; t: number; ic: number; n: number }[] = []; const trades: { sym: string; abl: string; r: number }[] = [];
for (const sym of K.SYMBOLS.split(",")) {
  const fee = FEE[sym] ?? 3; const recs = (await Deno.readTextFile(`${DIR}/${sym}-5m.jsonl`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.missing).filter((r, i, a) => a.findIndex((x) => x.d === r.d) === i) as { d: string; bars: number[][] }[];   // dedupe by day (a concurrent writer once overlapped)
  assertNonEmpty(`${sym} days with ticks`, recs, 150);
  const bars: B5[] = recs.flatMap((r) => r.bars).map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], d: b[6] })).sort((a, b) => a.t - b.t);
  // hourly aggregates
  const hours = new Map<number, { c: number; delta: number; fp: number }>(); const byH = new Map<number, B5[]>();
  for (const b of bars) { const ht = Math.floor(b.t / 3600) * 3600; (byH.get(ht) ?? byH.set(ht, []).get(ht)!).push(b); }
  for (const [ht, bs] of byH) { if (bs.length < 8) continue; const h = Math.max(...bs.map((b) => b.h)), l = Math.min(...bs.map((b) => b.l)); let v = 0, dl = 0, top = 0, bot = 0; const t1 = l + (h - l) / 3, t2 = l + 2 * (h - l) / 3; for (const b of bs) { v += b.v; dl += b.d; const mid = (b.h + b.l) / 2; if (mid >= t2) top += b.d; else if (mid < t1) bot += b.d; } hours.set(ht, { c: bs[bs.length - 1].c, delta: v > 0 ? dl / v : 0, fp: v > 0 ? (top - bot) / v : 0 }); }
  const ts = [...hours.keys()].sort((a, b) => a - b); const ret = new Map<number, number>(); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] === 3600) ret.set(ts[i - 1], Math.log(hours.get(ts[i])!.c / hours.get(ts[i - 1])!.c) * 1e4);
  for (const [name, f] of [["plain hourly delta", (t: number) => hours.get(t)!.delta], ["footprint proxy (top-bottom third)", (t: number) => hours.get(t)!.fp]] as [string, (t: number) => number][]) {
    const xs = ts.map(f), z = zs(xs, +K.Z_WIN); const X: number[] = [], Y: number[] = []; for (let i = 0; i < ts.length; i++) { const y = ret.get(ts[i]); if (y == null || !Number.isFinite(z[i])) continue; X.push(z[i]); Y.push(y); }
    if (X.length < 2000) { console.log(`  ${sym} ${name}: UNTESTED (n ${X.length})`); continue; }
    const o = ols(X, Y); res.push({ sym, sig: name, bpPerSd: o.b, t: o.t, ic: rankIC(X, Y), n: o.n });
  }
  // composite at prior-session VA edges
  const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10); const byDay = new Map<string, number[]>(); bars.forEach((b, i) => { const k = dayOf(b.t); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(i); });
  const days = [...byDay.keys()].sort();
  for (let di = 1; di < days.length; di++) {
    const prev = byDay.get(days[di - 1])!, cur = byDay.get(days[di])!; if (prev.length < 150 || cur.length < 150) continue;
    const va = valueArea(prev.map((i) => ({ h: bars[i].h, l: bars[i].l, c: bars[i].c, v: bars[i].v } as PBar)), 0.7, 100); if (!va || !(va.vah > va.val)) continue;
    for (const L of [{ px: va.val, side: 1 as const }, { px: va.vah, side: -1 as const }]) {
      let prevClose = bars[cur[0] - 1]?.c ?? bars[cur[0]].o;
      for (const i of cur) { const b = bars[i]; if (i < 12 || i + 72 >= bars.length) { prevClose = b.c; continue; }
        const touched = L.side === 1 ? (prevClose > L.px && b.l <= L.px) : (prevClose < L.px && b.h >= L.px); if (!touched) { prevClose = b.c; continue; }
        let d15 = 0, d45 = 0; for (let k = 0; k < 3; k++) d15 += bars[i - k].d; for (let k = 3; k < 12; k++) d45 += bars[i - k].d;
        const D = Math.sign(d15) !== Math.sign(d45) && Math.sign(d15) === L.side && d15 !== 0;
        const r = L.side * Math.log(bars[i + 72].c / b.c) - fee / 1e4; trades.push({ sym, abl: "level", r }); if (D) trades.push({ sym, abl: "level+delta", r }); break; }
    }
  }
}
assertNonEmpty("results", res, 2);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "fx-footprint", runId: K.RUN_ID, spent: 6 });
console.log(`\n==> FX FOOTPRINT from tick side-volume (D-811), ${K.SYMBOLS}. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
for (const r of res) console.log(`    ${r.sym.padEnd(7)} ${r.sig.padEnd(36)} ${r.bpPerSd.toFixed(2).padStart(7)}bp/sd t ${r.t.toFixed(2).padStart(6)}  x fee ${(r.bpPerSd / (FEE[r.sym] ?? 3)).toFixed(2).padStart(5)}  rankIC ${r.ic.toFixed(3)}  n ${r.n}`);
for (const sym of K.SYMBOLS.split(",")) for (const abl of ["level", "level+delta"]) { const R = trades.filter((x) => x.sym === sym && x.abl === abl).map((x) => x.r); console.log(`    ${sym.padEnd(7)} composite ${abl.padEnd(12)} n ${String(R.length).padStart(5)}  K6 net ${(mean(R) * 1e4).toFixed(2).padStart(7)}bp  t ${tstat(R).toFixed(2).padStart(6)}`); }
const sup = ["plain hourly delta", "footprint proxy (top-bottom third)"].some((s) => { const g = res.filter((r) => r.sig === s); return g.length === 2 && g.every((r) => r.bpPerSd >= (FEE[r.sym] ?? 3) && r.t >= 2.5); });
const missed = res.some((r) => r.t <= -2.5); const maxX = Math.max(...res.map((r) => Math.abs(r.bpPerSd) / (FEE[r.sym] ?? 3)));
console.log(`\n  VERDICT flow: ${sup ? "SUPPORTED" : missed ? "SIGN MISSED on at least one cell" : `SUB-FEE / NULL (largest |effect| ${maxX.toFixed(2)}x fee)`}`);
console.log(`  RESULT_JSON ${JSON.stringify({ res, trades: ["EURUSD", "XAUUSD"].map((s) => ({ s, level: trades.filter((x) => x.sym === s && x.abl === "level").length, ld: trades.filter((x) => x.sym === s && x.abl === "level+delta").length })) })}`);
