#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// si-surprise.ts (D-805) — SHORT-INTEREST SURPRISE at the cadence the data actually has.
//
// D-626 left this UNTESTED: the daily surprise construction (60-day own baseline) holds ~4 observations at FINRA's
// semi-monthly cadence, and widening the window silently would have evaded the kill condition. So this is a NEW,
// separately pre-registered test (trd_prereg D-805-si-surprise-K12): the baseline is K=12 STRICTLY PRIOR settlements
// (~6 months), matched on observation count rather than on calendar time. Entry 10 trading days after settlement
// (FINRA publishes ~8 business days later — the D-391 convention), held 20 sessions.
// Laws: BENCHMARK — the statistic is the top-quartile bucket's EXCESS vs the same-period universe, never the bucket
// return; liquidity halves measured on BOTH sides (D-634); LEVEL control (days-to-cover quartiles on the same periods)
// separates surprise from the D-616 level effect; periods overlap (settlements ~10 sessions apart, hold 20) so a
// Newey-West(2) t is reported and the smaller |t| decides; SIGN stated before the data (negative). Trials: 2.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("si-surprise", [
  { name: "KOBS", def: "12", note: "strictly-prior settlements in the own baseline (median)" },
  { name: "PUB_LAG", def: "10", note: "trading days from settlement to entry (publication lag)" },
  { name: "HOLD", def: "20", note: "sessions held" },
  { name: "MIN_ADV", def: "200000", note: "median FINRA adv_qty (shares) to load a symbol's bars at all" },
  { name: "LIQ", def: "5000000", note: "min $ MDV (21d) at entry" },
  { name: "MIN_NAMES", def: "50", note: "names per settlement period" },
  { name: "COST_BP", def: "25", note: "round trip, for the net line only" },
  { name: "RUN_ID", def: "D-805-si-surprise-K12", note: "trial ledger run key" },
  { name: "DUMP", def: "data/si-surprise-periods.tsv", note: "per-period record" },
  { name: "PAGE_SLEEP_MS", def: "80", note: "pacing between bar pages (the REST restart of D-798 was a burst)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const REPO = new URL("..", import.meta.url).pathname;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sis", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const KOBS = +K.KOBS, LAG = +K.PUB_LAG, HOLD = +K.HOLD, MIN_ADV = +K.MIN_ADV, LIQ = +K.LIQ, MIN_NAMES = +K.MIN_NAMES, COST = +K.COST_BP / 1e4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get<T>(path: string): Promise<T> { const r = await fetch(`${OWNED}${path}`, { headers: hdr }); if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 80)}: ${(await r.text()).slice(0, 160)}`); return await r.json() as T; }

// 1. short interest, paged by month (offset pagination over 3.9M sorted rows is the slow path)
type SI = { d: string; q: number; adv: number };
const si = new Map<string, SI[]>(); let nRows = 0;
for (let y = 2017; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const a = `${y}-${String(m).padStart(2, "0")}-01`, b = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  for (let off = 0; ; off += 50000) {
    const rows = await get<{ symbol: string; settlement: string; short_qty: number; adv_qty: number }[]>(`/trd_short_interest?select=symbol,settlement,short_qty,adv_qty&settlement=gte.${a}&settlement=lt.${b}&order=settlement,symbol&offset=${off}&limit=50000`);
    for (const r of rows) { if (!(r.short_qty > 0)) continue; (si.get(r.symbol) ?? si.set(r.symbol, []).get(r.symbol)!).push({ d: r.settlement, q: r.short_qty, adv: r.adv_qty || 0 }); nRows++; }
    if (rows.length < 50000) break;
  }
}
console.log(`  short interest: ${nRows.toLocaleString()} rows, ${si.size.toLocaleString()} symbols`);
if (nRows < 3_500_000) { console.error("  RED — positive control: expected >= 3.5M short-interest rows"); Deno.exit(1); }
const aapl = si.get("AAPL"); if (!aapl || aapl.length < 100) { console.error("  RED — positive control: AAPL missing or < 100 settlements"); Deno.exit(1); }
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
for (const arr of si.values()) arr.sort((x, y) => x.d < y.d ? -1 : 1);

// 2. equities held, intersected with active short-interest names
const esyms = new Set<string>();
for (let off = 0; ; off += 1000) { const p = await get<{ symbol: string }[]>(`/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`); for (const r of p) esyms.add(r.symbol); if (p.length < 1000) break; }
const targets = [...si.keys()].filter((s) => esyms.has(s) && si.get(s)!.length >= KOBS + 1 && median(si.get(s)!.map((x) => x.adv)) >= MIN_ADV).sort();
assertNonEmpty("symbols with bars + >= K+1 settlements + adv floor", targets, 500);
console.log(`  equities to load: ${targets.length.toLocaleString()} (of ${esyms.size.toLocaleString()} held, ${si.size.toLocaleString()} with short interest)`);

// 3. bars, paced
type Bars = { day: string[]; c: Float64Array; dv: Float64Array };
const bars = new Map<string, Bars>();
for (let i = 0; i < targets.length; i += 20) {
  const rows = await get<{ symbol: string; bars: number[][] }[]>(`/trd_bars_deep?symbol=in.(${targets.slice(i, i + 20).map((s) => `"${s}"`).join(",")})&select=symbol,bars`);
  for (const r of rows) { const b = r.bars; if (!b || b.length < 300) continue; const day = b.map((x) => new Date(x[0] * 1000).toISOString().slice(0, 10)); bars.set(r.symbol, { day, c: Float64Array.from(b.map((x) => x[4])), dv: Float64Array.from(b.map((x) => x[4] * x[5])) }); }
  await sleep(+K.PAGE_SLEEP_MS);
}
console.log(`  bars loaded: ${bars.size.toLocaleString()} symbols`);
if (!bars.has("AAPL")) { console.error("  RED — positive control: AAPL bars missing"); Deno.exit(1); }

// 4. events
type Ev = { s: string; d: string; sur: number; lvl: number; mdv: number; ret: number };
const evs: Ev[] = [];
const idxAfter = (day: string[], d: string) => { let lo = 0, hi = day.length; while (lo < hi) { const m = (lo + hi) >> 1; if (day[m] <= d) lo = m + 1; else hi = m; } return lo; };
for (const s of targets) {
  const b = bars.get(s), arr = si.get(s)!; if (!b) continue;
  for (let i = KOBS; i < arr.length; i++) {
    const base = median(arr.slice(i - KOBS, i).map((x) => x.q)); if (!(base > 0)) continue;
    const e = idxAfter(b.day, arr[i].d) + LAG, x = e + HOLD; if (x >= b.day.length || e < 21) continue;
    let mdv = 0, n = 0; for (let k = e - 21; k < e; k++) if (b.dv[k] > 0) { mdv += b.dv[k]; n++; } if (!n || mdv / n < LIQ) continue;
    if (!(b.c[e] > 0 && b.c[x] > 0)) continue;
    evs.push({ s, d: arr[i].d, sur: arr[i].q / base - 1, lvl: arr[i].adv > 0 ? arr[i].q / arr[i].adv : NaN, mdv: mdv / n, ret: b.c[x] / b.c[e] - 1 });
  }
}
assertNonEmpty("events", evs, 10000);
console.log(`  events: ${evs.length.toLocaleString()} (settlement x name, liquid at entry)`);

// 5. per-period cross-sections
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12);
const nwT = (a: number[], L = 2) => { const m = mean(a), n = a.length; let v = 0; for (let l = 0; l <= L; l++) { let g = 0; for (let i = l; i < n; i++) g += (a[i] - m) * (a[i - l] - m); g /= n; v += l === 0 ? g : 2 * (1 - l / (L + 1)) * g; } return m / (Math.sqrt(v / n) || 1e-12); };
const byP = new Map<string, Ev[]>(); for (const e of evs) (byP.get(e.d) ?? byP.set(e.d, []).get(e.d)!).push(e);
const periods = [...byP.keys()].sort().filter((d) => byP.get(d)!.length >= MIN_NAMES);
console.log(`  periods with >= ${MIN_NAMES} names: ${periods.length} of ${byP.size}  (${periods[0]} .. ${periods[periods.length - 1]})`);
if (periods.length < 100) { console.error("  RED — fewer than 100 usable periods: UNDERPOWERED, not null"); }
const quart = (xs: Ev[], key: (e: Ev) => number) => { const v = xs.filter((e) => Number.isFinite(key(e))).sort((a, b) => key(a) - key(b)); const q = Math.floor(v.length / 4); return { lo: v.slice(0, q), hi: v.slice(v.length - q) }; };
type Rec = { d: string; n: number; uni: number; hiEx: number; loEx: number; hiExLiq: number; hiExIll: number; lvlHiEx: number; negHi: number };
const recs: Rec[] = [];
for (const d of periods) {
  const xs = byP.get(d)!, uni = mean(xs.map((e) => e.ret));
  const q = quart(xs, (e) => e.sur), ql = quart(xs, (e) => e.lvl);
  const medMdv = median(xs.map((e) => e.mdv));
  const liq = xs.filter((e) => e.mdv >= medMdv), ill = xs.filter((e) => e.mdv < medMdv);
  const half = (h: Ev[]) => { if (h.length < 20) return NaN; const qq = quart(h, (e) => e.sur); return mean(qq.hi.map((e) => e.ret)) - mean(h.map((e) => e.ret)); };
  recs.push({ d, n: xs.length, uni, hiEx: mean(q.hi.map((e) => e.ret)) - uni, loEx: mean(q.lo.map((e) => e.ret)) - uni, hiExLiq: half(liq), hiExIll: half(ill), lvlHiEx: mean(ql.hi.map((e) => e.ret)) - uni, negHi: mean(q.hi.map((e) => e.ret)) < 0 ? 1 : 0 });
}
const col = (f: (r: Rec) => number) => recs.map(f).filter(Number.isFinite);
const line = (name: string, v: number[]) => console.log(`    ${name.padEnd(44)} ${(mean(v) * 100).toFixed(3).padStart(8)}% /${HOLD}s   t ${tstat(v).toFixed(2).padStart(6)}   NW(2) t ${nwT(v).toFixed(2).padStart(6)}   n ${v.length}`);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "si-surprise", runId: K.RUN_ID, spent: 2 });
console.log(`\n==> SHORT-INTEREST SURPRISE (K=${KOBS} prior settlements, entry settle+${LAG}td, hold ${HOLD}s). Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    BENCHMARK LAW: every line is an EXCESS vs the same-period universe. Pre-registered sign: NEGATIVE for the HIGH-surprise bucket.`);
line("universe mean (all names)", col((r) => r.uni));
line("HIGH-surprise quartile EXCESS", col((r) => r.hiEx));
line("LOW-surprise quartile EXCESS", col((r) => r.loEx));
line("HIGH-surprise EXCESS, LIQUID half", col((r) => r.hiExLiq));
line("HIGH-surprise EXCESS, ILLIQUID half", col((r) => r.hiExIll));
line("LEVEL control: HIGH days-to-cover EXCESS", col((r) => r.lvlHiEx));
const hi = col((r) => r.hiEx), tPlain = tstat(hi), tNW = nwT(hi), tDec = Math.abs(tNW) < Math.abs(tPlain) ? tNW : tPlain;
const liqT = nwT(col((r) => r.hiExLiq)), illT = nwT(col((r) => r.hiExIll));
console.log(`    periods where the HIGH bucket is actually negative: ${(mean(col((r) => r.negHi)) * 100).toFixed(0)}%   mean names/period ${mean(recs.map((r) => r.n)).toFixed(0)}`);
console.log(`    net if shorted at ${K.COST_BP}bp: ${((-mean(hi) - COST) * 100).toFixed(3)}% per ${HOLD}s`);
const sign = mean(hi) < 0 ? "NEGATIVE (MATCHED)" : "POSITIVE (MISSED)";
let verdict: string;
if (tDec <= -2 && mean(col((r) => r.hiExLiq)) < 0 && mean(col((r) => r.hiExIll)) < 0) verdict = `SUPPORTED in research space (deciding t ${tDec.toFixed(2)}, both halves negative) — instrument + turnover before anything else`;
else if (tDec >= 2) verdict = `SIGN MISSED (deciding t ${tDec.toFixed(2)}) — recorded, not claimable (D-511b)`;
else verdict = `NULL (deciding t ${tDec.toFixed(2)}; |t| 2.0 at this effect would need ~${Math.ceil(hi.length * (2 / Math.max(1e-6, Math.abs(tDec))) ** 2)} periods)`;
console.log(`    sign ${sign}   liquid-half NW t ${liqT.toFixed(2)}   illiquid-half NW t ${illT.toFixed(2)}`);
console.log(`\n  VERDICT: ${verdict}`);
console.log(`  RESULT_JSON ${JSON.stringify({ periods: hi.length, events: evs.length, hiEx: mean(hi), t: tPlain, tNW, liqT, illT, lvlT: nwT(col((r) => r.lvlHiEx)), sign, ceiling: T.ceiling })}`);
const dump = K.DUMP.startsWith("/") ? K.DUMP : `${REPO}${K.DUMP}`;
await Deno.writeTextFile(dump, "settlement\tn\tuni\thiEx\tloEx\thiExLiq\thiExIll\tlvlHiEx\n" + recs.map((r) => [r.d, r.n, r.uni, r.hiEx, r.loEx, r.hiExLiq, r.hiExIll, r.lvlHiEx].join("\t")).join("\n") + "\n");
console.log(`  per-period record: ${dump}`);
