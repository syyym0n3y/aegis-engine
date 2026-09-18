// D-939 — the IDIOSYNCRATIC-VOLATILITY and LOTTERY(MAX) anomalies as a candidate quality-AND-independent sleeve.
// Ang-Hodrick-Xing-Zhang (2006): high idiosyncratic vol -> LOW returns. Bali-Cakici-Whitelaw (2011): high MAX daily
// return -> LOW returns. Both are SHORT-SALE-CONSTRAINED mispricings (overpriced lottery stocks are hard to short),
// which is exactly the property that lets the distress short survive the liquid tercile where merger-arb, activist-13D
// and PEAD all died. Buildable from HELD bars only (no fetch). The test that decides a SLEEVE is not standalone Sharpe
// but CORRELATION to trend/long/cryptomom/distress (D-894: the worst standalone sleeve improved the blend, the best
// diluted it). Honors BENCHMARK (both legs' excess), LIQUIDITY (both halves), TURNOVER, breadth, pseudo-replication
// (t on the portfolio series, not across names).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("volatility-anomaly", [
  { name: "SIGNAL", def: "ivol", note: "ivol | max | totvol — which overpricing signal to sort on" },
  { name: "FORM_D", def: "60", note: "trailing sessions to estimate the signal" },
  { name: "REBAL_D", def: "21", note: "trading-day rebalance/hold step" },
  { name: "QUINTILE", def: "5", note: "long low / short high 1/QUINTILE within the liquid tercile" },
  { name: "COST_BP", def: "20" }, { name: "MIN_NAMES", def: "100" }, { name: "MAX_NAMES", def: "2200", note: "cap the universe by history length (memory) — the anomaly is a LIQUID-name effect, microcaps are not needed and OOM the loader" },
  { name: "CROWD_DC", def: "0", note: "D-939c AVOID-FILTER: if >0, drop SHORT-leg names whose point-in-time days-to-cover >= this (crowded short = expensive/unavailable borrow); the borrowable-majority deployment rule" },
  { name: "SI_LAG_D", def: "14", note: "publication lag on short-interest: a settlement is knowable ~T+10bd, so only use SI with settlement <= d - SI_LAG_D (no look-ahead)" },
  { name: "RUN_ID", def: "D-939-volatility-anomaly" }, { name: "DUMP", def: "0", note: "1 = write d939-<signal>-daily.json for the blend correlation test" },
  { name: "DUMP_SHORTS", def: "0", note: "1 = write d939-<signal>-shorts.json (recent short-leg names) for the INSTRUMENT-LAW borrow gate" }, { name: "SHORT_REBS", def: "24", note: "how many recent rebalances define the representative short-leg universe" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "va", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const FD = +K.FORM_D, RB = +K.REBAL_D, QN = +K.QUINTILE, cost = +K.COST_BP / 1e4, MINN = +K.MIN_NAMES;
// 1) load equity bars (held). Keep names with enough history and non-trivial liquidity.
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((m) => m.n_bars > 400).slice(0, +K.MAX_NAMES);
assertNonEmpty("equity names", meta, 200);
type Bar = { d: number; c: number; r: number; dv: number };
const S = new Map<string, Bar[]>();
for (let i = 0; i < meta.length; i += 40) { const page = meta.slice(i, i + 40);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); if (b.length < 400) continue;
    const arr: Bar[] = []; for (let j = 1; j < b.length; j++) arr.push({ d: Math.floor(b[j][0] / 86400), c: b[j][4], r: Math.log(b[j][4] / b[j - 1][4]), dv: b[j][4] * b[j][5] }); S.set(r.symbol.toUpperCase(), arr); }
}
console.log(`loaded ${S.size} equity names with >=400 bars`);
assertNonEmpty("priced names", [...S.keys()], 100);
// D-939c: point-in-time short-interest (days_cover) for the SHORT-leg borrow avoid-filter (held historical SI)
const siByName = new Map<string, { d: number; dc: number }[]>();
const CROWD = +K.CROWD_DC, SILAG = +K.SI_LAG_D;
if (CROWD > 0) {
  const syms = [...S.keys()];
  for (let i = 0; i < syms.length; i += 60) {
    const rows = await q(`trd_short_interest?symbol=in.(${syms.slice(i, i + 60).map(encodeURIComponent).join(",")})&select=symbol,settlement,days_cover`) as { symbol: string; settlement: string; days_cover: number }[];
    for (const r of rows) { if (!r.settlement || r.days_cover == null) continue; const s = r.symbol.toUpperCase(); (siByName.get(s) ?? siByName.set(s, []).get(s)!).push({ d: Math.floor(Date.parse(r.settlement + "T00:00:00Z") / 86400000), dc: +r.days_cover }); }
  }
  for (const [, a] of siByName) a.sort((x, y) => x.d - y.d);
  console.log(`  AVOID-FILTER on: short-interest for ${siByName.size}/${S.size} names; drop short-leg names with as-of days_cover >= ${CROWD} (SI publication lag ${SILAG}d, point-in-time)`);
}
let siMissing = 0;
const borrowOK = (sym: string, d: number): boolean => {
  if (CROWD <= 0) return true;
  const a = siByName.get(sym); if (!a || !a.length) { siMissing++; return true; } // no SI on a liquid name (rare) -> treat borrowable, counted
  let dc: number | null = null; for (const x of a) { if (x.d <= d - SILAG) dc = x.dc; else break; }
  return dc === null ? true : dc < CROWD;
};
// 2) common calendar + equal-weight market factor (for IVOL residual)
const allDays = new Set<number>(); for (const b of S.values()) for (const x of b) allDays.add(x.d);
const cal = [...allDays].sort((a, z) => a - z);
const idxOf = new Map<string, Map<number, number>>(); for (const [s, b] of S) { const m = new Map<number, number>(); b.forEach((x, i) => m.set(x.d, i)); idxOf.set(s, m); }
const mkt = new Map<number, number>(); for (const d of cal) { const rs: number[] = []; for (const [s, b] of S) { const i = idxOf.get(s)!.get(d); if (i !== undefined) rs.push(b[i].r); } if (rs.length >= 20) mkt.set(d, mean(rs)); }
// 3) signal per name at a rebalance day d (using the trailing FD sessions strictly before d)
function signal(sym: string, d: number): number | null {
  const b = S.get(sym)!; const idx = idxOf.get(sym)!; const i0 = idx.get(d); if (i0 === undefined || i0 < FD) return null;
  const win = b.slice(i0 - FD, i0); if (win.length < FD * 0.8) return null; const rs = win.map((x) => x.r);
  if (K.SIGNAL === "max") return Math.max(...win.slice(-21).map((x) => x.r));
  if (K.SIGNAL === "totvol") return sd(rs);
  // ivol: residual std from a single-factor (market) regression over the window
  const mr = win.map((x) => mkt.get(x.d) ?? 0); const mm = mean(mr), mrr = mean(rs);
  let cov = 0, vv = 0; for (let k = 0; k < rs.length; k++) { cov += (mr[k] - mm) * (rs[k] - mrr); vv += (mr[k] - mm) ** 2; }
  const beta = vv > 0 ? cov / vv : 0; const resid = rs.map((rk, k) => rk - beta * (mr[k] - mm) - mrr); return sd(resid);
}
const dvTrail = (sym: string, d: number): number => { const b = S.get(sym)!; const idx = idxOf.get(sym)!.get(d); if (idx === undefined) return 0; const w = b.slice(Math.max(0, idx - 60), idx); return w.length ? mean(w.map((x) => x.dv)) : 0; };
const pxAt = (sym: string, d: number): number | null => { const i = idxOf.get(sym)!.get(d); return i !== undefined ? S.get(sym)![i].c : null; };
// 4) monthly cross-section: long LOW-signal quintile, short HIGH-signal quintile, within the liquid tercile
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
type Reb = { d: number; longs: string[]; shorts: string[]; liqN: number };
const rebs: Reb[] = [];
for (let ci = 260; ci < cal.length; ci += RB) { const d = cal[ci];
  const cand: { s: string; sig: number; dv: number }[] = [];
  for (const s of S.keys()) { const sig = signal(s, d); if (sig === null || pxAt(s, d) === null) continue; cand.push({ s, sig, dv: dvTrail(s, d) }); }
  if (cand.length < MINN) continue;
  const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)];
  const liq = cand.filter((c) => c.dv >= volMed); if (liq.length < 50) continue;
  liq.sort((a, z) => a.sig - z.sig); const k = Math.max(5, Math.floor(liq.length / QN));
  const longs = liq.slice(0, k).map((c) => c.s); // long leg borrows nothing — unfiltered
  // short leg = highest-signal names that pass the borrow filter (walk down from the top), taking k
  const shorts: string[] = []; for (let j = liq.length - 1; j >= 0 && shorts.length < k; j--) if (borrowOK(liq[j].s, d)) shorts.push(liq[j].s);
  if (shorts.length < 5) continue;
  rebs.push({ d, longs, shorts, liqN: liq.length });
}
console.log(`\n==> D-939 VOLATILITY ANOMALY [${K.SIGNAL}] — long LOW / short HIGH within liquid tercile; ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`   ${rebs.length} rebalances, mean liquid universe ${Math.round(mean(rebs.map((r) => r.liqN)))}, leg ${Math.round(mean(rebs.map((r) => r.longs.length)))}${CROWD > 0 ? ` | AVOID-FILTER active (days_cover < ${CROWD}); short leg = borrowable-majority` : ""}`);
assertNonEmpty("rebalances", rebs, 24);
// 5) forward returns (long-short + per-leg excess vs liquid universe = BENCHMARK LAW) + liquidity halves + turnover
const fwd = (s: string, d0: number, d1: number): number | null => { const p0 = pxAt(s, d0), p1 = pxAt(s, d1); return p0 && p1 ? Math.log(p1 / p0) : null; };
const lsRaw: number[] = [], lsNet: number[] = [], longEx: number[] = [], shortEx: number[] = [], turn: number[] = [];
let prev = new Set<string>();
for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d;
  const uni = [...rebs[r].longs, ...rebs[r].shorts]; const uniR = uni.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null); if (!uniR.length) continue; const um = mean(uniR);
  const lr = rebs[r].longs.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null);
  const sr = rebs[r].shorts.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null);
  if (lr.length < 5 || sr.length < 5) continue;
  lsRaw.push(mean(lr) - mean(sr)); longEx.push(mean(lr) - um); shortEx.push(mean(sr) - um);
  const now = new Set(uni); const churn = prev.size ? [...now].filter((s) => !prev.has(s)).length / now.size : 1; turn.push(churn); prev = now;
  lsNet.push((mean(lr) - mean(sr)) - 2 * churn * cost);
}
const ann = 252 / RB;
const stat = (a: number[]) => { const mu = mean(a) * ann, s = sd(a) * Math.sqrt(ann); return { annPct: mu * 100, vol: s * 100, sr: mu / (s || 1), t: mean(a) / (sd(a) / Math.sqrt(a.length) || 1) }; };
const R = stat(lsRaw), N = stat(lsNet);
console.log(`  GROSS L-S: ${R.annPct.toFixed(1)}%/yr vol ${R.vol.toFixed(1)}% Sharpe ${R.sr.toFixed(2)} t ${R.t.toFixed(2)} (${lsRaw.length} rebs)`);
console.log(`  NET   L-S: ${N.annPct.toFixed(1)}%/yr Sharpe ${N.sr.toFixed(2)} t ${N.t.toFixed(2)} (cost ${K.COST_BP}bp, turnover ${(mean(turn)*100).toFixed(0)}%/reb)`);
console.log(`  BENCHMARK LAW (excess vs liquid universe): LONG(low-${K.SIGNAL}) ${(mean(longEx)*100).toFixed(2)}%/reb, SHORT(high-${K.SIGNAL}) ${(mean(shortEx)*100).toFixed(2)}%/reb (short should be NEGATIVE = lottery names underperform)`);
const survives = N.sr > 0 && Math.abs(N.t) > ceil.ceiling;
console.log(`  CLEARS NET PAST CEILING: ${survives ? "YES" : "NO"} (net t ${N.t.toFixed(2)} vs ${ceil.ceiling.toFixed(2)}) — but for a SLEEVE, correlation decides (D-894)`);
{ // D-943b: era-split (net L-S is chronological) — is the IVOL edge era-STEADY (persistent low-vol anomaly) or concentrated like distress?
  const em = Math.floor(lsNet.length / 2); const eE = stat(lsNet.slice(0, em)), eL = stat(lsNet.slice(em));
  console.log(`  ERA-SPLIT net SR: early ${eE.sr.toFixed(2)} (t ${eE.t.toFixed(2)}), late ${eL.sr.toFixed(2)} (t ${eL.t.toFixed(2)}) — IVOL should be steadier than distress (2016-21 ~1.1 vs 2021-26 ~4.5)`); }
await spendTrials({ rest: OWNED, headers: hdr, family: "volatility-anomaly", runId: K.RUN_ID, spent: 3 });
if ((Deno.env.get("HOLD_SWEEP") ?? "0") === "1") {
  // D-943: longer-horizon sweep — same formation (${FD}d) + avoid-filter, vary the HOLD/rebalance step. Longer hold =>
  // fewer rebalances => lower turnover cost; if net SR rises the edge is slow-moving and the 21d deploy is cost-bound.
  console.log(`\n  === HOLD-HORIZON SWEEP [${K.SIGNAL}] (formation ${FD}d fixed, avoid-filter ${CROWD > 0 ? "on" : "off"}) ===`);
  console.log(`  ${"hold".padStart(5)} ${"rebs".padStart(5)} ${"grossSR".padStart(8)} ${"netSR".padStart(7)} ${"net t".padStart(6)} ${"turn/reb".padStart(9)} ${"shortExcess".padStart(12)}`);
  for (const rb of [21, 42, 63, 126, 189, 252]) {
    const rbs: Reb[] = [];
    for (let ci = 260; ci < cal.length; ci += rb) { const d = cal[ci];
      const cand: { s: string; sig: number; dv: number }[] = [];
      for (const s of S.keys()) { const sig = signal(s, d); if (sig === null || pxAt(s, d) === null) continue; cand.push({ s, sig, dv: dvTrail(s, d) }); }
      if (cand.length < MINN) continue;
      const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)];
      const liq = cand.filter((c) => c.dv >= volMed); if (liq.length < 50) continue;
      liq.sort((a, z) => a.sig - z.sig); const k = Math.max(5, Math.floor(liq.length / QN));
      const longs = liq.slice(0, k).map((c) => c.s);
      const shorts: string[] = []; for (let j = liq.length - 1; j >= 0 && shorts.length < k; j--) if (borrowOK(liq[j].s, d)) shorts.push(liq[j].s);
      if (shorts.length < 5) continue; rbs.push({ d, longs, shorts, liqN: liq.length });
    }
    if (rbs.length < 12) { console.log(`  ${String(rb).padStart(5)}  too few rebalances`); continue; }
    const g: number[] = [], nn: number[] = [], se: number[] = [], tt: number[] = []; let pv = new Set<string>();
    for (let r = 0; r < rbs.length - 1; r++) { const d0 = rbs[r].d, d1 = rbs[r + 1].d;
      const uni = [...rbs[r].longs, ...rbs[r].shorts]; const uniR = uni.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null); if (!uniR.length) continue; const um = mean(uniR);
      const lr = rbs[r].longs.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null);
      const sr = rbs[r].shorts.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null);
      if (lr.length < 5 || sr.length < 5) continue;
      g.push(mean(lr) - mean(sr)); se.push(mean(sr) - um);
      const now = new Set(uni); const churn = pv.size ? [...now].filter((s) => !pv.has(s)).length / now.size : 1; tt.push(churn); pv = now;
      nn.push((mean(lr) - mean(sr)) - 2 * churn * cost);
    }
    const an = 252 / rb; const st2 = (a: number[]) => { const mu = mean(a) * an, s = sd(a) * Math.sqrt(an); return { sr: mu / (s || 1), t: mean(a) / (sd(a) / Math.sqrt(a.length) || 1) }; };
    const gs = st2(g), ns = st2(nn);
    console.log(`  ${String(rb).padStart(5)} ${String(g.length).padStart(5)} ${gs.sr.toFixed(2).padStart(8)} ${ns.sr.toFixed(2).padStart(7)} ${ns.t.toFixed(2).padStart(6)} ${(mean(tt) * 100).toFixed(0).padStart(8)}% ${(mean(se) * 100).toFixed(2).padStart(11)}%`);
  }
  console.log(`  READ: if net SR rises with the hold, the edge is slow-moving and the 21d deploy is cost-bound — the best hold is a deployable improvement.`);
}
if (K.DUMP === "1") {
  const daily: { d: string; ret: number }[] = [];
  for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d; const L = rebs[r].longs, Sh = rebs[r].shorts;
    for (let d = d0 + 1; d <= d1; d++) { const lr = L.map((s) => { const i = idxOf.get(s)!.get(d), j = idxOf.get(s)!.get(d - 1); return i !== undefined && j !== undefined ? S.get(s)![i].r : null; }).filter((x): x is number => x !== null);
      const sr = Sh.map((s) => { const i = idxOf.get(s)!.get(d); return i !== undefined ? S.get(s)![i].r : null; }).filter((x): x is number => x !== null);
      if (lr.length < 5 || sr.length < 5) continue; daily.push({ d: new Date(d * 86400000).toISOString().slice(0, 10), ret: mean(lr) - mean(sr) }); } }
  await Deno.writeTextFile(new URL(`../data/d939-${K.SIGNAL}-daily.json`, import.meta.url), JSON.stringify(daily));
  console.log(`  dumped ${daily.length} daily L-S returns -> data/d939-${K.SIGNAL}-daily.json`);
}
if (K.DUMP_SHORTS === "1") {
  // the representative short-leg universe = names appearing in the high-signal short leg over the last SHORT_REBS
  const last = rebs.slice(-Math.min(+K.SHORT_REBS, rebs.length)); const freq = new Map<string, number>();
  for (const r of last) for (const s of r.shorts) freq.set(s, (freq.get(s) ?? 0) + 1);
  const dLast = rebs[rebs.length - 1].d;
  const rows = [...freq.entries()].map(([sym, n]) => ({ sym, appearances: n, dollar_vol: Math.round(dvTrail(sym, dLast)), avg_excess_126d: 0 }));
  await Deno.writeTextFile(new URL(`../data/d939-${K.SIGNAL}-shorts.json`, import.meta.url), JSON.stringify(rows));
  // break-even borrow = the short leg's own annualized excess (what it earns by the names underperforming)
  const shortAnnPct = -mean(shortEx) * ann * 100; // positive: how much the short leg gains per year from underperformance
  console.log(`  dumped ${rows.length} recent short-leg names (last ${last.length} rebs) -> data/d939-${K.SIGNAL}-shorts.json`);
  console.log(`  SHORT-LEG break-even borrow = its annualized excess ~= ${shortAnnPct.toFixed(1)}%/yr (borrow below this = the short is economic)`);
}
console.log(`\n  READ: a quality-AND-independent 5th sleeve needs low correlation to the four sleeves AND to help the blend; a low-vol short is DEFENSIVE so watch its correlation to the distress short (both profit when bad names fall).`);
