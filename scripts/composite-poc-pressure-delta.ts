#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// composite-poc-pressure-delta.ts (D-809) — the operator's confluence, pre-registered (trd_prereg D-809-poc-pressure-delta-composite):
//   LEVEL   first 5-minute touch of the prior UTC-session value-area edge (VAL from above -> LONG, VAH from below -> SHORT; 70% VA)
//   P       futures PRESSURE aligned: over the prior 4h open interest ROSE while price moved INTO the level, AND the top-trader
//           long/short ACCOUNT ratio moved in the reversal direction (Binance metrics, 5-minute)
//   D       DELTA REVERSAL on the footprint: 5-minute taker delta over the last 15 min of the touching hour has the opposite
//           sign to the preceding 45 min AND points in the reversal direction (absorption)
// Managements: M1 K=6h close-to-close; M2 target = |edge - POC|, stop = half, first touch within 24h (conservative: a bar
// hitting both counts as the stop). Net 7bp. Ablations: level-only, level+P, level+D, level+P+D. Control: the same D rule
// at a RANDOM level at the same distance. The composite must beat its best component by >= 5bp (rule). Trials 18.
import { valueArea, PBar } from "../supabase/functions/_shared/trd-auction.ts";
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("composite-poc-pressure-delta", [{ name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT" }, { name: "DIR", def: "data/binance-mirror" }, { name: "FEE_BP", def: "7" }, { name: "SEED", def: "809" }, { name: "RUN_ID", def: "D-809-composite" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cpd", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const REPO = new URL("..", import.meta.url).pathname; const DIR = K.DIR.startsWith("/") ? K.DIR : `${REPO}${K.DIR}`; const FEE = +K.FEE_BP / 1e4;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
let seed = +K.SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
async function jsonl<T>(p: string): Promise<T[]> { try { return (await Deno.readTextFile(p)).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.missing) as T[]; } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; } }
type B5 = { t: number; o: number; h: number; l: number; c: number; v: number; d: number };
type Trade = { sym: string; side: 1 | -1; abl: string; m1: number; m2: number; win: number };
const trades: Trade[] = []; const ctrlD: number[] = [];
for (const sym of K.SYMBOLS.split(",")) {
  const k5 = await jsonl<{ d: string; bars: number[][] }>(`${DIR}/klines5m/${sym}.jsonl`); assertNonEmpty(`${sym} 5m records`, k5, 12);
  const bars: B5[] = k5.flatMap((r) => r.bars).map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], d: 2 * b[6] - b[5] })).sort((a, b) => a.t - b.t);
  const met = await jsonl<{ d: string; rows: (string | number)[][] }>(`${DIR}/metrics/${sym}.jsonl`); assertNonEmpty(`${sym} metrics days`, met, 300);
  const oi = new Map<number, number>(), topLS = new Map<number, number>();
  for (const day of met) for (const r of day.rows) { const t0 = Math.floor(Date.parse(String(r[0]).replace(" ", "T") + "Z") / 1000); if (!Number.isFinite(t0)) continue; const t5 = Math.floor(t0 / 300) * 300; if (+r[1] > 0) oi.set(t5, +r[1]); if (+r[3] > 0) topLS.set(t5, +r[3]); }
  const near = (m: Map<number, number>, t: number) => { for (let k = 0; k < 6; k++) { const v = m.get(t - k * 300); if (v != null) return v; } return NaN; };
  const idxOf = new Map<number, number>(); bars.forEach((b, i) => idxOf.set(b.t, i));
  const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const byDay = new Map<string, number[]>(); bars.forEach((b, i) => { const k = dayOf(b.t); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(i); });
  const days = [...byDay.keys()].sort();
  for (let di = 1; di < days.length; di++) {
    const prev = byDay.get(days[di - 1])!, cur = byDay.get(days[di])!; if (prev.length < 200 || cur.length < 200) continue;
    const va = valueArea(prev.map((i) => ({ h: bars[i].h, l: bars[i].l, c: bars[i].c, v: bars[i].v } as PBar)), 0.7, 100); if (!va || !(va.vah > va.val)) continue;
    const open = bars[cur[0]].o;
    const levels: { px: number; side: 1 | -1; target: number; real: boolean }[] = [
      { px: va.val, side: 1, target: va.poc, real: true }, { px: va.vah, side: -1, target: va.poc, real: true },
    ];
    // random control levels at the same distances (for the delta-at-random control)
    for (const L of levels.slice()) { const dist = Math.abs(L.px - open); const sgn = rnd() < 0.5 ? -1 : 1; const px = open + sgn * dist; levels.push({ px, side: sgn < 0 ? 1 : -1, target: px + (sgn < 0 ? 1 : -1) * Math.abs(L.target - L.px), real: false }); }
    for (const L of levels) {
      let prevClose = bars[cur[0] - 1]?.c ?? open;
      for (const i of cur) {
        const b = bars[i]; if (i < 48 || i + 288 >= bars.length) { prevClose = b.c; continue; }
        const touched = L.side === 1 ? (prevClose > L.px && b.l <= L.px) : (prevClose < L.px && b.h >= L.px);
        if (!touched) { prevClose = b.c; continue; }
        // pressure over prior 4h (48 bars)
        const oiNow = near(oi, b.t), oiPrev = near(oi, b.t - 4 * 3600), lsNow = near(topLS, b.t), lsPrev = near(topLS, b.t - 4 * 3600);
        const movedInto = L.side === 1 ? b.c < bars[i - 48].c : b.c > bars[i - 48].c;
        const P = Number.isFinite(oiNow) && Number.isFinite(oiPrev) && Number.isFinite(lsNow) && Number.isFinite(lsPrev) && oiNow > oiPrev && movedInto && (L.side === 1 ? lsNow > lsPrev : lsNow < lsPrev);
        // delta reversal: last 3 bars vs preceding 9 bars
        let d15 = 0, d45 = 0; for (let k = 0; k < 3; k++) d15 += bars[i - k].d; for (let k = 3; k < 12; k++) d45 += bars[i - k].d;
        const D = Math.sign(d15) !== Math.sign(d45) && Math.sign(d15) === L.side && d15 !== 0;
        // outcomes from the touching bar's close
        const entry = b.c; const m1 = L.side * Math.log(bars[i + 72].c / entry) - FEE;
        const tgt = L.target, stop = entry - L.side * Math.abs(tgt - entry) / 2; let m2 = NaN, win = 0;
        for (let k = 1; k <= 288; k++) { const x = bars[i + k]; const hitStop = L.side === 1 ? x.l <= stop : x.h >= stop; const hitTgt = L.side === 1 ? x.h >= tgt : x.l <= tgt; if (hitStop) { m2 = L.side * Math.log(stop / entry) - FEE; break; } if (hitTgt) { m2 = L.side * Math.log(tgt / entry) - FEE; win = 1; break; } if (k === 288) m2 = L.side * Math.log(x.c / entry) - FEE; }
        if (!L.real) { if (D) ctrlD.push(m1); break; }
        trades.push({ sym, side: L.side, abl: "level", m1, m2, win });
        if (P) trades.push({ sym, side: L.side, abl: "level+P", m1, m2, win });
        if (D) trades.push({ sym, side: L.side, abl: "level+D", m1, m2, win });
        if (P && D) trades.push({ sym, side: L.side, abl: "level+P+D (COMPOSITE)", m1, m2, win });
        break;
      }
    }
  }
}
assertNonEmpty("trades", trades, 500);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "poc-pressure-delta", runId: K.RUN_ID, spent: 18 });
console.log(`\n==> POC x PRESSURE x DELTA-REVERSAL composite (D-809), ${K.SYMBOLS}, net ${K.FEE_BP}bp. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    ${"ablation".padEnd(24)} ${"n".padStart(6)} ${"M1 6h bp".padStart(9)} ${"t".padStart(6)} | ${"M2 2:1 bp".padStart(9)} ${"t".padStart(6)} ${"win%".padStart(6)}  per-symbol M1 sign`);
const out: Record<string, unknown> = {};
for (const abl of ["level", "level+P", "level+D", "level+P+D (COMPOSITE)"]) {
  const R = trades.filter((x) => x.abl === abl); if (!R.length) { console.log(`    ${abl.padEnd(24)} UNTESTED (0 trades)`); continue; }
  const m1 = R.map((x) => x.m1), m2 = R.map((x) => x.m2).filter(Number.isFinite), wr = mean(R.map((x) => x.win));
  const signs = K.SYMBOLS.split(",").map((s) => { const v = R.filter((x) => x.sym === s).map((x) => x.m1); return `${s.slice(0, 3)}${v.length ? (mean(v) > 0 ? "+" : "-") : "?"}(${v.length})`; }).join(" ");
  console.log(`    ${abl.padEnd(24)} ${String(R.length).padStart(6)} ${(mean(m1) * 1e4).toFixed(2).padStart(9)} ${tstat(m1).toFixed(2).padStart(6)} | ${(mean(m2) * 1e4).toFixed(2).padStart(9)} ${tstat(m2).toFixed(2).padStart(6)} ${(wr * 100).toFixed(1).padStart(5)}%  ${signs}`);
  out[abl] = { n: R.length, m1: mean(m1) * 1e4, t1: tstat(m1), m2: mean(m2) * 1e4, t2: tstat(m2), win: wr };
}
console.log(`    control: delta-reversal at RANDOM levels   n ${ctrlD.length}  M1 ${(mean(ctrlD) * 1e4).toFixed(2)}bp  t ${tstat(ctrlD).toFixed(2)}`);
const comp = out["level+P+D (COMPOSITE)"] as { n: number; m1: number; t1: number } | undefined;
const best = Math.max(...["level", "level+P", "level+D"].map((a) => (out[a] as { m1: number } | undefined)?.m1 ?? -1e9));
let verdict = "UNTESTED (composite has no trades)";
if (comp) verdict = comp.n >= 200 && comp.m1 >= 10 && comp.t1 >= 2.5 && comp.m1 - best >= 5 ? `SUPPORTED in research space (${comp.m1.toFixed(1)}bp t ${comp.t1.toFixed(2)} n ${comp.n}, beats best component by ${(comp.m1 - best).toFixed(1)}bp)` : comp.t1 <= -2.5 ? `SIGN MISSED (${comp.m1.toFixed(1)}bp t ${comp.t1.toFixed(2)})` : `NULL / SUB-FEE (${comp.m1.toFixed(1)}bp t ${comp.t1.toFixed(2)} n ${comp.n}; best component ${best.toFixed(1)}bp)`;
console.log(`\n  VERDICT: ${verdict}`);
console.log(`  win rate is reported BESIDE its 2:1 payoff: a win rate without its geometry is not a number.`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
