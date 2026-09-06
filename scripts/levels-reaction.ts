#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// levels-reaction.ts (D-808) — two pre-registered level families as REACTION levels, on every hourly instrument held:
//   PREREG D-808-value-area-levels : prior UTC-session POC / VAH / VAL (trd-auction.ts valueArea, 70%, volume-at-price)
//   PREREG D-808-q-levels          : quarter levels — BTC-style step 2.5 x 10^(floor(log10 p) - 2) (77,000 -> 250);
//                                     FX-style (price < 10) step 0.0025; ".00/.50" vs ".25/.75" reported separately
// Event = FIRST hourly touch of the level in a UTC day from the correct side (VAH from below -> expect DOWN; VAL from
// above -> expect UP; POC / quarter level: from below -> DOWN, from above -> UP — a reversal back through the level).
// Measured = direction x log(c[i+6]/c[i]) - RT (7bp crypto, 4bp index/commodity, 2bp FX), i.e. the REVERSAL return.
// Controls (the competing explanations in the pre-registrations): (1) PDH/PDL first touches, same rule; (2) RANDOM
// levels — per instrument-day a level at a distance from the day's open drawn from the instrument's own empirical
// distribution of level distances, same first-touch rule, same direction convention, hour-matched by construction.
// The statistic is the EXCESS of the level family over the random control (pooled, portfolio t) with a cross-instrument
// sign count. Laws: BENCHMARK (excess over control), BREADTH (instruments stated), SIGN (pre-registered), EXECUTION
// (return from the touching bar's close — the same-bar rule applies to close-derived signals; a touch is an intrabar
// event and the entry at that bar's close is the conservative reading — stated), TRIALS 6 + 4.
import { valueArea, PBar } from "../supabase/functions/_shared/trd-auction.ts";
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("levels-reaction", [
  { name: "KK", def: "6" }, { name: "MIN_BARS", def: "5000" }, { name: "SEED", def: "808" }, { name: "RUN_ID", def: "D-808-levels-reaction" },
]);
const KK = +K.KK;
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lvl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
type Bar = { ts: number; o: number; h: number; l: number; c: number; v: number };
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
let seed = +K.SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// instruments: 97 perps (packed, 9-tuple) + FX/index hourly (row-per-bar)
const inst: { sym: string; cls: "crypto" | "index" | "fx"; rt: number; bars: Bar[] }[] = [];
const meta = await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
for (const m of meta) { if (m.n_bars < +K.MIN_BARS) continue; const row = (await q(`trd_bars_intraday?symbol=eq.${m.symbol}&tf=eq.1hSF&select=bars`))[0]; const bars = ((row?.bars || []) as number[][]).filter((b) => b.length >= 6 && b[5] > 0).map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })).sort((a, b) => a.ts - b.ts); if (bars.length >= +K.MIN_BARS) inst.push({ sym: m.symbol, cls: "crypto", rt: 7e-4, bars }); }
for (const s of ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "BRENTCMDUSD", "USA500IDXUSD", "USATECHIDXUSD"]) {
  const bars: Bar[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${s}&select=ts,o,h,l,c,vol&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; for (const r of p) if (r.c > 0) bars.push({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol || 0 }); if (p.length < 50000) break; }
  if (bars.length >= +K.MIN_BARS) inst.push({ sym: s, cls: /USD$/.test(s) && !/IDX|CMD|XAU/.test(s) ? "fx" : "index", rt: /IDX|CMD|XAU/.test(s) ? 4e-4 : 2e-4, bars });
}
assertNonEmpty("instruments", inst, 50);
console.error(`  ${inst.length} instruments loaded (${inst.filter((i) => i.cls === "crypto").length} crypto, ${inst.filter((i) => i.cls !== "crypto").length} fx/index)`);

const qStep = (p: number) => p < 10 ? 0.0025 : 2.5 * Math.pow(10, Math.floor(Math.log10(p)) - 2);
type Ev = { sym: string; fam: string; kind: string; r: number; dist: number };
const evs: Ev[] = []; let vaSkipped = 0;
for (const I of inst) {
  const B = I.bars; const byDay = new Map<string, number[]>(); B.forEach((b, i) => { const k = dayKey(b.ts); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(i); });
  const dayKeys = [...byDay.keys()].sort(); const hasVol = B.some((b) => b.v > 0);
  if (!hasVol) vaSkipped++;
  const distPool: number[] = [];   // |level - open| / open for the real levels, to draw random controls from
  const levelsByDay: { day: string; lv: { fam: string; kind: string; px: number; side: "any" | "below" | "above" }[] }[] = [];
  for (let di = 1; di < dayKeys.length; di++) {
    const prev = byDay.get(dayKeys[di - 1])!, idx = byDay.get(dayKeys[di])!; if (prev.length < 12 || idx.length < 12) continue;
    const open = B[idx[0]].o; const lv: (typeof levelsByDay)[0]["lv"] = [];
    const pdh = Math.max(...prev.map((i) => B[i].h)), pdl = Math.min(...prev.map((i) => B[i].l));
    lv.push({ fam: "control-PDHL", kind: "PDH", px: pdh, side: "below" }, { fam: "control-PDHL", kind: "PDL", px: pdl, side: "above" });
    if (hasVol) { const va = valueArea(prev.map((i) => ({ h: B[i].h, l: B[i].l, c: B[i].c, v: B[i].v } as PBar)), 0.7, 100); if (va) { lv.push({ fam: "value-area", kind: "VAH", px: va.vah, side: "below" }, { fam: "value-area", kind: "VAL", px: va.val, side: "above" }, { fam: "value-area", kind: "POC", px: va.poc, side: "any" }); } }
    const st = qStep(open); const lo = Math.floor(pdl / st) - 1, hi = Math.ceil(pdh / st) + 1;
    for (let k = lo; k <= hi; k++) { const px = k * st; const quarter = ((k % 4) + 4) % 4; lv.push({ fam: "q-levels", kind: quarter === 0 || quarter === 2 ? "Q.00/.50" : "Q.25/.75", px, side: "any" }); }
    for (const l of lv) if (l.fam !== "control-PDHL") distPool.push(Math.abs(l.px - open) / open);
    levelsByDay.push({ day: dayKeys[di], lv });
  }
  // random control levels: same count per day as the real (non-control) levels, distances drawn from the pool
  for (const { day, lv } of levelsByDay) {
    const idx = byDay.get(day)!; const open = B[idx[0]].o; const nReal = lv.filter((l) => l.fam !== "control-PDHL").length;
    for (let k = 0; k < nReal; k++) { const dist = distPool[Math.floor(rnd() * distPool.length)] ?? 0; const px = open * (1 + (rnd() < 0.5 ? -1 : 1) * dist); lv.push({ fam: "control-random", kind: "RND", px, side: "any" }); }
    // first touch per level in the day
    for (const l of lv) {
      let prevClose = B[idx[0] - 1]?.c ?? B[idx[0]].o;
      for (const i of idx) {
        const b = B[i]; if (i + KK >= B.length) break;
        const fromBelow = prevClose < l.px && b.h >= l.px, fromAbove = prevClose > l.px && b.l <= l.px;
        if ((l.side === "below" && fromBelow) || (l.side === "above" && fromAbove) || (l.side === "any" && (fromBelow || fromAbove))) {
          const dir = fromBelow ? -1 : 1;   // reversal back through the level
          evs.push({ sym: I.sym, fam: l.fam, kind: l.kind, r: dir * Math.log(B[i + KK].c / b.c) - I.rt, dist: Math.abs(l.px - open) / open }); break;
        }
        prevClose = b.c;
      }
    }
  }
}
assertNonEmpty("touch events", evs, 10000);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "levels-reaction", runId: K.RUN_ID, spent: 10 });
console.log(`\n==> LEVELS AS REACTION LEVELS — first touch, K=${KK}h reversal return net of class RT. ${inst.length} instruments, ${evs.length.toLocaleString()} touches. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    value area computable on ${inst.length - vaSkipped} instruments (volume held); ${vaSkipped} fx/index instruments carry NO volume -> value-area UNTESTED there (stated, COVERAGE LAW).`);
const byFamKind = new Map<string, Ev[]>(); for (const e of evs) { const k = `${e.fam}|${e.kind}`; (byFamKind.get(k) ?? byFamKind.set(k, []).get(k)!).push(e); }
const ctrlBySym = new Map<string, number[]>(); for (const e of evs) if (e.fam === "control-random") (ctrlBySym.get(e.sym) ?? ctrlBySym.set(e.sym, []).get(e.sym)!).push(e.r);
const ctrlAll = evs.filter((e) => e.fam === "control-random").map((e) => e.r);
console.log(`    ${"level".padEnd(24)} ${"n".padStart(7)} ${"raw bp".padStart(8)} ${"t".padStart(6)} | ${"random ctrl bp".padStart(14)} | ${"EXCESS bp".padStart(10)} ${"t".padStart(6)}  instruments +/tested`);
const out: Record<string, unknown> = {};
for (const [k, E] of [...byFamKind.entries()].sort()) {
  const raw = E.map((e) => e.r); const bySym = new Map<string, number[]>(); for (const e of E) (bySym.get(e.sym) ?? bySym.set(e.sym, []).get(e.sym)!).push(e.r);
  // excess per event vs the instrument's own random-control mean
  const ex = E.map((e) => e.r - mean(ctrlBySym.get(e.sym) ?? ctrlAll)); let pos = 0, tested = 0;
  for (const [s, xs] of bySym) if (xs.length >= 30) { tested++; if (mean(xs) - mean(ctrlBySym.get(s) ?? ctrlAll) > 0) pos++; }
  console.log(`    ${k.padEnd(24)} ${String(raw.length).padStart(7)} ${(mean(raw) * 1e4).toFixed(2).padStart(8)} ${tstat(raw).toFixed(2).padStart(6)} | ${(mean(ctrlAll) * 1e4).toFixed(2).padStart(14)} | ${(mean(ex) * 1e4).toFixed(2).padStart(10)} ${tstat(ex).toFixed(2).padStart(6)}  ${pos}/${tested}`);
  out[k] = { n: raw.length, rawBp: mean(raw) * 1e4, tRaw: tstat(raw), exBp: mean(ex) * 1e4, tEx: tstat(ex), pos, tested };
}
console.log(`\n    by class (excess over random control, all real levels pooled):`);
for (const cls of ["crypto", "index", "fx"]) { const syms = new Set(inst.filter((i) => i.cls === cls).map((i) => i.sym)); for (const fam of ["value-area", "q-levels"]) { const E = evs.filter((e) => e.fam === fam && syms.has(e.sym)); if (!E.length) { console.log(`      ${cls.padEnd(7)} ${fam.padEnd(11)} UNTESTED (no events)`); continue; } const ex = E.map((e) => e.r - mean(ctrlBySym.get(e.sym) ?? ctrlAll)); console.log(`      ${cls.padEnd(7)} ${fam.padEnd(11)} n ${String(E.length).padStart(7)}  excess ${(mean(ex) * 1e4).toFixed(2).padStart(7)}bp  t ${tstat(ex).toFixed(2).padStart(6)}`); } }
const verdict = (fam: string) => { const E = evs.filter((e) => e.fam === fam); const ex = E.map((e) => e.r - mean(ctrlBySym.get(e.sym) ?? ctrlAll)); const t = tstat(ex); const bySym = new Map<string, number[]>(); for (const e of E) (bySym.get(e.sym) ?? bySym.set(e.sym, []).get(e.sym)!).push(e.r); let pos = 0, tested = 0; for (const [s, xs] of bySym) if (xs.length >= 30) { tested++; if (mean(xs) - mean(ctrlBySym.get(s) ?? ctrlAll) > 0) pos++; } const agree = tested ? pos / tested : 0; return t >= 2.5 && agree >= 0.6 ? `SUPPORTED in research space (excess t ${t.toFixed(2)}, ${pos}/${tested} agree)` : t <= -2.5 ? `SIGN MISSED (excess t ${t.toFixed(2)})` : `NULL (excess t ${t.toFixed(2)}, ${pos}/${tested} agree)`; };
console.log(`\n  VERDICT value-area: ${verdict("value-area")}`); console.log(`  VERDICT q-levels:   ${verdict("q-levels")}`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
