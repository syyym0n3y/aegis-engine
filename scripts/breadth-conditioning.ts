#!/usr/bin/env -S deno run --allow-net --allow-env
// breadth-conditioning.ts (D-718) — is the breadth we just built (D-717) INFORMATIVE about forward equity-index
// returns, or is it decorative? A conditioning variable earns its place only if the tape behaves differently across
// its range. This is the test that decides whether breadth may enter any point-in-time confidence view at all.
//
// THE HYPOTHESIS, stated so it can lose. The folklore is a "washout": when almost nothing is above its 200dma the
// market is oversold and forward returns are high; when almost everything is, it is overbought and forward returns
// are low. If true, mean forward return falls monotonically across breadth deciles. If breadth is noise, the deciles
// are flat within error.
//
// THE DISCIPLINES THAT KEEP THIS HONEST:
//  - BENCHMARK (D-627): every conditional mean is reported beside the UNCONDITIONAL mean over the same span. A decile
//    that merely rises with the market's drift is drift, not information.
//  - SELECTION (D-455): no threshold is chosen on the full sample. The decile edges are computed on TRAIN only and
//    applied to TEST, so a monotone pattern that survives is out-of-sample, and the split is reported.
//  - SURVIVORSHIP (D-717): breadth LEVEL is biased up (dead names absent), so an absolute edge like "below 0.10" is
//    not portable. The test therefore uses RANK deciles within the train window, which are invariant to a level
//    shift — the one construction that survives the bias.
//  - This is a CONDITIONING test, not a strategy. A monotone relationship is information about the state of the tape;
//    it is NOT a claim of tradable edge, which would require costs, execution, and the whole gate stack. The whole
//    programme's prior is that nothing clears those, and this test does not pretend otherwise.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("breadth-conditioning", [
  { name: "SERIES", def: "breadth_pct_gt_200dma_surv", note: "which breadth series to condition on" },
  { name: "INDEX", def: "SPY", note: "the equity-index whose forward return we measure" },
  { name: "FWD", def: "20", note: "forward horizon in trading days" },
  { name: "TRAIN_FRAC", def: "0.6", note: "fraction of the span used to fix the decile edges" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "brc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

// Breadth series: date -> value.
const brRows = await fetch(`${OWNED}/trd_macro_series?series=eq.${K.SERIES}&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.json()) as { d: string; v: number }[];
assertNonEmpty(`breadth series ${K.SERIES}`, brRows, 1000);
const br = new Map(brRows.map((r) => [r.d, r.v]));

// Index closes.
const idxRaw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${K.INDEX}&select=bars`, { headers: hdr }).then((x) => x.json()) as { bars: number[][] }[];
const bars = (idxRaw[0]?.bars || []).filter((b) => b[4] > 0);
assertNonEmpty(`${K.INDEX} bars`, bars, 500);

// Align: for each index day that has a breadth reading and a forward bar FWD days out, record (breadth, fwdReturn).
const FWD = Number(K.FWD);
const rows: { d: string; b: number; fwd: number }[] = [];
for (let i = 0; i < bars.length - FWD; i++) {
  const d = iso(bars[i][0]); const b = br.get(d);
  if (b == null) continue;
  rows.push({ d, b, fwd: bars[i + FWD][4] / bars[i][4] - 1 });
}
assertNonEmpty("aligned observations", rows, 500);

// SELECTION LAW: fix decile edges on TRAIN, apply to TEST. Split chronologically.
const split = Math.floor(rows.length * Number(K.TRAIN_FRAC));
const train = rows.slice(0, split), test = rows.slice(split);
const edges = [...train].map((r) => r.b).sort((a, b) => a - b);
const q = (p: number) => edges[Math.min(edges.length - 1, Math.floor(p * edges.length))];
const cut = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q);
const decile = (b: number) => { let i = 0; while (i < cut.length && b > cut[i]) i++; return i; };

const uncondTest = mean(test.map((r) => r.fwd));
console.log(`==> BREADTH CONDITIONING — does ${K.SERIES} inform ${K.INDEX} forward-${FWD}d return?`);
console.log(`    ${rows.length} obs ${rows[0].d}..${rows[rows.length - 1].d}  |  train ${train.length} / TEST ${test.length}  |  decile edges fixed on TRAIN`);
console.log(`    unconditional TEST forward-${FWD}d mean: ${(uncondTest * 100).toFixed(2)}%\n`);
console.log(`    ${"decile".padEnd(8)}${"breadth range".padEnd(16)}${"n".padStart(6)}${"fwd%".padStart(9)}${"EXCESS vs uncond".padStart(18)}${"t(excess)".padStart(11)}`);

const byDec: { fwd: number }[][] = Array.from({ length: 10 }, () => []);
for (const r of test) byDec[decile(r.b)].push({ fwd: r.fwd });
const means: number[] = [];
for (let dq = 0; dq < 10; dq++) {
  const g = byDec[dq]; if (!g.length) { means.push(NaN); continue; }
  const fwds = g.map((x) => x.fwd);
  const ex = fwds.map((x) => x - uncondTest);
  const lo = dq === 0 ? 0 : cut[dq - 1], hi = dq === 9 ? 1 : cut[dq];
  means.push(mean(fwds));
  console.log(`    ${("D" + (dq + 1)).padEnd(8)}${`${lo.toFixed(2)}-${hi.toFixed(2)}`.padEnd(16)}${String(g.length).padStart(6)}${(mean(fwds) * 100).toFixed(2).padStart(9)}${((mean(fwds) - uncondTest) * 100).toFixed(2).padStart(18)}${tstat(ex).toFixed(2).padStart(11)}`);
}

// Is the relationship MONOTONE across the range? Rank-correlate decile index with mean forward return, on TEST.
const valid = means.map((m, i) => ({ i, m })).filter((x) => Number.isFinite(x.m));
const n = valid.length;
const di = valid.map((_, i) => i), dm = valid.map((x) => x.m);
const rankCorr = (() => {
  const rk = (a: number[]) => { const s = [...a].map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); s.forEach(([, i], j) => r[i as number] = j); return r; };
  const ri = rk(di), rm = rk(dm); const mi = mean(ri), mm = mean(rm);
  let num = 0, di2 = 0, dm2 = 0;
  for (let i = 0; i < n; i++) { num += (ri[i] - mi) * (rm[i] - mm); di2 += (ri[i] - mi) ** 2; dm2 += (rm[i] - mm) ** 2; }
  return num / (Math.sqrt(di2 * dm2) || 1e-12);
})();

// Top-vs-bottom decile spread, the sharpest single statement, on TEST with its t.
const bottom = byDec[0].map((x) => x.fwd), top = byDec[9].map((x) => x.fwd);
const spread = mean(bottom) - mean(top);
const spreadT = (mean(bottom) - mean(top)) / Math.sqrt((sd(bottom) ** 2 / bottom.length) + (sd(top) ** 2 / top.length) || 1e-12);
console.log(`\n    MONOTONICITY (Spearman of decile vs forward return, TEST): ${rankCorr.toFixed(2)}  ${rankCorr < -0.6 ? "-> washout pattern holds OOS" : rankCorr > 0.6 ? "-> INVERTED (momentum, not reversion)" : "-> NOT MONOTONE — weak/none"}`);
console.log(`    D1(low breadth) minus D10(high breadth) forward-${FWD}d: ${(spread * 100).toFixed(2)}%  t=${spreadT.toFixed(2)}  (n ${bottom.length}/${top.length})`);
console.log(`\n    READ THIS AS CONDITIONING, NOT EDGE. A monotone OOS relationship means breadth carries information about`);
console.log(`    the STATE of the tape — a legitimate input to a point-in-time confidence view. It is NOT a tradable`);
console.log(`    signal: no costs, no execution, no borrow are modelled here, and forward-${FWD}d overlapping windows`);
console.log(`    inflate |t|. The programme's prior that nothing clears the gates is unchanged by this test.`);
console.log(`    And the breadth level is SURVIVORSHIP-BIASED (D-717) — only the rank ordering used here is portable.`);
