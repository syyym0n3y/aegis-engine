#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// prop-firm-ev.ts (D-796) — prop-firm evaluations as the CAPITAL-ACCESS route for edges that only work at >=$100k books.
// A prop eval is not an edge problem; it is a DRAWDOWN-CONSTRAINED STOPPING problem: pay fee F, pass if equity reaches
// +TARGET before max drawdown DD (trailing or static) and daily-loss rules, then trade a funded book for a payout split.
// This script prices that bet with the programme's MEASURED per-day return distributions — the same series the
// registered clocks score — by block-bootstrap Monte Carlo, at a sweep of position sizes, against typical published
// rule-sets, and ALWAYS beside the no-edge baseline (what the firm is pricing) and a 2026-only pessimistic case (the
// regime that broke four crypto constructions, D-777/778/782/794).
//
// TWO HARD LINES, on the record: (1) cross-firm hedging to force a pass is ToS fraud and voids payouts — not modelled,
// not recommended; (2) N accounts trading ONE signal are ONE bet at N× size — pass outcomes are ~perfectly correlated,
// so "many firms" scales payouts AND fee losses together; it does not diversify. Reported as such.
//
// SIGNAL SETS (all lag-1, net of cost, per-day MEAN across that day's signals = the day-clustered series):
//   FUTURES (Topstep/Apex/Lucid-style: index futures only): NQ+SPX 1h — utc16 close>PDH -> long K6 (clock utc16) and
//     the D-779 10AM-ET close>PDH -> long K6 continuation. Cost 2bp RT (pessimistic for micro/e-mini futures).
//   CFD (FTMO-style: FX/indices/crypto CFDs): the 17-instrument utc16 cell (the only D-780 clock still positive in 2026).
// Every (firm × signal-set × size) is a counted trial. DESCRIPTIVE ONLY. Rule presets are TYPICAL PUBLISHED TERMS and
// must be verified against the firm's current page before any fee is paid — they are knobs, not facts.
import { Bar, decodeBar, priorPeriodLevels, utcDayKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("prop-firm-ev", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "PATHS", def: "4000", note: "Monte Carlo paths per cell" },
  { name: "BLOCK", def: "5", note: "block-bootstrap block length in event-days (keeps within-week clustering)" },
  { name: "SIZES", def: "0.5,1,2,3,5", note: "notional as a multiple of the evaluation account size" },
  { name: "FUT_RT_BP", def: "2" }, { name: "CFD_RT_BP", def: "4" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "FX_RT_BP", def: "2" },
  { name: "FUNDED_MONTHS", def: "6", note: "months of funded trading simulated after a pass" },
  { name: "SEED", def: "7" },
  { name: "EQUITY", def: "0", note: "1 = also price the D-785 equity liquid-decile belowPML K5 cell against stock-CFD prop terms (loads 12,300 symbols, ~3 min)" },
  { name: "EQ_RT_BP", def: "15", note: "stock-CFD prop round trip incl. spread+commission (pessimistic; swaps on a 5-day hold NOT modelled — stated)" },
  { name: "EQ_MIN_BARS", def: "500" },
]);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000), PATHS = Number(K.PATHS), BLOCK = Number(K.BLOCK);
const SIZES = K.SIZES.split(",").map(Number), FUNDED_MONTHS = Number(K.FUNDED_MONTHS);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pfe", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// deterministic PRNG so runs are reproducible (SEED knob)
let seed = Number(K.SEED) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---------- rule presets: TYPICAL PUBLISHED TERMS (2025-26), VERIFY BEFORE PAYING A FEE ----------
interface Rules { name: string; kind: "futures" | "cfd"; book: number; target: number; maxDD: number; trailing: boolean; dailyLoss: number; minDays: number; consistency: number; fee: number; payout: number; maxDays: number; phase2Target: number }
const FIRMS: Rules[] = [
  { name: "topstep-50k (typical)", kind: "futures", book: 50000, target: 3000, maxDD: 2000, trailing: true, dailyLoss: 1000, minDays: 2, consistency: 0.5, fee: 49, payout: 0.9, maxDays: 0, phase2Target: 0 },
  { name: "apex-50k (typical)", kind: "futures", book: 50000, target: 3000, maxDD: 2500, trailing: true, dailyLoss: 0, minDays: 7, consistency: 0.3, fee: 167, payout: 0.9, maxDays: 0, phase2Target: 0 },
  { name: "lucid-50k (screenshot-implied)", kind: "futures", book: 50000, target: 3000, maxDD: 2000, trailing: true, dailyLoss: 1100, minDays: 1, consistency: 0.4, fee: 99, payout: 0.9, maxDays: 0, phase2Target: 0 },
  { name: "ftmo-100k (typical, 2 phases)", kind: "cfd", book: 100000, target: 10000, maxDD: 10000, trailing: false, dailyLoss: 5000, minDays: 4, consistency: 0, fee: 580, payout: 0.8, maxDays: 0, phase2Target: 5000 },
];

// ---------- signal-set construction: per-day mean net return series (day-clustered), OOS and 2026-only ----------
async function loadFx(sym: string): Promise<Bar[]> { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
async function loadCrypto(sym: string): Promise<Bar[]> { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0]; return ((row?.bars || []) as number[][]).filter((b) => b[5] > 0).map(decodeBar).sort((a, b) => a.ts - b.ts); }
function isDstUS(ts: number): boolean { const d = new Date(ts * 1000), y = d.getUTCFullYear(); const mar = new Date(Date.UTC(y, 2, 1)); const s = Date.UTC(y, 2, 1 + (7 - mar.getUTCDay()) % 7 + 7, 7); const nov = new Date(Date.UTC(y, 10, 1)); const e = Date.UTC(y, 10, 1 + (7 - nov.getUTCDay()) % 7, 6); const t = ts * 1000; return t >= s && t < e; }
interface DayRet { day: string; ret: number }
// events: close > prior-UTC-day high at a given UTC hour (or at 10AM ET) -> long at close, exit K=6 bars later, net of rt
function eventsAbovePDH(bars: Bar[], hourSel: (ts: number) => boolean, rt: number): DayRet[] {
  const pd = priorPeriodLevels(bars, utcDayKey), out: DayRet[] = [];
  for (let i = 30; i < bars.length - 7; i++) {
    if (bars[i].ts < SPLIT_TS || !hourSel(bars[i].ts)) continue;
    const l = pd[i]; if (!l || i <= l.fromLastIndex || !(bars[i].c > l.high)) continue;
    out.push({ day: utcDayKey(bars[i].ts), ret: Math.log(bars[i + 6].c / bars[i].c) - rt });
  }
  return out;
}
function dayMeans(evs: DayRet[]): DayRet[] { const m = new Map<string, number[]>(); for (const e of evs) (m.get(e.day) ?? m.set(e.day, []).get(e.day)!).push(e.ret); return [...m.entries()].sort().map(([day, xs]) => ({ day, ret: xs.reduce((a, c) => a + c, 0) / xs.length })); }

const FUT_RT = Number(K.FUT_RT_BP) / 1e4, CFD_RT = Number(K.CFD_RT_BP) / 1e4, CR_RT = Number(K.CRYPTO_RT_BP) / 1e4, FX_RT = Number(K.FX_RT_BP) / 1e4;
const nq = await loadFx("USATECHIDXUSD"), sp = await loadFx("USA500IDXUSD");
assertNonEmpty("NQ bars", nq, 3000); assertNonEmpty("SPX bars", sp, 3000);
const futEv: DayRet[] = [];
for (const b of [nq, sp]) { futEv.push(...eventsAbovePDH(b, (ts) => new Date(ts * 1000).getUTCHours() === 16, FUT_RT)); futEv.push(...eventsAbovePDH(b, (ts) => new Date(ts * 1000).getUTCHours() === (isDstUS(ts) ? 14 : 15), FUT_RT)); }
const cfdEv: DayRet[] = [];
for (const s of ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"]) cfdEv.push(...eventsAbovePDH(await loadCrypto(s), (ts) => new Date(ts * 1000).getUTCHours() === 16, CR_RT));
for (const s of ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"]) cfdEv.push(...eventsAbovePDH(await loadFx(s), (ts) => new Date(ts * 1000).getUTCHours() === 16, CFD_RT));
for (const s of ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"]) cfdEv.push(...eventsAbovePDH(await loadFx(s), (ts) => new Date(ts * 1000).getUTCHours() === 16, FX_RT));
const SETS: Record<string, DayRet[]> = { "FUTURES NQ+SPX (utc16 + 10AM-ET abovePDH)": dayMeans(futEv), "CFD 17-panel utc16 abovePDH": dayMeans(cfdEv) };
// EQUITY set (opt-in): the D-785 clock-#18 cell — liquid top-decile US equities, close < prior 20-day low -> long, K=5 DAYS.
// The only construction that did NOT break in 2026 (D-784/785). Priced against stock-CFD prop terms at EQ_RT_BP. A 5-day
// hold means up to 5 overlapping positions per name-day, so the sim divides notional by 5 (concurrent exposure ≈ the
// chosen size) and books each event-day's 5-day return on its entry day — conservative on DD timing, stated as such.
if (K.EQUITY === "1") {
  const EQ_RT = Number(K.EQ_RT_BP) / 1e4, MINB = Number(K.EQ_MIN_BARS);
  const meta = await q(`trd_bars_deep?n_bars=gte.${MINB}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
  const per: { sym: string; mdv: number; evs: DayRet[] }[] = []; let loaded = 0;
  for (const m of meta) {
    const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(m.symbol)}&select=bars`))?.[0];
    const b = ((row?.bars || []) as number[][]).filter((x) => Array.isArray(x) && x.length >= 5 && x[4] > 0).sort((a, c) => a[0] - c[0]);
    if (b.length < MINB + 6) continue;
    const dv: number[] = []; for (const x of b) { if (x[0] >= SPLIT_TS) break; dv.push(x[4] * (x[5] ?? 0)); }
    const mdv = dv.length ? dv.sort((a, c) => a - c)[Math.floor(dv.length / 2)] : 0;
    const evs: DayRet[] = [];
    for (let i = 20; i < b.length - 6; i++) {
      if (b[i][0] < SPLIT_TS) continue;
      let lo = Infinity; for (let j = i - 20; j < i; j++) if (b[j][3] < lo) lo = b[j][3];
      if (!(b[i][4] < lo)) continue;
      evs.push({ day: new Date(b[i][0] * 1000).toISOString().slice(0, 10), ret: Math.log(b[i + 5][4] / b[i][4]) - EQ_RT });
    }
    per.push({ sym: m.symbol, mdv, evs }); loaded++;
    if (loaded % 2000 === 0) console.error(`  equity: loaded ${loaded}/${meta.length}`);
  }
  per.sort((a, c) => c.mdv - a.mdv);
  const liq = per.slice(0, Math.floor(per.length * 0.1));
  const eqEv: DayRet[] = []; for (const p of liq) eqEv.push(...p.evs);
  SETS[`EQUITY liquid-decile belowPML K5 (stock-CFD prop, ${K.EQ_RT_BP}bp, exposure/5)`] = dayMeans(eqEv);
  console.log(`  equity set: ${loaded} symbols loaded, liquid decile ${liq.length}, ${eqEv.length} events -> ${SETS[`EQUITY liquid-decile belowPML K5 (stock-CFD prop, ${K.EQ_RT_BP}bp, exposure/5)`].length} event-days`);
}
const exposureDiv = (setName: string) => setName.startsWith("EQUITY") ? 5 : 1;
function stats(xs: number[]) { const n = xs.length; if (!n) return { n: 0, mean: 0, sd: 0, t: 0 }; const m = xs.reduce((a, c) => a + c, 0) / n; const sd = Math.sqrt(n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0); return { n, mean: m, sd, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 }; }
const bp = (x: number) => (x * 1e4).toFixed(1);

// ---------- the evaluation as a stopping problem, Monte Carlo over block-bootstrapped event-days ----------
interface Sim { pPass: number; pFail: number; medDays: number; pConsistencyFail: number; fundedMonthly: number; pBlowFunded: number }
function simulate(series: number[], R: Rules, notional: number, noEdge: boolean, target: number): Sim {
  const n = series.length; if (n < 30) return { pPass: NaN, pFail: NaN, medDays: NaN, pConsistencyFail: NaN, fundedMonthly: NaN, pBlowFunded: NaN };
  const mu = series.reduce((a, c) => a + c, 0) / n;
  const draw = (): number => { // block bootstrap; demeaned when noEdge (same variance, zero drift = what the firm prices)
    const start = Math.floor(rnd() * n); const x = series[(start + (blockPos++ % BLOCK)) % n]; return noEdge ? x - mu : x; };
  let blockPos = 0;
  let pass = 0, fail = 0, consFail = 0; const daysToPass: number[] = [];
  let fundedTotal = 0, fundedRuns = 0, blown = 0;
  const maxDays = R.maxDays || 400;
  for (let p = 0; p < PATHS; p++) {
    // EVALUATION
    let eq = R.book, hwm = R.book, best = 0, profit = 0, d = 0, done = 0;   // done: 1 pass, -1 fail
    for (d = 1; d <= maxDays; d++) {
      const pnl = draw() * notional; eq += pnl; profit = eq - R.book; best = Math.max(best, pnl);
      if (R.dailyLoss > 0 && pnl <= -R.dailyLoss) { done = -1; break; }
      const floor = R.trailing ? Math.min(hwm, R.book + target) - R.maxDD : R.book - R.maxDD;   // trailing floor caps at target (typical)
      if (eq <= floor) { done = -1; break; }
      hwm = Math.max(hwm, eq);
      if (profit >= target && d >= R.minDays) { if (R.consistency > 0 && best / profit > R.consistency) { continue; } done = 1; break; }
    }
    if (done === 1) { pass++; daysToPass.push(d); }
    else if (done === -1) fail++;
    else if (profit >= target) consFail++;   // hit target but never satisfied consistency within maxDays
    // FUNDED PHASE (only for passed paths): same rules' DD on the funded book, payout split on positive months
    if (done === 1) {
      let feq = R.book, fh = R.book, alive = true, paid = 0;
      for (let m = 0; m < FUNDED_MONTHS && alive; m++) {
        const startEq = feq;
        for (let dd = 0; dd < 21; dd++) { const pnl = draw() * notional; feq += pnl; const floor = R.trailing ? Math.min(fh, R.book + R.maxDD) - R.maxDD : R.book - R.maxDD; if (feq <= floor || (R.dailyLoss > 0 && pnl <= -R.dailyLoss)) { alive = false; break; } fh = Math.max(fh, feq); }
        if (alive && feq > startEq) { paid += (feq - startEq) * R.payout; feq = startEq; fh = Math.max(fh, feq); }   // withdraw profits monthly
      }
      fundedTotal += paid / FUNDED_MONTHS; fundedRuns++; if (!alive) blown++;
    }
  }
  daysToPass.sort((a, b) => a - b);
  return { pPass: pass / PATHS, pFail: fail / PATHS, medDays: daysToPass.length ? daysToPass[Math.floor(daysToPass.length / 2)] : NaN, pConsistencyFail: consFail / PATHS, fundedMonthly: fundedRuns ? fundedTotal / fundedRuns : NaN, pBlowFunded: fundedRuns ? blown / fundedRuns : NaN };
}

let TRIALS = 0;
console.log(`==> PROP-FIRM EV (D-796) — evaluations priced on MEASURED day-clustered returns, block bootstrap (${PATHS} paths, block ${BLOCK}), sizes ${SIZES.join("/")}x account`);
console.log(`  Hard lines: no cross-firm hedging (ToS fraud); N accounts on one signal = ONE bet at Nx (correlated), not diversification.\n`);
for (const [setName, all] of Object.entries(SETS)) {
  const y26 = all.filter((d) => d.day >= "2026-01-01");
  for (const [label, ser] of [["OOS 2023+", all], ["2026-only (pessimistic)", y26]] as const) {
    const xs = ser.map((d) => d.ret); const s = stats(xs);
    console.log(`  == ${setName} — ${label}: ${s.n} event-days, mean ${bp(s.mean)}bp/day, sd ${bp(s.sd)}bp, day-t ${s.t.toFixed(2)}, ~${(s.n / Math.max(1, (Date.parse(ser[ser.length - 1]?.day ?? "2026-01-01") - Date.parse(ser[0]?.day ?? "2026-01-01")) / (365.25 * 86400e3))).toFixed(0)} event-days/yr`);
    if (s.n < 30) { console.log(`     too few event-days — UNTESTED`); continue; }
    for (const R of FIRMS) {
      if ((R.kind === "futures") !== setName.startsWith("FUTURES")) continue;
      console.log(`     ${R.name}: book ${R.book}, target ${R.target}${R.phase2Target ? `+${R.phase2Target}` : ""}, maxDD ${R.maxDD}${R.trailing ? " trailing" : " static"}, daily ${R.dailyLoss || "none"}, minDays ${R.minDays}, consistency ${R.consistency || "none"}, fee ${R.fee}, payout ${R.payout}`);
      console.log(`       size   P(pass)  med days  P(fail)  P(consist.)  fee/pass   funded $/mo  P(blow, ${FUNDED_MONTHS}mo)   EV per fee $   | NO-EDGE P(pass)`);
      for (const sz of SIZES) {
        TRIALS++;
        const notional = sz * R.book / exposureDiv(setName);   // equity: 5 overlapping 5-day positions -> concurrent exposure ≈ sz
        let sim = simulate(xs, R, notional, false, R.target);
        if (R.phase2Target && Number.isFinite(sim.pPass)) { const s2 = simulate(xs, R, notional, false, R.phase2Target); sim = { ...sim, pPass: sim.pPass * s2.pPass, medDays: sim.medDays + s2.medDays }; }
        const ne = simulate(xs, R, notional, true, R.target);
        const feePerPass = sim.pPass > 0 ? R.fee / sim.pPass : Infinity;
        const ev = sim.pPass > 0 && Number.isFinite(sim.fundedMonthly) ? (sim.pPass * sim.fundedMonthly * FUNDED_MONTHS - R.fee) / R.fee : NaN;
        console.log(`       ${String(sz).padStart(4)}x   ${(100 * sim.pPass).toFixed(0).padStart(4)}%   ${String(sim.medDays).padStart(5)}    ${(100 * sim.pFail).toFixed(0).padStart(4)}%     ${(100 * sim.pConsistencyFail).toFixed(0).padStart(4)}%    ${feePerPass === Infinity ? "   inf" : feePerPass.toFixed(0).padStart(6)}   ${Number.isFinite(sim.fundedMonthly) ? sim.fundedMonthly.toFixed(0).padStart(8) : "     n/a"}      ${Number.isFinite(sim.pBlowFunded) ? (100 * sim.pBlowFunded).toFixed(0).padStart(4) + "%" : "  n/a"}          ${Number.isFinite(ev) ? (ev >= 0 ? "+" : "") + ev.toFixed(2) : " n/a"}        |   ${(100 * ne.pPass).toFixed(0)}%`);
      }
    }
    console.log("");
  }
}
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "prop-firm-ev", runId: `pfe|${K.SPLIT}|${K.SIZES}`, spent: TRIALS });
console.log(`  TRIALS ${TRIALS} | ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()}`);
console.log(`  READ: "EV per fee $" = (P(pass) x funded $/mo x ${FUNDED_MONTHS} - fee) / fee. Positive means the fee is +EV under the MEASURED distribution; the NO-EDGE column is what the`);
console.log(`  firm is pricing (same variance, zero drift). A cell is only worth a real fee if it is +EV on the 2026-only rows too. Presets are typical published terms — verify.`);
