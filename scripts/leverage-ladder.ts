#!/usr/bin/env -S deno run --allow-net --allow-env
// leverage-ladder.ts (D-701) — PREREG D-701-leverage, registered BEFORE this ran.
//
// WHY THIS IS THE RIGHT NEXT TEST. Every lever measured on this ladder so far either LOWERS return (D-689's
// higher-Sharpe baskets, D-700's option writing — both made the climb longer) or does not move the phase at all
// (D-688 deposits, D-691 entry timing). Leverage is the only one that raises the compounding rate, and it is a
// documented approach: the lifecycle-investing argument is precisely that a young contribution-funded account is
// under-exposed early and should borrow against its future contributions.
//
// THE THREE THINGS THAT ARGUE BACK, all quantitative:
//   BORROW is charged on the whole levered notional and scales LINEARLY with L.
//   VOLATILITY DRAG on constant-leverage is QUADRATIC in L — roughly (L^2-L)/2 x variance per period.
//   RUIN IS ABSORBING. The ladder's median worst drawdown is -46.9%; at 2x that is a wipeout, and an account at zero
//   does not participate in the recovery. This is the term a median-only study silently drops.
//
// AND THE INSTRUMENT LAW. The naive levered index is research space. SSO (2x) and UPRO (3x) are what an account can
// hold, they rebalance DAILY, and daily rebalancing realises drag that a monthly-levered series only partly incurs.
// Measuring the wrapper is not a footnote here; it is the whole difference between an idea and a position.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("leverage-ladder", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "LEVS", def: "1.0,1.25,1.5,2.0,3.0", note: "constant leverage, monthly rebalanced" },
  { name: "SPREAD_BP", def: "150", note: "borrow spread over the risk-free rate, bp/yr — retail margin is far worse, box-spread far better" },
  { name: "MAX_YEARS", def: "45" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lev", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ff(name: string) {
  const m = new Map<string, number>();
  for (let off = 0;; off += 10000) {
    const r = await fetch(`${OWNED}/trd_ff_factors?select=month,ret&factor=eq.${encodeURIComponent(name)}&order=month.asc&offset=${off}&limit=10000`, { headers: hdr });
    if (!r.ok) { console.error(`!! ${name} HTTP ${r.status}`); Deno.exit(1); }
    const rows = await r.json() as { month: string; ret: number }[];
    if (!rows.length) break;
    for (const x of rows) { const v = Number(x.ret); if (Number.isFinite(v)) m.set(x.month.slice(0, 7), v); }
    if (rows.length < 10000) break;
  }
  return m;
}
const mkt = await ff("Mkt-RF"), rf = await ff("RF");
const months = [...mkt.keys()].filter((m) => rf.has(m)).sort()
  .map((m) => ({ m, r: mkt.get(m)! + rf.get(m)!, rf: rf.get(m)! }));
assertNonEmpty("total-return months", months, 600);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const START = Number(K.START), MONTHLY = Number(K.MONTHLY), MAXY = Number(K.MAX_YEARS);
const SPREAD = Number(K.SPREAD_BP) / 1e4;
const LEVS = K.LEVS.split(",").map(Number).filter((x) => Number.isFinite(x));

console.log(`==> LEVERAGE ON THE LADDER — PREREG D-701-leverage`);
console.log(`    ${months.length} months ${months[0].m}..${months[months.length - 1].m}  |  $${START} start, $${MONTHLY}/mo, borrow = RF + ${K.SPREAD_BP}bp\n`);

interface Row { L: number; to10: number; to100: number; ruin: number; dd: number; uw: number; end: number }
const rows: Row[] = [];
for (const L of LEVS) {
  const t10: number[] = [], t100: number[] = [], dds: number[] = [], uws: number[] = [], ends: number[] = [];
  let ruined = 0, paths = 0;
  for (let s = 0; s < months.length; s++) {
    if (months.length - s < 24) break;
    paths++;
    let cap = START, peak = START, worst = 0, uw = 0, luw = 0;
    let hit10: number | null = null, hit100: number | null = null;
    let wiped = false;
    for (let i = s, mo = 0; i < months.length && mo < MAXY * 12; i++, mo++) {
      // Constant leverage L, rebalanced monthly. Borrow is charged on the BORROWED portion (L-1) at RF + spread.
      const borrowCost = (L - 1) * (months[i].rf + SPREAD / 12);
      const gross = L * months[i].r - borrowCost;
      cap = cap * (1 + gross);
      // RUIN IS ABSORBING, and this is the term a median-only study drops. A levered account whose equity reaches
      // zero is gone; contributions afterwards are a NEW account, not a recovery of the old one, and the distinction
      // matters because the ladder question is how long the CLIMB takes.
      if (cap <= 0) { wiped = true; cap = 0; }
      cap += MONTHLY;
      peak = Math.max(peak, cap);
      const d = cap / peak - 1; worst = Math.min(worst, d);
      uw = d < -1e-9 ? uw + 1 : 0; luw = Math.max(luw, uw);
      if (hit10 === null && cap >= 10000) hit10 = mo / 12;
      if (hit100 === null && cap >= 100000) hit100 = mo / 12;
    }
    if (wiped) ruined++;
    if (hit10 !== null) t10.push(hit10);
    if (hit100 !== null) t100.push(hit100);
    dds.push(worst * 100); uws.push(luw / 12); ends.push(cap);
  }
  rows.push({ L, to10: t10.length ? pct(t10, 0.5) : NaN, to100: t100.length ? pct(t100, 0.5) : NaN,
    ruin: 100 * ruined / paths, dd: pct(dds, 0.5), uw: pct(uws, 0.5), end: pct(ends, 0.5) });
}
assertNonEmpty("leverage rows", rows, 3);

console.log(`    ${"leverage".padEnd(10)}${"to $10k".padStart(10)}${"to $100k".padStart(11)}${"RUIN %".padStart(9)}${"med maxDD".padStart(11)}${"med UW yr".padStart(11)}`);
for (const r of rows) {
  console.log(`    ${(r.L.toFixed(2) + "x").padEnd(10)}${(Number.isFinite(r.to10) ? r.to10.toFixed(1) + "y" : "—").padStart(10)}${(Number.isFinite(r.to100) ? r.to100.toFixed(1) + "y" : "—").padStart(11)}${r.ruin.toFixed(1).padStart(9)}${(r.dd.toFixed(0) + "%").padStart(11)}${r.uw.toFixed(1).padStart(11)}`);
}

const base = rows.find((r) => r.L === 1.0)!;
const eligible = rows.filter((r) => r.L > 1 && Number.isFinite(r.to100));
const best = eligible.length ? eligible.reduce((a, b) => (b.to100 < a.to100 ? b : a)) : null;
console.log(`\n    GATE 1 — best leverage at least 2 years faster to $100k than 1.0x:`);
const g1 = !!best && (base.to100 - best.to100) >= 2;
console.log(`      1.0x ${base.to100.toFixed(1)}y  vs  best ${best ? best.L.toFixed(2) + "x " + best.to100.toFixed(1) + "y" : "none"}  ->  ${best ? (base.to100 - best.to100).toFixed(1) : "—"} years ... ${g1 ? "PASS" : "FAIL"}`);
const g2 = !!best && best.ruin < 5;
console.log(`    GATE 2 — ruin rate under 5% at that leverage: ${best ? best.ruin.toFixed(1) + "%" : "—"} ... ${g2 ? "PASS" : "FAIL"}`);

// ---- INSTRUMENT: the placeable daily-rebalanced wrappers -------------------------------------------------------
console.log(`\n    GATE 3 — INSTRUMENT: what a PLACEABLE leveraged ETF actually delivers (they rebalance DAILY):`);
const wraps: Record<string, number> = { SSO: 2, UPRO: 3 };
const wr = new Map<string, Map<string, number>>();
for (const w of [...Object.keys(wraps), "SPY"]) {
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${w}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  await sleep(250);
  const res = j?.chart?.result?.[0], q = res?.indicators?.quote?.[0], adj = res?.indicators?.adjclose?.[0]?.adjclose, ts = res?.timestamp;
  if (!q?.close || !ts) { console.log(`      ${w}: unavailable`); continue; }
  const px: number[][] = [];
  for (let i = 0; i < ts.length; i++) { const c = q.close[i]; if (!(c > 0)) continue; const a = adj?.[i]; px.push([ts[i], (a > 0 ? a : c)]); }
  if (px.length < 500) { console.log(`      ${w}: only ${px.length} bars — EXCLUDED`); continue; }
  const mo = new Map<string, number>();
  for (let i = 0; i < px.length - 1; i++) { const m = new Date(px[i + 1][0] * 1000).toISOString().slice(0, 7); mo.set(m, (mo.get(m) ?? 0) + Math.log(px[i + 1][1] / px[i][1])); }
  const r = new Map<string, number>(); for (const [m, lg] of mo) r.set(m, Math.expm1(lg));
  wr.set(w, r);
}
let bestCap = -Infinity;
if (wr.has("SPY")) {
  for (const [w, L] of Object.entries(wraps)) {
    if (!wr.has(w)) continue;
    const cm = [...wr.get(w)!.keys()].filter((m) => wr.get("SPY")!.has(m)).sort();
    if (cm.length < 60) { console.log(`      ${w}: ${cm.length} common months — UNTESTED`); continue; }
    const wv = cm.map((m) => wr.get(w)!.get(m)!), sv = cm.map((m) => wr.get("SPY")!.get(m)!);
    const annW = Math.expm1(mean(wv.map((x) => Math.log1p(x))) * 12) * 100;
    const annS = Math.expm1(mean(sv.map((x) => Math.log1p(x))) * 12) * 100;
    // What a naive constant-L monthly exposure on the SAME months would have produced, borrow charged the same way.
    const naive = cm.map((m, i) => L * sv[i] - (L - 1) * ((rf.get(m) ?? 0) + SPREAD / 12));
    const annN = Math.expm1(mean(naive.map((x) => Math.log1p(Math.max(-0.99, x)))) * 12) * 100;
    const idxGain = annN - annS, wrapGain = annW - annS;
    const cap = idxGain > 0.25 ? 100 * wrapGain / idxGain : NaN;
    if (Number.isFinite(cap)) bestCap = Math.max(bestCap, cap);
    console.log(`      ${w} (${L}x, ${cm.length} mo ${cm[0]}..${cm[cm.length - 1]}): wrapper ${annW.toFixed(2)}%/yr, SPY ${annS.toFixed(2)}, naive ${L}x ${annN.toFixed(2)}`);
    console.log(`         naive gain over SPY ${idxGain.toFixed(2)}pp, WRAPPER gain ${wrapGain.toFixed(2)}pp -> ${Number.isFinite(cap) ? `CAPTURE ${cap.toFixed(0)}%` : "no positive naive gain to capture over this span"}`);
  }
}
const g3 = Number.isFinite(bestCap) && bestCap >= 50;
console.log(`      GATE 3 — a placeable wrapper captures >= 50% of a POSITIVE gain ... ${g3 ? "PASS" : "FAIL"}`);

console.log(`\n    VERDICT: ${g1 && g2 && g3 ? "ALL THREE GATES PASS — the pre-registered promote rule is met." :
  "KILLED by the pre-registered rule — " + [!g1 ? "speed" : null, !g2 ? "ruin" : null, !g3 ? "instrument" : null].filter(Boolean).join(" + ") + " failed."}`);
console.log(`\n    THE BORROW SPREAD IS THE ASSUMPTION TO ATTACK. ${K.SPREAD_BP}bp over RF is optimistic for retail margin`);
console.log(`    (often 300-800bp) and pessimistic against a box spread (~25-50bp). Re-run with SPREAD_BP to see how`);
console.log(`    much of any result is the financing assumption rather than the leverage.`);
await stampDataVersion(OWNED, hdr, { trd_ff_factors: null });
