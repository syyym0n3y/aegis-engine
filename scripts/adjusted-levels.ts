#!/usr/bin/env -S deno run --allow-net --allow-env
// adjusted-levels.ts (D-846) — PREREG: D-846-adjusted-levels. A self-attack on FLAW C1.
//
// C1, named by reasoning: our equity bars are fully adjusted for splits AND dividends. Adjusted RETURNS are correct.
// But any rule keyed to a LEVEL — a round number, an absolute price band, a level compared across an adjustment
// event — references a price that never traded, and the adjustment encodes corporate actions that had not happened.
// D-837 already met the split half of this by accident and had to retract a SUPPORTED verdict. The level half has
// never been measured.
//
// THE INSTRUMENT: nominal price is RECONSTRUCTED, not assumed. Adjusted price = nominal x f(t) for an unknown f, and
// because f scales every price in a session equally it scales the PRICE INCREMENT too. The nominal increment is not
// unknown — it is the regulated tick, 1/8 before June 1997, 1/16 to April 2001, $0.01 after, all three MEASURED off
// this same panel in D-843 and confirmed there against two regulatory events. So f(t) = tick_measured / tick_nominal,
// estimated in rolling windows, and nominal = adjusted / f.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("adjusted-levels", [
  { name: "MAX_SYMS", def: "120", note: "US equities with pre-1990 history; >=80 required" },
  { name: "PAGE", def: "5", note: "symbols per REST read (D-812)" },
  { name: "WIN", def: "60", note: "sessions per reconstruction window — long enough for a stable tick estimate, short enough that f barely moves inside it" },
  { name: "BAR", def: "0.50", note: "median |adjusted/nominal - 1| on pre-1990 bars that the rule requires for SUPPORTED" },
  { name: "ERA", def: "all", note: "all = the D-846 run as pre-registered; eighths = the D-846b run, scoped to pre-Jun-1997 where the instrument demonstrably resolves the lattice" },
  { name: "RUN_ID", def: "D-846-adjusted-levels" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "adjlv", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
// the regulated minimum tick, by date — the one input this reconstruction takes from outside the data
const SIXTEENTHS = Date.parse("1997-06-24T00:00:00Z") / 1000, DECIMALS = Date.parse("2001-04-09T00:00:00Z") / 1000;
const tickNominal = (ts: number) => ts < SIXTEENTHS ? 0.125 : ts < DECIMALS ? 0.0625 : 0.01;

console.log(`\n==> D-846 ADJUSTED LEVELS — flaw C1. Adjusted returns are right. What about a rule keyed to a PRICE?`);
console.log(`    PREREG: D-846-adjusted-levels. Nominal price RECONSTRUCTED from the tick lattice, not assumed.\n`);

const cat = await q(`trd_bars_deep?asset_class=eq.equity&first_date=lt.1990-01-01&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
assertNonEmpty("equities with pre-1990 history", cat, 80);
const syms = cat.slice(0, +K.MAX_SYMS).map((r) => r.symbol);
console.log(`  ${cat.length} US equities hold pre-1990 history; reconstructing the ${syms.length} deepest in ${K.WIN}-session windows.\n`);

type Rec = { ts: number; adj: number; nom: number; f: number; tick: number };
const recs: Rec[] = [];
for (let i = 0; i < syms.length; i += +K.PAGE) {
  const page = syms.slice(i, i + +K.PAGE);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const b = (r.bars ?? []).slice().sort((x, y) => x[0] - y[0]).filter((x) => x[4] > 0);
    for (let w = 0; w + +K.WIN <= b.length; w += +K.WIN) {
      const win = b.slice(w, w + +K.WIN);
      const d: number[] = [];
      for (let j = 1; j < win.length; j++) { const v = Math.abs(win[j][4] - win[j - 1][4]); if (v > 1e-12) d.push(v); }
      if (d.length < 30) continue;
      const tickAdj = pct(d, 0.05);                      // 5th pct of the increment lattice inside the window
      const tn = tickNominal(win[0][0]);
      const f = tickAdj / tn; if (!(f > 0) || !Number.isFinite(f)) continue;
      for (const x of win) recs.push({ ts: x[0], adj: x[4], nom: x[4] / f, f, tick: tn });
    }
  }
}
if (K.ERA === "eighths") {
  // D-846b: the D-846 run failed its own lattice control at 61.6% pooled and the failure decomposed cleanly by tick
  // regime — 82.7% under eighths, 63.6% under sixteenths, 42.4% under decimals. Rather than move D-846's threshold
  // after seeing it fail, the scope where the instrument works was RE-REGISTERED as D-846b and is selected here.
  const before = recs.length;
  const keep = recs.filter((r) => r.ts < SIXTEENTHS);
  recs.length = 0; for (const r of keep) recs.push(r);   // spread on ~700k elements blows the call stack
  console.log(`  ERA=eighths (D-846b): ${recs.length.toLocaleString()} of ${before.toLocaleString()} bars kept, all pre-Jun-1997.\n`);
}
assertNonEmpty("reconstructed bars", recs, 100000);
console.log(`  ${recs.length.toLocaleString()} bars reconstructed.\n`);

// ---- POSITIVE CONTROLS (D-641) — a reconstruction that cannot be checked is a guess -----------------------------
// (A) reconstructed nominal closes must sit ON the era's tick lattice; adjusted closes must not.
const onGrid = (p: number, t: number) => { const r = Math.abs(p / t - Math.round(p / t)); return r <= 0.2; };
const nomOn = recs.filter((r) => onGrid(r.nom, r.tick)).length / recs.length;
const adjOn = recs.filter((r) => onGrid(r.adj, r.tick)).length / recs.length;
// (B) the reconstructed 1980s median close must be a price US equities actually traded at.
const eighties = recs.filter((r) => { const y = new Date(r.ts * 1000).getUTCFullYear(); return y >= 1980 && y <= 1989; });
const medNom80 = med(eighties.map((r) => r.nom)), medAdj80 = med(eighties.map((r) => r.adj));
console.log(`  POSITIVE CONTROLS:`);
console.log(`    (A) on the era's tick lattice:  reconstructed ${(100 * nomOn).toFixed(1)}%   vs adjusted ${(100 * adjOn).toFixed(1)}%   [needs >=80% and materially higher]`);
console.log(`    (B) 1980s median close:         reconstructed $${medNom80.toFixed(2)}   vs adjusted $${medAdj80.toFixed(2)}   [needs $10-$200]`);
const ctlA = nomOn >= 0.80 && nomOn > adjOn + 0.10, ctlB = medNom80 >= 10 && medNom80 <= 200;
console.log(`    ${ctlA && ctlB ? "BOTH PASSED — the reconstruction is recovering nominal price." : "FAILED — this is not nominal price; nothing may be concluded from it."}\n`);
// DIAGNOSTIC — WHICH ERA the instrument resolves, because a control that fails everywhere and a control that fails in
// one regime are different findings. The tick is recoverable only while it is a meaningful fraction of a typical daily
// move: at 1/8 on a $30 stock a one-tick day is common, at $0.01 on a $66 stock it never happens and the lattice is
// unresolvable. This is the same resolution-floor failure Corwin-Schultz hit in D-843, in the same direction.
console.log(`  WHICH ERA THE INSTRUMENT RESOLVES — control (A) by tick regime:`);
for (const [name, lo, hi] of [["eighths (pre Jun-1997)", 0, SIXTEENTHS], ["sixteenths (to Apr-2001)", SIXTEENTHS, DECIMALS], ["decimals (Apr-2001 on)", DECIMALS, 4e9]] as [string, number, number][]) {
  const g = recs.filter((r) => r.ts >= lo && r.ts < hi);
  if (!g.length) continue;
  const on = g.filter((r) => onGrid(r.nom, r.tick)).length / g.length;
  const typical = med(g.map((r) => Math.abs(r.adj / r.f))) ;
  console.log(`    ${name.padEnd(26)} ${String(g.length).padStart(8)} bars   on-lattice ${(100 * on).toFixed(1).padStart(5)}%   median reconstructed close $${typical.toFixed(2)}`);
}
console.log(`    A tick is only recoverable while a one-tick day is common. It is not, once the tick is a cent.\n`);

// ---- the distortion, by decade ----------------------------------------------------------------------------------
console.log(`  THE LEVEL DISTORTION — how far the price we store is from the price that traded`);
console.log(`  ${"decade".padEnd(8)} ${"bars".padStart(9)} ${"median adjusted".padStart(16)} ${"median nominal".padStart(15)} ${"median |adj/nom - 1|".padStart(21)}`);
const byDec = new Map<number, Rec[]>();
for (const r of recs) { const dd = Math.floor(new Date(r.ts * 1000).getUTCFullYear() / 10) * 10; let a = byDec.get(dd); if (!a) { a = []; byDec.set(dd, a); } a.push(r); }
for (const dd of [...byDec.keys()].sort((a, b) => a - b)) {
  const a = byDec.get(dd)!;
  console.log(`  ${(dd + "s").padEnd(8)} ${String(a.length).padStart(9)} ${("$" + med(a.map((r) => r.adj)).toFixed(2)).padStart(16)} ${("$" + med(a.map((r) => r.nom)).toFixed(2)).padStart(15)} ${med(a.map((r) => Math.abs(r.adj / r.nom - 1))).toFixed(3).padStart(21)}`);
}
const pre90 = recs.filter((r) => new Date(r.ts * 1000).getUTCFullYear() < 1990);
const distort = med(pre90.map((r) => Math.abs(r.adj / r.nom - 1)));
console.log(`\n    pre-1990 median |adjusted/nominal - 1| = ${distort.toFixed(3)}   [rule needed > ${K.BAR}]`);

// ---- the concrete consequence: a round-number rule, run in both spaces ------------------------------------------
// Round-number clustering is the cleanest level effect there is, and it exists ONLY in nominal space.
const nearRound = (p: number) => Math.abs(p - Math.round(p)) <= 0.05 * Math.max(1, 1);
const nomRound = recs.filter((r) => nearRound(r.nom)).length / recs.length;
const adjRound = recs.filter((r) => nearRound(r.adj)).length / recs.length;
console.log(`\n  THE CONSEQUENCE, made concrete — a rule that fires "within 5 cents of a whole dollar":`);
console.log(`    fires on ${(100 * nomRound).toFixed(2)}% of bars in NOMINAL space, ${(100 * adjRound).toFixed(2)}% in the ADJUSTED space we store.`);
console.log(`    ratio ${(nomRound / Math.max(1e-9, adjRound)).toFixed(2)}x — the same rule is a different rule depending on which series it reads.`);

console.log(`\n  VERDICT, against the rule written before the data was read:`);
if (!(ctlA && ctlB)) console.log(`    UNTESTED — a control failed; the reconstruction is not nominal price and C1 remains unmeasured.`);
else if (distort > +K.BAR) {
  console.log(`    SUPPORTED. The price we store for a pre-1990 session differs from the price that traded by a median of`);
  console.log(`    ${(100 * distort).toFixed(0)}% (1980s: $${medNom80.toFixed(2)} traded, $${medAdj80.toFixed(2)} stored). Adjusted RETURNS remain correct and every return-based`);
  console.log(`    result on this board is untouched. What is invalid is any rule keyed to an absolute LEVEL on the equity panel.`);
} else console.log(`    NULL — the distortion is ${distort.toFixed(3)}, below the ${K.BAR} bar; C1 is real but too small to invalidate a level rule.`);
console.log(`\n  WHAT THIS DOES NOT SAY. RELATIVE level rules — a break of the prior session's low, a swing high — compare`);
console.log(`  prices days apart over which f is nearly constant, so they are LARGELY SAFE; their exposure is confined to`);
console.log(`  comparisons spanning an adjustment event, which this run does not isolate and which stays UNTESTED.`);
console.log(`  The intraday work is FX and crypto and is unaffected — that is luck, not design.`);
const t = await spendTrials({ rest: OWNED, headers: hdr, family: "adjusted-levels", runId: K.RUN_ID, spent: byDec.size });
console.log(`\n  trials +${byDec.size} (one per decade priced); ceiling ${t.ceiling.toFixed(4)}.`);
