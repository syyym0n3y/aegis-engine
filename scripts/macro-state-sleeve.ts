// D-899 — non-price macro state as an equity-timing sleeve.
// D-898 settled that mechanical orthogonality is achievable and that QUALITY is the binding constraint, so the hunt is
// now for NON-PRICE mechanisms that actually earn. These signals come from other markets entirely — option-implied tail
// pricing, the corporate credit spread, the Treasury curve — or from a cross-sectional statistic (breadth), not from
// the equity index's own price.
// BOTH D-898 LESSONS ARE BUILT IN FROM THE START rather than added after being fooled:
//   (a) every Sharpe sits beside a TIME-IN-MARKET-MATCHED buy-and-hold, because a rule long 60% of days inherits 60%
//       of the equity premium and quoting against zero would be a claim about the premium, not the signal;
//   (b) five-year BLOCKS, never a two-way split — turn-of-month read 0.41/0.39 across a 2010 split while its blocks ran
//       -0.83 to +1.70.
// And the registration's own clause (2): these are SLOW signals, so the effective sample is the number of regime
// EPISODES, not the number of days. Episodes are counted and a rule with fewer than 8 is UNTESTED.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("macro-state-sleeve", [
  { name: "SYMBOL", def: "SPY" }, { name: "COST_BP", def: "2" }, { name: "LOOK", def: "252", note: "trailing window for the percentile" },
  { name: "PCTL", def: "0.80", note: "the trailing percentile that defines the unfavourable state" },
  { name: "RF_ANNUAL", def: "0.04" }, { name: "DUMP", def: "" }, { name: "RUN_ID", def: "D-899-macro-state-sleeve" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mss", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const srOf = (r: number[], ann = 252) => { const s = sd(r); return s > 0 ? mean(r) / s * Math.sqrt(ann) : 0; };
async function series(name: string): Promise<Map<string, number>> {
  const m = new Map<string, number>(); let from = "1900-01-01";
  for (;;) { const p = await q(`trd_macro_series?series=eq.${name}&d=gt.${from}&select=d,v&order=d.asc&limit=20000`) as { d: string; v: number }[];
    if (!p.length) break; for (const r of p) if (r.v !== null) m.set(r.d, r.v); from = p.at(-1)!.d; if (p.length < 20000) break; }
  return m;
}
const rows = await q(`trd_bars_deep?symbol=eq.${K.SYMBOL}&select=bars`) as { bars: number[][] }[];
const bars = ((rows[0]?.bars ?? []) as number[][]).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
assertNonEmpty(`${K.SYMBOL} bars`, bars, 3000);
const iso = bars.map((b) => new Date(b[0] * 1000).toISOString().slice(0, 10));
const ret = bars.map((b, i) => i ? Math.log(b[4] / bars[i - 1][4]) : 0);
const rfD = +K.RF_ANNUAL / 252;
// "high" = the signal's high values mark the UNFAVOURABLE state (risk off), so the rule holds equity when it is LOW.
const SIGNALS: { name: string; src: string; high: boolean; note: string }[] = [
  { name: "SKEW high = out", src: "cboe_skew", high: true, note: "option-implied tail pricing" },
  { name: "credit spread high = out", src: "credit_baa_10y", high: true, note: "BAA minus 10y, corporate stress" },
  { name: "breadth >200dma low = out", src: "breadth_pct_gt_200dma_surv", high: false, note: "participation, survivorship-adjusted, from 1973" },
  { name: "new 252d lows high = out", src: "breadth_pct_252d_low_surv", high: true, note: "stress breadth" },
  { name: "new 252d highs low = out", src: "breadth_pct_252d_high_surv", high: false, note: "momentum breadth" },
];
console.log(`==> D-899 MACRO STATE SLEEVE — ${K.SYMBOL}, ${iso.length} days ${iso[0]}..${iso.at(-1)}; hold when the state is favourable, trailing ${K.LOOK}d percentile ${K.PCTL}, cost ${K.COST_BP}bp\n`);
console.log(`  ${"signal".padEnd(30)} ${"days%".padStart(6)} ${"eps".padStart(4)} ${"SR".padStart(6)} ${"matched".padStart(8)} ${"excess".padStart(7)} ${"blocks (5y)".padStart(11)}`);
let trials = 0; let best: { name: string; ser: Record<string, number>; ex: number } | null = null;
for (const S of SIGNALS) {
  const raw = await series(S.src);
  if (!raw.size) { console.log(`  ${S.name.padEnd(30)} — series absent, UNTESTED`); continue; }
  const lastD = [...raw.keys()].sort().at(-1)!;
  if (lastD < "2020-01-01") { console.log(`  ${S.name.padEnd(30)} — series ends ${lastD}, a dead feed cannot be a live sleeve, UNTESTED`); continue; }
  trials++;
  // forward-fill the macro value onto trading days, then lag ONE FULL DAY: the value is read at yesterday's close.
  const vals: (number | null)[] = []; let last: number | null = null;
  for (const d of iso) { if (raw.has(d)) last = raw.get(d)!; vals.push(last); }
  const pos: number[] = []; const hist: number[] = [];
  for (let i = 0; i < iso.length; i++) {
    const v = vals[i];
    if (v === null) { pos.push(0); continue; }
    hist.push(v); if (hist.length > +K.LOOK) hist.shift();
    if (hist.length < +K.LOOK) { pos.push(0); continue; }
    const srt = [...hist].sort((a, b) => a - b);
    const thr = srt[Math.floor(+K.PCTL * (srt.length - 1))];
    const thrLo = srt[Math.floor((1 - +K.PCTL) * (srt.length - 1))];
    pos.push(S.high ? (v <= thr ? 1 : 0) : (v >= thrLo ? 1 : 0));
  }
  const cost = +K.COST_BP / 1e4;
  const serAll: number[] = []; let held = 0, eps = 0;
  for (let i = 2; i < iso.length; i++) {
    const on = pos[i - 1] === 1;                      // lag-1: position from yesterday's signal
    const c = pos[i - 1] !== pos[i - 2] ? cost / 2 : 0;
    if (pos[i - 1] === 0 && pos[i - 2] === 1) eps++;   // an episode = one exit from the favourable state
    serAll.push((on ? ret[i] - rfD : 0) - c); if (on) held++;
  }
  if (eps < 8 || held < 200) { console.log(`  ${S.name.padEnd(30)} ${(100 * held / serAll.length).toFixed(0).padStart(5)}% ${String(eps).padStart(4)} — ${eps < 8 ? `only ${eps} regime episodes` : `only ${held} held days`}, UNTESTED`); continue; }
  const timeIn = held / serAll.length;
  const srFull = srOf(serAll);
  const bhAll = ret.slice(2).map((x) => x - rfD);
  const matched = srOf(bhAll) * Math.sqrt(timeIn);
  const blk = new Map<string, number[]>();
  for (let i = 2; i < iso.length; i++) { const y = +iso[i].slice(0, 4); const b = `${Math.floor(y / 5) * 5}`; (blk.get(b) ?? blk.set(b, []).get(b)!).push(serAll[i - 2]); }
  const bk = [...blk.keys()].sort(); const bvals = bk.map((b) => srOf(blk.get(b)!));
  const pos5 = bvals.filter((x) => x > 0).length;
  const ex = srFull - matched;
  console.log(`  ${S.name.padEnd(30)} ${(100 * timeIn).toFixed(0).padStart(5)}% ${String(eps).padStart(4)} ${srFull.toFixed(2).padStart(6)} ${matched.toFixed(2).padStart(8)} ${(ex >= 0 ? "+" : "") + ex.toFixed(2).padStart(6)} ${`${pos5}/${bk.length}`.padStart(11)}`);
  console.log(`      ${S.note}; blocks ${bk.map((b, i) => `${b}s ${bvals[i].toFixed(2)}`).join(" ")}`);
  if (!best || ex > best.ex) { const o: Record<string, number> = {}; for (let i = 2; i < iso.length; i++) o[iso[i]] = +serAll[i - 2].toFixed(8); best = { name: S.name, ser: o, ex }; }
}
await spendTrials({ rest: OWNED, headers: hdr, family: "macro-state-sleeve", runId: K.RUN_ID, spent: Math.max(1, trials) });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  ${trials} signal(s) counted; ceiling ${ceil.ceiling.toFixed(2)}. Best by EXCESS over its matched comparator: ${best?.name ?? "none"}${best ? ` (+${best.ex.toFixed(2)})` : ""}`);
if (K.DUMP && best) { await Deno.writeTextFile(K.DUMP, JSON.stringify({ prereg: K.RUN_ID, rule: best.name, symbol: K.SYMBOL, series: best.ser })); console.log(`  best rule's series -> ${K.DUMP}`); }
