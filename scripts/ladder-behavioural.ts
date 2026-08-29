#!/usr/bin/env -S deno run --allow-net --allow-env
// ladder-behavioural.ts (D-702) — three register items testable with data already on disk.
//
// WHY THESE THREE TOGETHER. `coverage-map.ts` left 22 approaches with no ledger evidence. Most need data we do not
// have. Three do not, and they share the ladder machinery: BEHAVIOURAL ERROR, CURRENCY OF ACCOUNT, and TAX-LOSS
// HARVESTING. Testing them in one place makes their magnitudes directly comparable, which is the whole point of the
// ladder frame — every lever gets priced in the same unit, years to $100,000.
//
// THE FIRST ONE IS THE LARGEST DOCUMENTED DRAG IN RETAIL INVESTING and this programme has never touched it. The
// investor-versus-fund return gap is the observation that the money in a fund earns less than the fund does, because
// it arrives after rises and leaves after falls. Estimates vary and are contested, but the DIRECTION is not: nobody
// finds investors beating their own funds. It is worth measuring here because unlike every signal on this board it
// requires no edge to capture — it is a drag you avoid rather than a return you find.
//
// HOW BEHAVIOUR IS MODELLED, and the modelling is the honest part. A rule: if the account's drawdown from its peak
// exceeds THRESHOLD, sell to cash, and re-enter after the market has recovered RECOVERY% from its low. That is a
// caricature of panic — real capitulation is not a threshold rule — but it is a caricature with the right SIGN and a
// tunable severity, and it makes the cost a number instead of an adjective. It is deliberately NOT calibrated to any
// survey estimate: the point is the shape of the cost, not a claim to have measured any real investor's behaviour.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("ladder-behavioural", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "MAX_YEARS", def: "45" },
  { name: "CASH_DRAG", def: "0", note: "bp/yr earned while sitting in cash beyond RF; 0 = cash earns exactly RF" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lb", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

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
assertNonEmpty("months", months, 600);

const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const START = Number(K.START), MONTHLY = Number(K.MONTHLY), MAXY = Number(K.MAX_YEARS);

// ---------------------------------------------------------------------------
// 1. BEHAVIOUR: capitulate at a drawdown, re-enter after a recovery
// ---------------------------------------------------------------------------
function walkBehaviour(sellDD: number | null, reenterUp: number) {
  const t100: number[] = [], t10: number[] = [];
  let totalOut = 0, paths = 0, everSold = 0;
  for (let s = 0; s < months.length; s++) {
    if (months.length - s < 24) break;
    paths++;
    let cap = START, peak = 1, idx = 1, low = 1, inMkt = true, monthsOut = 0, sold = false;
    let h10: number | null = null, h100: number | null = null;
    for (let i = s, mo = 0; i < months.length && mo < MAXY * 12; i++, mo++) {
      idx *= 1 + months[i].r;
      peak = Math.max(peak, idx);
      if (inMkt) {
        cap = cap * (1 + months[i].r);
        // The decision is made on the MARKET's drawdown, not the funded balance: contributions lift the balance
        // through a bear market, so a rule keyed on the balance would rarely fire and would understate the cost.
        if (sellDD !== null && idx / peak - 1 <= sellDD) { inMkt = false; low = idx; sold = true; }
      } else {
        cap = cap * (1 + months[i].rf);       // sits in cash, earning the risk-free rate
        monthsOut++;
        low = Math.min(low, idx);
        if (idx / low - 1 >= reenterUp) inMkt = true;
      }
      cap += MONTHLY;
      if (h10 === null && cap >= 10000) h10 = mo / 12;
      if (h100 === null && cap >= 100000) h100 = mo / 12;
    }
    if (h10 !== null) t10.push(h10);
    if (h100 !== null) t100.push(h100);
    totalOut += monthsOut; if (sold) everSold++;
  }
  return { to10: t10.length ? pct(t10, 0.5) : NaN, to100: t100.length ? pct(t100, 0.5) : NaN,
    outYears: totalOut / paths / 12, soldPct: 100 * everSold / paths };
}

console.log(`==> BEHAVIOUR, CURRENCY AND HARVESTING ON THE LADDER — three register items, one unit (years to $100k)`);
console.log(`    ${months.length} months ${months[0].m}..${months[months.length - 1].m}\n`);
console.log(`  1. BEHAVIOURAL ERROR — sell at a drawdown, re-enter after a recovery. Cash earns RF.`);
console.log(`     ${"rule".padEnd(34)}${"to $10k".padStart(10)}${"to $100k".padStart(11)}${"yrs in cash".padStart(13)}${"% paths sold".padStart(14)}`);
const RULES: { name: string; dd: number | null; up: number }[] = [
  { name: "never sells (hold through)", dd: null, up: 0 },
  { name: "sells at -20%, back after +20%", dd: -0.20, up: 0.20 },
  { name: "sells at -30%, back after +20%", dd: -0.30, up: 0.20 },
  { name: "sells at -20%, back after +50%", dd: -0.20, up: 0.50 },
  { name: "sells at -10%, back after +20%", dd: -0.10, up: 0.20 },
];
const bres: { name: string; r: ReturnType<typeof walkBehaviour> }[] = [];
for (const rr of RULES) {
  const r = walkBehaviour(rr.dd, rr.up);
  bres.push({ name: rr.name, r });
  console.log(`     ${rr.name.padEnd(34)}${(Number.isFinite(r.to10) ? r.to10.toFixed(1) + "y" : "—").padStart(10)}${(Number.isFinite(r.to100) ? r.to100.toFixed(1) + "y" : "—").padStart(11)}${r.outYears.toFixed(1).padStart(13)}${r.soldPct.toFixed(0).padStart(14)}`);
}
const hold = bres[0].r;
console.log(`\n     COST OF SELLING, against never selling:`);
for (const b of bres.slice(1)) {
  console.log(`       ${b.name.padEnd(34)} ${(b.r.to100 - hold.to100 >= 0 ? "+" : "")}${(b.r.to100 - hold.to100).toFixed(1)} years to $100k`);
}

// ---------------------------------------------------------------------------
// 2. CURRENCY OF ACCOUNT
// ---------------------------------------------------------------------------
console.log(`\n  2. CURRENCY OF ACCOUNT — the same USD holding, measured in a different home currency.`);
const fxSyms = ["GBPUSD=X", "EURUSD=X", "JPY=X"];
const fx = new Map<string, Map<string, number>>();
for (const s of fxSyms) {
  const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(s)}&select=bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { bars: number[][] }[];
  const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0);
  if (bars.length < 500) { console.log(`     ${s}: ${bars.length} bars — EXCLUDED`); continue; }
  const mo = new Map<string, number>();
  for (let i = 0; i < bars.length - 1; i++) {
    const m = new Date(bars[i + 1][0] * 1000).toISOString().slice(0, 7);
    mo.set(m, (mo.get(m) ?? 0) + Math.log(bars[i + 1][4] / bars[i][4]));
  }
  const r = new Map<string, number>();
  for (const [m, lg] of mo) r.set(m, Math.expm1(lg));
  fx.set(s, r);
}
console.log(`     ${"home currency".padEnd(22)}${"to $10k".padStart(10)}${"to $100k".padStart(11)}${"vs USD".padStart(10)}`);
function yearsIn(conv: Map<string, number> | null, invert: boolean) {
  const got10: number[] = [], got100: number[] = [];
  const usable = months.filter((x) => !conv || conv.has(x.m));
  if (usable.length < 120) return { a: NaN, b: NaN, n: usable.length };
  for (let s = 0; s < usable.length; s++) {
    if (usable.length - s < 24) break;
    let cap = START; let h10: number | null = null, h100: number | null = null;
    for (let i = s, mo = 0; i < usable.length && mo < MAXY * 12; i++, mo++) {
      // A USD asset held by a non-USD investor: the home-currency return is the asset return plus the change in the
      // value of USD against the home currency. Quotes here are USD-per-unit-of-foreign, so USD strength is a FALL
      // in the quote — `invert` carries that, and getting it backwards would silently reverse the whole result.
      const fxr = conv ? (conv.get(usable[i].m) ?? 0) : 0;
      const r = (1 + usable[i].r) * (1 + (invert ? fxr : -fxr)) - 1;
      cap = cap * (1 + r) + MONTHLY;
      if (h10 === null && cap >= 10000) h10 = mo / 12;
      if (h100 === null && cap >= 100000) h100 = mo / 12;
    }
    if (h10 !== null) got10.push(h10);
    if (h100 !== null) got100.push(h100);
  }
  return { a: got10.length ? pct(got10, 0.5) : NaN, b: got100.length ? pct(got100, 0.5) : NaN, n: usable.length };
}
const usdBase = yearsIn(null, false);
console.log(`     ${"USD (base)".padEnd(22)}${usdBase.a.toFixed(1).padStart(9)}y${usdBase.b.toFixed(1).padStart(10)}y${"—".padStart(10)}`);
for (const s of fxSyms) {
  if (!fx.has(s)) continue;
  // GBPUSD/EURUSD quote USD per foreign unit: a RISE means the foreign currency strengthened, which HURTS a USD
  // holding measured at home. JPY=X quotes yen per USD, the other way round.
  const invert = s === "JPY=X";
  const r = yearsIn(fx.get(s)!, invert);
  const label = s === "GBPUSD=X" ? "GBP" : s === "EURUSD=X" ? "EUR" : "JPY";
  // THE COMPARISON MUST BE ON THE SAME MONTHS. The first version compared each currency against the USD baseline
  // computed on the FULL 756-month panel while the currency rows span only their own 271-356 month overlap — an ERA
  // difference reported as a CURRENCY difference, which is the confound this programme's laws exist to catch, and it
  // produced a tidy -1.2 to -1.4 years that meant nothing. The baseline is now restricted to the identical months.
  const matched = new Map<string, number>();
  for (const m of fx.get(s)!.keys()) matched.set(m, 0);          // zero FX change = the USD investor, same months
  const cmp = yearsIn(matched, invert);
  console.log(`     ${(label + ` (${r.n} common mo)`).padEnd(22)}${r.a.toFixed(1).padStart(9)}y${r.b.toFixed(1).padStart(10)}y${((r.b - cmp.b >= 0 ? "+" : "") + (r.b - cmp.b).toFixed(1) + "y").padStart(10)}${("USD same span " + cmp.b.toFixed(1) + "y").padStart(22)}`);
}

// ---------------------------------------------------------------------------
// 3. TAX-LOSS HARVESTING
// ---------------------------------------------------------------------------
console.log(`\n  3. TAX-LOSS HARVESTING — a credit worth (loss x rate) banked in down years, reinvested.`);
console.log(`     ${"annual credit".padEnd(22)}${"to $100k".padStart(11)}${"20yr terminal".padStart(15)}`);
for (const cred of [0, 0.002, 0.005, 0.010]) {
  const got: number[] = [], term: number[] = [];
  for (let s = 0; s < months.length; s++) {
    if (months.length - s < 24) break;
    let cap = START; let h: number | null = null;
    for (let i = s, mo = 0; i < months.length && mo < MAXY * 12; i++, mo++) {
      // Modelled as a credit accruing only while the position is at a loss against a running high — harvesting has
      // nothing to harvest in a market that only rises, and a flat annual credit would overstate it by pretending
      // otherwise.
      cap = cap * (1 + months[i].r + (months[i].r < 0 ? cred / 12 : 0)) + MONTHLY;
      if (h === null && cap >= 100000) h = mo / 12;
      if (mo === 20 * 12 - 1) term.push(cap);
    }
    if (h !== null) got.push(h);
  }
  console.log(`     ${((cred * 100).toFixed(1) + "%/yr while down").padEnd(22)}${(got.length ? pct(got, 0.5).toFixed(1) + "y" : "—").padStart(11)}${("$" + Math.round(pct(term, 0.5)).toLocaleString()).padStart(15)}`);
}

console.log(`\n  READ ALL THREE AGAINST THE SAME BENCHMARK (D-680): a sustained +5%/yr NET alpha, which 1,059`);
console.log(`  specifications failed to produce, buys 4.1 years off the climb to $100,000.`);
await stampDataVersion(OWNED, hdr, { trd_ff_factors: null, trd_bars_deep: null });
