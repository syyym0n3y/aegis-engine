// D-911 — train-only selection on the futures book, the selection-law-clean test of D-910's lead.
// D-910 saw index/rate/fx beat commodities on the FULL sample and refused to chase it. This does the only admissible
// test: a MECHANICAL rule applied on TRAIN (2005-2015) alone, frozen, measured on TEST (2016-2026), with a random
// same-size placebo to prove the selection carries information rather than re-picking full-sample winners (D-455).
// Everything is reconstructed from the proven per-asset series dumped by tsmom-book, so the construction is identical
// by definition and nothing is hand-picked. Breadth is reported prominently: a sub-floor book is a LEAD, not a
// promotable strategy, and no floor is lowered here (the D-910 lesson).
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fts", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sg = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sg)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const HDR = { Authorization: `Bearer ${await jwt()}`, apikey: await jwt(), "Content-Type": "application/json" };
const K = declareKnobs("futures-trainselect", [
  { name: "SERIES", def: "data/d911-futures-assets.json" },
  { name: "SPLIT", def: "2015-12-31", note: "fixed in the D-911 registration; train <= this, test after" },
  { name: "RF", def: "0.04" }, { name: "TARGET_X", def: "100000" },
  { name: "PLACEBO", def: "500" }, { name: "SEED", def: "20260914" },
  { name: "RUN_ID", def: "D-911-futures-trainselect-book" },
]);
const j = JSON.parse(await Deno.readTextFile(new URL(`../${K.SERIES}`, import.meta.url).pathname)) as { assets: Record<string, { cls: string; series: [string, number][] }> };
const syms = Object.keys(j.assets).sort();
assertNonEmpty("futures assets in the dump", syms, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const isTrain = (d: string) => d <= K.SPLIT, isTest = (d: string) => d > K.SPLIT;
// per-asset train/test maps
type A = { sym: string; cls: string; train: Map<string, number>; test: Map<string, number>; trainMean: number; trainSR: number };
const AS: A[] = [];
for (const s of syms) {
  const tr = new Map<string, number>(), te = new Map<string, number>();
  for (const [d, v] of j.assets[s].series) (isTrain(d) ? tr : te).set(d, v);
  const trv = [...tr.values()];
  AS.push({ sym: s, cls: j.assets[s].cls, train: tr, test: te, trainMean: mean(trv) * 252, trainSR: sd(trv) > 0 ? mean(trv) / sd(trv) * Math.sqrt(252) : 0 });
}
const testDays = [...new Set(AS.flatMap((a) => [...a.test.keys()]))].sort();
assertNonEmpty("test days", testDays, 500);
const trainDays = [...new Set(AS.flatMap((a) => [...a.train.keys()]))].sort();
if (trainDays.length < 1000) { console.error(`!! only ${trainDays.length} train days < 1000 — UNTESTED`); Deno.exit(1); }
// equal-weight subset book on the TEST window: each day, average the returns of selected assets active that day
function bookStats(sel: A[]) {
  const daily: number[] = [];
  for (const d of testDays) { let sum = 0, n = 0; for (const a of sel) { const v = a.test.get(d); if (v !== undefined) { sum += v; n++; } } if (n > 0) daily.push(sum / n); }
  const mu = mean(daily) * 252, vol = sd(daily) * Math.sqrt(252);
  let eq = 0, peak = 0, mdd = 0, uw = 0, mxuw = 0; for (const v of daily) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; mxuw = Math.max(mxuw, uw); } mdd = Math.min(mdd, eq - peak); }
  return { sr: vol > 0 ? mu / vol : 0, mu, vol, dd: Math.exp(mdd) - 1, uw: mxuw / 252, n: sel.length };
}
// train-window class-book Sharpe, to check whether the class tilt is stable across the split
function classSR(cls: string, which: "train" | "test") {
  const sub = AS.filter((a) => a.cls === cls); const days = which === "train" ? trainDays : testDays;
  const daily: number[] = []; for (const d of days) { let sum = 0, n = 0; for (const a of sub) { const v = a[which].get(d); if (v !== undefined) { sum += v; n++; } } if (n > 0) daily.push(sum / n); }
  return sd(daily) > 0 ? mean(daily) / sd(daily) * Math.sqrt(252) : 0;
}
console.log(`==> D-911 FUTURES TRAIN-SELECT — ${AS.length} contracts, train ${trainDays[0]}..${K.SPLIT} (${trainDays.length}d), test ${testDays[0]}..${testDays.at(-1)} (${testDays.length}d)`);
// internal positive control: reconstructing ALL 26 must reproduce tsmom-book's OOS number in the ballpark
const full = bookStats(AS);
console.log(`  INTERNAL CONTROL: full 26-contract book reconstructed on TEST -> Sharpe ${full.sr.toFixed(2)} (tsmom-book reported 0.11 over 2015+; a close match confirms the external build matches the proven machinery)\n`);
// TRAIN-window per asset, printed so the selection is auditable
console.log(`  PER-ASSET TRAIN (2005-${K.SPLIT.slice(0,4)}) mean %/yr [the selection input — nothing from TEST is used]:`);
for (const cls of ["index", "rate", "fx", "commodity"]) { const g = AS.filter((a) => a.cls === cls); if (!g.length) continue; console.log(`    ${cls.padEnd(10)} ${g.map((a) => `${a.sym.replace("=F","")}:${a.trainMean>=0?"+":""}${a.trainMean.toFixed(0)}`).join(" ")}`); }
// PRIMARY selection: positive train mean
const P = AS.filter((a) => a.trainMean > 0);
const Pstat = bookStats(P);
// SECONDARY: positive-train-class
const clsTrainMean: Record<string, number> = {}; for (const cls of new Set(AS.map((a) => a.cls))) { const g = AS.filter((a) => a.cls === cls); clsTrainMean[cls] = mean(g.flatMap((a) => [...a.train.values()])) * 252; }
const C = AS.filter((a) => clsTrainMean[a.cls] > 0);
const Cstat = bookStats(C);
console.log(`\n  SELECTION (frozen on train, measured on test):`);
const comp = (sel: A[]) => Object.entries(sel.reduce((m, a) => (m[a.cls] = (m[a.cls] ?? 0) + 1, m), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`    ${"book".padEnd(22)} ${"n".padStart(3)} ${"OOS Sharpe".padStart(11)} ${"%/yr".padStart(7)} ${"vol".padStart(6)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)}   composition`);
const row = (name: string, st: ReturnType<typeof bookStats>, sel: A[]) => console.log(`    ${name.padEnd(22)} ${String(st.n).padStart(3)} ${st.sr.toFixed(2).padStart(11)} ${(100*st.mu).toFixed(1).padStart(6)}% ${(100*st.vol).toFixed(1).padStart(5)}% ${(100*st.dd).toFixed(0).padStart(6)}% ${st.uw.toFixed(1).padStart(9)}y   ${comp(sel)}`);
row("full (no selection)", full, AS);
row("positive-train (P)", Pstat, P);
row("positive-train-class (C)", Cstat, C);
// PLACEBO: random same-size as P, is the selection informative? (D-455)
let seed = +K.SEED >>> 0; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const srs: number[] = [];
for (let p = 0; p < +K.PLACEBO; p++) { const idx = [...AS.keys()]; for (let i = idx.length - 1; i > 0; i--) { const jx = Math.floor(rnd() * (i + 1)); [idx[i], idx[jx]] = [idx[jx], idx[i]]; } srs.push(bookStats(idx.slice(0, P.length).map((i) => AS[i])).sr); }
srs.sort((a, b) => a - b);
const pctl = (p: number) => srs[Math.min(srs.length - 1, Math.floor(p * srs.length))];
const rank = srs.filter((x) => x < Pstat.sr).length / srs.length;
console.log(`\n  PLACEBO — ${K.PLACEBO} random ${P.length}-contract books on the SAME test window (is the selection informative, or D-455 hindsight?):`);
console.log(`    random-same-size OOS Sharpe: p10 ${pctl(0.1).toFixed(2)}  p50 ${pctl(0.5).toFixed(2)}  p90 ${pctl(0.9).toFixed(2)}  max ${srs.at(-1)!.toFixed(2)}`);
console.log(`    positive-train (P) OOS Sharpe ${Pstat.sr.toFixed(2)} sits at the ${(100*rank).toFixed(0)}th percentile of random same-size selections`);
// CLASS STABILITY train vs test
console.log(`\n  CLASS TILT STABILITY (per-class equal-weight book Sharpe):`);
for (const cls of ["index", "rate", "fx", "commodity"]) if (AS.some((a) => a.cls === cls)) console.log(`    ${cls.padEnd(10)} train ${classSR(cls,"train").toFixed(2).padStart(6)}   test ${classSR(cls,"test").toFixed(2).padStart(6)}`);
await spendTrials({ rest: OWNED, headers: HDR, family: "futures-trainselect", runId: K.RUN_ID, spent: 3 });
const ceil = await preregCeiling({ rest: OWNED, headers: HDR, preregId: K.RUN_ID });
// verdict
const beatsFull = Pstat.sr - full.sr;
const informative = rank >= 0.90;
console.log(`\n  BREADTH: the positive-train book holds ${P.length} contracts — below the 20-contract futures floor (D-910) and far below the 60-name general floor. Whatever follows, this is a LEAD, not a promotable book.`);
let verdict: string;
if (Pstat.sr < 0 || Pstat.sr <= full.sr) verdict = `NULL — train-selected OOS Sharpe ${Pstat.sr.toFixed(2)} ${Pstat.sr < 0 ? "is negative" : "does not beat the full book " + full.sr.toFixed(2)}`;
else if (!informative) verdict = `SELECTION-ADDS-NOTHING — ${Pstat.sr.toFixed(2)} sits at the ${(100*rank).toFixed(0)}th placebo percentile (< 90th): no better than a random ${P.length}-contract book. D-455 confirmed.`;
else if (beatsFull >= 0.25 && Pstat.dd > -0.50) verdict = `LEAD CONFIRMED (not promotable — breadth ${P.length}) — beats full by ${beatsFull.toFixed(2)} (>=0.25), ${(100*rank).toFixed(0)}th placebo pct (>=90th), maxDD ${(100*Pstat.dd).toFixed(0)}%`;
else if (Pstat.dd <= -0.50) verdict = `UNHOLDABLE — beats full and placebo but maxDD ${(100*Pstat.dd).toFixed(0)}% worse than -50%`;
else verdict = `MARGINAL — beats placebo but only ${beatsFull.toFixed(2)} over full (<0.25)`;
console.log(`  VERDICT: ${verdict}`);
console.log(`  (deflation ceiling for this id ${ceil.ceiling.toFixed(2)}; the OOS Sharpes above are book Sharpes, not t-stats)`);
