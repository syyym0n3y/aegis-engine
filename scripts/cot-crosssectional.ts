#!/usr/bin/env -S deno run --allow-net --allow-env
// cot-crosssectional.ts (D-607) — hedging pressure as a CROSS-SECTIONAL factor, which this board has never tested.
//
// THE GAP. trd_cot_disagg holds 183,951 weekly rows spanning 2006-2026 against SIX tested specs, and all eighteen
// COT specs on the board are per-market TIMING overlays: weight each market by its own percentile, then equal-average
// across markets. That construction can be net long or net short the entire commodity complex, so it carries complex
// beta. The literature's actual formulation (Basu & Miffre) is RELATIVE: rank markets against each other and hold a
// dollar-neutral long-short. Never run here.
//
// PRE-REGISTERED as D-607-cot-crosssectional with three competing explanations named in advance, the sharpest being
// BREADTH: 24 markets split in halves is 12 vs 12, and D-443 is the precedent where a crypto momentum result at
// SR 1.13 collapsed to 0.34 once breadth was made honest. Halves are used rather than quintiles precisely so this
// does not repeat that error at 5-vs-5.
//
// EXECUTION. COT is surveyed Tuesday and published Friday, so the signal is usable no earlier than publication.
// A 6-day lag from report date is applied, matching the existing board convention (exec: pub_lag6d).
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("cot-crosssectional", [
  { name: "SIGNAL", def: "hp", note: "hp = producer hedging pressure | mm = managed-money positioning" },
  { name: "LAG_D", def: "6", note: "days from report date to tradable" },
  { name: "COST_BP", def: "10", note: "round trip per rebalance leg" },
  { name: "VOLNORM", def: "1", note: "1 = volatility-normalise weights" },
  { name: "RANKBY", def: "signal", note: "signal | revN — D-610 reversal control" },
  { name: "DUMP", def: "", note: "path to write per-period returns" },
  { name: "FROM_D", def: "", note: "D-611: restrict to report dates >= this, to test recent (least-revised) data" },
  { name: "MIN_OBS", def: "200", note: "floor on weekly observations; lowered only for the deliberately short recent-window test" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cx", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// Same code->symbol mapping the board already uses, so this is comparable to the timing specs it is being set against.
const MAP: [string, string[]][] = [
  ["CL=F", ["067651"]], ["NG=F", ["023651"]], ["GC=F", ["088691"]], ["SI=F", ["084691"]],
  ["HG=F", ["085692"]], ["PL=F", ["076651"]], ["PA=F", ["075651"]],
  ["ZC=F", ["002602"]], ["ZW=F", ["001602"]], ["ZS=F", ["005602"]],
  ["KC=F", ["083731"]], ["SB=F", ["080732"]], ["CC=F", ["073732"]], ["CT=F", ["033661"]],
  ["LE=F", ["057642"]], ["HE=F", ["054642"]],
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const plus = (d: string, days: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };

interface Wk { d: string; sig: number }
const cot = new Map<string, Wk[]>();
const px = new Map<string, { d: string; c: number }[]>();

for (const [sym, codes] of MAP) {
  const rows = await fetch(`${OWNED}/trd_cot_disagg?market_code=eq.${codes[0]}&select=report_date,oi,pm_l,pm_s,mm_l,mm_s&order=report_date&limit=3000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { report_date: string; oi: number; pm_l: number; pm_s: number; mm_l: number; mm_s: number }[];
  if (!Array.isArray(rows) || rows.length < 200) continue;
  const wk: Wk[] = [];
  for (const r of rows) {
    const oi = +r.oi; if (!(oi > 0)) continue;
    // Hedging pressure: net SHORT producer position scaled by open interest — the classic Basu-Miffre construction,
    // where heavy hedger shorting is the compensation-bearing state. mm is the speculator mirror.
    const sig = K.SIGNAL === "mm" ? (+r.mm_l - +r.mm_s) / oi : (+r.pm_s - +r.pm_l) / oi;
    if (Number.isFinite(sig)) wk.push({ d: r.report_date, sig });
  }
  if (wk.length < 200) continue;
  cot.set(sym, wk);

  // Prices: daily closes from Yahoo for the mapped continuous future.
  const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=20y`, { headers: { "User-Agent": "Mozilla/5.0" } })
    .then((r) => r.json()).catch(() => null);
  const res = j?.chart?.result?.[0];
  if (!res?.timestamp) { cot.delete(sym); continue; }
  const q = res.indicators.quote[0];
  const series: { d: string; c: number }[] = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    const c = q.close[i]; if (!(c > 0)) continue;
    series.push({ d: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10), c });
  }
  if (series.length > 500) px.set(sym, series); else cot.delete(sym);
}

const syms = assertNonEmpty("markets with both COT and prices", [...cot.keys()].filter((s) => px.has(s)), 8);
console.log(`\n==> COT CROSS-SECTIONAL — signal=${K.SIGNAL}, ${syms.length} markets, lag ${K.LAG_D}d, ${K.VOLNORM === "1" ? "vol-normalised" : "equal"} weights`);

// Weekly rebalance: rank markets by signal, long the top HALF, short the bottom half (not quintiles — at 16-24
// markets quintiles would be 3-5 per side, the D-443 shape).
const dates = [...new Set(syms.flatMap((s) => cot.get(s)!.map((w) => w.d)))].sort().filter((d) => !K.FROM_D || d >= K.FROM_D);
const pxAt = (s: string, d: string) => { const a = px.get(s)!; let lo = 0, hi = a.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { best = m; lo = m + 1; } else hi = m - 1; } return best >= 0 ? a[best].c : null; };

const perWk: { d: string; r: number; n: number }[] = [];
const contrib = new Map<string, number[]>();     // per-market contribution, for the drop-one test
for (let i = 0; i < dates.length - 1; i++) {
  const d0 = plus(dates[i], Number(K.LAG_D)), d1 = plus(dates[i + 1], Number(K.LAG_D));
  const cands: { s: string; sig: number; ret: number; vol: number }[] = [];
  for (const s of syms) {
    const w = cot.get(s)!.find((x) => x.d === dates[i]); if (!w) continue;
    const p0 = pxAt(s, d0), p1 = pxAt(s, d1); if (!p0 || !p1) continue;
    const hist = px.get(s)!.filter((x) => x.d <= d0).slice(-60);
    if (hist.length < 30) continue;
    const rr: number[] = []; for (let k = 1; k < hist.length; k++) rr.push(hist[k].c / hist[k - 1].c - 1);
    const vol = sd(rr) || 1e-6;
    cands.push({ s, sig: w.sig, ret: p1 / p0 - 1, vol });
  }
  if (cands.length < 8) continue;
  // D-610 REVERSAL CONTROL — identical to the TFF version; only the ranking variable changes.
  const RB = K.RANKBY;
  if (RB.startsWith("rev")) {
    const nWk = Number(RB.slice(3)) || 4;
    for (const c of cands) {
      const back = plus(dates[Math.max(0, i - nWk)], Number(K.LAG_D));
      const pb = pxAt(c.s, back), p0b = pxAt(c.s, d0);
      c.sig = (pb && p0b) ? -(p0b / pb - 1) : 0;
    }
  }
  cands.sort((a, b) => b.sig - a.sig);
  const half = Math.floor(cands.length / 2);
  const longs = cands.slice(0, half), shorts = cands.slice(-half);
  const wt = (c: typeof cands[number]) => K.VOLNORM === "1" ? 1 / c.vol : 1;
  const gl = longs.reduce((a, c) => a + wt(c), 0), gs = shorts.reduce((a, c) => a + wt(c), 0);
  let r = 0;
  for (const c of longs) { const x = (wt(c) / gl) * c.ret; r += x; (contrib.get(c.s) ?? contrib.set(c.s, []).get(c.s)!).push(x); }
  for (const c of shorts) { const x = -(wt(c) / gs) * c.ret; r += x; (contrib.get(c.s) ?? contrib.set(c.s, []).get(c.s)!).push(x); }
  perWk.push({ d: dates[i], r: r - 2 * Number(K.COST_BP) / 1e4, n: cands.length });
}
assertNonEmpty("weekly observations", perWk, Number(K.MIN_OBS));

if (K.DUMP) await Deno.writeTextFile(K.DUMP, perWk.map((x) => `${x.d}\t${x.r}`).join("\n"));
const rs = perWk.map((x) => x.r);
const m = mean(rs), s2 = sd(rs) || 1e-12;
const t = m / (s2 / Math.sqrt(rs.length));
const ann = m * 52 * 100, shp = (m / s2) * Math.sqrt(52);
const h = Math.floor(rs.length / 2);
const t1 = mean(rs.slice(0, h)) / (sd(rs.slice(0, h)) / Math.sqrt(h) || 1e-12);
const t2 = mean(rs.slice(h)) / (sd(rs.slice(h)) / Math.sqrt(rs.length - h) || 1e-12);
console.log(`    weeks ${rs.length}, mean breadth ${(mean(perWk.map((x) => x.n))).toFixed(1)} markets`);
console.log(`    net ${ann.toFixed(2)}%/yr  Sharpe ${shp.toFixed(2)}  portfolio t ${t.toFixed(2)}  halves t ${t1.toFixed(2)} / ${t2.toFixed(2)}`);

// DROP-ONE: if removing any single market flips the sign, the "factor" is a few bets (competing explanation (a)).
console.log(`\n    drop-one test (sign must survive removing any single market):`);
let flips = 0;
for (const s of syms) {
  const idx = new Map<string, number>();
  perWk.forEach((w, i) => idx.set(w.d, i));
  const adj = rs.slice();
  const c = contrib.get(s) ?? [];
  // Recompute crudely: subtract this market's contributions in the weeks it appeared.
  let ci = 0;
  for (let i = 0; i < perWk.length && ci < c.length; i++) { adj[i] -= c[ci]; ci++; }
  const mm = mean(adj);
  if (Math.sign(mm) !== Math.sign(m)) { flips++; console.log(`      ${s}: DROPPING FLIPS THE SIGN (${(mm * 52 * 100).toFixed(2)}%/yr)`); }
}
if (!flips) console.log(`      no single market flips the sign across ${syms.length} markets.`);

const CEIL = 5.41;
const pass = Math.abs(t) > CEIL && Math.sign(t1) === Math.sign(t2) && Math.sign(t1) === Math.sign(t) && flips === 0;
console.log(`\n    ${pass ? "QUALIFIES" : "DOES NOT QUALIFY"} — portfolio |t| ${Math.abs(t).toFixed(2)} vs ceiling ${CEIL}; halves ${Math.sign(t1) === Math.sign(t2) ? "agree" : "DISAGREE"}; ${flips} market(s) flip the sign.`);
