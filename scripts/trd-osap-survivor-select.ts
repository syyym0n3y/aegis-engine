#!/usr/bin/env -S deno run --allow-read
// trd-osap-survivor-select — THE decisive question about the whole anomaly library: if you SELECT the
// predictors that are still working, do they keep working? Or is survivor-selection itself the illusion?
// (This is the trap that killed D-149's frequency winner and D-152's instrument cherry-picking.)
//
// HONEST PROTOCOL — selection and evaluation are strictly time-separated:
//   1. SELECT using data ONLY up to a cutoff (e.g. through 2014): keep predictors that are post-publication
//      significant at |t|>thr with the right sign, using nothing after the cutoff.
//   2. EVALUATE those exact predictors on the untouched period after the cutoff (2015-2024).
//   3. COMPARE against (a) a random selection of the same size, (b) the full 212-predictor average.
//   If selected ≈ random, "picking the survivors" adds nothing and the library is untradable.
// Also tests an equal-weight PORTFOLIO of the selected predictors (diversification across anomalies).
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const RET = "data/literature/PredictorLSretWide.csv", DOC = "data/literature/SignalDoc.csv";
let seed = 424242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const raw = (await Deno.readTextFile(RET)).trim().split("\n");
const hdr = raw[0].split(","); const cols = hdr.slice(1);
const dates: string[] = []; const series: number[][] = cols.map(() => []);
for (let i = 1; i < raw.length; i++) { const p = raw[i].split(","); if (p.length !== hdr.length) continue; dates.push(p[0]); for (let c = 1; c < p.length; c++) series[c - 1].push(p[c] === "" || p[c] === "NA" ? NaN : +p[c]); }
function parseCsv(t: string): Record<string, string>[] { const rows: string[][] = []; let cur: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { cur.push(f); f = ""; } else if (ch === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; } else if (ch !== "\r") f += ch; }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const h = rows[0]; return rows.slice(1).map((r) => { const o: Record<string, string> = {}; h.forEach((k, j) => o[k] = r[j] ?? ""); return o; }); }
const doc = parseCsv(await Deno.readTextFile(DOC));
const meta = new Map(doc.map((r) => [r["Acronym"], { end: +r["SampleEndYear"] || 0, kind: r["Cat.Signal"] ?? "", auth: r["Authors"] ?? "" }]));
const tstat = (a: number[]) => { const v = a.filter(Number.isFinite); if (v.length < 24) return NaN; const s = sampleStd(v); return s > 0 ? mean(v) / (s / Math.sqrt(v.length)) : NaN; };
const CUT = "2015-01";
interface P { name: string; selT: number; selM: number; evalRet: number[]; }
const all: P[] = [];
for (let c = 0; c < cols.length; c++) {
  const m = meta.get(cols[c]); if (!m || !m.end || (m.kind && m.kind !== "Predictor")) continue;
  const sel: number[] = [], ev: number[] = [];
  for (let i = 0; i < dates.length; i++) { const v = series[c][i]; if (!Number.isFinite(v)) continue;
    const y = +dates[i].slice(0, 4);
    if (dates[i] < CUT) { if (y > m.end) sel.push(v); }   // SELECTION: post-publication, pre-cutoff only
    else ev.push(v);                                       // EVALUATION: untouched
  }
  if (sel.length < 36 || ev.length < 60) continue;
  all.push({ name: cols[c], selT: tstat(sel), selM: mean(sel), evalRet: ev });
}
console.log(`SURVIVOR-SELECTION TEST — does picking the anomalies that still work actually work?\n`);
console.log(`Predictors with enough data: ${all.length}   selection window: post-publication → ${CUT}   evaluation: ${CUT} → 2024-12\n`);
const evalStats = (set: P[]) => {
  if (!set.length) return { t: NaN, m: NaN, n: 0 };
  const L = Math.min(...set.map((p) => p.evalRet.length));
  const port: number[] = [];
  for (let i = 0; i < L; i++) { let s = 0, k = 0; for (const p of set) { const v = p.evalRet[p.evalRet.length - L + i]; if (Number.isFinite(v)) { s += v; k++; } } if (k) port.push(s / k); }
  return { t: tstat(port), m: mean(port), n: port.length };
};
console.log(`${"selection rule".padEnd(34)} ${"picked".padStart(7)} ${"OOS mean%/mo".padStart(13)} ${"OOS t".padStart(7)}  verdict`);
for (const thr of [1.96, 2.5, 3.0]) {
  const sel = all.filter((p) => Math.abs(p.selT) > thr && p.selM > 0);
  const st = evalStats(sel);
  const rnds: number[] = [];
  for (let it = 0; it < 200; it++) { const shuf = [...all].sort(() => rnd() - 0.5).slice(0, sel.length); rnds.push(evalStats(shuf).m); }
  const rMean = mean(rnds), rSd = sampleStd(rnds);
  const z = rSd > 0 ? (st.m - rMean) / rSd : NaN;
  console.log(`${`selT>${thr} & positive`.padEnd(34)} ${String(sel.length).padStart(7)} ${st.m.toFixed(4).padStart(13)} ${st.t.toFixed(2).padStart(7)}  vs random-pick ${rMean.toFixed(4)} (z=${z.toFixed(2)}) ${z > 2 ? "✓ selection ADDS value" : "✗ selection adds NOTHING over random"}`);
}
const allSt = evalStats(all);
console.log(`${"ALL 212 (no selection)".padEnd(34)} ${String(all.length).padStart(7)} ${allSt.m.toFixed(4).padStart(13)} ${allSt.t.toFixed(2).padStart(7)}`);
// per-predictor: did the selected ones individually hold?
const sel2 = all.filter((p) => Math.abs(p.selT) > 2.5 && p.selM > 0);
const held = sel2.filter((p) => tstat(p.evalRet) > 1.96 && mean(p.evalRet) > 0).length;
const baseHeld = all.filter((p) => tstat(p.evalRet) > 1.96 && mean(p.evalRet) > 0).length;
console.log(`\nPER-PREDICTOR follow-through (evaluated 2015-2024, |t|>1.96 & positive):`);
console.log(`   among SELECTED (selT>2.5): ${held}/${sel2.length} = ${(held / sel2.length * 100).toFixed(0)}%`);
console.log(`   among ALL predictors:      ${baseHeld}/${all.length} = ${(baseHeld / all.length * 100).toFixed(0)}%`);
console.log(`   → selection ${held / sel2.length > baseHeld / all.length * 1.3 ? "IMPROVES the hit rate" : "does NOT meaningfully improve the hit rate"}`);
console.log(`\nREAD: if the selected portfolio's OOS return is indistinguishable from a RANDOM pick of the same size,`);
console.log(`then "trade the anomalies that still work" is itself an illusion — the same trap as D-149/D-152.`);

// ── EFFECTIVE-BETS CHECK: are 200 "distinct" anomalies actually independent? (mirrors D-154's 45→2.6) ──
console.log(`\n══ IS THE t=3.92 REAL, OR INFLATED BY CORRELATION AMONG PREDICTORS? ══`);
{
  const L = 120; // last 10y of evaluation
  const mat: number[][] = all.map((p) => p.evalRet.slice(-L)).filter((r) => r.length === L && r.every(Number.isFinite));
  const n = mat.length;
  const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let s = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; da += x * x; db += y * y; } return (da > 0 && db > 0) ? s / Math.sqrt(da * db) : 0; };
  let q = 0, sum = 0, k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const c = i === j ? 1 : corr(mat[i], mat[j]); q += c / (n * n); if (i < j) { sum += c; k++; } }
  const eff = 1 / q;
  console.log(`   predictors with complete 10y history: ${n}`);
  console.log(`   average pairwise correlation: ${(sum / k).toFixed(3)}`);
  console.log(`   EFFECTIVE NUMBER OF INDEPENDENT ANOMALIES: ${eff.toFixed(1)} out of ${n}`);
  console.log(`   → the equal-weight portfolio's t=3.92 rests on ~${eff.toFixed(0)} independent bets, not ${n}.`);
  console.log(`   → ${eff < 10 ? "the 'anomaly zoo' is mostly ONE factor wearing 200 costumes" : "genuine breadth exists"}`);
}

// ── IMPLEMENTABILITY: Hou-Xue-Zhang's central critique — is the effect a MICROCAP/equal-weight artifact? ──
console.log(`\n══ IS IT TRADABLE? equal-weight (microcap-heavy) vs value-weight (liquid) ══`);
{
  const wmap = new Map(doc.map((r) => [r["Acronym"], (r["Stock Weight"] ?? "").trim().toUpperCase()]));
  const groups: Record<string, P[]> = { EW: [], VW: [] };
  for (const p of all) { const w = wmap.get(p.name); if (w === "EW") groups.EW.push(p); else if (w === "VW") groups.VW.push(p); }
  for (const [g, set] of Object.entries(groups)) {
    if (set.length < 5) { console.log(`   ${g}: only ${set.length} predictors`); continue; }
    const st = evalStats(set);
    console.log(`   ${g === "EW" ? "EQUAL-weight (incl. microcaps)" : "VALUE-weight (liquid, tradable) "} n=${String(set.length).padStart(3)}  OOS ${st.m.toFixed(4)}%/mo  t=${st.t.toFixed(2)}  ${st.t > 2 ? "✓ significant" : "✗ not significant"}`);
  }
  const ew = evalStats(groups.EW), vw = evalStats(groups.VW);
  if (Number.isFinite(ew.m) && Number.isFinite(vw.m)) {
    console.log(`   → VW is ${(vw.m / (ew.m || 1) * 100).toFixed(0)}% of EW.  ${vw.t > 2 ? "The effect SURVIVES in liquid value-weighted form." : "The effect is LARGELY A MICROCAP ARTIFACT — Hou-Xue-Zhang's critique confirmed."}`);
    console.log(`   NOTE: even the VW figure is GROSS. Monthly rebalancing of long-short deciles across a broad`);
    console.log(`   cross-section, with shorting costs, plausibly consumes a large share of ${vw.m.toFixed(3)}%/mo.`);
  }
}
