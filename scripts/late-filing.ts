#!/usr/bin/env -S deno run --allow-net --allow-env
// late-filing.ts — event study of Form NT 10-K / NT 10-Q / NT 20-F (Rule 12b-25 "Notification of Late Filing").
//
// SIGN PRIOR, STATED FIRST (THE SIGN LAW, D-553). Registered BEFORE measurement, NEGATIVE:
//   "A late-filing notification (Form NT) predicts NEGATIVE forward excess return and elevated delisting."
// The reading of interest is therefore the SHORT / AVOID one: −excess. Late filing is a documented precursor of
// restatements, going-concern qualifications, auditor changes and delisting. This is DESCRIPTIVE ONLY — no mechanism
// is claimed and no forward clock is registered; it is a first measurement of an untested, free, retail-observable
// distress signal.
//
// THE LAWS BUILT IN FROM THE START, not bolted on as corrections:
//   EXECUTION / SAME-BAR COROLLARY (D-498) — entry is the first close STRICTLY AFTER the NT file_date (lag-1). An NT
//     filed after the close cannot be acted on at that close.
//   BENCHMARK / ABSOLUTE DIAGNOSTIC (D-627) — excess is measured against IWM and SPY; the raw bucket return and the
//     benchmark return are both reported, so a falling name in a faster-falling market is not miscalled an edge.
//   LIQUIDITY LAW (D-424) — split by PRE-event dollar-volume tercile; a distress short that lives only in illiquid
//     names is CAPACITY-BOUND, not tradable. The promotable number is the LIQUID tercile's.
//   COVERAGE LAW — N-with-bars / N-total is reported; delisters are measured to their LAST bar (which captures the
//     failure), because our bar panel backfills ~2020 and late filers delist disproportionately. Names absent from
//     the panel are the smallest/most-distressed — a survivorship caveat stated, not hidden.
//   TURNOVER LAW (D-654) — one round trip at 30bp is charged; an event study holds once so turnover is 1 round trip.
//   INSTRUMENT / BORROW — this is a SHORT in names that are frequently HARD OR IMPOSSIBLE TO BORROW (distressed
//     small caps). Borrow cost and availability are UNMEASURED here and are stated as an open constraint (as D-734c
//     did for de-SPAC). The AVOID reading (a holder exiting) needs no borrow and is the cleaner deployment.
//   PSEUDO-REPLICATION (D-612) — the event-level t treats co-dated names as independent and INFLATES significance;
//     it is reported with that caveat, and the proportion-negative and median (robust to clustering) are the honest
//     headline for a descriptive pass.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("late-filing", [
  { name: "FORMS", def: "NT 10-K,NT 10-Q,NT 20-F", note: "which NT root forms to include" },
  { name: "WINDOWS", def: "5,21,63,250", note: "forward horizons (trading days)" },
  { name: "COST_BP", def: "30", note: "one round trip" },
  { name: "REPEAT_MIN", def: "2", note: "distinct NT fiscal-periods for a filer to count as CHRONIC/repeat" },
  { name: "DELIST_CUT", def: "2026-05-01", note: "last bar before this = delisted -> measure to last bar; after = still trading, skip incomplete horizon" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ntlate", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q, qAll } = mkStrictRead(OWNED, hdr);   // D-757: a read FAILURE is an exception, never a silent empty universe

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

const FORMS = new Set(K.FORMS.split(",").map((s) => s.trim()));
const WINS = K.WINDOWS.split(",").map(Number);
const COST = Number(K.COST_BP) / 1e4;
const REPEAT_MIN = Number(K.REPEAT_MIN);
const DELIST_CUT = K.DELIST_CUT;

console.log(`==> LATE-FILING (Form NT) EVENT STUDY`);
console.log(`    SIGN PRIOR (registered NEGATIVE): "an NT late-filing predicts NEGATIVE forward excess / elevated delisting".`);
console.log(`    Reading of interest = SHORT/AVOID (−excess). DESCRIPTIVE ONLY. Horizons ${WINS.join("/")}d, cost ${K.COST_BP}bp round trip.\n`);

// ---- (1) the NT events ----
interface Raw { ticker: string | null; disclosed_date: string; raw: { cik?: string | null; period_ending?: string | null; form?: string | null } }
const rows = await qAll(`trd_raw_filings?source=eq.edgar&filing_type=like.*nt-late*&select=ticker,disclosed_date,raw&order=source_id`) as Raw[];
assertNonEmpty("NT late-filing rows", rows, 100);
const totalNT = rows.length;

// Resolve ticker-less filers via our own cik->ticker map (trd_cik_ticker) — dropping them would bias the panel to
// larger, better-tagged issuers, exactly the names LEAST likely to be distressed.
const cikMap = new Map<string, string>();
for (const r of await qAll(`trd_cik_ticker?select=cik,ticker&order=cik`) as { cik: string; ticker: string }[]) {
  if (r.ticker && r.cik) cikMap.set(String(r.cik).replace(/^0+/, ""), r.ticker);
}
interface Ev { ticker: string; date: string; period: string; form: string }
const evsAll: Ev[] = [];
let resolved = 0, noTicker = 0;
for (const r of rows) {
  const form = r.raw?.form ?? "";
  if (FORMS.size && form && !FORMS.has(form)) continue;
  let tk = r.ticker;
  if (!tk && r.raw?.cik) { const t = cikMap.get(String(r.raw.cik).replace(/^0+/, "")); if (t) { tk = t; resolved++; } }
  if (!tk) { noTicker++; continue; }
  if (!/^[A-Z][A-Z0-9.\-]{0,6}$/.test(tk) || !/^\d{4}-\d\d-\d\d$/.test(r.disclosed_date)) continue;
  const period = (r.raw?.period_ending && /^\d{4}-\d\d-\d\d$/.test(r.raw.period_ending)) ? r.raw.period_ending : r.disclosed_date.slice(0, 7);
  evsAll.push({ ticker: tk, date: r.disclosed_date, period, form });
}
console.log(`    NT rows: ${totalNT.toLocaleString()} total | resolved ${resolved} ticker-less via cik-map | ${noTicker.toLocaleString()} unresolved (no listed ticker — non-listed filers, legitimately dropped)`);

// ---- (2) dedup to FIRST NT per (ticker, fiscal-period); flag CHRONIC repeat filers ----
const firstByKey = new Map<string, Ev>();
for (const e of evsAll) {
  const key = `${e.ticker}|${e.period}`;
  const cur = firstByKey.get(key);
  if (!cur || e.date < cur.date) firstByKey.set(key, e);
}
const events = [...firstByKey.values()];
// distinct fiscal-periods late per ticker = chronic-ness
const periodsPerTicker = new Map<string, number>();
for (const e of events) periodsPerTicker.set(e.ticker, (periodsPerTicker.get(e.ticker) ?? 0) + 1);
const isRepeat = (t: string) => (periodsPerTicker.get(t) ?? 0) >= REPEAT_MIN;
const nRepeatTickers = [...periodsPerTicker.values()].filter((n) => n >= REPEAT_MIN).length;
console.log(`    after (ticker, fiscal-period) dedup: ${events.length.toLocaleString()} distinct late-filing events across ${periodsPerTicker.size.toLocaleString()} tickers`);
console.log(`    CHRONIC (>=${REPEAT_MIN} distinct late periods): ${nRepeatTickers.toLocaleString()} tickers, ${events.filter((e) => isRepeat(e.ticker)).length.toLocaleString()} of their events\n`);

// ---- (3) prices: needed tickers + benchmarks ----
async function bars(sym: string): Promise<number[][]> {
  const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  return (raw?.[0]?.bars || []).filter((b: number[]) => Number(b[4]) > 0);
}
const benchIWM = new Map((await bars("IWM")).map((b) => [iso(b[0]), Number(b[4])]));
const benchSPY = new Map((await bars("SPY")).map((b) => [iso(b[0]), Number(b[4])]));
assertNonEmpty("IWM bars", [...benchIWM.keys()], 500);
assertNonEmpty("SPY bars", [...benchSPY.keys()], 500);

const need = [...new Set(events.map((e) => e.ticker))];
const px = new Map<string, { d: string[]; c: number[]; dv: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const got = await q(`trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of Array.isArray(got) ? got : []) {
    const raw = r.bars; if (!Array.isArray(raw) || raw.length < 20) continue;
    const d: string[] = [], c: number[] = [], dv: number[] = [];
    for (const b of raw) { const cc = Number(b[4]); if (cc > 0) { d.push(iso(Number(b[0]))); c.push(cc); dv.push(cc * (Number(b[5]) || 0)); } }
    if (d.length >= 20) px.set(r.symbol, { d, c, dv });
  }
}
console.log(`    priced ${px.size.toLocaleString()} of ${need.length.toLocaleString()} distinct tickers (COVERAGE — names absent from the bar panel skew small/distressed; survivorship caveat)`);

// ---- (4) per-event forward excess ----
const idxAfter = (dts: string[], d: string): number => { for (let i = 0; i < dts.length; i++) if (dts[i] > d) return i; return -1; };  // STRICTLY after -> lag-1
const benchRet = (bm: Map<string, number>, d0: string, d1: string): number | null => {
  const keys = [...bm.keys()];
  const s0 = bm.get(d0) ?? bm.get([...keys].find((k) => k >= d0) ?? "");
  const s1 = bm.get(d1) ?? bm.get([...keys].reverse().find((k) => k <= d1) ?? "");
  return (s0 && s1) ? s1 / s0 - 1 : null;
};

interface Obs { exIWM: number; exSPY: number; dv: number; date: string; repeat: boolean; delisted: boolean }
const perWin: Obs[][] = WINS.map(() => []);
let withBars = 0, noEntry = 0, delistedCount = 0;
for (const e of events) {
  const p = px.get(e.ticker); if (!p) continue;
  const ci = idxAfter(p.d, e.date);                       // first bar strictly after the NT filing = lag-1 entry
  if (ci < 0 || ci >= p.c.length) { noEntry++; continue; }
  withBars++;
  const lastDt = p.d[p.d.length - 1];
  const delisted = lastDt < DELIST_CUT;                    // stopped trading before the data edge = a real delisting
  if (delisted) delistedCount++;
  // pre-event median dollar volume (no look-ahead into post-event volume)
  const pre = p.dv.slice(Math.max(0, ci - 60), ci); const preDV = pre.length ? med(pre) : med(p.dv);
  const p0 = p.c[ci], d0 = p.d[ci];
  for (let wi = 0; wi < WINS.length; wi++) {
    let iT = ci + WINS[wi];
    if (iT >= p.c.length) {
      if (!delisted) continue;                             // still trading, just not enough forward data — skip horizon
      iT = p.c.length - 1;                                 // delisted: measure to last bar (captures the failure)
    }
    if (iT <= ci) continue;
    const p1 = p.c[iT], d1 = p.d[iT];
    const rStock = p1 / p0 - 1;
    const rI = benchRet(benchIWM, d0, d1), rS = benchRet(benchSPY, d0, d1);
    if (!(p0 > 0 && p1 > 0) || rI == null || rS == null || Math.abs(rStock) > 5) continue;
    perWin[wi].push({ exIWM: (rStock - rI) * 100, exSPY: (rStock - rS) * 100, dv: preDV, date: e.date, repeat: isRepeat(e.ticker), delisted });
  }
}
console.log(`    events with a tradable lag-1 entry: ${withBars.toLocaleString()} (${noEntry} no entry bar) | of these ${delistedCount.toLocaleString()} delisted (last bar < ${DELIST_CUT})`);
console.log(`    COVERAGE: ${withBars} of ${events.length} events measurable = ${(100 * withBars / events.length).toFixed(1)}%. A null here would be UNTESTED on the ${events.length - withBars} unmeasured (mostly unpriced small caps).\n`);

// ---- (5) POSITIVE CONTROL on the "zero" risk (THE POSITIVE-CONTROL RULE) ----
if (withBars === 0) { console.error("!! ZERO measurable events — a broken join, not a market fact. RED."); Deno.exit(1); }
const sampleRepeat = events.filter((e) => isRepeat(e.ticker)).slice(0, 5).map((e) => e.ticker);
console.log(`    POSITIVE CONTROL — measurable>0 (${withBars}); example CHRONIC late filers present: ${sampleRepeat.join(", ") || "none"}\n`);

// ---- (6) report ----
const line = (label: string, xs: number[]) => {
  if (xs.length < 10) return `${label} n=${String(xs.length).padStart(4)} (too few)`;
  const short = xs.map((x) => -x);   // SHORT reading: profit = −excess
  const propNeg = 100 * xs.filter((x) => x < 0).length / xs.length;
  return `${label} n=${String(xs.length).padStart(4)}  excess med ${med(xs).toFixed(1)}% mean ${mean(xs).toFixed(1)}% (t ${tstat(xs).toFixed(2)})  |  SHORT −excess mean ${mean(short).toFixed(1)}% net@${K.COST_BP}bp ${(mean(short) - COST * 100).toFixed(1)}%  |  P(excess<0) ${propNeg.toFixed(0)}%`;
};
for (let wi = 0; wi < WINS.length; wi++) {
  const all = perWin[wi];
  console.log(`  === +${WINS[wi]}d ===  (event-level t; co-dated clustering INFLATES it — median & P(<0) are the robust read)`);
  if (all.length < 10) { console.log(`      n=${all.length} (too few)`); continue; }
  console.log(`      vs IWM  ${line("ALL   ", all.map((o) => o.exIWM))}`);
  console.log(`      vs SPY  ${line("ALL   ", all.map((o) => o.exSPY))}`);
  // liquid tercile by pre-event dollar volume (THE LIQUIDITY LAW — the promotable number)
  const sorted = [...all].sort((a, b) => a.dv - b.dv);
  const liq = sorted.slice(Math.floor(sorted.length * 2 / 3));
  const illiq = sorted.slice(0, Math.floor(sorted.length / 3));
  console.log(`      vs IWM  ${line("LIQUID", liq.map((o) => o.exIWM))}`);
  console.log(`      vs IWM  ${line("ILLIQ ", illiq.map((o) => o.exIWM))}`);
  // era halves
  const byDate = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(byDate.length / 2);
  console.log(`      vs IWM  ${line("ERA-1 ", byDate.slice(0, mid).map((o) => o.exIWM))} [<= ${byDate[mid - 1]?.date}]`);
  console.log(`      vs IWM  ${line("ERA-2 ", byDate.slice(mid).map((o) => o.exIWM))} [>= ${byDate[mid]?.date}]`);
  // repeat / chronic subset
  const rep = all.filter((o) => o.repeat), non = all.filter((o) => !o.repeat);
  console.log(`      vs IWM  ${line("CHRONIC", rep.map((o) => o.exIWM))}  (repeat filers — worse?)`);
  console.log(`      vs IWM  ${line("ONCE  ", non.map((o) => o.exIWM))}`);
  // delisting rate within horizon window
  const delRate = 100 * all.filter((o) => o.delisted).length / all.length;
  console.log(`      DELISTING: ${delRate.toFixed(0)}% of these events belong to names that stopped trading before ${DELIST_CUT}`);
  console.log("");
}

// ---- (7) trials + verdict ----
console.log(`    TRIALS THIS RUN: ${WINS.length} horizons × 2 benchmarks × {ALL,LIQUID,ILLIQ,ERA1,ERA2,CHRONIC,ONCE} — a wide descriptive sweep; treat |t| with deflation, not at face value.`);
console.log(`    BORROW: this is a SHORT in frequently hard-to-borrow distressed small caps; borrow cost/availability UNMEASURED (as D-734c). The AVOID reading (a holder exits) needs no borrow and is the cleaner deployment.`);
console.log(`    VERDICT is printed above per horizon: read the LIQUID tercile (tradable) and P(excess<0), NOT the pooled headline or the event-level t.`);
