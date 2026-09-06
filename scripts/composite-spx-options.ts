#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// composite-spx-options.ts (D-809b) — pre-registered: S&P 500 / Nasdaq CFD hourly, prior-session value-area edge x OPTIONS
// PRESSURE (prior trading day's CBOE INDEX put/call ratio, z-scored on a trailing 60 trading days, >= +1 for VAL longs,
// <= -1 for VAH shorts). Control: the same rule conditioned on the VIX3M z-score instead (competing explanation a).
// Managements: M1 K=6h close-to-close net 4bp; M2 target = edge-to-POC, stop = half, first touch within 24h. Ablation:
// level-only vs level+pressure. Trials 8 (2 indices x 2 managements x 2 ablations).
import { valueArea, PBar } from "../supabase/functions/_shared/trd-auction.ts";
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("composite-spx-options", [{ name: "SYMBOLS", def: "USA500IDXUSD,USATECHIDXUSD" }, { name: "FEE_BP", def: "4" }, { name: "Z_DAYS", def: "60" }, { name: "Z_THR", def: "1" }, { name: "RUN_ID", def: "D-809b-spx-options" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cso", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const FEE = +K.FEE_BP / 1e4, ZD = +K.Z_DAYS, ZT = +K.Z_THR;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
// daily series -> z on trailing ZD days, keyed by date; "prior trading day" = the newest date strictly before the touch day
async function dailyZ(series: string) { const rows = await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc&limit=20000`) as { d: string; v: number }[]; assertNonEmpty(series, rows, 200); const z = new Map<string, number>(); for (let i = ZD; i < rows.length; i++) { const w = rows.slice(i - ZD, i).map((r) => r.v); const s = sd(w); if (s > 0) z.set(rows[i].d, (rows[i].v - mean(w)) / s); } const dates = rows.map((r) => r.d); return (day: string) => { let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < day) lo = m + 1; else hi = m; } return lo > 0 ? (z.get(dates[lo - 1]) ?? NaN) : NaN; }; }
const pcZ = await dailyZ("cboe_pc_index"), vixZ = await dailyZ("cboe_vix3m");
type Trade = { sym: string; abl: string; m1: number; m2: number; win: number };
const trades: Trade[] = [];
for (const sym of K.SYMBOLS.split(",")) {
  const bars: { ts: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; for (const r of p) if (r.c > 0) bars.push({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol || 0 }); if (p.length < 50000) break; }
  assertNonEmpty(`${sym} bars`, bars, 5000);
  const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const byDay = new Map<string, number[]>(); bars.forEach((b, i) => { const k = dayOf(b.ts); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(i); });
  const days = [...byDay.keys()].sort();
  for (let di = 1; di < days.length; di++) {
    const prev = byDay.get(days[di - 1])!, cur = byDay.get(days[di])!; if (prev.length < 12 || cur.length < 12) continue;
    if (!prev.some((i) => bars[i].v > 0)) continue;
    const va = valueArea(prev.map((i) => ({ h: bars[i].h, l: bars[i].l, c: bars[i].c, v: bars[i].v } as PBar)), 0.7, 100); if (!va || !(va.vah > va.val)) continue;
    const zp = pcZ(days[di]), zv = vixZ(days[di]); if (!Number.isFinite(zp)) continue;   // no put/call history -> not an event (coverage stated)
    for (const L of [{ px: va.val, side: 1 as const }, { px: va.vah, side: -1 as const }]) {
      let prevClose = bars[cur[0] - 1]?.c ?? bars[cur[0]].o;
      for (const i of cur) {
        const b = bars[i]; if (i + 24 >= bars.length) break;
        const touched = L.side === 1 ? (prevClose > L.px && b.l <= L.px) : (prevClose < L.px && b.h >= L.px);
        if (!touched) { prevClose = b.c; continue; }
        const entry = b.c, m1 = L.side * Math.log(bars[i + 6].c / entry) - FEE;
        const tgt = va.poc, stop = entry - L.side * Math.abs(tgt - entry) / 2; let m2 = NaN, win = 0;
        for (let k = 1; k <= 24; k++) { const x = bars[i + k]; const hs = L.side === 1 ? x.l <= stop : x.h >= stop, ht = L.side === 1 ? x.h >= tgt : x.l <= tgt; if (hs) { m2 = L.side * Math.log(stop / entry) - FEE; break; } if (ht) { m2 = L.side * Math.log(tgt / entry) - FEE; win = 1; break; } if (k === 24) m2 = L.side * Math.log(x.c / entry) - FEE; }
        const P = L.side === 1 ? zp >= ZT : zp <= -ZT, V = Number.isFinite(zv) && (L.side === 1 ? zv >= ZT : zv <= -ZT);
        trades.push({ sym, abl: "level", m1, m2, win }); if (P) trades.push({ sym, abl: "level+putcall", m1, m2, win }); if (V) trades.push({ sym, abl: "control: level+VIX3M z", m1, m2, win });
        break;
      }
    }
  }
}
assertNonEmpty("trades", trades, 200);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "spx-poc-options", runId: K.RUN_ID, spent: 8 });
console.log(`\n==> SPX/NDX value-area edge x OPTIONS PRESSURE (index put/call z${ZD} >= ${ZT}), net ${K.FEE_BP}bp. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
const out: Record<string, unknown> = {};
for (const sym of K.SYMBOLS.split(",")) for (const abl of ["level", "level+putcall", "control: level+VIX3M z"]) {
  const R = trades.filter((x) => x.sym === sym && x.abl === abl); if (!R.length) { console.log(`    ${sym.padEnd(14)} ${abl.padEnd(24)} UNTESTED (0)`); continue; }
  const m1 = R.map((x) => x.m1), m2 = R.map((x) => x.m2).filter(Number.isFinite), wr = mean(R.map((x) => x.win));
  console.log(`    ${sym.padEnd(14)} ${abl.padEnd(24)} n ${String(R.length).padStart(5)}  M1 ${(mean(m1) * 1e4).toFixed(2).padStart(7)}bp t ${tstat(m1).toFixed(2).padStart(6)} | M2 ${(mean(m2) * 1e4).toFixed(2).padStart(7)}bp t ${tstat(m2).toFixed(2).padStart(6)} win ${(wr * 100).toFixed(1)}%`);
  out[`${sym}|${abl}`] = { n: R.length, m1: mean(m1) * 1e4, t1: tstat(m1), m2: mean(m2) * 1e4, t2: tstat(m2), win: wr };
}
const sp = out["USA500IDXUSD|level+putcall"] as { n: number; m1: number; t1: number } | undefined, lv = out["USA500IDXUSD|level"] as { m1: number } | undefined, ct = out["USA500IDXUSD|control: level+VIX3M z"] as { m1: number } | undefined;
let verdict = "UNTESTED";
if (sp && lv) verdict = sp.n >= 100 && sp.m1 >= 10 && sp.t1 >= 2.5 && sp.m1 - lv.m1 >= 5 && !(ct && ct.m1 >= sp.m1 - 2) ? `SUPPORTED in research space (${sp.m1.toFixed(1)}bp t ${sp.t1.toFixed(2)} n ${sp.n})` : sp.t1 <= -2.5 ? `SIGN MISSED (${sp.m1.toFixed(1)}bp t ${sp.t1.toFixed(2)})` : `NULL / SUB-FEE (${sp.m1.toFixed(1)}bp t ${sp.t1.toFixed(2)} n ${sp.n}; level-only ${lv.m1.toFixed(1)}bp; VIX control ${ct ? ct.m1.toFixed(1) : "n/a"}bp)`;
console.log(`\n  VERDICT (SPX): ${verdict}`); console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
