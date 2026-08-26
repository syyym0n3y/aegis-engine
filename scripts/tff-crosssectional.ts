#!/usr/bin/env -S deno run --allow-net --allow-env
// tff-crosssectional.ts (D-608) — hedging pressure as a CROSS-SECTIONAL factor, which this board has never tested.
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

const K = declareKnobs("tff-crosssectional", [
  { name: "SIGNAL", def: "hp", note: "hp = DEALER net short / OI (the intermediary analogue) | mm = leveraged-money net long" },
  { name: "LAG_D", def: "6", note: "days from report date to tradable" },
  { name: "COST_BP", def: "10", note: "round trip per rebalance leg" },
  { name: "VOLNORM", def: "1", note: "1 = volatility-normalise weights" },
  { name: "TILTDIAG", def: "1", note: "report the average net position per market" },
  { name: "DEMEAN_CLASS", def: "", note: "1 = demean the signal WITHIN asset class before ranking" },
  { name: "EXCLUDE", def: "", note: "comma-separated symbols to drop (D-608: CHF failed the empirical sign check)" },
  { name: "RANKBY", def: "signal", note: "signal | revN — D-610: rank by trailing N-week return instead, to test the reversal confound" },
  { name: "DUMP", def: "", note: "path to write per-period returns for the alpha regression" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// Same code->symbol mapping the board already uses, so this is comparable to the timing specs it is being set against.
// FINANCIAL futures. The sign column matters: COT is on the FOREIGN CURRENCY future, while Yahoo quotes JPY=X,
// CAD=X, CHF=X and MXN=X as USD-BASE pairs — so a long JPY future is a SHORT USD/JPY position and the return must be
// flipped. These signs are copied from the mapping the board already uses, not re-derived.
const MAP: [string, string[], number][] = [
  ["EURUSD=X", ["099741"], 1], ["GBPUSD=X", ["096742"], 1], ["AUDUSD=X", ["232741"], 1], ["NZDUSD=X", ["112741"], 1],
  ["JPY=X", ["097741"], -1], ["CAD=X", ["090741"], -1], ["CHF=X", ["092741"], -1], ["MXN=X", ["095741"], -1],
  ["^GSPC", ["13874A"], 1], ["TLT", ["020601"], 1],
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const plus = (d: string, days: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };

interface Wk { d: string; sig: number }
const cot = new Map<string, Wk[]>();
const px = new Map<string, { d: string; c: number }[]>();

const SIGN = new Map<string, number>(MAP.map(([a, , c]) => [a, c]));
// D-608: every FX sign convention was verified EMPIRICALLY (does spec net-long the foreign currency future coincide
// with that currency strengthening?). Six of seven verified correct; CHF=X came back +0.053 where the convention
// demands negative. Rather than quietly keep a market whose sign cannot be confirmed, it is droppable and the result
// is reported both ways.
const DROP = new Set((Deno.env.get("EXCLUDE") || "").split(",").map((x) => x.trim()).filter(Boolean));
for (const [sym, codes] of MAP) {
  if (DROP.has(sym)) continue;
  const rows = await fetch(`${OWNED}/trd_cot_tff?market_code=eq.${codes[0]}&select=report_date,oi,dl_l,dl_s,am_l,am_s,lm_l,lm_s&order=report_date&limit=3000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { report_date: string; oi: number; dl_l: number; dl_s: number; am_l: number; am_s: number; lm_l: number; lm_s: number }[];
  if (!Array.isArray(rows) || rows.length < 200) continue;
  const wk: Wk[] = [];
  for (const r of rows) {
    const oi = +r.oi; if (!(oi > 0)) continue;
    // Hedging pressure: net SHORT producer position scaled by open interest — the classic Basu-Miffre construction,
    // where heavy hedger shorting is the compensation-bearing state. mm is the speculator mirror.
    // Dealer net SHORT is the intermediary analogue of producer hedging pressure; leveraged money is the speculator mirror.
    const sig = K.SIGNAL === "mm" ? (+r.lm_l - +r.lm_s) / oi : (+r.dl_s - +r.dl_l) / oi;
    if (Number.isFinite(sig)) wk.push({ d: r.report_date, sig });
  }
  if (wk.length < 150) continue;
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

const syms = assertNonEmpty("markets with both TFF and prices", [...cot.keys()].filter((s) => px.has(s)), 6);
console.log(`\n==> TFF CROSS-SECTIONAL (financial futures) — signal=${K.SIGNAL}, ${syms.length} markets, lag ${K.LAG_D}d, ${K.VOLNORM === "1" ? "vol-normalised" : "equal"} weights`);

// Weekly rebalance: rank markets by signal, long the top HALF, short the bottom half (not quintiles — at 16-24
// markets quintiles would be 3-5 per side, the D-443 shape).
const dates = [...new Set(syms.flatMap((s) => cot.get(s)!.map((w) => w.d)))].sort();
const pxAt = (s: string, d: string) => { const a = px.get(s)!; let lo = 0, hi = a.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { best = m; lo = m + 1; } else hi = m - 1; } return best >= 0 ? a[best].c : null; };

const perWk: { d: string; r: number; n: number }[] = [];
const contrib = new Map<string, number[]>();
const netPos = new Map<string, number[]>();     // per-market contribution, for the drop-one test
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
    cands.push({ s, sig: w.sig, ret: (SIGN.get(s) ?? 1) * (p1 / p0 - 1), vol });   // USD-base pairs flipped
  }
  if (cands.length < 6) continue;
  // D-608 CONTROL. This cross-section mixes FX pairs, an equity index and a bond proxy. Ranking those against each
  // other by dealer positioning may encode nothing more than a persistent ASSET-CLASS TILT — always short equities,
  // always long FX — which is a tilt, not a positioning effect. Demeaning within class removes any such constant.
  // D-610 REVERSAL CONTROL. Same markets, same dates, same construction — only the ranking variable changes. Ranking
  // by NEGATIVE trailing return makes "long the top half" mean "long the recent losers", the standard reversal book.
  const RB = K.RANKBY;
  if (RB.startsWith("rev")) {
    const nWk = Number(RB.slice(3)) || 4;
    for (const c of cands) {
      const back = plus(dates[Math.max(0, i - nWk)], Number(K.LAG_D));
      const pb = pxAt(c.s, back), p0b = pxAt(c.s, d0);
      c.sig = (pb && p0b) ? -(SIGN.get(c.s) ?? 1) * (p0b / pb - 1) : 0;
    }
  }
  if (K.DEMEAN_CLASS === "1") {
    const cls = (x: string) => x === "^GSPC" ? "eq" : x === "TLT" ? "rates" : "fx";
    const byC = new Map<string, number[]>();
    for (const c of cands) (byC.get(cls(c.s)) ?? byC.set(cls(c.s), []).get(cls(c.s))!).push(c.sig);
    const mu = new Map<string, number>();
    for (const [k2, v] of byC) mu.set(k2, v.reduce((a, b2) => a + b2, 0) / v.length);
    for (const c of cands) c.sig -= (mu.get(cls(c.s)) ?? 0);
  }
  cands.sort((a, b) => b.sig - a.sig);
  const half = Math.floor(cands.length / 2);
  const longs = cands.slice(0, half), shorts = cands.slice(-half);
  const wt = (c: typeof cands[number]) => K.VOLNORM === "1" ? 1 / c.vol : 1;
  const gl = longs.reduce((a, c) => a + wt(c), 0), gs = shorts.reduce((a, c) => a + wt(c), 0);
  let r = 0;
  for (const c of longs) { const x = (wt(c) / gl) * c.ret; r += x; (contrib.get(c.s) ?? contrib.set(c.s, []).get(c.s)!).push(x); (netPos.get(c.s) ?? netPos.set(c.s, []).get(c.s)!).push(1); }
  for (const c of shorts) { const x = -(wt(c) / gs) * c.ret; r += x; (contrib.get(c.s) ?? contrib.set(c.s, []).get(c.s)!).push(x); (netPos.get(c.s) ?? netPos.set(c.s, []).get(c.s)!).push(-1); }
  perWk.push({ d: dates[i], r: r - 2 * Number(K.COST_BP) / 1e4, n: cands.length });
}
assertNonEmpty("weekly observations", perWk, 200);

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

if (K.TILTDIAG === "1") {
  console.log(`\n    average net position per market (+1 = always long, -1 = always short):`);
  for (const [sym, v] of [...netPos.entries()].sort((a, b) => (b[1].reduce((x, y) => x + y, 0) / b[1].length) - (a[1].reduce((x, y) => x + y, 0) / a[1].length))) {
    const avg = v.reduce((x, y) => x + y, 0) / v.length;
    console.log(`      ${sym.padEnd(10)} ${avg >= 0 ? "+" : ""}${avg.toFixed(3)}${Math.abs(avg) > 0.6 ? "   <- near-constant tilt" : ""}`);
  }
}
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

// SIGN-REPLICATION criteria, pre-registered. This promotes nothing: the deflated ceiling still governs any tradable
// claim and is deliberately NOT applied as the bar here, because the question is whether a DIRECTION transfers.
const replicates = Math.sign(t) < 0 && Math.abs(t) >= 2.0 && Math.sign(t1) === Math.sign(t2) && Math.sign(t1) === Math.sign(t) && flips === 0;
console.log(`\n    D-607 commodity sign was NEGATIVE at t -4.16. Here: t ${t.toFixed(2)}.`);
console.log(`    ${replicates ? "SIGN REPLICATES across a separate universe — supports a real effect, promotes NOTHING." :
  Math.sign(t) > 0 ? "SIGN IS OPPOSITE — supports competing explanation (a) commodity-specific or (b) the dealer role is not the producer role." :
  `DOES NOT REPLICATE — |t| ${Math.abs(t).toFixed(2)} under 2.0, halves ${Math.sign(t1) === Math.sign(t2) ? "agree" : "DISAGREE"}, ${flips} flip(s).`}`);
