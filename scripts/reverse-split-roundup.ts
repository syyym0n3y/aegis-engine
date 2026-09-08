#!/usr/bin/env -S deno run --allow-net --allow-env
// reverse-split-roundup.ts (D-837) — PREREG D-837-reverse-split-roundup.
// THE CAPACITY-INVERTED SPACE, tested where our data reaches. When a company reverse-splits 1-for-N, a holder of fewer
// than N shares owns a fraction; many issuers ROUND UP to one whole share rather than cashing it out. One share held
// before therefore becomes one share worth ~N times as much — a mechanism that works ONLY at one-share size, which is
// why no institution competes it away and why it is worth asking about at all (D-834, D-836 section E).
// THIS IS AN OPPORTUNITY-SIZE MEASUREMENT AND AN UPPER BOUND. We do not hold the round-up provision (issuer-specific)
// or the broker's treatment of street-name holdings; both are stated in the output on every run, not buried.
// Our bars are split-ADJUSTED, so the RAW pre-split price is reconstructed as adjusted x ratio — which is flaw C1 of
// docs/METHODOLOGY_FLAWS.md used deliberately and correctly rather than tripped over.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("reverse-split-roundup", [
  { name: "RUN_ID", def: "D-837-reverse-split-roundup" },
  { name: "FROM_Y", def: "2015", note: "modern era; the rule decides on this window" },
  { name: "HOLD_D", def: "5", note: "the second exit: close N trading days after, to test whether the gain is realisable" },
  { name: "COMMS", def: "0,1,5", note: "flat commission per trade in dollars, charged on BOTH legs" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rsr", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "capacity-inverted", runId: K.RUN_ID, spent: 6 });
console.log(`\n==> D-837 REVERSE-SPLIT ROUND-UP — opportunity size, UPPER BOUND. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()} (mined).`);
const splits = await q(`trd_macro_series?series=like.split:*&v=lt.1&v=gt.0&select=series,d,v&order=d.asc&limit=20000`) as { series: string; d: string; v: number }[];
assertNonEmpty("reverse splits", splits, 500);
console.log(`    ${splits.length} reverse splits held, ${splits[0].d}..${splits[splits.length - 1].d}.`);
interface Ev { sym: string; d: string; ratio: number; rawBefore: number; after1: number; afterN: number | null; }
const evs: Ev[] = []; let noBars = 0, noAfter = 0, badLift = 0;
const symbols = [...new Set(splits.map((s) => s.series.slice(6)))];
const barsOf = new Map<string, { d: string; c: number }[]>();
for (let i = 0; i < symbols.length; i += 20) {
  const part = symbols.slice(i, i + 20);
  const rows = await q(`trd_bars_deep?symbol=in.(${part.map((x) => `"${encodeURIComponent(x)}"`).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) barsOf.set(r.symbol, (r.bars ?? []).filter((b) => b[4] > 0).map((b) => ({ d: new Date(b[0] * 1000).toISOString().slice(0, 10), c: b[4] })));
}
/* CORRECTED after the first run produced a mean of $4.8 TRILLION against a median of $8 — a broken number, not a
   result, and the cause is flaw C1 of docs/METHODOLOGY_FLAWS.md biting within an hour of my naming it. An adjusted
   price at time t equals raw(t) divided by the product of EVERY split ratio after t, not just the next one. My first
   pass de-adjusted for the split being studied and ignored any LATER splits, so a symbol that reverse-split twice
   produced prices inflated by the second ratio as well. Both legs are now de-adjusted with the full forward product. */
const allSplits = await q(`trd_macro_series?series=like.split:*&v=gt.0&select=series,d,v&order=d.asc&limit=40000`) as { series: string; d: string; v: number }[];
const splitsOf = new Map<string, { d: string; v: number }[]>();
for (const r of allSplits) { const sy = r.series.slice(6); (splitsOf.get(sy) ?? splitsOf.set(sy, []).get(sy)!).push({ d: r.d, v: +r.v }); }
const fwdProd = (sym: string, afterDate: string) => (splitsOf.get(sym) ?? []).filter((x) => x.d > afterDate).reduce((p, x) => p * x.v, 1);
for (const s of splits) {
  const sym = s.series.slice(6); const bars = barsOf.get(sym);
  if (!bars || bars.length < 30) { noBars++; continue; }
  const iAfter = bars.findIndex((b) => b.d >= s.d);
  if (iAfter < 1) { noAfter++; continue; }
  const dBefore = bars[iAfter - 1].d;
  /* raw(t) = adjusted(t) x product of every split ratio strictly after t */
  const rawBefore = bars[iAfter - 1].c * fwdProd(sym, dBefore);
  const after1 = bars[iAfter].c * fwdProd(sym, bars[iAfter].d);
  const bN = bars[iAfter + (+K.HOLD_D)];
  const afterN = bN ? bN.c * fwdProd(sym, bN.d) : null;
  if (!(rawBefore > 0) || !(after1 > 0)) { noAfter++; continue; }
  /* POSITIVE CONTROL: a 1-for-N reverse split must lift the raw price by roughly N. A ratio wildly off that is a data
     defect, not an opportunity, and silently keeping it is how the first run produced a trillion-dollar mean. */
  const lift = after1 / rawBefore, expect = 1 / s.v;
  if (!(lift > expect / 10 && lift < expect * 10)) { badLift++; continue; }
  evs.push({ sym, d: s.d, ratio: 1 / s.v, rawBefore, after1, afterN });
}
assertNonEmpty("events with usable bars", evs, 100);
const modern = evs.filter((e) => +e.d.slice(0, 4) >= +K.FROM_Y);
const yrs = new Set(modern.map((e) => e.d.slice(0, 4))).size;
console.log(`    COVERAGE: ${evs.length} of ${splits.length} usable (${noBars} no series, ${noAfter} no post-split close, ${badLift} REJECTED because the observed price lift was not within 10x of the split ratio — a data defect, not an opportunity). The absent ones are disproportionately delisted, so this is an UPPER BOUND on both count and value.`);
console.log(`    ${modern.length} events from ${K.FROM_Y} across ${yrs} year(s) = ${(modern.length / Math.max(1, yrs)).toFixed(1)}/yr. Median ratio 1-for-${med(modern.map((e) => e.ratio)).toFixed(0)}, median raw pre-split price $${med(modern.map((e) => e.rawBefore)).toFixed(3)}.`);
console.log(`\n  ${"commission".padStart(11)} ${"exit".padStart(8)} ${"n".padStart(6)} ${"median net $".padStart(13)} ${"mean net $".padStart(11)} ${"% positive".padStart(11)} ${"median ROI on the 1 share".padStart(26)}`);
const results: Record<string, { med: number; n: number }> = {};
for (const c of K.COMMS.split(",").map(Number)) {
  for (const [label, px] of [["first close", (e: Ev) => e.after1], [`+${K.HOLD_D}d close`, (e: Ev) => e.afterN]] as [string, (e: Ev) => number | null][]) {
    const sel = modern.filter((e) => px(e) !== null);
    const net = sel.map((e) => (px(e) as number) - e.rawBefore - 2 * c);
    const roi = sel.map((e, i) => net[i] / Math.max(1e-9, e.rawBefore + c));
    if (!sel.length) continue;
    results[`${c}|${label}`] = { med: med(net), n: sel.length };
    console.log(`  ${("$" + c).padStart(11)} ${label.padStart(8)} ${String(sel.length).padStart(6)} ${med(net).toFixed(2).padStart(13)} ${mean(net).toFixed(2).padStart(11)} ${(100 * net.filter((x) => x > 0).length / net.length).toFixed(0).padStart(10)}% ${(med(roi) * 100).toFixed(0).padStart(25)}%`);
  }
}
const m1 = results[`1|first close`], m1h = results[`1|+${K.HOLD_D}d close`];
const perYear = modern.length / Math.max(1, yrs);
let v: string;
if (modern.length < 100) v = `UNDERPOWERED — only ${modern.length} events since ${K.FROM_Y} with usable bars (need 100)`;
else if (!m1 || m1.med < 5) v = `NULL — median net gain at $1 commission is $${m1 ? m1.med.toFixed(2) : "n/a"} (rule needs $5)`;
else if (perYear < 20) v = `NULL — ${perYear.toFixed(1)} qualifying events per year (rule needs 20)`;
else if (!m1h || m1h.med <= 0) v = `NULL — the gain does not survive a ${K.HOLD_D}-day hold (median $${m1h ? m1h.med.toFixed(2) : "n/a"}): unrealisable`;
else v = `SUPPORTED AS AN OPPORTUNITY — median $${m1.med.toFixed(2)}/event at $1 commission, ${perYear.toFixed(1)} events/yr, still $${m1h.med.toFixed(2)} on a ${K.HOLD_D}-day exit`;
console.log(`\n  VERDICT: ${v}`);
console.log(`  WHAT THIS DOES NOT ESTABLISH, on every run: we do NOT hold the round-up provision (issuer-specific; many reverse splits CASH OUT`);
console.log(`  fractions instead, paying the fraction and nothing more), and we do NOT know whether a broker passes a round-up through to a`);
console.log(`  street-name holder. Those two facts decide whether ANY of the above is reachable, and they are the same unanswered brokerage`);
console.log(`  question as D-834's odd-lot tenders. Until they are answered this is a population measurement, not an edge.`);
