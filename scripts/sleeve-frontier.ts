// D-893 — the one route to more Sharpe that needs no new edge.
// D-892 reduced the mission to a single number: best holdable Sharpe 1.29, ten-year run needs 1.49, gap 0.20.
// For k MUTUALLY UNCORRELATED sleeves the optimal blend has Sharpe sqrt(sum S_i^2) — so diversification buys Sharpe
// outright. This measures whether the sleeves already on this record are uncorrelated enough for that to bite.
// THE SELECTION LAW governs the whole script: tangency weights are estimated on TRAIN ONLY and applied forward, and
// they are reported beside equal-weight and inverse-vol, which require no estimation and therefore cannot be overfit.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("sleeve-frontier", [
  { name: "SLEEVES", def: "isa:data/d873b-isa.json,cryptosf:data/d873b-cryptosf.json,tsmom:data/d893-tsmom-ls.json" },
  { name: "TRAIN_D", def: "504", note: "trading days of history the tangency weights may see; ~2 years" },
  { name: "STEP_D", def: "63", note: "re-estimate quarterly" },
  { name: "EXCLUDE_YEARS", def: "", note: "D-875 convention: drop these years before computing anything" },
  { name: "WINDOW", def: "common", note: "common = from the day every sleeve is live (the honest blend); union = every day any sleeve has data, mirroring scripts/pair-blend.ts so its 1.29 can be reproduced as a control" }, { name: "TARGET_SR", def: "1.49", note: "D-892's ten-year requirement; the number this is judged against" },
  { name: "RUN_ID", def: "D-893-sleeve-frontier" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = { Authorization: `Bearer ${await jwt()}`, "Content-Type": "application/json" };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
let ANN_REF = 252;
const SR = (a: number[]) => sd(a) > 0 ? mean(a) / sd(a) * Math.sqrt(ANN_REF) : 0;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : 0; };
const drop = new Set(K.EXCLUDE_YEARS.split(",").filter(Boolean));

const names: string[] = [], maps: Map<string, number>[] = [];
for (const spec of K.SLEEVES.split(",")) {
  const [n, path] = spec.split(":");
  const j = JSON.parse(await Deno.readTextFile(path)) as { series: Record<string, number> };
  const m = new Map<string, number>(); for (const [d, v] of Object.entries(j.series)) if (!drop.has(d.slice(0, 4))) m.set(d, v);
  names.push(n); maps.push(m);
}
// POSITIVE-CONTROL CORRECTION (D-641). The first version used the INTERSECTION of days and annualised at sqrt(252),
// and its control failed: the pair's own two legs gave 0.94 where scripts/pair-blend.ts reports 1.29 on the same files.
// The record's convention is the correct one for a book holding crypto: take the UNION of days, treat a day a sleeve
// does not trade as a FLAT day for that sleeve (return 0, which is what actually happens to the money), and annualise
// at the book's OWN observations per year rather than an assumed 252. Crypto trades ~365 days, equities ~252, and the
// blend of the two prints about 361. Using 252 on a 361-observation book understates the Sharpe by sqrt(361/252).
let days = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
// WINDOW=common starts the blend on the day the LAST sleeve comes alive. Before that day a sleeve does not exist, and
// the record's script splits weight into it anyway (its 0.5 fallback when trailing vol is 0), which quietly de-risks
// the 2020 crash and is worth about 0.12 of Sharpe on the pair. WINDOW=union reproduces that exactly, as the control.
if (K.WINDOW === "common") { const start = maps.map((m) => [...m.keys()].sort()[0]).sort().at(-1)!; days = days.filter((d) => d >= start); }
assertNonEmpty("union trading days across all sleeves", days, 500);
const R = names.map((_, i) => days.map((d) => maps[i].get(d) ?? 0));
const spanY = (Date.parse(days.at(-1)! + "T00:00:00Z") - Date.parse(days[0] + "T00:00:00Z")) / (365.25 * 864e5);
const ANN = days.length / Math.max(1e-9, spanY);
ANN_REF = ANN;
console.log(`==> D-893 SLEEVE FRONTIER — ${names.length} sleeves, ${days.length} ${K.WINDOW} days (${ANN.toFixed(0)} obs/yr) ${days[0]}..${days.at(-1)}${drop.size ? ` (excluding ${[...drop].join(",")})` : ""}`);
console.log();
console.log(`  sleeve       Sharpe    vol   %/yr`);
for (let i = 0; i < names.length; i++) console.log(`  ${names[i].padEnd(10)} ${SR(R[i]).toFixed(2).padStart(7)} ${(100 * sd(R[i]) * Math.sqrt(ANN)).toFixed(1).padStart(6)}% ${(100 * mean(R[i]) * ANN).toFixed(1).padStart(6)}%`);
console.log();
console.log(`  CORRELATIONS — reported before any blend statistic, because a blend of correlated sleeves is a different`);
console.log(`  object from a blend of uncorrelated ones, and the blend Sharpe alone would not say which this is.`);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) console.log(`    ${names[i]} vs ${names[j]}: ${corr(R[i], R[j]).toFixed(3)}`);
const ceiling = Math.sqrt(names.reduce((s, _, i) => s + SR(R[i]) ** 2, 0));
console.log(`\n  THEORETICAL CEILING if the sleeves were mutually uncorrelated: sqrt(sum S^2) = ${ceiling.toFixed(2)}`);

// inverse-vol and equal weight need no estimation and so cannot be overfit
const blend = (w: number[]) => days.map((_, t) => names.reduce((s, _n, i) => s + w[i] * R[i][t], 0));
const eqW = names.map(() => 1 / names.length);
const ivRaw = names.map((_, i) => 1 / (sd(R[i]) || 1e-9)); const ivS = ivRaw.reduce((a, b) => a + b, 0); const ivW = ivRaw.map((x) => x / ivS);
// tangency on a window: w ∝ Sigma^-1 mu, long-only clipped and renormalised (a short sleeve is not a holdable book)
function tangency(win: number[][]): number[] {
  const k = win.length; const mu = win.map(mean);
  const C: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => { const a = win[i], b = win[j]; const ma = mean(a), mb = mean(b); let c = 0; for (let t = 0; t < a.length; t++) c += (a[t] - ma) * (b[t] - mb); return c / Math.max(1, a.length - 1) + (i === j ? 1e-12 : 0); }));
  for (let i = 0; i < k; i++) C[i][i] *= 1.10;   // ridge on the diagonal: a 3x3 covariance from ~2 years of daily data is noisy
  const M = C.map((r, i) => [...r, mu[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-18) return eqW;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; } }
  const w = M.map((r, i) => r[k] / r[i]);
  const cl = w.map((x) => Math.max(0, x)); const s = cl.reduce((a, b) => a + b, 0);
  return s > 1e-12 ? cl.map((x) => x / s) : eqW;
}
// walk-forward: weights see TRAIN only and are applied to the next STEP days, never to the days that chose them
const wfRet: number[] = []; const wfUsed: number[][] = [];
for (let s0 = +K.TRAIN_D; s0 < days.length; s0 += +K.STEP_D) {
  const tr = R.map((r) => r.slice(s0 - +K.TRAIN_D, s0));
  const w = tangency(tr); wfUsed.push(w);
  for (let t = s0; t < Math.min(s0 + +K.STEP_D, days.length); t++) wfRet.push(names.reduce((s, _n, i) => s + w[i] * R[i][t], 0));
}
const bestSingle = Math.max(...names.map((_, i) => SR(R[i])));
// the record's own scheme (pair-blend.ts): DYNAMIC risk parity on trailing 60-day sleeve vol, recomputed every day.
// It is included because it is what produced the 1.29 this test is judged against, and comparing against a different
// construction would be comparing two things, not one.
const parity: number[] = [];
for (let t = 0; t < days.length; t++) {
  const vs = R.map((r) => { const w = r.slice(Math.max(0, t - 60), t); return t > 40 ? sd(w) : 0; });
  // mirror pair-blend.ts exactly: if ANY sleeve has zero trailing vol the scheme falls back to equal weight
  const w = vs.every((v) => v > 0) ? (() => { const iv = vs.map((v) => 1 / v); const tot = iv.reduce((a, b) => a + b, 0); return iv.map((x) => x / tot); })() : eqW;
  parity.push(names.reduce((s2, _n, i) => s2 + w[i] * R[i][t], 0));
}
const rows: [string, number[]][] = [["equal weight", blend(eqW)], ["inverse vol (static)", blend(ivW)], ["risk parity (the record's)", parity], ["walk-forward tangency", wfRet]];
console.log(`\n  blend                     Sharpe    vol   %/yr   vs best single   vs D-892's ${K.TARGET_SR}`);
for (const [label, r] of rows) {
  const s = SR(r);
  console.log(`  ${label.padEnd(24)} ${s.toFixed(2).padStart(6)} ${(100 * sd(r) * Math.sqrt(ANN)).toFixed(1).padStart(6)}% ${(100 * mean(r) * ANN).toFixed(1).padStart(6)}%   ${(s - bestSingle >= 0 ? "+" : "") + (s - bestSingle).toFixed(2).padStart(6)}        ${s >= +K.TARGET_SR ? "CLEARS" : (s - +K.TARGET_SR).toFixed(2) + " short"}`);
}
// D-895: a single long-run Sharpe hides exactly the instability this kind of test exists to find, so the blend is also
// decomposed by calendar block. Reported regardless of outcome, as the registration requires.
{
  const parBy = new Map<string, number[]>();
  for (let t = 0; t < days.length; t++) { const y = +days[t].slice(0, 4); const blk = `${Math.floor(y / 5) * 5}-${Math.floor(y / 5) * 5 + 4}`; (parBy.get(blk) ?? parBy.set(blk, []).get(blk)!).push(parity[t]); }
  const blocks = [...parBy.keys()].sort();
  console.log(`\n  RISK-PARITY BLEND BY CALENDAR BLOCK (the single number above averages over all of these):`);
  for (const b of blocks) { const x = parBy.get(b)!; console.log(`    ${b}  n ${String(x.length).padStart(5)}  Sharpe ${SR(x).toFixed(2).padStart(6)}  ${(100 * mean(x) * ANN).toFixed(1).padStart(6)}%/yr`); }
  const yrBy = new Map<string, number[]>();
  for (let t = 0; t < days.length; t++) { const y = days[t].slice(0, 4); (yrBy.get(y) ?? yrBy.set(y, []).get(y)!).push(parity[t]); }
  console.log(`    by year: ` + [...yrBy.keys()].sort().map((y) => `${y} ${SR(yrBy.get(y)!).toFixed(1)}`).join(" | "));
}
const avgW = names.map((_, i) => mean(wfUsed.map((w) => w[i])));
console.log(`\n  mean walk-forward weights: ${names.map((n, i) => `${n} ${(100 * avgW[i]).toFixed(0)}%`).join(", ")} over ${wfUsed.length} re-estimations`);
// how many more sleeves of the observed average quality would close the gap
const best = Math.max(...rows.map(([, r]) => SR(r)));
const avgS = mean(names.map((_, i) => SR(R[i])));
let need = 0; for (let n = 0; n < 40; n++) { if (Math.sqrt(best * best + n * avgS * avgS) >= +K.TARGET_SR) { need = n; break; } }
console.log(`  TO CLOSE THE GAP: at the observed average sleeve Sharpe of ${avgS.toFixed(2)}, reaching ${K.TARGET_SR} from ${best.toFixed(2)} needs ${need} more sleeve(s) that are UNCORRELATED with these — and "uncorrelated" is the load-bearing word, as the matrix above shows.`);
await spendTrials({ rest: OWNED, headers: hdr, family: "sleeve-frontier", runId: `${K.RUN_ID}${drop.size ? "-ex" + [...drop].join("") : ""}`, spent: 4 });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`  ceiling ${ceil.ceiling.toFixed(2)} (trial-count deflation; the blend Sharpes above are not t-statistics and are reported with their day counts)`);
