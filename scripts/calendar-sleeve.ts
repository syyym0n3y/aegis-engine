// D-898 — calendar effects as a sleeve, the one family orthogonal to price BY CONSTRUCTION.
// Every sleeve on this record is a function of price, which is why they correlate 0.42-0.50 (D-893/895). A calendar
// rule's position depends on the DATE, so its correlation with a trend book is structurally near zero — if it earns
// anything at all. The honest prior is publication death: this is the most-published family in finance, so every rule
// is reported in BOTH halves and one that lives only in the early half is recorded as DECAYED, not as an edge.
// THE COMPARATOR IS NOT ZERO (competing hypothesis 2): a rule long the market 20% of the time earns 20% of the equity
// premium, so each rule is scored against a buy-and-hold matched to the SAME time in market. Without that, a positive
// calendar Sharpe is a statement about the equity premium, not about the calendar.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("calendar-sleeve", [
  { name: "SYMBOL", def: "SPY" }, { name: "COST_BP", def: "2", note: "round trip per entry/exit pair" },
  { name: "SPLIT", def: "2010-01-01", note: "the pre/post halves; the turn-of-month effect was published in the 1980s" },
  { name: "DUMP", def: "", note: "write the best-scoring rule's daily series here for the blend test" },
  { name: "RF_ANNUAL", def: "0.04" }, { name: "RUN_ID", def: "D-898-calendar-sleeve" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const rows = await q(`trd_bars_deep?symbol=eq.${K.SYMBOL}&select=bars`) as { bars: number[][] }[];
const bars = ((rows[0]?.bars ?? []) as number[][]).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
assertNonEmpty(`${K.SYMBOL} daily bars`, bars, 3000);
const dates = bars.map((b) => new Date(b[0] * 1000));
const iso = dates.map((d) => d.toISOString().slice(0, 10));
const ret = bars.map((b, i) => i ? Math.log(b[4] / bars[i - 1][4]) : 0);
const rfD = +K.RF_ANNUAL / 252;
// trading-day index within each calendar month, and days remaining, so "turn of month" is defined on TRADING days
const tdIn: number[] = [], tdLeft: number[] = [];
{ let k = 0; for (let i = 0; i < iso.length; i++) { if (i > 0 && iso[i].slice(0, 7) !== iso[i - 1].slice(0, 7)) k = 0; tdIn.push(k++); }
  let j = 0; for (let i = iso.length - 1; i >= 0; i--) { if (i < iso.length - 1 && iso[i].slice(0, 7) !== iso[i + 1].slice(0, 7)) j = 0; tdLeft.unshift(j++); } }
type Rule = { name: string; hold: (i: number) => boolean };
const RULES: Rule[] = [
  { name: "turn-of-month (last 1 + first 3)", hold: (i) => tdLeft[i] <= 0 || tdIn[i] <= 2 },
  { name: "turn-of-month (last 2 + first 3)", hold: (i) => tdLeft[i] <= 1 || tdIn[i] <= 2 },
  { name: "first half of month", hold: (i) => tdIn[i] <= 9 },
  { name: "Nov-Apr (sell in May)", hold: (i) => { const m = +iso[i].slice(5, 7); return m >= 11 || m <= 4; } },
  { name: "Mon+Fri only", hold: (i) => { const w = dates[i].getUTCDay(); return w === 1 || w === 5; } },
  { name: "not-Monday", hold: (i) => dates[i].getUTCDay() !== 1 },
  { name: "pre-holiday (gap > 1 calendar day ahead)", hold: (i) => i + 1 < iso.length && (Date.parse(iso[i + 1]) - Date.parse(iso[i])) / 864e5 > 3 },
];
const splitS = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
const stats = (r: number[], ann = 252) => { const m = mean(r), s = sd(r); return { sr: s > 0 ? m / s * Math.sqrt(ann) : 0, n: r.length }; };
console.log(`==> D-898 CALENDAR SLEEVE — ${K.SYMBOL}, ${iso.length} days ${iso[0]}..${iso.at(-1)}, cost ${K.COST_BP}bp per round trip`);
console.log(`  EVERY Sharpe is beside its TIME-IN-MARKET-MATCHED buy-and-hold: a rule long 20% of days earns 20% of the`);
console.log(`  equity premium, so the comparator is that, never zero.\n`);
console.log(`  ${"rule".padEnd(38)} ${"days%".padStart(6)} ${"SR".padStart(6)} ${"matched B&H".padStart(11)} ${"excess".padStart(7)} ${"pre".padStart(6)} ${"post".padStart(6)} ${"yrs+".padStart(6)} ${"trips/yr".padStart(8)}`);
let best: { name: string; ser: Record<string, number>; ex: number } | null = null;
let trials = 0;
for (const r of RULES) {
  trials++;
  const pos = iso.map((_, i) => r.hold(i) ? 1 : 0);
  let trips = 0; for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[i - 1]) trips++;
  const cost = +K.COST_BP / 1e4;
  // lag-1: the rule is known in advance, but the POSITION is entered at the next open, so the return earned on day i
  // is pos[i-1] * ret[i]. Calendar rules are knowable ahead of time, which is exactly why this lag must still be taken.
  const ser: number[] = [], serAll: number[] = [];
  for (let i = 1; i < iso.length; i++) {
    const held = pos[i - 1] === 1;
    const c = pos[i - 1] !== (pos[i - 2] ?? 0) ? cost / 2 : 0;
    serAll.push((held ? ret[i] - rfD : 0) - c);
    if (held) ser.push(ret[i]);
  }
  if (ser.length < 200) { console.log(`  ${r.name.padEnd(38)} — fewer than 200 held days, UNTESTED`); continue; }
  const timeIn = ser.length / (iso.length - 1);
  const full = stats(serAll);
  // matched buy-and-hold: the SAME time in market, earned on randomly-placed days — i.e. scale the index's own excess
  const bhAll = ret.slice(1).map((x) => x - rfD);
  const bh = stats(bhAll); const matched = bh.sr * Math.sqrt(timeIn);
  const preIdx: number[] = [], postIdx: number[] = [];
  for (let i = 1; i < iso.length; i++) (bars[i][0] < splitS ? preIdx : postIdx).push(serAll[i - 1]);
  const yr = new Map<string, number[]>();
  for (let i = 1; i < iso.length; i++) { const y = iso[i].slice(0, 4); (yr.get(y) ?? yr.set(y, []).get(y)!).push(serAll[i - 1]); }
  const yrsPos = [...yr.values()].filter((v) => mean(v) > 0).length;
  // A TWO-WAY SPLIT AT ONE CHOSEN POINT IS NOT A STABILITY TEST (D-898's own lesson): turn-of-month reads 0.41/0.39
  // across a 2010 split and looks perfectly stable, while the 2005-2015 decade alone gives 0.09. Report five-year
  // blocks so the split point cannot be the thing doing the work.
  const blk = new Map<string, number[]>();
  for (let i = 1; i < iso.length; i++) { const y = +iso[i].slice(0, 4); const b = `${Math.floor(y / 5) * 5}`; (blk.get(b) ?? blk.set(b, []).get(b)!).push(serAll[i - 1]); }
  const blkTxt = [...blk.keys()].sort().map((b) => `${b}s ${stats(blk.get(b)!).sr.toFixed(2)}`).join(" ");
  const ex = full.sr - matched;
  console.log(`  ${r.name.padEnd(38)} ${(100 * timeIn).toFixed(0).padStart(5)}% ${full.sr.toFixed(2).padStart(6)} ${matched.toFixed(2).padStart(11)} ${(ex >= 0 ? "+" : "") + ex.toFixed(2).padStart(6)} ${stats(preIdx).sr.toFixed(2).padStart(6)} ${stats(postIdx).sr.toFixed(2).padStart(6)} ${`${yrsPos}/${yr.size}`.padStart(6)} ${(trips / ((bars.at(-1)![0] - bars[0][0]) / 3.156e7)).toFixed(1).padStart(8)}`);
  console.log(`      blocks: ${blkTxt}`);
  if (!best || ex > best.ex) { const o: Record<string, number> = {}; for (let i = 1; i < iso.length; i++) o[iso[i]] = +serAll[i - 1].toFixed(8); best = { name: r.name, ser: o, ex }; }
}
await spendTrials({ rest: OWNED, headers: hdr, family: "calendar-sleeve", runId: K.RUN_ID, spent: trials });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  ${trials} rules counted; ceiling ${ceil.ceiling.toFixed(2)}. Best by EXCESS over its matched comparator: ${best?.name ?? "none"} (+${best?.ex.toFixed(2)})`);
if (K.DUMP && best) { await Deno.writeTextFile(K.DUMP, JSON.stringify({ prereg: K.RUN_ID, rule: best.name, symbol: K.SYMBOL, series: best.ser })); console.log(`  best rule's series -> ${K.DUMP}`); }
