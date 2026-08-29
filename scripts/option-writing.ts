#!/usr/bin/env -S deno run --allow-net --allow-env
// option-writing.ts (D-700) — PREREG D-700-optionwriting, registered BEFORE this ran.
//
// WHY THIS ONE. `coverage-map.ts` (D-697) found option writing among the largest untested items that is actually
// PLACEABLE at the bottom of the ladder: no borrow, no margin, fractional shares, and ETF wrappers that exist.
// The CBOE PutWrite index runs to 1996 and is free; the wrappers (PBP 2007, QYLD/XYLD 2013) are the instruments an
// account could actually hold. That split is exactly what THE INSTRUMENT LAW is for — measure the premium in the
// thing that would hold it, and measure the conversion rather than assuming it.
//
// THREE QUESTIONS, IN THE ORDER THAT DECIDES THEM:
//   1. BENCHMARK (D-636). Does the index beat simply holding SPY — on RETURN, not only on Sharpe?
//   2. INSTRUMENT (D-575). What fraction of that does a placeable wrapper actually capture?
//   3. LADDER (D-689). Does it climb faster? An account compounding to a LEVEL cares about return; a higher-Sharpe,
//      lower-return holding DELAYS the climb, which is the finding that makes question 1 the decisive one.
//
// THE PREDICTION IS ON RECORD: I expect higher Sharpe, lower return, failure of the promote rule, and wrapper
// capture well under 50%. Writing it down first is the only thing that makes being wrong visible.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("option-writing", [
  { name: "SYMS", def: "^PUT,PBP,QYLD,XYLD,SPY,QQQ", note: "index + placeable wrappers + benchmarks" },
  { name: "START", def: "40", note: "ladder opening capital" },
  { name: "MONTHLY", def: "100", note: "ladder contribution" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ow", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---- fetch + store, sequentially (Hard Rule), with the D-694 truncation check ----------------------------------
const SYMS = K.SYMS.split(",").map((s) => s.trim()).filter(Boolean);
const series = new Map<string, Map<string, number>>();
for (const sym of SYMS) {
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  await sleep(250);
  const res = j?.chart?.result?.[0], q = res?.indicators?.quote?.[0];
  const adj = res?.indicators?.adjclose?.[0]?.adjclose, ts = res?.timestamp;
  if (!q?.close || !ts) { console.log(`  ${sym}: unavailable`); continue; }
  const bars: number[][] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i]; if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const a = adj?.[i]; const f = (a != null && Number.isFinite(a) && a > 0) ? a / c : 1;
    bars.push([ts[i], +(c * f).toFixed(6)]);
  }
  // A RECYCLED OR STUB TICKER RETURNS A SHORT, LATE-STARTING SERIES. PUTW does exactly this (31 bars from
  // 2026-07-17) and is excluded here rather than silently averaged in — D-687's hazard, applied at the point of use.
  if (bars.length < 500) { console.log(`  ${sym}: only ${bars.length} bars — EXCLUDED (too short to be the real series; the PUTW shape)`); continue; }
  const mo = new Map<string, number>();
  for (let i = 0; i < bars.length - 1; i++) {
    const m = new Date(bars[i + 1][0] * 1000).toISOString().slice(0, 7);
    mo.set(m, (mo.get(m) ?? 0) + Math.log(bars[i + 1][1] / bars[i][1]));
  }
  const r = new Map<string, number>();
  for (const [m, lg] of mo) r.set(m, Math.expm1(lg));
  series.set(sym, r);
  console.log(`  ${sym.padEnd(7)} ${String(r.size).padStart(4)} months  ${[...r.keys()].sort()[0]} .. ${[...r.keys()].sort().slice(-1)[0]}`);
}
assertNonEmpty("series loaded", [...series.keys()], 3);
if (!series.has("^PUT") || !series.has("SPY")) { console.error("!! need both ^PUT and SPY to answer question 1. RED."); Deno.exit(1); }

function stat(rs: number[]) {
  const ann = Math.expm1(mean(rs.map((r) => Math.log1p(r))) * 12) * 100;
  const vol = sd(rs) * Math.sqrt(12) * 100;
  let cum = 1, pk = 1, dd = 0, uw = 0, luw = 0;
  for (const x of rs) { cum *= 1 + x; pk = Math.max(pk, cum); const d = cum / pk - 1; dd = Math.min(dd, d); uw = d < -1e-9 ? uw + 1 : 0; luw = Math.max(luw, uw); }
  return { ann, vol, sr: (ann - 2) / vol, dd: dd * 100, uw: luw / 12 };
}

// ---- QUESTION 1: the index against simply holding, on a COMMON span ---------------------------------------------
const common = [...series.get("^PUT")!.keys()].filter((m) => series.get("SPY")!.has(m)).sort();
assertNonEmpty("^PUT/SPY common months", common, 200);
const put = common.map((m) => series.get("^PUT")!.get(m)!), spy = common.map((m) => series.get("SPY")!.get(m)!);
const sPut = stat(put), sSpy = stat(spy);
const diff = put.map((x, i) => x - spy[i]);
const tDiff = mean(diff) / ((sd(diff) || 1e-12) / Math.sqrt(diff.length));

console.log(`\n==> OPTION WRITING — PREREG D-700-optionwriting`);
console.log(`    common span ${common[0]} .. ${common[common.length - 1]} (${common.length} months, ${(common.length / 12).toFixed(1)} years)\n`);
console.log(`    ${"series".padEnd(10)}${"%/yr".padStart(9)}${"vol".padStart(8)}${"SR".padStart(7)}${"maxDD".padStart(9)}${"UW yr".padStart(8)}`);
for (const [n, s] of [["^PUT", sPut], ["SPY", sSpy]] as [string, ReturnType<typeof stat>][])
  console.log(`    ${n.padEnd(10)}${s.ann.toFixed(2).padStart(9)}${s.vol.toFixed(1).padStart(8)}${s.sr.toFixed(2).padStart(7)}${(s.dd.toFixed(0) + "%").padStart(9)}${s.uw.toFixed(1).padStart(8)}`);
console.log(`    ${"".padEnd(10)}${(sPut.ann - sSpy.ann).toFixed(2).padStart(9)}${"".padStart(8)}${(sPut.sr - sSpy.sr).toFixed(2).padStart(7)}   <- difference, monthly t ${tDiff.toFixed(2)}`);

const g1 = sPut.ann > sSpy.ann;
console.log(`\n    GATE 1 — index beats holding on RETURN, not merely on Sharpe .......... ${g1 ? "PASS" : "FAIL"}`);

// ---- QUESTION 2: what a placeable wrapper actually captures -----------------------------------------------------
console.log(`\n    GATE 2 — INSTRUMENT CONVERSION, measured not assumed (D-575):`);
let bestCapture = -Infinity;
for (const w of ["PBP", "QYLD", "XYLD"]) {
  if (!series.has(w)) { console.log(`      ${w.padEnd(6)} not available`); continue; }
  const cm = [...series.get(w)!.keys()].filter((m) => series.get("SPY")!.has(m) && series.get("^PUT")!.has(m)).sort();
  if (cm.length < 60) { console.log(`      ${w.padEnd(6)} only ${cm.length} common months — UNTESTED`); continue; }
  const wr = cm.map((m) => series.get(w)!.get(m)!), sr2 = cm.map((m) => series.get("SPY")!.get(m)!), pr = cm.map((m) => series.get("^PUT")!.get(m)!);
  const sW = stat(wr), sS = stat(sr2), sP = stat(pr);
  const idxEx = sP.ann - sS.ann, wrapEx = sW.ann - sS.ann;
  // D-700 GATE DEFECT, CAUGHT BY ITS OWN OUTPUT. The first version accepted `Math.abs(idxEx) > 0.25`, so a NEGATIVE
  // index excess produced a large positive "capture" — the wrappers faithfully tracking a LOSS scored 92-144% and
  // the gate read PASS. A capture ratio is only meaningful when there is something worth capturing. The guard now
  // requires the index excess to be POSITIVE; a wrapper that faithfully reproduces underperformance is recorded as
  // a good tracker of a bad thing, which is a real and separate finding, not a passing gate.
  const cap = idxEx > 0.25 ? 100 * wrapEx / idxEx : NaN;
  const track = Math.abs(idxEx) > 0.25 ? 100 * wrapEx / idxEx : NaN;
  if (Number.isFinite(cap)) bestCapture = Math.max(bestCapture, cap);
  console.log(`      ${w.padEnd(6)} ${cm.length} mo (${cm[0]}..${cm[cm.length - 1]}): wrapper ${sW.ann.toFixed(2)}%/yr vs SPY ${sS.ann.toFixed(2)} vs index ${sP.ann.toFixed(2)}`);
  console.log(`             index excess ${idxEx.toFixed(2)}pp, wrapper excess ${wrapEx.toFixed(2)}pp -> ${
    Number.isFinite(cap) ? `CAPTURE ${cap.toFixed(0)}%`
    : Number.isFinite(track) ? `NO POSITIVE EXCESS TO CAPTURE — the wrapper tracks the index at ${track.toFixed(0)}% of a NEGATIVE excess (good tracking of a bad thing)`
    : "index excess ~0 over this span — undefined"}`);
}
const g2 = Number.isFinite(bestCapture) && bestCapture >= 50;
console.log(`      GATE 2 — a placeable wrapper captures >= 50% of a POSITIVE excess .. ${g2 ? "PASS" : "FAIL"}`);

// ---- QUESTION 3: the ladder ------------------------------------------------------------------------------------
const START = Number(K.START), MONTHLY = Number(K.MONTHLY);
function yearsTo(rs: number[], target: number) {
  const got: number[] = [];
  for (let s = 0; s < rs.length; s++) {
    if (rs.length - s < 24) break;
    let cap = START;
    for (let i = s, mo = 0; i < rs.length && mo < 45 * 12; i++, mo++) {
      cap = cap * (1 + rs[i]) + MONTHLY;
      if (cap >= target) { got.push(mo / 12); break; }
    }
  }
  return got.length ? pct(got, 0.5) : NaN;
}
console.log(`\n    GATE 3 — THE LADDER (D-689: a higher Sharpe with a lower return DELAYS it):`);
console.log(`      ${"holding".padEnd(10)}${"to $10k".padStart(10)}${"to $100k".padStart(11)}`);
for (const [n, rs] of [["^PUT", put], ["SPY", spy]] as [string, number[]][])
  console.log(`      ${n.padEnd(10)}${(yearsTo(rs, 10000).toFixed(1) + "y").padStart(10)}${(yearsTo(rs, 100000).toFixed(1) + "y").padStart(11)}`);
const gPut = yearsTo(put, 100000), gSpy = yearsTo(spy, 100000);
const g3 = gPut <= gSpy;
console.log(`      GATE 3 — no slower to $100k than holding ........................... ${g3 ? "PASS" : "FAIL"}`);

console.log(`\n    VERDICT: ${g1 && g2 && g3 ? "ALL THREE GATES PASS — the pre-registered promote rule is met." : "KILLED by the pre-registered rule — " + [!g1 ? "return" : null, !g2 ? "instrument conversion" : null, !g3 ? "ladder" : null].filter(Boolean).join(" + ") + " failed."}`);
await stampDataVersion(OWNED, hdr, { trd_bars_deep: null });
