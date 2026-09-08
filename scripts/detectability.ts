#!/usr/bin/env -S deno run --allow-net --allow-env
// detectability.ts (D-832) — HOW MANY TRADES WOULD IT TAKE TO KNOW? Never computed on this stack, and it governs the
// micro rung's review clause directly.
// Every gate here is written in trades (paper->micro >= 30, micro->small >= 50) and every measured effect here is a few
// basis points against a per-event standard deviation two orders of magnitude larger. Those two facts have never been
// put in the same sentence. This puts them there: for each effect the record actually measured, the sample needed to
// distinguish it from zero at t=2, and the calendar time that sample takes at the observed event rate.
// No new data, no new hypothesis - arithmetic on numbers already in the ledger, which is why it is cheap and decisive.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("detectability", [{ name: "SPLIT", def: "2023-01-01" }, { name: "KK", def: "24" }, { name: "T_TARGET", def: "2.0" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "det", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const VENUE: Record<string, number> = { XAUUSD: 2.2, USA500IDXUSD: 2.4, USATECHIDXUSD: 2.2 };
const KK = +K.KK, SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000, TT = +K.T_TARGET;
const nets: number[] = []; let spanDays = 0; let firstTs = Infinity, lastTs = 0;
for (const sym of Object.keys(VENUE)) {
  const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  const b: Bar[] = rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
  const psl = priorSessionLevels(b); const rt = VENUE[sym] / 1e4; let firedAt: number | undefined;
  for (let i = 1; i < b.length - KK - 1; i++) {
    const lvl = psl[i]?.low; if (lvl === undefined) continue;
    if (!(b[i - 1].c >= lvl && b[i].c < lvl) || firedAt === lvl) continue;
    firedAt = lvl; if (b[i].ts < SPLIT) continue;
    nets.push(Math.log(b[i + 1 + KK].c / b[i + 1].o) - rt);
    firstTs = Math.min(firstTs, b[i].ts); lastTs = Math.max(lastTs, b[i].ts);
  }
}
assertNonEmpty("event stream", nets, 1000);
spanDays = (lastTs - firstTs) / 86400;
const S = sd(nets), rate = nets.length / spanDays;                       /* events per calendar day, all 3 instruments */
console.log(`\n==> D-832 HOW MANY TRADES WOULD IT TAKE TO KNOW?`);
console.log(`    Measured on the live stream: per-event standard deviation ${(S * 1e4).toFixed(0)}bp, event rate ${rate.toFixed(2)}/day across the 3 placeable instruments (${nets.length} events over ${spanDays.toFixed(0)} days).`);
console.log(`    n required to separate an edge from zero at t = ${TT}:  n = (${TT} x sd / edge)^2\n`);
console.log(`    ${"claimed edge".padStart(14)} ${"n needed".padStart(10)} ${"at this rate".padStart(14)} ${"if you take 1 in 4".padStart(19)}   what in the record is this size`);
const cases: [number, string][] = [
  [7.15, "D-767 rvol-hi K24, the best conditioned cell the record ever measured"],
  [6.24, "D-825 as first reported (before its benchmark was corrected)"],
  [2.09, "D-764 unconditioned fade on the 12-instrument panel"],
  [1.35, "D-826b: what D-825 actually was, with the sign flipped — a SHORTFALL"],
  [20.0, "a hypothetical edge 3x anything ever measured here"],
];
for (const [bpEdge, label] of cases) {
  const n = Math.ceil(((TT * S) / (bpEdge / 1e4)) ** 2);
  const days = n / rate, yrs = days / 365;
  console.log(`    ${(bpEdge.toFixed(2) + "bp").padStart(14)} ${n.toLocaleString().padStart(10)} ${(yrs >= 1 ? yrs.toFixed(1) + " yr" : days.toFixed(0) + " d").padStart(14)} ${((yrs * 4) >= 1 ? (yrs * 4).toFixed(1) + " yr" : (days * 4).toFixed(0) + " d").padStart(19)}   ${label}`);
}
console.log(`\n    THE GATE, READ AGAINST ITS OWN ARITHMETIC:`);
for (const n of [30, 50, 100]) {
  const detectable = TT * S / Math.sqrt(n);
  console.log(`      at ${String(n).padStart(3)} trades the SMALLEST edge distinguishable from zero is ${(detectable * 1e4).toFixed(1)}bp — ${(detectable * 1e4 / 7.15).toFixed(0)}x the best cell this programme has ever measured (7.15bp).`);
}
console.log(`\n    So the 30-trade review cannot detect any edge this stack is capable of finding. What 30 trades CAN establish is`);
console.log(`    the thing they were actually put there for: that the plumbing works — real fills, real slippage against the sheet's`);
console.log(`    intended price, real costs, the kill-switch honoured. That is an OPERATIONAL test, and it is a good reason to place`);
console.log(`    them. It is not, and cannot be, evidence about expectancy, and D-831 measured what happens when it is read as such.`);
