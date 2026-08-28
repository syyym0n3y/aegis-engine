#!/usr/bin/env -S deno run --allow-net --allow-env
// overnight-breakeven.ts (D-685) — the factory charged SPY 20bp a day. SPY does not cost 20bp a day.
//
// HOW THIS SURFACED. D-684c/d made the gross series survive in every family, and the first thing the recovered data
// showed was a list of specs recorded as losses whose GROSS effect is real. Two clear the 5.456 deflation ceiling:
//   overnight|SPY|overnight   net -40.07%/yr t -23.77   GROSS +10.11%/yr t 6.00
//   overnight|QQQ|overnight   net -36.17%/yr t -14.18   GROSS +14.05%/yr t 5.51
//
// THE FACTORY WAS NOT WRONG TO CHARGE A COST. Capturing the overnight leg means buying at the close and selling at
// the open — a genuine round trip every session, so a per-day charge is the right SHAPE. What is wrong is the
// NUMBER. 20bp/day was a conservative placeholder applied uniformly. SPY quotes a one-cent spread on a ~$600 price
// (~0.17bp), and the close and open are auction prints that MOC and MOO orders fill at by construction. A retail
// round trip in SPY is on the order of 1bp, not 20. The factory therefore charged 50.4%/yr against a 10.11%/yr
// effect and recorded "loses at t -23.77" — a statement about a placeholder, in the voice of a statement about
// markets. This is THE COST-INFLATION COROLLARY's worst case: not a mildly pessimistic assumption, an assumption
// off by more than an order of magnitude on the single most liquid instrument that exists.
//
// WHAT IS AND IS NOT NEW. "The equity premium is earned overnight" is a documented decomposition (Lachance;
// Bogousslavsky) and the factory's own header says so. Nothing here claims to discover it. What is new is the
// DECISION-RELEVANT number nobody computed: the BREAKEVEN round-trip cost, and whether the strategy beats simply
// holding the instrument once a realistic cost is charged.
//
// THE BENCHMARK THAT DECIDES IT (D-636). Overnight-only earning ~10%/yr is not interesting if buy-and-hold earns the
// same — that is the same return for 252 round trips. The test that matters is overnight-only MINUS buy-and-hold,
// net of cost, which is what the gates below are computed on.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("overnight-breakeven", [
  { name: "INSTRUMENTS", def: "SPY,QQQ,^GSPC,GLD,TLT,IWM,DIA,EFA,EEM", note: "one series each; ^GSPC is uninvestable and is the control" },
  { name: "COSTS_BP", def: "0,0.5,1,2,5,10,20", note: "round trip per DAY, swept" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "obe", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

const INSTS = K.INSTRUMENTS.split(",").map((s) => s.trim()).filter(Boolean);
const COSTS = K.COSTS_BP.split(",").map(Number).filter((x) => Number.isFinite(x));

interface Row { inst: string; nMo: number; from: string; to: string; grossON: number; grossID: number; grossBH: number;
  exGross: number; tExGross: number; breakevenBp: number; eras: number[]; uwYears: number; ddPct: number }
const out: Row[] = [];

for (const inst of INSTS) {
  const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(inst)}&select=bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { bars: number[][] }[];
  const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0 && b[1] > 0);
  if (bars.length < 2500) { console.log(`  ${inst}: ${bars.length} bars — skipped`); continue; }

  // Monthly sums of the three daily series. Overnight = close(t) -> open(t+1). Intraday = open(t+1) -> close(t+1).
  // Their sum is the buy-and-hold day return by construction, which is the arithmetic identity this rests on.
  const moON = new Map<string, number>(), moID = new Map<string, number>(), moBH = new Map<string, number>(), moDays = new Map<string, number>();
  for (let i = 0; i < bars.length - 1; i++) {
    const on = bars[i + 1][1] / bars[i][4] - 1;
    const id = bars[i + 1][4] / bars[i + 1][1] - 1;
    const bh = bars[i + 1][4] / bars[i][4] - 1;
    const mo = iso(bars[i + 1][0]).slice(0, 7);
    moON.set(mo, (moON.get(mo) ?? 0) + on);
    moID.set(mo, (moID.get(mo) ?? 0) + id);
    moBH.set(mo, (moBH.get(mo) ?? 0) + bh);
    moDays.set(mo, (moDays.get(mo) ?? 0) + 1);
  }
  const months = [...moON.keys()].sort();
  const on = months.map((m) => moON.get(m)!), id = months.map((m) => moID.get(m)!), bh = months.map((m) => moBH.get(m)!);
  const days = months.map((m) => moDays.get(m)!);
  assertNonEmpty(`${inst} months`, months, 60);

  // THE BENCHMARK (D-636): overnight-only minus holding the same instrument through the same months.
  const exG = on.map((x, i) => x - bh[i]);
  const gON = mean(on) * 12 * 100, gID = mean(id) * 12 * 100, gBH = mean(bh) * 12 * 100;

  // Breakeven cost is set by the ABSOLUTE overnight return, not the excess: the daily round trip is what the
  // strategy pays to exist at all, and it is paid whether or not it beats buy-and-hold.
  const breakeven = (mean(on) / mean(days)) * 1e4;

  const q4 = [0, 1, 2, 3].map((e) => { const a = Math.floor(e * on.length / 4), b = Math.floor((e + 1) * on.length / 4); return mean(on.slice(a, b)) * 12 * 100; });

  // Holdability on the gross overnight equity curve (D-565): depth is not the risk, duration is.
  let cum = 1, pk = 1, dd = 0, uw = 0, longestUW = 0;
  for (const x of on) { cum *= 1 + x; pk = Math.max(pk, cum); const d = cum / pk - 1; dd = Math.min(dd, d); uw = d < -1e-9 ? uw + 1 : 0; longestUW = Math.max(longestUW, uw); }

  out.push({ inst, nMo: months.length, from: months[0], to: months[months.length - 1],
    grossON: gON, grossID: gID, grossBH: gBH, exGross: mean(exG) * 12 * 100, tExGross: tstat(exG),
    breakevenBp: breakeven, eras: q4, uwYears: longestUW / 12, ddPct: dd * 100 });
}
assertNonEmpty("instruments measured", out, 3);

// Each instrument is a trial and the ceiling must reflect it (D-628 refuses to return one it has not recorded).
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "overnight-breakeven",
  runId: `overnight-breakeven|${INSTS.join(",")}|${COSTS.join(",")}`, spent: out.length });

console.log(`==> OVERNIGHT BREAKEVEN — what round trip does the overnight leg actually support?`);
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()}  |  DEFLATION CEILING ${spend.ceiling.toFixed(4)}\n`);
console.log(`    ${"inst".padEnd(8)}${"n".padStart(5)}${"span".padStart(18)}${"ON%".padStart(8)}${"INTRA%".padStart(8)}${"HOLD%".padStart(8)}${"ON-HOLD".padStart(9)}${"t".padStart(7)}${"b/e bp/day".padStart(12)}`);
for (const r of out) {
  console.log(`    ${r.inst.padEnd(8)}${String(r.nMo).padStart(5)}${`${r.from}..${r.to}`.padStart(18)}${r.grossON.toFixed(1).padStart(8)}${r.grossID.toFixed(1).padStart(8)}${r.grossBH.toFixed(1).padStart(8)}${r.exGross.toFixed(1).padStart(9)}${r.tExGross.toFixed(2).padStart(7)}${r.breakevenBp.toFixed(2).padStart(12)}`);
}

console.log(`\n    NET OF A DAILY ROUND TRIP — overnight-only ANNUAL RETURN at each assumed cost (bp/day):`);
console.log(`    ${"inst".padEnd(8)}${COSTS.map((c) => `${c}bp`.padStart(9)).join("")}`);
for (const r of out) {
  const cells = COSTS.map((c) => {
    const drag = c / 1e4 * 252 * 100;
    return (r.grossON - drag).toFixed(1).padStart(9);
  });
  console.log(`    ${r.inst.padEnd(8)}${cells.join("")}`);
}

console.log(`\n    ERA STABILITY of the gross overnight return (%/yr by quarter of the sample) + HOLDABILITY:`);
console.log(`    ${"inst".padEnd(8)}${"Q1".padStart(9)}${"Q2".padStart(9)}${"Q3".padStart(9)}${"Q4".padStart(9)}${"maxDD".padStart(9)}${"longest UW".padStart(12)}`);
for (const r of out) {
  console.log(`    ${r.inst.padEnd(8)}${r.eras.map((x) => x.toFixed(1).padStart(9)).join("")}${(r.ddPct.toFixed(0) + "%").padStart(9)}${(r.uwYears.toFixed(1) + "yr").padStart(12)}`);
}

console.log(`\n    READ THIS BEFORE THE NUMBERS ABOVE LOOK LIKE AN EDGE:`);
console.log(`      1. ON-HOLD is the column that decides. Earning the market's return overnight is not an edge if`);
console.log(`         holding the same fund earns the same thing without 252 round trips a year.`);
console.log(`      2. ^GSPC is the CONTROL and is uninvestable — no fund, no auction to trade at. If its numbers look`);
console.log(`         like the tradable ones, the effect is a property of the price series, not of an executable trade.`);
console.log(`      3. The breakeven column is where the assumption failed: the factory charged 20bp/day uniformly.`);
console.log(`      4. THE EXECUTION LAW still binds. Close-to-open assumes MOC and MOO fills at the official auction`);
console.log(`         prints. That is a far better-founded assumption than a passive limit (D-445) — those orders fill`);
console.log(`         by construction — but it is an assumption, and it is stated rather than buried.`);
await stampDataVersion(OWNED, hdr, { trd_bars_deep: null });
