#!/usr/bin/env -S deno run --allow-net --allow-env
// monthly-crossasset.ts (D-675) — PREREG D-675-monthly-crossasset-causality.
//
// THE QUESTION THE TURNOVER LAW OPENS. D-599 killed cross-asset lead-lag at HOURLY frequency — 56 of 56 pairs
// sub-fee, the best effect 0.24x its round-trip cost. That is the hardest possible test: an hourly signal pays its
// cost roughly 2,000 times a year. D-656 established that cost scales with rebalance frequency, so the identical
// effect at MONTHLY frequency faces about 1/170th the annual cost. Whether that changes the verdict is a question
// the hourly null cannot answer, and nobody has asked it.
//
// WHAT THIS IS NOT. It is not a search for a big number. With N streams there are N*N ordered pairs and the best of
// them is selected from a large family, so the bar is the DEFLATION CEILING for the trials spent — currently ~5.41
// at 2.27M cumulative trials, and this search adds its own. A nominal t of 2 on the winner of a thousand pairs is
// noise with a good haircut, and D-457 is what happens when that is forgotten.
//
// THREE CONTROLS, EACH KILLING A DIFFERENT WAY TO BE WRONG:
//   own-lag      — B predicting itself, mislabelled as A predicting B
//   market-removal — both legs loading on one slow force, so the "lead" is shared beta
//   effect size  — the survivor must exceed 3x its round-trip cost, not merely be significant (D-429)
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("monthly-crossasset", [
  { name: "MIN_MONTHS", def: "180", note: "overlap floor per pair; 15 years" },
  { name: "COST_BP", def: "10", note: "round trip, monthly rebalance" },
  { name: "TOP_SHOW", def: "12" },
  { name: "EXCLUDE", def: "RF", note: "D-675: regex of stream names to drop. The first run's top 12 of 323,192 pairs were ALL risk-free-rate variants predicting one another — interest rates are persistent, which is not cross-asset causality. Excluding them finds the best pair that is actually about markets." },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mxa", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

// ---- load monthly streams ----
const series = new Map<string, Map<string, number>>();
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_ff_factors?select=factor,month,ret&order=factor,month&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { factor: string; month: string; ret: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    const v = Number(r.ret); if (!Number.isFinite(v)) continue;
    (series.get(r.factor) ?? series.set(r.factor, new Map()).get(r.factor)!).set(r.month.slice(0, 7), v);
  }
  if (rows.length < 50000) break;
}
assertNonEmpty("monthly streams", [...series.keys()], 50);

const MINM = Number(K.MIN_MONTHS), COST = Number(K.COST_BP) / 1e4;
// Keep only streams with enough history. A pair is only as long as its shorter leg.
const EXRE = K.EXCLUDE ? new RegExp(K.EXCLUDE) : null;
const usable = [...series.entries()].filter(([k, m]) => m.size >= MINM && !(EXRE && EXRE.test(k))).map(([k]) => k);
assertNonEmpty("streams with sufficient history", usable, 30);
console.log(`==> MONTHLY CROSS-ASSET LEAD-LAG — PREREG D-675`);
console.log(`    ${series.size} streams held, ${usable.length} with >= ${MINM} months`);

// The market stream, for the shared-beta control.
const MKT = series.get("Mkt-RF") ?? null;
console.log(`    market control stream: ${MKT ? `Mkt-RF, ${MKT.size} months` : "NOT AVAILABLE — market-removal control cannot run"}`);

interface Res { a: string; b: string; n: number; t: number; ann: number; tOwn: number; tExMkt: number }
const out: Res[] = [];
let pairs = 0;

// Strategy per ordered pair (A -> B): each month, take sign(A_t) * B_{t+1}. A positive mean means A's direction
// last month predicts B's next month. Cost is charged only when the SIGN CHANGES, because that is when a position
// actually turns over — charging every month would overstate cost by ~2x and is the D-662 error inverted.
for (const a of usable) {
  const A = series.get(a)!;
  for (const b of usable) {
    if (a === b) continue;
    const B = series.get(b)!;
    const months = [...A.keys()].filter((m) => B.has(m)).sort();
    if (months.length < MINM + 1) continue;
    const r: number[] = [], own: number[] = [], exm: number[] = [];
    let prevSign = 0;
    for (let i = 0; i < months.length - 1; i++) {
      const av = A.get(months[i])!, bv = B.get(months[i + 1])!;
      const sgn = Math.sign(av); if (sgn === 0) continue;
      const turned = sgn !== prevSign; prevSign = sgn;
      r.push(sgn * bv - (turned ? COST : 0));
      // control 1: B's OWN lagged sign instead of A's
      const bPrev = B.get(months[i]); if (bPrev !== undefined) own.push(Math.sign(bPrev) * bv);
      // control 2: same rule on market-removed legs
      if (MKT) {
        const ma = MKT.get(months[i]), mb = MKT.get(months[i + 1]);
        if (ma !== undefined && mb !== undefined) exm.push(Math.sign(av - ma) * (bv - mb) - (turned ? COST : 0));
      }
    }
    if (r.length < MINM) continue;
    pairs++;
    out.push({ a, b, n: r.length, t: tstat(r), ann: mean(r) * 12 * 100, tOwn: own.length ? tstat(own) : 0, tExMkt: exm.length ? tstat(exm) : 0 });
  }
}
assertNonEmpty("evaluated pairs", out, 100);

// EVERY PAIR IS A TRIAL. The ceiling must reflect what this search actually spent, and spendTrials refuses to
// return a ceiling it has not recorded (D-628).
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "xasset-monthly", runId: `xasset-monthly|${usable.length}streams|${MINM}m`, spent: pairs });
console.log(`    ${pairs.toLocaleString()} ordered pairs evaluated — each a trial`);
console.log(`    trial count ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()}  |  DEFLATION CEILING ${spend.ceiling.toFixed(4)}`);

out.sort((x, y) => Math.abs(y.t) - Math.abs(x.t));
console.log(`\n    top ${K.TOP_SHOW} by |t|  (bar is the ceiling above, NOT 2.0):`);
console.log(`    ${"lead".padEnd(18)}${"target".padEnd(18)}${"n".padStart(5)}${"t".padStart(8)}${"%/yr".padStart(9)}${"t own-lag".padStart(11)}${"t ex-mkt".padStart(10)}`);
for (const r of out.slice(0, Number(K.TOP_SHOW))) {
  console.log(`    ${r.a.padEnd(18)}${r.b.padEnd(18)}${String(r.n).padStart(5)}${r.t.toFixed(2).padStart(8)}${r.ann.toFixed(1).padStart(9)}${r.tOwn.toFixed(2).padStart(11)}${r.tExMkt.toFixed(2).padStart(10)}`);
}

const best = out[0];
const clears = Math.abs(best.t) > spend.ceiling;
const costMult = Math.abs(mean([best.ann / 1200])) / (COST || 1e-9);
console.log(`\n    PRE-REGISTERED GATES on the best pair (${best.a} -> ${best.b}):`);
console.log(`      (1) |t| ${Math.abs(best.t).toFixed(2)} > deflation ceiling ${spend.ceiling.toFixed(2)} ... ${clears ? "PASS" : "FAIL"}`);
console.log(`      (2) effect >= 3x round-trip cost ................... ${costMult >= 3 ? "PASS" : "FAIL"}  (${costMult.toFixed(2)}x)`);
console.log(`      (3) survives the target's own lag .................. ${Math.abs(best.t) > Math.abs(best.tOwn) ? "PASS" : "FAIL"}  (own-lag t ${best.tOwn.toFixed(2)})`);
console.log(`      (4) survives market removal ....................... ${Math.abs(best.tExMkt) >= 2 ? "PASS" : "FAIL"}  (ex-mkt t ${best.tExMkt.toFixed(2)})`);
console.log(`\n    ${clears && costMult >= 3 && Math.abs(best.t) > Math.abs(best.tOwn) && Math.abs(best.tExMkt) >= 2
  ? "ALL GATES PASS — forward registration warranted."
  : `NOT SUPPORTED. The best of ${pairs.toLocaleString()} pairs does not clear a ceiling that reflects ${pairs.toLocaleString()} trials.`}`);
