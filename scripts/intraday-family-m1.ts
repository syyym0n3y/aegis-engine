#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
// intraday-family-m1.ts (D-713) — does intraday trading of ANY kind beat holding, at minute resolution?
//
// THE QUESTION BEHIND THE ONE MODEL. D-708/711 tested one externally-supplied breakout checklist and found no edge
// over holding. That is one rule. The ladder work (D-680..D-702) established that the levers which actually move a
// contribution-funded account are structural — deposits, financing, not panic-selling, holding a total-return
// vehicle — and that no signal in 1,059 specifications clears the bar. Intraday was never tested at all, because
// the resolution to test it did not exist here until D-709.
//
// It does now: 1,200,240 minute bars, 3,334 days, 2016-2026. So the honest question is not "does this checklist
// work" but "does ANY simple intraday rule on this instrument beat simply holding it, after costs a retail account
// actually pays". A family, not a rule, so a null means something.
//
// FIVE RULE CLASSES, each a documented retail staple, all long AND short, all benchmarked against holding the same
// window, all costed, all at minute resolution where D-712 showed coarse bars conjure a t of 4.30 from nothing:
//   OPEN_BREAK   break of the opening range         (the D-708 family, included as the control)
//   TOD          be long a fixed time-of-day window (the "power hour" / "first hour" folklore)
//   MOM          continue the first hour's direction
//   REV          fade the first hour's direction
//   GAP          fade or follow the overnight gap
//
// EVERY SPEC IS A TRIAL and the ceiling reflects them. The point of running a FAMILY is that the best of N is
// expected to look good; the deflation bar is what makes that expectation explicit rather than exciting.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("intraday-family-m1", [
  { name: "CACHE", def: "/Users/ona/aegis-data/m1_USATECHIDXUSD.jsonl.gz", note: "minute bars (D-709)" },
  { name: "COST_BP", def: "1.5", note: "round-trip in bp — MNQ commission on ~$54k notional plus a 0.25pt spread" },
  { name: "WINDOW_MIN", def: "150", note: "minutes from the 8:30 CT open to the close of the trade window" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ifm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

function isDST(d: string): boolean {
  const [y, m, dd] = d.split("-").map(Number);
  const nth = (yr: number, mo: number, dow: number, n: number) => {
    const f = new Date(Date.UTC(yr, mo - 1, 1));
    return 1 + ((dow - f.getUTCDay() + 7) % 7) + (n - 1) * 7;
  };
  if (m > 3 && m < 11) return true;
  if (m === 3) return dd >= nth(y, 3, 0, 2);
  if (m === 11) return dd < nth(y, 11, 0, 1);
  return false;
}

const raw = await Deno.readFile(K.CACHE);
const text = new TextDecoder().decode(new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()));
const days = text.trim().split("\n").map((l) => { const o = JSON.parse(l) as { d: string; b: number[][] }; return { d: o.d, bars: o.b }; });
assertNonEmpty("cached days", days, 1000);
if (days.some((x) => !Array.isArray(x.bars))) { console.error("!! a cached day has no bar array — RED."); Deno.exit(1); }

const COST = Number(K.COST_BP) / 1e4, WIN = Number(K.WINDOW_MIN);

// Pre-slice every day once: the session window, plus the previous close for the gap rules.
interface Sess { d: string; bars: number[][]; open: number; prevClose: number }
const sess: Sess[] = [];
let prevLast = NaN;
for (const day of days) {
  const openSec = (isDST(day.d) ? 13 : 14) * 3600 + 30 * 60;
  const w = day.bars.filter((b) => b[0] >= openSec && b[0] < openSec + WIN * 60);
  const dayLast = day.bars.length ? day.bars[day.bars.length - 1][4] : NaN;
  if (w.length >= 60 && w[0][1] > 0) sess.push({ d: day.d, bars: w, open: w[0][1], prevClose: prevLast });
  if (Number.isFinite(dayLast)) prevLast = dayLast;
}
assertNonEmpty("sessions", sess, 500);
console.log(`==> INTRADAY RULE FAMILY AT MINUTE RESOLUTION — ${sess.length} sessions, ${sess[0].d}..${sess[sess.length - 1].d}\n`);

interface Spec { cls: string; name: string; f: (s: Sess) => { r: number; b: number } | null }
const specs: Spec[] = [];

// The BENCHMARK for every rule is holding the same window, so a rule that merely captures drift shows zero excess.
const holdRet = (s: Sess, from: number, to: number) => {
  const a = s.bars.find((b) => b[0] >= s.bars[0][0] + from * 60);
  const z = [...s.bars].reverse().find((b) => b[0] < s.bars[0][0] + to * 60);
  return a && z ? (z[4] - a[1]) / a[1] : null;
};

// 1. OPEN_BREAK — the D-708 family, kept as the control
for (const orb of [15, 30]) {
  specs.push({ cls: "OPEN_BREAK", name: `orb${orb}`, f: (s) => {
    const o = s.bars.filter((b) => b[0] < s.bars[0][0] + orb * 60);
    if (o.length < orb / 2) return null;
    const hi = Math.max(...o.map((b) => b[2])), lo = Math.min(...o.map((b) => b[3]));
    const rest = s.bars.filter((b) => b[0] >= s.bars[0][0] + orb * 60);
    if (!rest.length || !(hi > lo)) return null;
    const ref = o[o.length - 1][4], last = rest[rest.length - 1][4];
    for (const b of rest) {
      if (b[2] > hi && b[3] < lo) return { r: (((last - hi) / hi) + ((lo - last) / lo)) / 2, b: (last - ref) / ref };
      if (b[2] > hi) return { r: (last - hi) / hi, b: (last - ref) / ref };
      if (b[3] < lo) return { r: (lo - last) / lo, b: (last - ref) / ref };
    }
    return null;
  } });
}
// 2. TOD — long a fixed minute window, the "first hour" / "power hour" folklore
for (const [a, b] of [[0, 30], [0, 60], [30, 90], [60, 150], [90, 150]] as [number, number][]) {
  specs.push({ cls: "TOD", name: `long ${a}-${b}m`, f: (s) => {
    const r = holdRet(s, a, b); const bm = holdRet(s, 0, WIN);
    return r === null || bm === null ? null : { r, b: bm };
  } });
}
// 3/4. MOM and REV on the first hour's direction
for (const look of [30, 60]) for (const sign of [1, -1]) {
  specs.push({ cls: sign === 1 ? "MOM" : "REV", name: `${look}m signal`, f: (s) => {
    const o = s.bars.filter((b) => b[0] < s.bars[0][0] + look * 60);
    if (o.length < look / 2) return null;
    const dir = Math.sign(o[o.length - 1][4] - o[0][1]);
    if (dir === 0) return null;
    const r = holdRet(s, look, WIN); const bm = holdRet(s, 0, WIN);
    return r === null || bm === null ? null : { r: sign * dir * r, b: bm };
  } });
}
// 5. GAP — follow or fade the overnight gap
for (const sign of [1, -1]) {
  specs.push({ cls: sign === 1 ? "GAP_FOLLOW" : "GAP_FADE", name: "overnight gap", f: (s) => {
    if (!Number.isFinite(s.prevClose) || s.prevClose <= 0) return null;
    const dir = Math.sign(s.open - s.prevClose);
    if (dir === 0) return null;
    const r = holdRet(s, 0, WIN); const bm = r;
    return r === null ? null : { r: sign * dir * r, b: bm! };
  } });
}

console.log(`    ${"class".padEnd(12)}${"spec".padEnd(14)}${"n".padStart(6)}${"mean%".padStart(10)}${"t".padStart(7)}${"bench%".padStart(9)}${"EXCESS%".padStart(10)}${"NET%".padStart(9)}${"eras".padStart(7)}`);
const results: { cls: string; name: string; n: number; ex: number; t: number; net: number }[] = [];
for (const sp of specs) {
  const rr: number[] = [], bb: number[] = [];
  for (const s of sess) { const v = sp.f(s); if (!v) continue; rr.push(v.r); bb.push(v.b); }
  if (rr.length < 500) continue;
  const ex = rr.map((x, i) => x - bb[i]);
  const q4 = [0, 1, 2, 3].map((e) => mean(ex.slice(Math.floor(e * ex.length / 4), Math.floor((e + 1) * ex.length / 4))));
  const net = (mean(ex) - COST) * 100;
  results.push({ cls: sp.cls, name: sp.name, n: rr.length, ex: mean(ex) * 100, t: tstat(ex), net });
  console.log(`    ${sp.cls.padEnd(12)}${sp.name.padEnd(14)}${String(rr.length).padStart(6)}${(mean(rr) * 100).toFixed(4).padStart(10)}${tstat(rr).toFixed(2).padStart(7)}${(mean(bb) * 100).toFixed(4).padStart(9)}${(mean(ex) * 100).toFixed(4).padStart(10)}${net.toFixed(4).padStart(9)}${q4.map((x) => x > 0 ? "+" : "-").join("").padStart(7)}`);
}
assertNonEmpty("specs evaluated", results, 5);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "intraday-family-m1",
  runId: `ifm1|${specs.length}specs|${WIN}m`, spent: results.length });
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()}  |  DEFLATION CEILING ${spend.ceiling.toFixed(4)}`);
const clears = results.filter((r) => Math.abs(r.t) > spend.ceiling);
const netPos = results.filter((r) => r.net > 0);
console.log(`    specs clearing the ceiling on the EXCESS: ${clears.length} of ${results.length}`);
console.log(`    specs net-positive on the excess after ${K.COST_BP}bp: ${netPos.length} of ${results.length}`);
if (netPos.length) for (const r of netPos) console.log(`      ${r.cls} ${r.name}: excess ${r.ex.toFixed(4)}% t ${r.t.toFixed(2)} net ${r.net.toFixed(4)}%`);
console.log(`\n    The benchmark for every row is HOLDING the same window, so a rule that merely captures the day's`);
console.log(`    drift reports zero excess. A family-wide null is a stronger statement than any single rule's.`);
