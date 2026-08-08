#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-osap-212 — test ALL 212 published predictors from Chen & Zimmermann's Open Source Asset Pricing
// (monthly long-short portfolio returns, reproduced from the original papers) against our gates.
//
// WHY THIS IS THE STRONGEST OOS TEST AVAILABLE: for each predictor we split at its ORIGINAL PAPER'S SAMPLE
// END. Everything after that date is data the authors never saw — a true out-of-sample period, not a
// re-slicing of the same history. This is the McLean-Pontiff design applied to the whole library at once.
//
// GATES APPLIED (ours + the literature's):
//   • |t| > 1.96  (conventional)      • |t| > 2.78  (Hou-Xue-Zhang multiple-test hurdle)
//   • |t| > 3.00  (Harvey-Liu-Zhu — "most claimed findings are likely false" without it)
//   • DECAY = post-sample mean ÷ in-sample mean (McLean-Pontiff measured 26-58% decay)
//   • SIGN STABILITY = does it keep the SAME sign in-sample and post-sample (our D-155 rule)
//   • RECENT ERA = last 10 years only — is it still alive TODAY, which is all that matters for trading
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const RET = "data/literature/PredictorLSretWide.csv", DOC = "data/literature/SignalDoc.csv";
// ---- load returns (wide: date, then one column per predictor) ----
const raw = (await Deno.readTextFile(RET)).trim().split("\n");
const hdr = raw[0].split(",");
const cols = hdr.slice(1);
const dates: string[] = []; const series: number[][] = cols.map(() => []);
for (let i = 1; i < raw.length; i++) {
  const p = raw[i].split(","); if (p.length !== hdr.length) continue;
  dates.push(p[0]);
  for (let c = 1; c < p.length; c++) { const v = p[c] === "" || p[c] === "NA" ? NaN : +p[c]; series[c - 1].push(v); }
}
// ---- load doc (publication year + original sample end + reported t-stat) ----
function parseCsv(t: string): Record<string, string>[] {
  const out: Record<string, string>[] = []; const rows: string[][] = []; let cur: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { cur.push(f); f = ""; }
    else if (ch === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; } else if (ch !== "\r") f += ch; }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const h = rows[0]; for (let i = 1; i < rows.length; i++) { const o: Record<string, string> = {}; h.forEach((k, j) => o[k] = rows[i][j] ?? ""); out.push(o); }
  return out;
}
const doc = parseCsv(await Deno.readTextFile(DOC));
const meta = new Map<string, { year: number; sampleEnd: number; tOrig: number; authors: string; cat: string; kind: string }>();
for (const r of doc) meta.set(r["Acronym"], { year: +r["Year"] || 0, sampleEnd: +r["SampleEndYear"] || 0, tOrig: +r["T-Stat"] || 0, authors: r["Authors"] ?? "", cat: r["Cat.Economic"] ?? "", kind: r["Cat.Signal"] ?? "" });
console.log(`OSAP 212-PREDICTOR TEST — ${cols.length} predictor columns, ${dates.length} months (${dates[0]} → ${dates[dates.length - 1]})\n`);
const tstat = (a: number[]) => { const v = a.filter(Number.isFinite); if (v.length < 24) return { t: NaN, m: NaN, n: v.length }; const s = sampleStd(v); return { t: s > 0 ? mean(v) / (s / Math.sqrt(v.length)) : NaN, m: mean(v), n: v.length }; };
interface R { name: string; authors: string; cat: string; tIn: number; mIn: number; tPost: number; mPost: number; nPost: number; decay: number; sameSign: boolean; tRecent: number; mRecent: number }
const rows: R[] = [];
const RECENT_FROM = "2015-01";
for (let c = 0; c < cols.length; c++) {
  const name = cols[c]; const m = meta.get(name); if (!m || !m.sampleEnd) continue;
  if (m.kind && m.kind !== "Predictor") continue; // exclude placebos
  const inS: number[] = [], post: number[] = [], recent: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const v = series[c][i]; if (!Number.isFinite(v)) continue;
    const y = +dates[i].slice(0, 4);
    if (y <= m.sampleEnd) inS.push(v); else post.push(v);
    if (dates[i] >= RECENT_FROM) recent.push(v);
  }
  const a = tstat(inS), b = tstat(post), r2 = tstat(recent);
  if (!Number.isFinite(a.t) || !Number.isFinite(b.t)) continue;
  rows.push({ name, authors: m.authors, cat: m.cat, tIn: a.t, mIn: a.m, tPost: b.t, mPost: b.m, nPost: b.n, decay: a.m !== 0 ? b.m / a.m : NaN, sameSign: Math.sign(a.m) === Math.sign(b.m), tRecent: r2.t, mRecent: r2.m });
}
console.log(`Testable predictors (have original sample-end + returns): ${rows.length}\n`);
const pct = (n: number) => `${(n / rows.length * 100).toFixed(0)}%`;
const inSig = rows.filter((r) => Math.abs(r.tIn) > 1.96).length;
console.log(`══ IN-SAMPLE (the authors' own period — should look great) ══`);
console.log(`   |t|>1.96: ${rows.filter((r) => Math.abs(r.tIn) > 1.96).length}/${rows.length} (${pct(inSig)})   mean monthly LS return ${mean(rows.map((r) => r.mIn)).toFixed(3)}%`);
console.log(`\n══ POST-PUBLICATION (data the authors NEVER SAW — the honest test) ══`);
for (const [lbl, thr] of [["|t|>1.96 (conventional)", 1.96], ["|t|>2.78 (Hou-Xue-Zhang)", 2.78], ["|t|>3.00 (Harvey-Liu-Zhu)", 3.0]] as [string, number][]) {
  const surv = rows.filter((r) => Math.abs(r.tPost) > thr && r.sameSign && r.mPost > 0 === r.mIn > 0);
  console.log(`   ${lbl.padEnd(26)} survive: ${String(surv.length).padStart(3)}/${rows.length}  (${pct(surv.length)})   FAIL RATE ${(100 - surv.length / rows.length * 100).toFixed(0)}%`);
}
const sameSign = rows.filter((r) => r.sameSign).length;
console.log(`   same sign in+post:         ${sameSign}/${rows.length} (${pct(sameSign)})  — ${(100 - sameSign / rows.length * 100).toFixed(0)}% FLIP SIGN entirely`);
const decays = rows.map((r) => r.decay).filter((x) => Number.isFinite(x) && Math.abs(x) < 10);
console.log(`   median decay (post ÷ in):  ${(decays.sort((a, b) => a - b)[Math.floor(decays.length / 2)] * 100).toFixed(0)}%  → ${(100 - decays[Math.floor(decays.length / 2)] * 100).toFixed(0)}% of the published edge is gone (McLean-Pontiff measured 26-58%)`);
console.log(`\n══ STILL ALIVE TODAY (2015→) — the only thing that matters for trading ══`);
for (const thr of [1.96, 3.0]) { const alive = rows.filter((r) => Math.abs(r.tRecent) > thr && Math.sign(r.mRecent) === Math.sign(r.mIn)); console.log(`   |t|>${thr.toFixed(2)} since 2015 AND right sign: ${alive.length}/${rows.length} (${pct(alive.length)})`); }
const alive3 = rows.filter((r) => Math.abs(r.tRecent) > 3 && Math.sign(r.mRecent) === Math.sign(r.mIn)).sort((a, b) => Math.abs(b.tRecent) - Math.abs(a.tRecent));
console.log(`\n   SURVIVORS at t>3 since 2015 (${alive3.length}):`);
for (const r of alive3.slice(0, 20)) console.log(`     ${r.name.padEnd(24)} ${r.authors.slice(0, 22).padEnd(22)} ${(r.cat || "").slice(0, 14).padEnd(14)} t_recent ${r.tRecent.toFixed(2).padStart(6)}  ${r.mRecent.toFixed(2)}%/mo  (orig t ${r.tIn.toFixed(1)})`);
console.log(`\n══ WORST DECAY — published stars that died ══`);
for (const r of rows.filter((x) => Math.abs(x.tIn) > 4).sort((a, b) => (a.decay || 0) - (b.decay || 0)).slice(0, 8)) console.log(`     ${r.name.padEnd(24)} orig t ${r.tIn.toFixed(1).padStart(5)} → post t ${r.tPost.toFixed(1).padStart(6)}  decay ${(r.decay * 100).toFixed(0)}%`);
console.log(`\nNOTE: post-publication split uses each paper's OWN sample end year, so the post period is genuinely`);
console.log(`unseen data. Expected false positives at |t|>1.96 with ${rows.length} tests ≈ ${(rows.length * 0.05).toFixed(0)}.`);
