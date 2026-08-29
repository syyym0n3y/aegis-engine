#!/usr/bin/env -S deno run --allow-net --allow-env
// breadth-ushape-oos.ts (D-718b) — the pre-registered OOS test of the breadth U-shape (prereg D718-breadth-ushape).
//
// The U-shape (both breadth extremes outperform the middle in forward-20d return) was found POST-HOC on SPY and is
// therefore not claimable from that data. This registers as a genuine out-of-sample test: the SAME rule on three
// instruments never examined for this pattern — QQQ, IWM, DIA. The kill condition was written before this ran:
// the middle tercile (breadth deciles 4-7) must be LOWER than the average of the extreme terciles (D1-3, D8-10) on
// at least 2 of the 3 instruments, or the U-shape is decorative and dies.
//
// Every discipline from D-718 carries: TRAIN-only decile edges (SELECTION), rank-based so survivorship level-bias
// cancels, benchmark-aware. Overlapping-window t-inflation still applies, so the DECISION is on the sign/ordering of
// the tercile means, not on a t-stat — the pre-registered rule is deliberately about ordering, not significance.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("breadth-ushape-oos", [
  { name: "SERIES", def: "breadth_pct_gt_200dma_surv", note: "breadth series to condition on" },
  { name: "INSTRUMENTS", def: "QQQ,IWM,DIA", note: "held-out instruments (SPY was the discovery set)" },
  { name: "FWD", def: "20", note: "forward horizon in trading days" },
  { name: "TRAIN_FRAC", def: "0.6", note: "fraction used to fix decile edges" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bus", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

const brRows = await fetch(`${OWNED}/trd_macro_series?series=eq.${K.SERIES}&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.json()) as { d: string; v: number }[];
assertNonEmpty("breadth series", brRows, 1000);
const br = new Map(brRows.map((r) => [r.d, r.v]));
const FWD = Number(K.FWD), TF = Number(K.TRAIN_FRAC);

console.log(`==> BREADTH U-SHAPE, PRE-REGISTERED OOS TEST (prereg D718-breadth-ushape)`);
console.log(`    rule: middle tercile (deciles 4-7) forward-${FWD}d mean LOWER than extreme terciles (D1-3,D8-10) on >=2 of 3\n`);
console.log(`    ${"inst".padEnd(6)}${"n(test)".padStart(9)}${"extremes%".padStart(11)}${"middle%".padStart(10)}${"mid<ext?".padStart(10)}${"gap pp".padStart(9)}`);

let pass = 0, checked = 0;
for (const inst of K.INSTRUMENTS.split(",")) {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${inst}&select=bars`, { headers: hdr }).then((x) => x.json()) as { bars: number[][] }[];
  const bars = (raw[0]?.bars || []).filter((b) => b[4] > 0);
  if (bars.length < 500) { console.log(`    ${inst.padEnd(6)}  SKIP — insufficient bars`); continue; }
  const rows: { b: number; fwd: number }[] = [];
  for (let i = 0; i < bars.length - FWD; i++) { const bb = br.get(iso(bars[i][0])); if (bb == null) continue; rows.push({ b: bb, fwd: bars[i + FWD][4] / bars[i][4] - 1 }); }
  if (rows.length < 500) { console.log(`    ${inst.padEnd(6)}  SKIP — few aligned obs`); continue; }
  const split = Math.floor(rows.length * TF);
  const edges = rows.slice(0, split).map((r) => r.b).sort((a, b) => a - b);
  const q = (p: number) => edges[Math.min(edges.length - 1, Math.floor(p * edges.length))];
  const cut = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q);
  const decile = (b: number) => { let i = 0; while (i < cut.length && b > cut[i]) i++; return i; };
  const test = rows.slice(split);
  const extremes: number[] = [], middle: number[] = [];
  for (const r of test) { const dq = decile(r.b); if (dq <= 2 || dq >= 7) extremes.push(r.fwd); else if (dq >= 3 && dq <= 6) middle.push(r.fwd); }
  if (extremes.length < 30 || middle.length < 30) { console.log(`    ${inst.padEnd(6)}  SKIP — thin buckets`); continue; }
  const em = mean(extremes), mm = mean(middle); const midLower = mm < em;
  checked++; if (midLower) pass++;
  console.log(`    ${inst.padEnd(6)}${String(test.length).padStart(9)}${(em * 100).toFixed(2).padStart(11)}${(mm * 100).toFixed(2).padStart(10)}${(midLower ? "YES" : "no").padStart(10)}${((mm - em) * 100).toFixed(2).padStart(9)}`);
}

assertNonEmpty("instruments checked", Array(checked).fill(0), 2);
const verdict = pass >= 2;
console.log(`\n    ${pass} of ${checked} instruments show the middle LOWER than the extremes.`);
console.log(`    PRE-REGISTERED VERDICT: ${verdict ? "REPLICATES" : "KILLED"} — rule required >=2 of 3.`);
console.log(`    ${verdict
  ? "The U-shape survived a genuine out-of-sample test. Still CONDITIONING not edge (no costs/execution), and the"
  : "The U-shape was decorative — a SPY-specific artifact. Breadth carries no non-monotone forward information either,"}`);
console.log(`    ${verdict ? "next step is a pre-registered forward clock, not a position." : "and D-718's rejection of the monotone hypothesis stands as the whole story."}`);
console.log(`\n    Record the outcome against prereg D718-breadth-ushape (append-only; the label cannot later be softened).`);
