#!/usr/bin/env -S deno run --allow-net --allow-env
// macro-regime-conditioning.ts (D-730) — does the macro regime CONDITION returns? The sharpest, most falsifiable
// version, and the one that validates the driver just unlocked (D-729): the clips call the REAL YIELD gold's #1
// driver. Test it two ways on held data:
//   (A) DRIVER VALIDATION (contemporaneous): is the daily gold return negatively correlated with the daily change in
//       the 10y real yield? If the driver is real, yes. This is a fact-check on the driver, not a strategy.
//   (B) SIGNAL TEST (forward): does the real-yield LEVEL/percentile condition FORWARD gold returns? benchmark vs the
//       unconditional mean (BENCHMARK LAW), decile edges fixed on TRAIN only (SELECTION LAW), overlapping windows so
//       the decision is on ordering/sign not on an inflated t.
// Also runs the analogue for SPY vs real yields (growth stocks hate high real yields) as a second instrument.
// Expected honest outcome per the programme's priors: a real contemporaneous relationship, a weak/no forward signal.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("macro-regime-conditioning", [
  { name: "FWD", def: "20", note: "forward horizon (trading days) for the signal test" },
  { name: "TRAIN_FRAC", def: "0.6", note: "fraction used to fix decile edges (SELECTION LAW)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mrc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
function corr(a: number[], b: number[]) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); }

async function closes(sym: string): Promise<Map<string, number>> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  const bars = (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
  return new Map(bars.map((b: number[]) => [iso(b[0]), b[4]]));
}
async function macro(name: string): Promise<Map<string, number>> {
  const r = await fetch(`${OWNED}/trd_macro_series?series=eq.${name}&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  return new Map((Array.isArray(r) ? r : []).map((x: { d: string; v: number }) => [x.d, x.v]));
}

const ry = await macro("real_yield_10y");
assertNonEmpty("real yield series", [...ry], 1000);
const FWD = Number(K.FWD), TF = Number(K.TRAIN_FRAC);
let totalSpecs = 0;

async function testInstrument(sym: string, expectSign: "neg" | "pos") {
  const px = await closes(sym);
  const dates = [...px.keys()].filter((d) => ry.has(d)).sort();
  if (dates.length < 500) { console.log(`  ${sym}: too few aligned days`); return; }
  // (A) contemporaneous: daily return vs daily real-yield CHANGE (in bp).
  const ret: number[] = [], dRY: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const p0 = px.get(dates[i - 1])!, p1 = px.get(dates[i])!;
    const y0 = ry.get(dates[i - 1])!, y1 = ry.get(dates[i])!;
    if (p0 > 0 && p1 > 0) { ret.push(Math.log(p1 / p0)); dRY.push(y1 - y0); }
  }
  const c = corr(ret, dRY);
  const matched = expectSign === "neg" ? c < 0 : c > 0;
  console.log(`\n  ${sym}: (A) corr(daily return, d[real yield]) = ${c.toFixed(3)}  [expected ${expectSign === "neg" ? "NEGATIVE" : "POSITIVE"}] -> ${matched ? "DRIVER CONFIRMED" : "prior MISSED"}`);

  // (B) forward: real-yield LEVEL deciles fixed on TRAIN, forward-FWD return, excess vs unconditional (BENCHMARK).
  const obs: { d: string; y: number; fwd: number }[] = [];
  for (let i = 0; i < dates.length - FWD; i++) {
    const d = dates[i]; const fi = dates.indexOf(d);   // dates is sorted; forward FWD trading days
    const dd = dates[i + FWD]; if (!dd) continue;
    obs.push({ d, y: ry.get(d)!, fwd: px.get(dd)! / px.get(d)! - 1 });
  }
  const split = Math.floor(obs.length * TF);
  const edges = obs.slice(0, split).map((o) => o.y).sort((a, b) => a - b);
  const q = (p: number) => edges[Math.min(edges.length - 1, Math.floor(p * edges.length))];
  const cut = [0.2, 0.4, 0.6, 0.8].map(q);
  const dec = (y: number) => { let i = 0; while (i < cut.length && y > cut[i]) i++; return i; };
  const test = obs.slice(split);
  const uncond = mean(test.map((o) => o.fwd));
  const buckets: number[][] = [[], [], [], [], []];
  for (const o of test) buckets[dec(o.y)].push(o.fwd);
  const lowRY = buckets[0], highRY = buckets[4];   // Q1 = lowest real yield (gold-supportive), Q5 = highest
  const exLow = lowRY.length ? (mean(lowRY) - uncond) * 100 : NaN, exHigh = highRY.length ? (mean(highRY) - uncond) * 100 : NaN;
  const tLowHigh = lowRY.length > 5 && highRY.length > 5 ? (mean(lowRY) - mean(highRY)) / Math.sqrt(sd(lowRY) ** 2 / lowRY.length + sd(highRY) ** 2 / highRY.length) : 0;
  console.log(`     (B) forward-${FWD}d on real-yield LEVEL, TEST n=${test.length}: uncond ${(uncond * 100).toFixed(2)}% | lowRY excess ${exLow.toFixed(2)}% | highRY excess ${exHigh.toFixed(2)}% | low-minus-high t=${tLowHigh.toFixed(2)}`);

  // (C) THE STATIONARITY CONTROL. The level is highly persistent (level ~ era), so (B) may be era-conditioning, not a
  // signal. Re-condition on the prior-FWD-day real-yield CHANGE (stationary). If the driver were a real forward
  // signal, FALLING real yields (Q1 of change) should precede HIGHER gold returns; if (B) was a level artifact, this
  // washes to ~null. Decile edges again TRAIN-only.
  const cobs: { y: number; fwd: number }[] = [];
  for (let i = FWD; i < dates.length - FWD; i++) { const dy = ry.get(dates[i])! - ry.get(dates[i - FWD])!; cobs.push({ y: dy, fwd: px.get(dates[i + FWD])! / px.get(dates[i])! - 1 }); }
  const csplit = Math.floor(cobs.length * TF);
  const cedges = cobs.slice(0, csplit).map((o) => o.y).sort((a, b) => a - b);
  const cq = (p: number) => cedges[Math.min(cedges.length - 1, Math.floor(p * cedges.length))];
  const ccut = [0.2, 0.4, 0.6, 0.8].map(cq);
  const cdec = (y: number) => { let i = 0; while (i < ccut.length && y > ccut[i]) i++; return i; };
  const ctest = cobs.slice(csplit); const cuncond = mean(ctest.map((o) => o.fwd));
  const cb: number[][] = [[], [], [], [], []]; for (const o of ctest) cb[cdec(o.y)].push(o.fwd);
  const fall = cb[0], rise = cb[4];   // Q1 = biggest FALL in real yield (should be gold-supportive if a real signal)
  const tFallRise = fall.length > 5 && rise.length > 5 ? (mean(fall) - mean(rise)) / Math.sqrt(sd(fall) ** 2 / fall.length + sd(rise) ** 2 / rise.length) : 0;
  console.log(`     (C) forward-${FWD}d on real-yield CHANGE (stationary): falling-RY excess ${((mean(fall) - cuncond) * 100).toFixed(2)}% | rising-RY excess ${((mean(rise) - cuncond) * 100).toFixed(2)}% | fall-minus-rise t=${tFallRise.toFixed(2)} ${Math.abs(tFallRise) < 2 ? "-> WASHES OUT (B was a level/era artifact)" : "-> survives the stationarity control"}`);
  totalSpecs += 3;
  return { sym, c, matched, tLowHigh, tFallRise };
}

console.log(`==> MACRO REGIME CONDITIONING — does the real yield condition its instruments? (D-729 driver in use)`);
await testInstrument("GC=F", "neg");   // gold: real yields UP -> gold DOWN (negative)
await testInstrument("SPY", "neg");    // growth equity: high real yields a headwind (weaker/negative)
await testInstrument("TLT", "neg");    // long bonds: yields up -> bond price down (mechanically negative)

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "macro-regime-conditioning", runId: `mrc|${totalSpecs}specs|fwd${FWD}`, spent: totalSpecs });
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`    (A) is a DRIVER FACT-CHECK — a real contemporaneous relationship validates the observable. (B) is the`);
console.log(`    SIGNAL test — a forward level-conditioning, benchmarked and train-split. STATE/validation, not an edge:`);
console.log(`    the contemporaneous relationship being real does not make the forward level tradable, and overlapping`);
console.log(`    windows inflate any forward t. Reported for the trustworthy verdict, not as a promotion.`);
