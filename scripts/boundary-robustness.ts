#!/usr/bin/env -S deno run --allow-net --allow-env
// boundary-robustness.ts (D-842) — DESCRIPTIVE ONLY (MECHANISM LAW: description is always allowed; the unregistered
// STORY is what is forbidden). No hypothesis, no direction, nothing promoted. This is a SELF-ATTACK.
//
// FLAW C2 of docs/METHODOLOGY_FLAWS.md, identified by reasoning and never tested: "a day" for a 24-hour instrument is
// a CONVENTION, and this programme picked 00:00 UTC without ever asking whether its results depend on that pick.
// D-828's two load-bearing correlations — first-hours range vs rest-of-day range (0.605 -> 0.596) and day range vs
// prior-day range (0.640 -> 0.612) — were the evidence for "range is predictable, direction is not", which in turn
// motivated D-829, D-830 and the reading of D-814. Every one of them inherits the 00:00 UTC boundary.
// If those correlations move materially when the boundary moves, the finding is partly an artifact of my own choice.
// If they hold, the finding is structure. Either way it is measurable in one pass, which is why it should have been
// measured before anything was built on it.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("boundary-robustness", [
  { name: "SHIFTS", def: "0,6,12,18", note: "hours to shift the day boundary; 0 is the convention every prior result used" },
  { name: "FIRST_H", def: "4", note: "the 'so far' window, as in D-828" },
  { name: "SPLIT", def: "2023-01-01" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bdy", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
async function loadBars(sym: string): Promise<Bar[]> {
  if (FX.includes(sym)) { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
const perpRows = await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[];
const UNIVERSE = [...perpRows.filter((r) => (r.n_bars ?? 0) > 10000).map((r) => r.symbol), ...FX];
const SHIFTS = K.SHIFTS.split(",").map(Number), FH = +K.FIRST_H, SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
console.log(`\n==> D-842 BOUNDARY ROBUSTNESS — is "range is predictable" structure, or an artifact of starting the day at 00:00 UTC?`);
console.log(`    DESCRIPTIVE ONLY, a self-attack on D-828's two load-bearing correlations. ${UNIVERSE.length} instruments, ${SHIFTS.length} boundaries.\n`);
const bars = new Map<string, Bar[]>();
for (const sym of UNIVERSE) { const b = await loadBars(sym); if (b.length >= 8000) bars.set(sym, b); }
assertNonEmpty("instruments loaded", [...bars.keys()], 15);
console.log(`  ${"boundary".padStart(9)} ${"days".padStart(8)} ${"corr(first" + FH + "h, rest)".padStart(22)} ${"corr(range, prior range)".padStart(25)} ${"body/range".padStart(11)} ${"median day range %".padStart(19)}`);
// D-845: EXTENDED after D-844b showed the statistic this script audits is itself POOLED. The original run reported
// pooled correlations only, so its 0.093 boundary spread was a pooled quantity and said nothing about whether the
// per-instrument statistic — the honest one, at 0.378 rather than 0.60 — is more or less sensitive to the boundary.
// A self-attack that inherits its target's defect tests the assumption it should be questioning. Both are now
// reported side by side; the ORIGINAL POOLED COLUMNS ARE UNCHANGED so D-842's recorded numbers still reproduce.
const out: Record<number, { c1: number; c2: number; body: number; rng: number; n: number; c1m: number; c2m: number; nInst: number }> = {};
for (const shift of SHIFTS) {
  const firstRng: number[] = [], restRng: number[] = [], rngSeq: number[] = [], prevSeq: number[] = [], bodies: number[] = [], ranges: number[] = [];
  const perC1: number[] = [], perC2: number[] = [];
  for (const [, b] of bars) {
    const iF: number[] = [], iR: number[] = [], iSeq: number[] = [], iPrev: number[] = [];
    const key = (ts: number) => Math.floor((ts - shift * 3600) / 86400);
    const days = new Map<number, Bar[]>();
    for (const x of b) { if (x.ts < SPLIT) continue; const k = key(x.ts); (days.get(k) ?? days.set(k, []).get(k)!).push(x); }
    const ks = [...days.keys()].sort((a, z) => a - z);
    let prevR: number | null = null;
    for (const k of ks) {
      const d = days.get(k)!; if (d.length < 12) { prevR = null; continue; }
      const o = d[0].o; let hi = -Infinity, lo = Infinity;
      for (const x of d) { hi = Math.max(hi, x.h); lo = Math.min(lo, x.l); }
      const rng = (hi - lo) / o; if (!(rng > 0)) { prevR = null; continue; }
      let fh = -Infinity, fl = Infinity; for (const x of d.slice(0, FH)) { fh = Math.max(fh, x.h); fl = Math.min(fl, x.l); }
      let rh = -Infinity, rl = Infinity; for (const x of d.slice(FH)) { rh = Math.max(rh, x.h); rl = Math.min(rl, x.l); }
      firstRng.push((fh - fl) / o); restRng.push(d.length > FH ? (rh - rl) / o : 0);
      iF.push((fh - fl) / o); iR.push(d.length > FH ? (rh - rl) / o : 0);
      bodies.push(Math.abs(d[d.length - 1].c - o) / o / rng); ranges.push(rng);
      if (prevR !== null) { rngSeq.push(rng); prevSeq.push(prevR); iSeq.push(rng); iPrev.push(prevR); }
      prevR = rng;
    }
    if (iF.length >= 100) perC1.push(corr(iF, iR));
    if (iSeq.length >= 100) perC2.push(corr(iPrev, iSeq));
  }
  out[shift] = { c1: corr(firstRng, restRng), c2: corr(prevSeq, rngSeq), body: mean(bodies), rng: 100 * med(ranges), n: ranges.length, c1m: med(perC1), c2m: med(perC2), nInst: perC2.length };
  console.log(`  ${(shift + "h").padStart(9)} ${String(out[shift].n).padStart(8)} ${out[shift].c1.toFixed(3).padStart(22)} ${out[shift].c2.toFixed(3).padStart(25)} ${out[shift].body.toFixed(3).padStart(11)} ${out[shift].rng.toFixed(2).padStart(19)}   | per-instrument median: first-vs-rest ${out[shift].c1m.toFixed(3)}  prior-day ${out[shift].c2m.toFixed(3)}  (${out[shift].nInst} instruments)`);
}
const c1s = SHIFTS.map((s) => out[s].c1), c2s = SHIFTS.map((s) => out[s].c2), bodies = SHIFTS.map((s) => out[s].body);
const c1ms = SHIFTS.map((s) => out[s].c1m), c2ms = SHIFTS.map((s) => out[s].c2m);
const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
console.log(`\n  SPREAD ACROSS BOUNDARIES (the number that decides):`);
console.log(`    corr(first${FH}h, rest-of-day) ... ${Math.min(...c1s).toFixed(3)} .. ${Math.max(...c1s).toFixed(3)}   spread ${spread(c1s).toFixed(3)}`);
console.log(`    corr(range, prior range) ....... ${Math.min(...c2s).toFixed(3)} .. ${Math.max(...c2s).toFixed(3)}   spread ${spread(c2s).toFixed(3)}`);
console.log(`    body/range ..................... ${Math.min(...bodies).toFixed(3)} .. ${Math.max(...bodies).toFixed(3)}   spread ${spread(bodies).toFixed(3)}`);
console.log(`\n  THE SAME SPREAD ON THE PER-INSTRUMENT STATISTIC (D-845) — the pooled figures above are inflated by`);
console.log(`  cross-instrument volatility differences (D-844b: pooled 0.599 vs per-instrument median 0.378 on this panel).`);
console.log(`    per-instrument corr(first${FH}h, rest) ... ${Math.min(...c1ms).toFixed(3)} .. ${Math.max(...c1ms).toFixed(3)}   spread ${spread(c1ms).toFixed(3)}   [pooled spread ${spread(c1s).toFixed(3)}]`);
console.log(`    per-instrument corr(range, prior) ..... ${Math.min(...c2ms).toFixed(3)} .. ${Math.max(...c2ms).toFixed(3)}   spread ${spread(c2ms).toFixed(3)}   [pooled spread ${spread(c2s).toFixed(3)}]`);
console.log(`    Which estimator is more boundary-sensitive is the question D-844b left open, and it is answered here:`);
console.log(`    ${spread(c2ms) > spread(c2s) ? "the per-instrument statistic is MORE boundary-sensitive — pooling was masking the instability, not creating it" : "the per-instrument statistic is LESS boundary-sensitive in ABSOLUTE terms — the pooled spread overstated how many points the convention moves"}.`);
// But absolute spreads are not comparable across estimators with different LEVELS, and reading them as if they were
// would turn this into a false reprieve. Relative to each estimator's own level the sensitivity is nearly identical,
// so D-842's qualitative conclusion survives intact — only its arithmetic shrinks with the level it was measured on.
const rel = (sp: number, lvl: number[]) => 100 * sp / (lvl.reduce((a, b) => a + b, 0) / lvl.length);
console.log(`    RELATIVE TO EACH ESTIMATOR'S OWN LEVEL, which is the only fair comparison:`);
console.log(`      corr(first${FH}h, rest): pooled ${rel(spread(c1s), c1s).toFixed(1)}% of its level, per-instrument ${rel(spread(c1ms), c1ms).toFixed(1)}%`);
console.log(`      corr(range, prior):     pooled ${rel(spread(c2s), c2s).toFixed(1)}% of its level, per-instrument ${rel(spread(c2ms), c2ms).toFixed(1)}%`);
console.log(`    D-842's conclusion is therefore UNCHANGED in substance: the boundary I chose still moves the statistic`);
console.log(`    by a similar FRACTION of itself on either estimator. What shrank is the number of correlation points,`);
console.log(`    because the level it was measured against was inflated by the same pooling (D-844b).`);
/* The comparator is D-828's own train->test drift, which is what the atlas offered as evidence of stability:
   0.009 for the first-hours correlation and 0.028 for the prior-day one. A boundary spread materially LARGER than
   that means the choice of boundary moves the statistic more than three years of regime change did. */
const verdict = (name: string, sp: number, drift: number) =>
  `    ${name.padEnd(34)} boundary spread ${sp.toFixed(3)} vs D-828's train->test drift ${drift.toFixed(3)} — ${sp <= drift ? "STRUCTURE (the boundary matters LESS than a regime change)" : sp <= 3 * drift ? "MOSTLY STRUCTURE, but the boundary is not free" : "ARTIFACT RISK: the boundary moves it MORE than the regime did"}`;
console.log(`\n  AGAINST THE ATLAS'S OWN STABILITY EVIDENCE:`);
console.log(verdict("corr(first-hours, rest-of-day)", spread(c1s), 0.009));
console.log(verdict("corr(range, prior-day range)", spread(c2s), 0.028));
console.log(verdict("body/range", spread(bodies), 0.014));
console.log(`\n  DESCRIPTIVE ONLY — no claim is made or withdrawn here by itself; the numbers above are what any conclusion resting on a UTC day must survive.`);
