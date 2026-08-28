#!/usr/bin/env -S deno run --allow-net --allow-env
// ladder-entry-timing.ts (D-691) — does it matter WHEN on the cycle you start the climb?
//
// THE QUESTION, AND WHY IT IS NOT A TIMING STRATEGY. D-680 walked 733 start months and reported medians. A median
// hides the thing an account actually experiences: someone starting in 1999 met the dot-com bust while the balance
// was smallest, someone starting in 2009 got a decade of tailwind first. The ladder's answer may therefore be an
// average over two very different regimes rather than a description of either.
//
// This does NOT test a rule for when to start. Nobody chooses their birth year, and a rule that says "wait for a
// drawdown" is a market-timing overlay of exactly the kind D-649 measured costing ~5.7pp/yr. The question here is
// descriptive: conditional on the state of the market the day you begin — which is KNOWABLE that day, so this is
// conditioning, not look-ahead — how different is the climb?
//
// THE CONDITIONING VARIABLE IS DELIBERATELY THE CRUDEST ONE AVAILABLE. Trailing drawdown from the running high needs
// no valuation data (CAPE is not held here, and FRED is credential-blocked), is computable from the price series
// alone, and is knowable at entry. A richer conditioner would be a better predictor and a worse test: the point is
// whether the ladder is regime-sensitive at all, not to find the best conditioner.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ladder-entry-timing", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "MAX_YEARS", def: "45" },
  { name: "ER_BP", def: "3", note: "expense ratio bp/yr" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "let", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function stream(name: string) {
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
const mkt = await stream("Mkt-RF"), rf = await stream("RF");
const months = [...mkt.keys()].filter((m) => rf.has(m)).sort().map((m) => ({ m, r: mkt.get(m)! + rf.get(m)! }));
assertNonEmpty("total-return months", months, 600);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// Trailing drawdown at each month, from the running high of the total-return index. Knowable that day.
const dd: number[] = [];
{ let cum = 1, pk = 1; for (const x of months) { cum *= 1 + x.r; pk = Math.max(pk, cum); dd.push(cum / pk - 1); } }

const START = Number(K.START), MONTHLY = Number(K.MONTHLY), MAXY = Number(K.MAX_YEARS), ER = Number(K.ER_BP) / 1e4;
const LEVELS = [10000, 100000];
const LABEL = ["$10k", "$100k"];

interface P { start: string; ddAtEntry: number; hit: (number | null)[]; monthsRun: number; worstDD: number }
const paths: P[] = [];
for (let s = 0; s < months.length; s++) {
  if (months.length - s < 24) break;
  let cap = START, peak = START, worst = 0;
  const hit: (number | null)[] = LEVELS.map(() => null);
  let mo = 0;
  for (let i = s; i < months.length && mo < MAXY * 12; i++, mo++) {
    cap = cap * (1 - ER / 12) * (1 + months[i].r) + MONTHLY;
    peak = Math.max(peak, cap); worst = Math.min(worst, cap / peak - 1);
    LEVELS.forEach((L, k) => { if (hit[k] === null && cap >= L) hit[k] = mo / 12; });
  }
  paths.push({ start: months[s].m, ddAtEntry: dd[s], hit, monthsRun: mo, worstDD: worst });
}
assertNonEmpty("paths", paths, 100);

// Buckets by the state of the market on the day of entry.
const BUCKETS: { name: string; test: (d: number) => boolean }[] = [
  { name: "at/near a high", test: (d) => d > -0.05 },
  { name: "-5% to -15%", test: (d) => d <= -0.05 && d > -0.15 },
  { name: "-15% to -30%", test: (d) => d <= -0.15 && d > -0.30 },
  { name: "deeper than -30%", test: (d) => d <= -0.30 },
];

console.log(`==> LADDER ENTRY TIMING — ${months.length} months, ${months[0].m} .. ${months[months.length - 1].m}`);
console.log(`    start $${START}  contribution $${MONTHLY}/mo  ${paths.length} start months\n`);
console.log(`    ${"market on entry day".padEnd(20)}${"n".padStart(5)}${LABEL.map((l) => `${l} med`.padStart(11)).join("")}${LABEL.map((l) => `${l} p90`.padStart(11)).join("")}${"worst DD".padStart(11)}`);

const rows: { name: string; n: number; med: (number | null)[] }[] = [];
for (const b of BUCKETS) {
  const sub = paths.filter((p) => b.test(p.ddAtEntry));
  if (!sub.length) { console.log(`    ${b.name.padEnd(20)}${"0".padStart(5)}`); continue; }
  const med: (number | null)[] = [];
  const cells: string[] = [], p90s: string[] = [];
  LEVELS.forEach((_, k) => {
    const got = sub.map((p) => p.hit[k]).filter((x): x is number => x !== null);
    med.push(got.length ? pct(got, 0.5) : null);
    cells.push((got.length ? pct(got, 0.5).toFixed(1) + "y" : "—").padStart(11));
    p90s.push((got.length ? pct(got, 0.9).toFixed(1) + "y" : "—").padStart(11));
  });
  const wd = mean(sub.map((p) => p.worstDD)) * 100;
  console.log(`    ${b.name.padEnd(20)}${String(sub.length).padStart(5)}${cells.join("")}${p90s.join("")}${(wd.toFixed(0) + "%").padStart(11)}`);
  rows.push({ name: b.name, n: sub.length, med });
}

// THE COUNT THAT DECIDES WHETHER ANY OF THIS IS ACTIONABLE. A conditioner that only fires rarely cannot be waited
// for: an account that sits in cash waiting for a -30% entry spends most of history not invested, and the ladder is
// a compounding problem where time out of the market is the dominant cost.
const deep = paths.filter((p) => p.ddAtEntry <= -0.30).length;
const near = paths.filter((p) => p.ddAtEntry > -0.05).length;
console.log(`\n    AVAILABILITY: ${near} of ${paths.length} months (${(100 * near / paths.length).toFixed(0)}%) are within 5% of a high;`);
console.log(`    only ${deep} (${(100 * deep / paths.length).toFixed(1)}%) are deeper than -30%.`);
console.log(`    A rule that waits for the deep bucket is out of the market ~${(100 - 100 * deep / paths.length).toFixed(0)}% of the time, and this`);
console.log(`    script does NOT evaluate that rule — it is a timing overlay, and D-649 measured the class costing ~5.7pp/yr.`);

const hi = rows.find((r) => r.name === "at/near a high"), lo = rows.find((r) => r.name === "deeper than -30%");
if (hi && lo && hi.med[0] !== null && lo.med[0] !== null) {
  console.log(`\n    DIFFERENCE, entering at a high vs after a >30% fall:`);
  LEVELS.forEach((_, k) => {
    if (hi.med[k] === null || lo.med[k] === null) return;
    console.log(`      to ${LABEL[k].padEnd(6)}: ${hi.med[k]!.toFixed(1)}y at a high vs ${lo.med[k]!.toFixed(1)}y after the fall — ${(hi.med[k]! - lo.med[k]!).toFixed(1)}y`);
  });
  console.log(`\n    Read it as a description of dispersion the median hides, not as an instruction. The entry state is`);
  console.log(`    knowable on the day, so the conditioning is legitimate; ACTING on it is a different claim that this`);
  console.log(`    does not test and that the trend-overlay evidence argues against.`);
}
