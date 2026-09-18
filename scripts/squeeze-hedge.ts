// squeeze-hedge.ts (D-946) — a SQUEEZE HEDGE candidate for the 5-sleeve blend. D-945 showed the blend's worst tail is
// a distress+IVOL JOINT short-squeeze blowup (Jan-2021 meme squeeze: both short legs reverse together because both are
// "short the overpriced junk"), and that -13.9% drawdown is the blend's max. A hedge must PROFIT when the most-shorted
// junk rips. Construction: LONG the top-quintile by point-in-time DAYS-TO-COVER (the most-crowded shorts = squeeze fuel)
// within the liquid tercile, dollar-neutral vs the liquid universe mean (BENCHMARK LAW: the hedge return is the
// most-shorted basket's EXCESS over the universe — positive in a squeeze, negative in the body = the CARRY it costs).
//
// THE HONEST FRAME (stated before the numbers): a STATIC always-on long-junk hedge is algebraically the mirror of the
// distress/IVOL short leg, so overlaying $Y of it on a book short $X of junk gives net short $(X-Y) — IDENTICAL to just
// sizing the shorts down to $(X-Y), but with extra turnover and a full-time carry bleed. So a static hedge is DOMINATED
// by "short less" unless it is CONDITIONAL (long junk only when squeeze risk is elevated). This script measures the
// static hedge (carry, tail payoff, correlation to distress/IVOL) so the overlay in multistrategy-blend.ts can be
// judged against the short-less equivalence — it does NOT claim the static hedge is deployable.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("squeeze-hedge", [
  { name: "REBAL_D", def: "21", note: "trading-day rebalance/hold step" },
  { name: "QUINTILE", def: "5", note: "long the top 1/QUINTILE by days-to-cover within the liquid tercile" },
  { name: "COST_BP", def: "20" }, { name: "MIN_NAMES", def: "100" }, { name: "MAX_NAMES", def: "2200", note: "cap universe by history length (memory)" },
  { name: "SI_LAG_D", def: "14", note: "publication lag on short-interest: use SI with settlement <= d - SI_LAG_D (no look-ahead)" },
  { name: "MIN_DC", def: "0", note: ">0 = require the long-leg names to have days_cover >= this (a true squeeze target, not merely the top of a low-SI cross-section)" },
  { name: "RUN_ID", def: "D-946-squeeze-hedge" }, { name: "DUMP", def: "0", note: "1 = write d946-squeeze-daily.json for the blend overlay" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sqz", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const RB = +K.REBAL_D, QN = +K.QUINTILE, cost = +K.COST_BP / 1e4, MINN = +K.MIN_NAMES, SILAG = +K.SI_LAG_D, MINDC = +K.MIN_DC;
// 1) equity bars (held)
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
// 2) point-in-time days-to-cover (the squeeze signal). COVERAGE LAW: measure how many names carry SI before any verdict.
const siByName = new Map<string, { d: number; dc: number }[]>();
{ const syms = [...S.keys()];
  for (let i = 0; i < syms.length; i += 60) {
    const rows = await q(`trd_short_interest?symbol=in.(${syms.slice(i, i + 60).map(encodeURIComponent).join(",")})&select=symbol,settlement,days_cover`) as { symbol: string; settlement: string; days_cover: number }[];
    for (const r of rows) { if (!r.settlement || r.days_cover == null) continue; const s = r.symbol.toUpperCase(); (siByName.get(s) ?? siByName.set(s, []).get(s)!).push({ d: Math.floor(Date.parse(r.settlement + "T00:00:00Z") / 86400000), dc: +r.days_cover }); }
  }
  for (const [, a] of siByName) a.sort((x, y) => x.d - y.d);
}
const siCov = siByName.size / S.size;
console.log(`  COVERAGE: short-interest present for ${siByName.size}/${S.size} names (${(100 * siCov).toFixed(0)}%); signal = point-in-time days-to-cover (lag ${SILAG}d)`);
if (siCov < 0.5) { console.error(`!! SI coverage ${(100 * siCov).toFixed(0)}% < 50% — the days-to-cover cross-section is UNTESTED, not a hedge. Aborting.`); Deno.exit(1); }
const dcAt = (sym: string, d: number): number | null => { const a = siByName.get(sym); if (!a || !a.length) return null; let dc: number | null = null; for (const x of a) { if (x.d <= d - SILAG) dc = x.dc; else break; } return dc; };
// 3) calendar + liquidity helpers
const allDays = new Set<number>(); for (const b of S.values()) for (const x of b) allDays.add(x.d);
const cal = [...allDays].sort((a, z) => a - z);
const idxOf = new Map<string, Map<number, number>>(); for (const [s, b] of S) { const m = new Map<number, number>(); b.forEach((x, i) => m.set(x.d, i)); idxOf.set(s, m); }
const dvTrail = (sym: string, d: number): number => { const b = S.get(sym)!; const idx = idxOf.get(sym)!.get(d); if (idx === undefined) return 0; const w = b.slice(Math.max(0, idx - 60), idx); return w.length ? mean(w.map((x) => x.dv)) : 0; };
const pxAt = (sym: string, d: number): number | null => { const i = idxOf.get(sym)!.get(d); return i !== undefined ? S.get(sym)![i].c : null; };
// 4) monthly cross-section: LONG the highest-days-to-cover quintile within the liquid tercile (the most-crowded shorts)
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
type Reb = { d: number; longs: string[]; uni: string[]; liqN: number; meanDC: number };
const rebs: Reb[] = [];
for (let ci = 260; ci < cal.length; ci += RB) { const d = cal[ci];
  const cand: { s: string; dc: number; dv: number }[] = [];
  for (const s of S.keys()) { const dc = dcAt(s, d); if (dc === null || pxAt(s, d) === null) continue; cand.push({ s, dc, dv: dvTrail(s, d) }); }
  if (cand.length < MINN) continue;
  const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)];
  const liq = cand.filter((c) => c.dv >= volMed); if (liq.length < 50) continue;
  liq.sort((a, z) => a.dc - z.dc); const k = Math.max(5, Math.floor(liq.length / QN));
  let longs = liq.slice(liq.length - k).map((c) => c.s);         // top-DTC = most-shorted
  if (MINDC > 0) longs = liq.filter((c) => c.dc >= MINDC).slice(-k).map((c) => c.s);
  if (longs.length < 5) continue;
  rebs.push({ d, longs, uni: liq.map((c) => c.s), liqN: liq.length, meanDC: mean(liq.slice(liq.length - k).map((c) => c.dc)) });
}
console.log(`\n==> D-946 SQUEEZE HEDGE — LONG top-${QN}-tile days-to-cover (most-shorted) within liquid tercile, dollar-neutral vs universe`);
console.log(`   ${rebs.length} rebalances, mean liquid universe ${Math.round(mean(rebs.map((r) => r.liqN)))}, long leg ${Math.round(mean(rebs.map((r) => r.longs.length)))} names, mean days-to-cover of the leg ${mean(rebs.map((r) => r.meanDC)).toFixed(1)}`);
assertNonEmpty("rebalances", rebs, 24);
// 5) forward returns: hedge = mean(most-shorted longs) - mean(liquid universe) [BENCHMARK LAW: excess = the squeeze factor]
const fwd = (s: string, d0: number, d1: number): number | null => { const p0 = pxAt(s, d0), p1 = pxAt(s, d1); return p0 && p1 ? Math.log(p1 / p0) : null; };
type RebRet = { d0: string; hedge: number; turn: number };
const per: RebRet[] = []; const hExcess: number[] = []; let prev = new Set<string>();
for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d;
  const uniR = rebs[r].uni.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null); if (uniR.length < 20) continue; const um = mean(uniR);
  const lr = rebs[r].longs.map((s) => fwd(s, d0, d1)).filter((x): x is number => x !== null); if (lr.length < 5) continue;
  const now = new Set(rebs[r].longs); const churn = prev.size ? [...now].filter((s) => !prev.has(s)).length / now.size : 1; prev = now;
  hExcess.push(mean(lr) - um);
  per.push({ d0: new Date(d0 * 86400000).toISOString().slice(0, 10), hedge: (mean(lr) - um) - 2 * churn * cost, turn: churn });
}
const ann = 252 / RB;
const stat = (a: number[]) => { const mu = mean(a) * ann, s = sd(a) * Math.sqrt(ann); return { annPct: mu * 100, vol: s * 100, sr: mu / (s || 1), t: mean(a) / (sd(a) / Math.sqrt(a.length) || 1) }; };
const H = stat(per.map((p) => p.hedge)); const turn = mean(per.map((p) => p.turn));
console.log(`  NET hedge (most-shorted excess - cost): ${H.annPct.toFixed(1)}%/yr, Sharpe ${H.sr.toFixed(2)}, t ${H.t.toFixed(2)}, vol ${H.vol.toFixed(1)}%, turnover ${(100 * turn).toFixed(0)}%/reb (${per.length} rebs)`);
console.log(`  BENCHMARK LAW: most-shorted basket excess vs liquid universe = ${(mean(hExcess) * 100).toFixed(2)}%/reb (NEGATIVE = the carry; the most-shorted underperform in the body — this is the cost of the insurance)`);
console.log(`  CEILING: |t| ${Math.abs(H.t).toFixed(2)} vs ${ceil.ceiling.toFixed(2)} — a hedge is NOT judged on standalone Sharpe (it is expected to bleed); it is judged on its tail payoff + correlation to the short sleeves.`);
{ // era-split of the carry
  const em = Math.floor(per.length / 2); const eE = stat(per.slice(0, em).map((p) => p.hedge)), eL = stat(per.slice(em).map((p) => p.hedge));
  console.log(`  ERA-SPLIT net SR: early ${eE.sr.toFixed(2)} (t ${eE.t.toFixed(2)}), late ${eL.sr.toFixed(2)} (t ${eL.t.toFixed(2)})`); }
// 6) SQUEEZE-EPISODE diagnostic: the hedge's return in the known squeeze windows (does it actually pay when it must?)
const episodes: [string, string, string][] = [["Jan-Feb 2021 meme squeeze", "2021-01-01", "2021-02-28"], ["Q1 2021 reflation", "2021-01-01", "2021-03-31"], ["Aug 2022 meme wave", "2022-08-01", "2022-08-31"], ["2020 covid crash+rip", "2020-02-20", "2020-04-30"]];
console.log(`  SQUEEZE EPISODES (hedge total return in the window — must be POSITIVE when the shorts blow up):`);
for (const [name, a, b] of episodes) { const seg = per.filter((p) => p.d0 >= a && p.d0 <= b); if (!seg.length) { console.log(`    ${name.padEnd(28)} no rebalance in window`); continue; } const tot = seg.reduce((s, p) => s + p.hedge, 0); console.log(`    ${name.padEnd(28)} ${(100 * tot).toFixed(1).padStart(6)}%  (${seg.length} reb)`); }
await spendTrials({ rest: OWNED, headers: hdr, family: "squeeze-hedge", runId: K.RUN_ID, spent: 2 });
if (K.DUMP === "1") {
  // daily hedge series = mean(long most-shorted daily r) - mean(liquid universe daily r), held between rebalances
  const daily: { d: string; ret: number }[] = [];
  for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d; const L = rebs[r].longs, U = rebs[r].uni;
    for (let d = d0 + 1; d <= d1; d++) {
      const lr = L.map((s) => { const i = idxOf.get(s)!.get(d); return i !== undefined ? S.get(s)![i].r : null; }).filter((x): x is number => x !== null);
      const ur = U.map((s) => { const i = idxOf.get(s)!.get(d); return i !== undefined ? S.get(s)![i].r : null; }).filter((x): x is number => x !== null);
      if (lr.length < 5 || ur.length < 20) continue; daily.push({ d: new Date(d * 86400000).toISOString().slice(0, 10), ret: mean(lr) - mean(ur) }); } }
  await Deno.writeTextFile(new URL(`../data/d946-squeeze-daily.json`, import.meta.url), JSON.stringify(daily));
  console.log(`  dumped ${daily.length} daily hedge returns -> data/d946-squeeze-daily.json`);
}
console.log(`\n  READ: a hedge that bleeds in the body (negative carry) and pays in the squeeze is only worth its carry if the tail`);
console.log(`  protection beats simply SHORTING LESS (down-sizing distress+IVOL). The blend overlay (HEDGE_FRAC) settles that.`);
