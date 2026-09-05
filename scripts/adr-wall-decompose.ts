#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// adr-wall-decompose.ts (D-794 e, survival tests) — the D-777 protocol applied to the one new cross-panel cell from the
// upload-concept sweep: "first touch of day-open + ADR(20) -> CONTINUE long" (t 3.5/4.8/3.9, sign 13/13/12 of 17).
// D-776's t 7.86 died on exactly these two axes (crypto-only; 2026 sign-flip), so nothing is said about this cell until
// it has passed: (1) per-asset-class breakdown, (2) per-year era stability incl. 2026 partial, (3) day-clustered t
// (touches cluster on market-wide trend days), (4) gross vs net (a WIN claim — cost should REDUCE t, not create it).
import { Bar, decodeBar, utcDayKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("adr-wall-decompose", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "MIN_INST", def: "20" }, { name: "ADR_N", def: "20" },
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" }, { name: "FX_RT_BP", def: "2" },
]);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const MIN_INST = Number(K.MIN_INST), ADR_N = Number(K.ADR_N), KSET = [6, 12, 24];
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "awd", exp: 4102444800 });
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
async function loadCrypto(sym: string): Promise<Bar[]> { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0]; return ((row?.bars || []) as number[][]).filter((b) => b[5] > 0).map(decodeBar).sort((a, b) => a.ts - b.ts); }
async function loadFx(sym: string): Promise<Bar[]> { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP) / 1e4, bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP) / 1e4, bars: await loadFx(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP) / 1e4, bars: await loadFx(s) });
for (const i of insts) assertNonEmpty(`bars ${i.symbol}`, i.bars, 3000);
function stats(xs: number[]) { const n = xs.length; if (!n) return { n: 0, mean: 0, t: 0 }; const m = xs.reduce((a, c) => a + c, 0) / n; const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0; const sd = Math.sqrt(s2); return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 }; }
const bp = (x: number) => (x * 1e4).toFixed(2);

interface Ev { sym: string; klass: Klass; day: string; year: number; gross: Record<number, number>; net: Record<number, number> }
const upper: Ev[] = [], lower: Ev[] = [];
for (const inst of insts) {
  const b = inst.bars; const hi = new Map<string, number>(), lo = new Map<string, number>(), open = new Map<string, number>();
  for (const x of b) { const d = utcDayKey(x.ts); if (!open.has(d)) open.set(d, x.o); hi.set(d, Math.max(hi.get(d) ?? -Infinity, x.h)); lo.set(d, Math.min(lo.get(d) ?? Infinity, x.l)); }
  const days = [...hi.keys()].sort(); const adr = new Map<string, number>();
  for (let n = ADR_N; n < days.length; n++) { let s = 0; for (let j = n - ADR_N; j < n; j++) s += hi.get(days[j])! - lo.get(days[j])!; adr.set(days[n], s / ADR_N); }
  let cur = "", tU = false, tL = false;
  for (let i = 0; i < b.length - 26; i++) {
    const d = utcDayKey(b[i].ts); if (d !== cur) { cur = d; tU = false; tL = false; }
    if (b[i].ts < SPLIT_TS) continue;
    const a = adr.get(d), o = open.get(d); if (a === undefined || o === undefined) continue;
    const e = b[i + 1].o; if (!(e > 0)) continue;
    const mk = (dir: 1 | -1): Ev => { const gross: Record<number, number> = {}, net: Record<number, number> = {}; for (const k of KSET) { gross[k] = dir * Math.log(b[i + 1 + k].c / e); net[k] = gross[k] - inst.rt; } return { sym: inst.symbol, klass: inst.klass, day: d, year: Number(d.slice(0, 4)), gross, net }; };
    if (!tU && b[i].h >= o + a) { tU = true; upper.push(mk(1)); }     // upper wall touch -> CONTINUE long
    if (!tL && b[i].l <= o - a) { tL = true; lower.push(mk(1)); }     // lower wall touch -> FADE long
  }
}
let TRIALS = 0;
function cell(label: string, evs: Ev[], k: number) {
  TRIALS++;
  const sN = stats(evs.map((e) => e.net[k])), sG = stats(evs.map((e) => e.gross[k]));
  const byDay = new Map<string, number[]>(); const bySym = new Map<string, number[]>();
  for (const e of evs) { (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e.net[k]); (bySym.get(e.sym) ?? bySym.set(e.sym, []).get(e.sym)!).push(e.net[k]); }
  const dm: number[] = []; for (const xs of byDay.values()) dm.push(xs.reduce((a, c) => a + c, 0) / xs.length); const sD = stats(dm);
  let pos = 0, tested = 0; for (const xs of bySym.values()) { if (xs.length < MIN_INST) continue; tested++; if (stats(xs).mean > 0) pos++; }
  console.log(`    ${label.padEnd(26)} K${String(k).padStart(2)}  n ${String(sN.n).padStart(5)}  net ${bp(sN.mean).padStart(7)}bp t ${sN.t.toFixed(2).padStart(6)}  | gross t ${sG.t.toFixed(2).padStart(6)}  | day-clustered t ${sD.t.toFixed(2).padStart(6)} (${dm.length}d)  | sign ${pos}/${tested}`);
}
for (const [name, evs] of [["UPPER touch -> CONTINUE long", upper], ["LOWER touch -> FADE long", lower]] as const) {
  console.log(`\n==> ${name} — ${evs.length} OOS events`);
  console.log(`  ALL (17):`); for (const k of KSET) cell("all", evs, k);
  console.log(`  BY CLASS (K12):`); for (const c of ["crypto", "idx", "fx"] as Klass[]) cell(c, evs.filter((e) => e.klass === c), 12);
  console.log(`  BY YEAR (K12, all classes):`); for (const y of [2023, 2024, 2025, 2026]) cell(String(y), evs.filter((e) => e.year === y), 12);
  console.log(`  BY YEAR (K12, crypto only):`); for (const y of [2023, 2024, 2025, 2026]) cell(`${y} crypto`, evs.filter((e) => e.year === y && e.klass === "crypto"), 12);
}
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "adr-wall-decompose", runId: `awd|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  TRIALS ${TRIALS} | ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()}`);
console.log(`  SURVIVAL RULE (D-777): >=2 of 3 classes positive with majority sign; >=3 of 4 years positive incl. no 2026 sign-flip; day-clustered t >= 2; gross t >= net t.`);
