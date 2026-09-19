#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// multistrategy-blend.ts (D-865) — PREREG: D-865-multistrategy-blend. The portfolio question: a Sharpe rises through
// diversification across UNCORRELATED books, not a better signal. Sleeves, all on the same 110-asset daily panel and
// OOS window as D-863: (a) TREND — the D-863 combo; (b) LONG — the vol-matched long-only basket; (c) CARRY — FX
// interest differentials from the held 3-month rates (long high-rate vs short low-rate, vol-scaled, monthly);
// (d) VALUE — 5-year return reversal, bottom quartile long / top quartile short within class, vol-scaled, monthly.
// Blend = risk parity (equal ex-ante vol weight, from trailing 60-day sleeve vol). No weight is optimised on OOS.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("multistrategy-blend", [{ name: "OOS_FROM", def: "2015-01-01" }, { name: "VOL_TARGET", def: "0.10" }, { name: "REBAL_D", def: "5" }, { name: "MIN_YEARS", def: "10" }, { name: "MAX_CRYPTO", def: "10" }, { name: "COST_MULT", def: "1", note: "2 = double every class cost (the retail-access question)" }, { name: "SLEEVES", def: "trend,long,carry,value", note: "the registered blend is all four; any subset is DESCRIPTIVE ONLY (a subset chosen after seeing OOS sleeve results is a pick made on the evaluation window, D-455)" }, { name: "RUN_ID", def: "D-865-multistrategy-blend" }, { name: "PAPER", def: "0", note: "1 = stand up the 3-factor blend on paper (DORMANT snapshot + forward mark for fwd-three-factor-blend)" }, { name: "PAPER_START", def: "2026-09-15" }, { name: "PAPER_RULE", def: "fwd-three-factor-blend" }, { name: "PAPER_SPEC", def: "three-factor-blend" }, { name: "REGIME", def: "0", note: "1 = print per-sleeve regime dependence (own active-halves + shared calendar eras) — read-only, no writes" }, { name: "STRESS", def: "", note: "a FROM:TO date window (e.g. 2021-01-01:2021-12-31) to stress-test the blend in that regime — path, attribution, leave-one-out, worst rolling quarter; read-only" }, { name: "HEDGE_SPEC", def: "", note: "D-946: filename under data/ of a daily hedge series {d,ret}[] to OVERLAY on the blend (e.g. d946-squeeze-daily.json); read-only" }, { name: "HEDGE_FRAC", def: "0,0.05,0.1,0.2", note: "comma list of hedge vol allocations as fractions of VOL_TARGET to sweep in the overlay" }, { name: "DEGROSS", def: "0", note: "D-947: 1 = train/test a CONDITIONAL de-gross of the distress+ivol short legs on a junk-momentum (own-bleed) trigger; rule chosen on TRAIN only, frozen, applied to TEST; read-only" }, { name: "TRAIN_END", def: "2020-12-31", note: "last TRAIN day; TEST = days after it (default puts the Jan-2021 squeeze in the held-out TEST set)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "msb2", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const COST: Record<string, number> = { fx: 2, index: 4, intl_index: 4, rate: 4, etf: 4, sector: 4, commodity: 6, crypto: 9 };
const meta = await q(`trd_bars_deep?asset_class=in.(commodity,fx,index,intl_index,rate,etf,sector,crypto)&select=symbol,asset_class,first_date,n_bars&order=first_date.asc`) as { symbol: string; asset_class: string; first_date: string; n_bars: number }[];
const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - +K.MIN_YEARS);
let sel = meta.filter((m) => m.first_date <= cutoff.toISOString().slice(0, 10) && m.n_bars > 2000 && !/^\^VIX$|USDT|^\^IRX$/.test(m.symbol));
sel = [...sel.filter((m) => m.asset_class !== "crypto"), ...sel.filter((m) => m.asset_class === "crypto").slice(0, +K.MAX_CRYPTO)];
type Ser = { sym: string; cls: string; ts: number[]; c: number[]; r: Float64Array; pos: Map<string, number> };
const S: Ser[] = [];
for (let i = 0; i < sel.length; i += 5) { const page = sel.slice(i, i + 5); const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[]; for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); const c = b.map((x) => x[4]); const rr = new Float64Array(c.length); for (let j = 1; j < c.length; j++) rr[j] = Math.log(c[j] / c[j - 1]); S.push({ sym: r.symbol, cls: r.asset_class, ts: b.map((x) => x[0]), c, r: rr, pos: new Map(b.map((x, j) => [day(x[0]), j])) }); } }
assertNonEmpty("assets", S, 60);
// FX carry inputs: 3m rates by currency from trd_macro_series (FRED, keyless) + US 3m (^IRX)
const CCY: Record<string, { ccy: string; invert: boolean }> = { "GBPUSD=X": { ccy: "gbp", invert: false }, "EURUSD=X": { ccy: "eur", invert: false }, "AUDUSD=X": { ccy: "aud", invert: false }, "NZDUSD=X": { ccy: "nzd", invert: false }, "JPY=X": { ccy: "jpy", invert: true }, "CAD=X": { ccy: "cad", invert: true }, "CHF=X": { ccy: "chf", invert: true }, "MXN=X": { ccy: "mxn", invert: true }, "USDCNY=X": { ccy: "cny", invert: true }, "USDINR=X": { ccy: "inr", invert: true }, "ZAR=X": { ccy: "zar", invert: true }, "BRL=X": { ccy: "brl", invert: true }, "TRY=X": { ccy: "try", invert: true }, "KRW=X": { ccy: "krw", invert: true } };
const rates = new Map<string, { d: string; v: number }[]>();
for (const c of new Set(Object.values(CCY).map((x) => x.ccy))) { const r = await q(`trd_macro_series?series=eq.rate_3m_${c}&select=d,v&order=d.asc&limit=2000`) as { d: string; v: number }[]; rates.set(c, r); }
const us = await q(`trd_bars_deep?symbol=eq.%5EIRX&select=bars`) as { bars: number[][] }[]; const usRate = new Map((us[0]?.bars ?? []).map((b) => [day(b[0]), b[4]]));
const rateAt = (c: string, d: string) => { const r = rates.get(c); if (!r) return null; let v: number | null = null; for (const x of r) { if (x.d <= d) v = x.v; else break; } return v; };
const usAt = (d: string) => { let k = d; for (let i = 0; i < 7; i++) { const v = usRate.get(k); if (v !== undefined) return v; k = day(Date.parse(k + "T00:00:00Z") / 1000 - 86400); } return null; };
// ---- sleeves as daily book returns (equal weight over active assets; each asset vol-scaled to VOL_TARGET) ----
const isOOS = (d: string) => d >= K.OOS_FROM;
type Daily = Map<string, number>; const sleeves: Record<string, Daily> = { trend: new Map(), long: new Map(), carry: new Map(), value: new Map(), cryptomom: new Map() }; const nAct: Record<string, Daily> = { trend: new Map(), long: new Map(), carry: new Map(), value: new Map(), cryptomom: new Map() };
const add = (s: string, d: string, v: number) => { sleeves[s].set(d, (sleeves[s].get(d) ?? 0) + v); nAct[s].set(d, (nAct[s].get(d) ?? 0) + 1); };
// D-913 financing: track each directional sleeve's NET signed position (sum over assets) — financing is charged on
// net-long DOLLAR exposure (borrowed cash), which only the long-only + net-trend legs carry; dollar-neutral
// long-shorts (carry/value/gcshort/ivol) borrow no net cash and cost ~0 to finance regardless of beta.
const netPos: Record<string, Daily> = { trend: new Map(), long: new Map(), cryptomom: new Map() };
const addNet = (s: string, d: string, p: number) => netPos[s].set(d, (netPos[s].get(d) ?? 0) + p);
const LOOK = [21, 63, 126, 252];
// monthly cross-sectional sleeves need ranks across assets on rebalance days: precompute per asset the signal series
const monthKeys = new Set<string>();
for (const a of S) {
  const n = a.c.length, cost = COST[a.cls] * +K.COST_MULT / 1e4; let posT = 0, posL = 0, lastReb = -1e9;
  for (let i = 260; i < n - 1; i++) {
    const d1 = day(a.ts[i + 1]); const vol = sd(Array.from(a.r.slice(i - 60, i))) * Math.sqrt(252); const scale = vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0;
    let tc = 0, lc = 0;
    if (i - lastReb >= +K.REBAL_D) { lastReb = i; let sgn = 0; for (const L of LOOK) sgn += Math.sign(a.c[i] / a.c[i - L] - 1); sgn /= LOOK.length; const nt = sgn * scale; tc = Math.abs(nt - posT) * cost / 2; posT = nt; const nl = scale; lc = Math.abs(nl - posL) * cost / 2; posL = nl; }
    add("trend", d1, posT * a.r[i + 1] - tc); add("long", d1, posL * a.r[i + 1] - lc); if (a.cls === "crypto") add("cryptomom", d1, posT * a.r[i + 1] - tc);
    addNet("trend", d1, posT); addNet("long", d1, posL); if (a.cls === "crypto") addNet("cryptomom", d1, posT);
    if (day(a.ts[i]).slice(8, 10) <= "03" && day(a.ts[i - 1]).slice(0, 7) !== day(a.ts[i]).slice(0, 7)) monthKeys.add(day(a.ts[i]));
  }
}
// carry + value: monthly, cross-sectional within group, positions held for the month
type Pos = { sym: string; w: number }[]; const carryPos = new Map<string, Pos>(), valuePos = new Map<string, Pos>();
const months = [...monthKeys].sort();
for (const m of months) {
  // carry (FX only): signal = foreign 3m - US 3m in the direction of holding the foreign currency
  const cs: { a: Ser; sig: number; i: number }[] = [];
  for (const a of S) { if (a.cls !== "fx" || !CCY[a.sym]) continue; const i = a.pos.get(m); if (i === undefined || i < 260) continue; const f = rateAt(CCY[a.sym].ccy, m), u = usAt(m); if (f === null || u === null) continue; cs.push({ a, sig: (f - u) * (CCY[a.sym].invert ? -1 : 1), i }); }
  if (cs.length >= 6) { cs.sort((x, y) => y.sig - x.sig); const k = Math.max(1, Math.floor(cs.length / 3)); const p: Pos = []; for (let j = 0; j < cs.length; j++) { const w = j < k ? 1 : j >= cs.length - k ? -1 : 0; if (!w) continue; const vol = sd(Array.from(cs[j].a.r.slice(cs[j].i - 60, cs[j].i))) * Math.sqrt(252); p.push({ sym: cs[j].a.sym, w: w * (vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0) }); } carryPos.set(m, p); }
  // value: 5-year total return reversal within class (non-FX classes pooled by class), quartiles
  const byCls = new Map<string, { a: Ser; sig: number; i: number }[]>();
  for (const a of S) { const i = a.pos.get(m); if (i === undefined || i < 1300) continue; const sig = -(a.c[i] / a.c[i - 1260] - 1); const g = a.cls === "fx" ? "fx" : a.cls === "commodity" ? "commodity" : a.cls === "crypto" ? "crypto" : "eq"; let arr = byCls.get(g); if (!arr) { arr = []; byCls.set(g, arr); } arr.push({ a, sig, i }); }
  const p: Pos = []; for (const [, arr] of byCls) { if (arr.length < 8) continue; arr.sort((x, y) => y.sig - x.sig); const k = Math.max(1, Math.floor(arr.length / 4)); for (let j = 0; j < arr.length; j++) { const w = j < k ? 1 : j >= arr.length - k ? -1 : 0; if (!w) continue; const vol = sd(Array.from(arr[j].a.r.slice(arr[j].i - 60, arr[j].i))) * Math.sqrt(252); p.push({ sym: arr[j].a.sym, w: w * (vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0) }); } } if (p.length) valuePos.set(m, p);
}
const bySym = new Map(S.map((a) => [a.sym, a]));
for (const [name, posMap] of [["carry", carryPos], ["value", valuePos]] as [string, Map<string, Pos>][]) {
  const ms = [...posMap.keys()].sort(); const prev = new Map<string, number>();
  for (let mi = 0; mi < ms.length; mi++) { const m = ms[mi], next = ms[mi + 1] ?? "9999"; const p = posMap.get(m)!;
    for (const { sym, w } of p) { const a = bySym.get(sym)!, i0 = a.pos.get(m)!; const cost = COST[a.cls] * +K.COST_MULT / 1e4; const turn = Math.abs(w - (prev.get(sym) ?? 0)); prev.set(sym, w); let first = true; for (let i = i0; i < a.c.length - 1; i++) { const d1 = day(a.ts[i + 1]); if (d1 >= next) break; add(name, d1, w * a.r[i + 1] - (first ? turn * cost / 2 : 0)); first = false; } }
    for (const [sym] of prev) if (!p.some((x) => x.sym === sym)) prev.set(sym, 0); }
}
// ---- OOS series, equal-weight per active asset, risk-parity blend ----
const series = (s: string) => { const out = new Map<string, number>(); for (const [d, v] of sleeves[s]) if (isOOS(d)) out.set(d, v / Math.max(1, nAct[s].get(d) ?? 1)); return out; };
const OS: Record<string, Map<string, number>> = { trend: series("trend"), long: series("long"), carry: series("carry"), value: series("value"), cryptomom: series("cryptomom") };
const _SLgc = () => K.SLEEVES.split(",").includes("gcshort");
const GC_FILE = Deno.env.get("GC_SPEC") || "d931-gcshort-daily.json"; // D-946: override to A/B the squeeze-avoid-filtered distress series (read-only; d931 stays the deployed one)
if (_SLgc()) { const gc = JSON.parse(await Deno.readTextFile(new URL(`../data/${GC_FILE}`, import.meta.url))) as { d: string; ret: number }[]; OS.gcshort = new Map(gc.filter((x) => isOOS(x.d)).map((x) => [x.d, x.ret])); if (GC_FILE !== "d931-gcshort-daily.json") console.log(`  [D-946 A/B] gcshort sleeve loaded from ${GC_FILE} (NOT the deployed d931)`); }
const _SLiv = () => K.SLEEVES.split(",").includes("ivol"); // D-939 idiosyncratic-vol anomaly candidate sleeve
if (_SLiv()) { const iv = JSON.parse(await Deno.readTextFile(new URL("../data/d939-ivol-daily.json", import.meta.url))) as { d: string; ret: number }[]; OS.ivol = new Map(iv.filter((x) => isOOS(x.d)).map((x) => [x.d, x.ret])); }
const days = [...OS.trend.keys()].filter((d) => OS.long.has(d)).sort();
const stats = (x: number[]) => { const mu = mean(x) * 252, vol = sd(x) * Math.sqrt(252); let eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0; for (const v of x) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak); } return { mu, vol, sr: vol ? mu / vol : 0, t: tstat(x), mdd, uwY: maxUw / 252, n: x.length }; };
const _SL = K.SLEEVES.split(","); const names = ["trend", "long", "carry", "value", ...(_SL.includes("cryptomom") ? ["cryptomom"] : []), ...(_SL.includes("gcshort") ? ["gcshort"] : []), ...(_SL.includes("ivol") ? ["ivol"] : [])]; const X: Record<string, number[]> = {}; for (const s of names) X[s] = days.map((d) => OS[s].get(d) ?? 0);
console.log(`\n==> D-865 MULTI-STRATEGY BLEND — ${S.length} assets, OOS ${K.OOS_FROM}+, ${days.length} days, cost x${K.COST_MULT}`);
console.log(`  ${"sleeve".padEnd(8)} ${"Sharpe".padStart(7)} ${"t".padStart(6)} ${"%/yr".padStart(6)} ${"vol".padStart(6)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)}`);
const st: Record<string, ReturnType<typeof stats>> = {}; for (const s of names) { st[s] = stats(X[s]); console.log(`  ${s.padEnd(8)} ${st[s].sr.toFixed(2).padStart(7)} ${st[s].t.toFixed(2).padStart(6)} ${(100 * st[s].mu).toFixed(1).padStart(5)}% ${(100 * st[s].vol).toFixed(1).padStart(5)}% ${(100 * st[s].mdd).toFixed(0).padStart(6)}% ${st[s].uwY.toFixed(1).padStart(9)}y`); }
console.log(`\n  OOS CORRELATION MATRIX (daily):`); console.log(`  ${"".padEnd(8)} ${names.map((n) => n.padStart(7)).join("")}`); let maxCorr = 0;
for (const a of names) console.log(`  ${a.padEnd(8)} ${names.map((b) => { const c = a === b ? 1 : corr(X[a], X[b]); if (a !== b) maxCorr = Math.max(maxCorr, Math.abs(c)); return c.toFixed(2).padStart(7); }).join("")}`);
// crash-month correlations (2020-03, 2022 H1)
const crash = (from: string, to: string) => { const ix = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= from && d <= to).map(([, i]) => i); return `${from.slice(0, 7)}..${to.slice(0, 7)}: trend/long ${corr(ix.map((i) => X.trend[i]), ix.map((i) => X.long[i])).toFixed(2)}, trend ${(100 * ix.reduce((s, i) => s + X.trend[i], 0)).toFixed(1)}% long ${(100 * ix.reduce((s, i) => s + X.long[i], 0)).toFixed(1)}%`; };
console.log(`  CRASHES: ${crash("2020-02-20", "2020-03-31")} | ${crash("2022-01-01", "2022-10-31")}`);
// risk parity: weight_i = 1/vol_i over trailing 60d, renormalised to 10% book vol daily
const BL = K.SLEEVES.split(","); if (BL.length < 4) console.log(`\n  SUBSET ${BL.join("+")} — DESCRIPTIVE ONLY, not the registered blend (D-455: chosen after the sleeves were seen).`);
// net-exposure series per directional sleeve (same normalisation as the return series in series())
const netExpX: Record<string, number[]> = {}; for (const s of ["trend", "long", "cryptomom"]) if (names.includes(s)) netExpX[s] = days.map((d) => (netPos[s].get(d) ?? 0) / Math.max(1, nAct[s].get(d) ?? 1));
const blend: number[] = []; const blendNet: number[] = []; const blendW: number[][] = []; for (let i = 0; i < days.length; i++) { const w: number[] = names.map((s) => { const win = X[s].slice(Math.max(0, i - 60), i); const v = win.length > 20 ? sd(win) * Math.sqrt(252) : 0; return v > 0 && BL.includes(s) ? 1 / v : 0; }); const tot = w.reduce((a, b) => a + b, 0) || 1; let v = 0, ne = 0; names.forEach((s, j) => { v += (w[j] / tot) * X[s][i]; ne += (w[j] / tot) * (netExpX[s]?.[i] ?? 0); }); blend.push(v); blendNet.push(ne); blendW.push(names.map((_, j) => w[j] / tot)); }
const bv = sd(blend) * Math.sqrt(252); const lev = +K.VOL_TARGET / (bv || 1); const B = stats(blend.map((v) => v * lev));
await spendTrials({ rest: OWNED, headers: hdr, family: "multistrategy", runId: K.RUN_ID, spent: names.length + 1 });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  RISK-PARITY BLEND at ${(100 * +K.VOL_TARGET).toFixed(0)}% vol: Sharpe ${B.sr.toFixed(2)}, t ${B.t.toFixed(2)}, ${(100 * B.mu).toFixed(1)}%/yr, maxDD ${(100 * B.mdd).toFixed(0)}%, underwater ${B.uwY.toFixed(1)}y; best single sleeve Sharpe ${Math.max(...names.map((s) => st[s].sr)).toFixed(2)}; max |corr| ${maxCorr.toFixed(2)}`);
console.log(`  LEVERAGE TABLE (blend): ` + [0.10, 0.20, 0.40].map((tv) => { const x = blend.map((v) => v * tv / (bv || 1)); const s2 = stats(x); const g = s2.mu - s2.vol * s2.vol / 2; return `${(100 * tv).toFixed(0)}% vol -> ${(100 * s2.mu).toFixed(1)}%/yr, DD ${(100 * s2.mdd).toFixed(0)}%, 10x in ${g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never"}`; }).join(" | "));
// D-913 HONESTY: the Sharpe above is on RAW returns; leverage multiplies the EXCESS-over-rf Sharpe, and financing the
// levered book costs rf only on the NET-LONG dollar exposure (dollar-neutral long-shorts borrow no net cash). Two
// charges: (floor) fully-funded — subtract rf from the WHOLE book (over-charges, treats every sleeve as financed);
// (pinned) net-exposure — subtract rf * blendNet, the actual net-long dollar exposure the long/trend legs carry.
{ const rfDay = (d: string) => { const r = usAt(d); return r === null ? 0 : (r / 100) / 252; };
  const rfCov = days.filter((d) => usAt(d) !== null).length; const lv = +K.VOL_TARGET / (bv || 1);
  const floor = stats(days.map((d, i) => (blend[i] - rfDay(d)) * lv));                 // subtract rf from the WHOLE book (over-charge)
  const pinned = stats(days.map((d, i) => (blend[i] - rfDay(d) * blendNet[i]) * lv));   // subtract rf only on net-long dollar exposure
  const rf = mean(days.map(rfDay)) * 252; const avgNet = mean(blendNet);
  const kelly = (S: number, sig = 0.20) => { const g = rf + sig * S - sig * sig / 2; return g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never"; };
  console.log(`  D-913 EXCESS (rf~${(100 * rf).toFixed(1)}%/yr, cov ${rfCov}/${days.length}, avg net-long exposure ${avgNet.toFixed(2)}x of capital):`);
  console.log(`    raw ${B.sr.toFixed(2)}  |  net-exposure-financed (PINNED) ${pinned.sr.toFixed(2)}  |  fully-funded floor ${floor.sr.toFixed(2)}  ->  leverageable ~${pinned.sr.toFixed(2)}, bounded [${floor.sr.toFixed(2)}, ${B.sr.toFixed(2)}]`);
  console.log(`    Kelly 10x @20% vol: raw ${kelly(B.sr)} | PINNED ${kelly(pinned.sr)} | floor ${kelly(floor.sr)}  (g = rf + sigma*S_excess - sigma^2/2)`); }
const ok = B.sr >= 1.0 && B.t >= ceil.ceiling && B.mdd > -0.25 && B.sr > Math.max(...names.map((s) => st[s].sr)) && maxCorr < 0.5;
console.log(`  ceiling ${ceil.ceiling.toFixed(3)}. VERDICT (D-865 rule): ${ok ? "SUPPORTED" : `NULL — ${[B.sr < 1.0 && `blend Sharpe ${B.sr.toFixed(2)} < 1.0`, B.t < ceil.ceiling && `t ${B.t.toFixed(2)} < ceiling`, B.mdd <= -0.25 && "maxDD worse than -25%", B.sr <= Math.max(...names.map((s) => st[s].sr)) && "does not beat the best sleeve", maxCorr >= 0.5 && "a sleeve pair correlates >= 0.5"].filter(Boolean).join("; ")}`}`);

// ---- REGIME DEPENDENCE (read-only, default off) — is each sleeve's edge concentrated in one regime, and do the
// five sleeves diversify ACROSS regimes or all earn in the same era? The blend's headline is only robust if the
// sleeves are paid in DIFFERENT eras; if all five carry their edge in 2021-26, the ~1.98 is one bet, not five. ----
if (K.REGIME === "1") {
  // per-index-subset stats on a return series (annualised Sharpe, portfolio t, %/yr, N)
  const sub = (x: number[], idx: number[]) => { const s = idx.map((i) => x[i]); const mu = mean(s) * 252, vol = sd(s) * Math.sqrt(252); return { sr: vol ? mu / vol : 0, t: tstat(s), mu, n: s.length }; };
  const blendLev = blend.map((v) => v * lev);
  const cols = [...names, "BLEND"] as const;
  const seriesOf = (s: string) => s === "BLEND" ? blendLev : X[s];
  // VIEW A — each sleeve split at the midpoint of its OWN active (first-non-zero .. end) span: within-sleeve concentration.
  console.log(`\n==> REGIME DEPENDENCE (${days.length} common days, ${days[0]}..${days[days.length - 1]})`);
  console.log(`\n  VIEW A — own active-period halves (is THIS sleeve's edge recent-concentrated?):`);
  console.log(`  ${"sleeve".padEnd(9)} ${"active from".padStart(12)} ${"early SR".padStart(9)}${"(t)".padStart(8)} ${"late SR".padStart(9)}${"(t)".padStart(8)}   verdict`);
  for (const s of cols) {
    const x = seriesOf(s); const fa = x.findIndex((v) => v !== 0); const act = fa >= 0 ? [...Array(x.length - fa).keys()].map((k) => k + fa) : [];
    if (act.length < 40) { console.log(`  ${s.padEnd(9)} ${"(<40 obs)".padStart(12)}`); continue; }
    const mid = fa + Math.floor((x.length - fa) / 2); const eIdx = act.filter((i) => i < mid), lIdx = act.filter((i) => i >= mid);
    const e = sub(x, eIdx), l = sub(x, lIdx); const ratio = Math.abs(e.sr) > 0.05 ? l.sr / e.sr : Infinity;
    const verdict = e.sr <= 0 && l.sr > 0.3 ? "LATE-ONLY (dead early)" : ratio > 2 ? "recent-concentrated" : ratio < 0.5 ? "early-concentrated" : "era-robust";
    console.log(`  ${s.padEnd(9)} ${days[fa].padStart(12)} ${e.sr.toFixed(2).padStart(9)}${("(" + e.t.toFixed(1) + ")").padStart(8)} ${l.sr.toFixed(2).padStart(9)}${("(" + l.t.toFixed(1) + ")").padStart(8)}   ${verdict}`);
  }
  // VIEW B — shared calendar eras: WHICH regime pays each sleeve, and does the blend depend on one era? (%/yr per era)
  const eras: [string, string, string][] = [["15-19 calm", "0000", "2020-02-19"], ["20 covid", "2020-02-20", "2020-12-31"], ["21 rally", "2021-01-01", "2021-12-31"], ["22 bear", "2022-01-01", "2022-12-31"], ["23-26 recent", "2023-01-01", "9999"]];
  const eraIdx = eras.map(([, a, b]) => days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= a && d <= b).map(([, i]) => i));
  console.log(`\n  VIEW B — shared calendar eras (%/yr; N days) — do the sleeves earn in DIFFERENT regimes?:`);
  console.log(`  ${"sleeve".padEnd(9)} ${eras.map(([n]) => n.padStart(13)).join("")}`);
  for (const s of cols) { const x = seriesOf(s); console.log(`  ${s.padEnd(9)} ${eras.map((_, k) => { const r = sub(x, eraIdx[k]); return r.n < 15 ? "  —".padStart(13) : `${(100 * r.mu).toFixed(0)}%/${r.sr.toFixed(1)}`.padStart(13); }).join("")}`); }
  console.log(`  (cell = annualised %/yr and Sharpe in that era; "—" = under 15 days of the sleeve's data in the era)`);
}

// ---- STRESS TEST a single regime window (read-only, default off) — the blend's WEAKEST era is its floor, and a
// one-year Sharpe is one draw (t ~= SR). This interrogates the path (worst month, drawdown, worst rolling quarter),
// the attribution (which sleeves carried vs dragged), and the FRAGILITY (leave-one-out: if dropping the load-bearing
// sleeve turns the window negative, the "floor" is really one-sleeve-dependent). All measured, nothing simulated. ----
if (K.STRESS) {
  const [from, to] = K.STRESS.split(":"); const idx = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= from && d <= to).map(([, i]) => i);
  console.log(`\n==> STRESS TEST — blend in ${from}..${to} (${idx.length} days, deployed ${(100 * +K.VOL_TARGET).toFixed(0)}% vol target)`);
  if (idx.length < 40) console.log(`  only ${idx.length} days — UNTESTED (need >= 40).`);
  else {
    const lv = lev; const bw = idx.map((i) => blend[i] * lv); const p = stats(bw); const yrs = (Date.parse(days[idx[idx.length - 1]]) - Date.parse(days[idx[0]])) / (365.25 * 864e5);
    // PATH: monthly P&L, worst/best month, negatives, worst rolling 63d Sharpe
    const byMonth = new Map<string, number>(); for (const i of idx) { const m = days[i].slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? 0) + blend[i] * lv); }
    const months = [...byMonth.entries()].sort(); const worstM = months.reduce((a, b) => b[1] < a[1] ? b : a); const bestM = months.reduce((a, b) => b[1] > a[1] ? b : a); const nNeg = months.filter(([, r]) => r < 0).length;
    let worstQ = Infinity, worstQfrom = ""; for (let k = 0; k + 63 <= idx.length; k++) { const s = stats(idx.slice(k, k + 63).map((i) => blend[i] * lv)); if (s.sr < worstQ) { worstQ = s.sr; worstQfrom = days[idx[k]]; } }
    console.log(`  PATH: Sharpe ${p.sr.toFixed(2)} (t ${p.t.toFixed(2)} on ${idx.length} obs / ${yrs.toFixed(1)} calendar-yr — a single-regime Sharpe is one draw), ${(100 * p.mu).toFixed(1)}%/yr, vol ${(100 * p.vol).toFixed(1)}%, maxDD ${(100 * p.mdd).toFixed(1)}%, ${p.uwY.toFixed(2)}y underwater`);
    console.log(`        months ${months.length}, ${nNeg} negative; worst ${worstM[0]} ${(100 * worstM[1]).toFixed(1)}%, best ${bestM[0]} ${(100 * bestM[1]).toFixed(1)}%; worst rolling quarter Sharpe ${worstQ === Infinity ? "n/a (<63d)" : `${worstQ.toFixed(2)} (from ${worstQfrom})`}`);
    // ATTRIBUTION: each sleeve's contribution to the window's TOTAL levered return = sum_day w_i*ret_i*lev
    const contrib = names.map((s, j) => ({ s, c: idx.reduce((acc, i) => acc + (blendW[i]?.[j] ?? 0) * X[s][i] * lv, 0), own: stats(idx.map((i) => X[s][i])) }));
    const totRet = idx.reduce((a, i) => a + blend[i] * lv, 0); console.log(`  ATTRIBUTION (contribution to the window's ${(100 * totRet).toFixed(1)}% total return; own = sleeve's standalone Sharpe in the window):`);
    for (const { s, c, own } of contrib.sort((a, b) => b.c - a.c)) console.log(`    ${s.padEnd(9)} ${(100 * c).toFixed(1).padStart(6)}%   own Sharpe ${own.sr.toFixed(2).padStart(6)}`);
    // LEAVE-ONE-OUT: drop each sleeve, renormalise risk-parity weights among the rest, recompute the window blend.
    // Sharpe is scale-free so leverage is irrelevant to it; the drop that most lowers Sharpe is the load-bearing sleeve.
    console.log(`  LEAVE-ONE-OUT (window Sharpe / %/yr with that sleeve removed; full blend Sharpe ${p.sr.toFixed(2)}):`);
    const loo = names.map((drop, d) => { const r = idx.map((i) => { let v = 0, tot = 0; for (let j = 0; j < names.length; j++) { if (j === d) continue; const w = blendW[i]?.[j] ?? 0; tot += w; v += w * X[names[j]][i]; } return tot > 0 ? v / tot : 0; }); const rv = sd(r) * Math.sqrt(252); const rl = rv > 0 ? +K.VOL_TARGET / rv : 0; const s = stats(r.map((x) => x * rl)); return { drop, sr: s.sr, mu: s.mu }; });
    for (const { drop, sr, mu } of loo.sort((a, b) => a.sr - b.sr)) console.log(`    without ${drop.padEnd(9)} Sharpe ${sr.toFixed(2).padStart(6)}  ${(100 * mu).toFixed(1).padStart(6)}%/yr   ${sr < 0 ? "<- window goes NEGATIVE without it" : sr < p.sr - 0.5 ? "<- load-bearing" : ""}`);
  }
}

// ---- HEDGE OVERLAY (read-only, default off) — D-946: overlay a squeeze-hedge series on the deployed blend at a
// swept vol fraction and report Sharpe / maxDD / worst rolling quarter / the Jan-2021 squeeze window / underwater.
// A squeeze hedge must (a) be negatively correlated with the distress+IVOL short legs and (b) turn the Jan-2021 window
// POSITIVE at a size that does not wreck the Sharpe. If it cannot, it is dominated by simply shorting less. ----
if (K.HEDGE_SPEC) {
  const hs = JSON.parse(await Deno.readTextFile(new URL(`../data/${K.HEDGE_SPEC}`, import.meta.url))) as { d: string; ret: number }[];
  const hm = new Map(hs.map((x) => [x.d, x.ret])); const covD = days.filter((d) => hm.has(d)); const hraw = days.map((d) => hm.get(d) ?? 0);
  const hvol = sd(covD.map((d) => hm.get(d)!)) * Math.sqrt(252);
  const jan = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= "2021-01-01" && d <= "2021-02-28").map(([, i]) => i);
  const janBase = jan.reduce((a, i) => a + blend[i] * lev, 0);
  const worstQ = (x: number[]) => { let w = Infinity; for (let k = 0; k + 63 <= x.length; k++) { const s = stats(x.slice(k, k + 63)); if (s.sr < w) w = s.sr; } return w; };
  console.log(`\n==> HEDGE OVERLAY — ${K.HEDGE_SPEC} (coverage ${covD.length}/${days.length} days, hedge standalone vol ${(100 * hvol).toFixed(1)}%)`);
  console.log(`  hedge daily corr: gcshort ${corr(hraw, X.gcshort ?? hraw).toFixed(2)}, ivol ${corr(hraw, X.ivol ?? hraw).toFixed(2)}, blend ${corr(hraw, blend).toFixed(2)} (a hedge should be NEGATIVE to the short sleeves)`);
  console.log(`  baseline blend Jan-2021 (Jan+Feb) window return ${(100 * janBase).toFixed(1)}%, worst rolling quarter Sharpe ${worstQ(blend.map((v) => v * lev)).toFixed(2)}`);
  console.log(`  ${"frac".padStart(6)} ${"w_hedge".padStart(8)} ${"Sharpe".padStart(7)} ${"exc".padStart(6)} ${"%/yr".padStart(6)} ${"maxDD".padStart(7)} ${"worstQ".padStart(7)} ${"Jan21".padStart(7)} ${"uw(y)".padStart(6)}`);
  const rfDay = (d: string) => { const r = usAt(d); return r === null ? 0 : (r / 100) / 252; };
  for (const f of K.HEDGE_FRAC.split(",").map(Number).filter((x) => !isNaN(x))) {
    const wh = hvol > 0 ? f * +K.VOL_TARGET / hvol : 0; const hb = days.map((d, i) => blend[i] * lev + wh * hraw[i]);
    const s = stats(hb); const exc = stats(days.map((d, i) => blend[i] * lev + wh * hraw[i] - rfDay(d) * blendNet[i])); const janR = jan.reduce((a, i) => a + hb[i], 0);
    console.log(`  ${f.toFixed(2).padStart(6)} ${wh.toFixed(2).padStart(8)} ${s.sr.toFixed(2).padStart(7)} ${exc.sr.toFixed(2).padStart(6)} ${(100 * s.mu).toFixed(1).padStart(5)}% ${(100 * s.mdd).toFixed(0).padStart(6)}% ${worstQ(hb).toFixed(2).padStart(7)} ${(100 * janR).toFixed(1).padStart(6)}% ${s.uwY.toFixed(2).padStart(6)}`);
  }
  console.log(`  READ: frac 0 is the deployed blend. A useful hedge lifts Jan21 toward >=0 AND holds exc-Sharpe; if exc-Sharpe falls monotonically with frac and Jan21 stays negative, the hedge does not work and shorting less dominates it.`);
}

// ---- CONDITIONAL DE-GROSS (read-only, default off) — D-947: the ONLY forward mitigation D-946 left open for the
// distress+IVOL joint-squeeze tail. When junk rips, the two short legs bleed together; that bleed is the contemporaneous
// squeeze signature. Rule: when the trailing-K return of the (gcshort+ivol) short book (through i-1, LAG-1, no
// look-ahead) falls below a threshold, cut (1-f) of the distress+ivol contribution for that day. STRICT DISCIPLINE
// (SELECTION LAW D-455): (K, threshold-percentile, f) are chosen on TRAIN ONLY (<= TRAIN_END), frozen, applied to TEST.
// Default TRAIN_END=2020-12-31 holds the Jan-2021 squeeze OUT of training — the rule must protect a squeeze it never saw.
// D-821 is the known trap: de-grossing in high-vol regimes halved the Sharpe there, because the shorts EARN in the
// post-squeeze mean-reversion — so cutting after a bleed can cut right before the payback. The OOS test decides. ----
if (K.DEGROSS === "1") {
  const iGc = names.indexOf("gcshort"), iIv = names.indexOf("ivol");
  if (iGc < 0 || iIv < 0) { console.log(`\n==> DE-GROSS: needs gcshort+ivol in SLEEVES (have ${names.join(",")}) — skipped.`); }
  else {
    const splitDate = K.TRAIN_END;
    const trainIdx = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d <= splitDate).map(([, i]) => i);
    const testIdx = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d > splitDate).map(([, i]) => i);
    const shortBook = days.map((_, i) => (X.gcshort[i] + X.ivol[i]) / 2);      // the two short legs, equal weight
    const trail = (i: number, Kk: number) => { let s = 0; for (let j = Math.max(0, i - Kk); j < i; j++) s += shortBook[j]; return s; }; // through i-1 only (LAG-1)
    // de-grossed daily blend for (Kk, tau, f): on days trail(i)<tau, remove (1-f) of the distress+ivol contribution (true de-gross to cash; NOT rotated to other sleeves)
    const buildDG = (Kk: number, tau: number, f: number) => days.map((_, i) => { const cut = trail(i, Kk) < tau ? (1 - f) : 0; return blend[i] - cut * (blendW[i][iGc] * X.gcshort[i] + blendW[i][iIv] * X.ivol[i]); });
    const srOf = (idx: number[], s: number[]) => stats(idx.map((i) => s[i])).sr;
    // TRAIN grid search: pick (K, threshold-percentile, f) maximising TRAIN Sharpe. tau = that percentile of the TRAIN trailing-K distribution (a frozen NUMBER carried into test).
    const Kgrid = [5, 10, 21], pgrid = [0.02, 0.05, 0.10, 0.20], fgrid = [0, 0.5];
    let best: { Kk: number; p: number; tau: number; f: number; sr: number } | null = null;
    for (const Kk of Kgrid) { const tt = trainIdx.map((i) => trail(i, Kk)).sort((a, b) => a - b);
      for (const p of pgrid) { const tau = tt[Math.floor(p * tt.length)];   // low percentile = a sharp-bleed threshold
        for (const f of fgrid) { const sr = srOf(trainIdx, buildDG(Kk, tau, f)); if (!best || sr > best.sr) best = { Kk, p, tau, f, sr }; } } }
    const staticTrainSR = srOf(trainIdx, blend), staticTestSR = srOf(testIdx, blend);
    const dgFrozen = buildDG(best!.Kk, best!.tau, best!.f); const dgTestSR = srOf(testIdx, dgFrozen);
    // tail metrics: lever BOTH to VOL_TARGET using the TRAIN vol (frozen — no test leakage), then stats on the TEST slice
    const lvTrain = (s: number[]) => { const v = sd(trainIdx.map((i) => s[i])) * Math.sqrt(252); return v > 0 ? +K.VOL_TARGET / v : 0; };
    const lS = lvTrain(blend), lD = lvTrain(dgFrozen);
    const testStat = (s: number[], lv: number) => stats(testIdx.map((i) => s[i] * lv));
    const worstQ = (idx: number[], s: number[], lv: number) => { const a = idx.map((i) => s[i] * lv); let w = Infinity; for (let k = 0; k + 63 <= a.length; k++) { const st2 = stats(a.slice(k, k + 63)); if (st2.sr < w) w = st2.sr; } return w === Infinity ? NaN : w; };
    const jan = testIdx.filter((i) => days[i] >= "2021-01-01" && days[i] <= "2021-02-28");
    const nActiveTest = testIdx.filter((i) => trail(i, best!.Kk) < best!.tau).length;
    const sS = testStat(blend, lS), sD = testStat(dgFrozen, lD);
    console.log(`\n==> D-947 CONDITIONAL DE-GROSS — TRAIN <= ${splitDate} (${trainIdx.length}d), TEST > ${splitDate} (${testIdx.length}d); Jan-2021 squeeze is in TEST`);
    console.log(`  RULE CHOSEN ON TRAIN: cut ${((1 - best!.f) * 100).toFixed(0)}% of distress+ivol when the ${best!.Kk}-day short-book return < ${(100 * best!.tau).toFixed(1)}% (train ${(100 * best!.p).toFixed(0)}th pct); train Sharpe ${staticTrainSR.toFixed(2)} -> ${best!.sr.toFixed(2)} ${best!.sr > staticTrainSR + 0.02 ? "(helped in-sample)" : "(barely/again NOT helped in-sample — the grid could not beat 'never de-gross')"}`);
    console.log(`  fired on ${nActiveTest}/${testIdx.length} test days (${(100 * nActiveTest / testIdx.length).toFixed(1)}%)`);
    console.log(`  ${"".padEnd(10)} ${"Sharpe".padStart(7)} ${"%/yr".padStart(6)} ${"maxDD".padStart(7)} ${"worstQ".padStart(7)} ${"Jan21".padStart(7)} ${"uw(y)".padStart(6)}`);
    console.log(`  ${"STATIC".padEnd(10)} ${sS.sr.toFixed(2).padStart(7)} ${(100 * sS.mu).toFixed(1).padStart(5)}% ${(100 * sS.mdd).toFixed(0).padStart(6)}% ${worstQ(testIdx, blend, lS).toFixed(2).padStart(7)} ${(100 * jan.reduce((a, i) => a + blend[i] * lS, 0)).toFixed(1).padStart(6)}% ${sS.uwY.toFixed(2).padStart(6)}`);
    console.log(`  ${"DE-GROSS".padEnd(10)} ${sD.sr.toFixed(2).padStart(7)} ${(100 * sD.mu).toFixed(1).padStart(5)}% ${(100 * sD.mdd).toFixed(0).padStart(6)}% ${worstQ(testIdx, dgFrozen, lD).toFixed(2).padStart(7)} ${(100 * jan.reduce((a, i) => a + dgFrozen[i] * lD, 0)).toFixed(1).padStart(6)}% ${sD.uwY.toFixed(2).padStart(6)}`);
    const dSr = dgTestSR - staticTestSR, dDD = sD.mdd - sS.mdd, dJan = (jan.reduce((a, i) => a + dgFrozen[i] * lD, 0) - jan.reduce((a, i) => a + blend[i] * lS, 0));
    const tailHelped = dDD > 0.005 || dJan > 0.03; // shallower maxDD or a materially better squeeze month
    console.log(`  OOS VERDICT: Sharpe ${dSr >= 0 ? "+" : ""}${dSr.toFixed(2)} (${dgTestSR.toFixed(2)} vs ${staticTestSR.toFixed(2)}), maxDD ${dDD >= 0 ? "+" : ""}${(100 * dDD).toFixed(1)}pt, Jan-2021 ${dJan >= 0 ? "+" : ""}${(100 * dJan).toFixed(1)}pt`);
    console.log(`  => ${tailHelped && dSr > -0.05 ? "SQUEEZE INSURANCE: protects the held-out tail at ~neutral Sharpe (the test contained a squeeze)" : tailHelped ? "TAIL help but a Sharpe COST — a tolerance trade" : "PURE DRAG (no squeeze in this test window) — D-821: cutting the shorts on their bleed forgoes the post-squeeze payback"}. Net: small negative carry + a contingent squeeze payout = a genuine hedge (unlike D-946's long basket), NOT a Sharpe improver.`);
  }
}

// ---- D-926 PAPER STAND-UP (additive; default off) — stand the 3-factor blend up on paper for the forward clock ----
if (K.PAPER === "1") {
  const wh = { ...hdr, "Content-Type": "application/json" } as Record<string, string>;
  // kill switch — never mark a killed book
  const ks = await q(`trd_kill_switch?account=eq.paper&select=state`) as { state: string }[];
  const st0 = String(ks[0]?.state ?? "").toLowerCase(); const killed = !!ks[0] && st0 !== "armed" && st0 !== "ok"; // armed/ok = paper rung active & marking (matches paper-book.ts)
  // forward-window realized stats (vol-targeted blend returns since PAPER_START)
  const fwdIdx = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= K.PAPER_START).map(([, i]) => i);
  const fwd = fwdIdx.map((i) => blend[i] * lev);
  const fs = fwd.length >= 2 ? stats(fwd) : null;
  const computable = fwd.length >= 20;
  const elapsed = fwdIdx.length;
  const metricVal = computable && fs ? fs.sr : null;
  const nsl = names.length;
  const note = killed ? `KILL SWITCH engaged — book frozen, not marked (${fwd.length} fwd days).`
    : !computable ? `${fwd.length} forward days since ${K.PAPER_START}; below 20, not-yet-computable (numeric two-sided promote/kill floors live in trd_forward_rules[${K.PAPER_RULE}]).`
    : `${fwd.length} forward days since ${K.PAPER_START}: realized ${nsl}-sleeve blend Sharpe ${fs!.sr.toFixed(2)}, ${(100 * fs!.mu).toFixed(1)}%/yr, maxDD ${(100 * fs!.mdd).toFixed(0)}%.`;
  if (!killed) {
    const mk = await fetch(`${OWNED}/trd_forward_marks`, { method: "POST", headers: { ...wh, Prefer: "return=minimal" }, // plumbing-ok: audited — status checked next line
      body: JSON.stringify({ rule_id: K.PAPER_RULE, elapsed_days: elapsed, metric_name: `fwd_sharpe_${nsl}sleeve`, metric_value: metricVal, n_obs: fwd.length, note, matured: false }) });
    console.log(`\n  PAPER MARK -> trd_forward_marks[${K.PAPER_RULE}]: ${mk.status} — ${note}`);
  } else console.log(`\n  PAPER: ${note}`);
  // one-time DORMANT position snapshot (idempotent: only if no three-factor snapshot exists)
  const existing = await q(`trd_positions?book->>spec_id=eq.${K.PAPER_SPEC}&select=id&limit=1`) as { id: number }[];
  if (!existing.length) {
    const sleeveW = names.filter((s) => BL.includes(s)).map((s) => { const win = X[s].slice(-60); const v = sd(win) * Math.sqrt(252); return { sleeve: s, inv_vol_weight: v > 0 ? 1 / v : 0, standalone_sharpe: +st[s].sr.toFixed(2) }; });
    const wtot = sleeveW.reduce((a, x) => a + x.inv_vol_weight, 0) || 1; sleeveW.forEach((x) => x.inv_vol_weight = +(x.inv_vol_weight / wtot).toFixed(3));
    const decMap: Record<string, string> = { "four-factor-blend": "D-932", "distress-blend-combined": "D-936", "distress-ivol-blend-5": "D-939", "three-factor-blend": "D-924" };
    const book = { dormant: true, spec_id: K.PAPER_SPEC, decision: decMap[K.PAPER_SPEC] ?? "D-924", forward_rule: K.PAPER_RULE, inception: K.PAPER_START,
      construction: `risk-parity blend of ${names.join(" + ")}, equal-risk-parity from trailing 60d sleeve vol, ${(+K.VOL_TARGET*100)}% vol target, per-class costs, ${K.REBAL_D}-day rebalance` + (names.includes("gcshort") ? " — gcshort = the D-936 COMBINED distress short (going-concern UNION late-filing)" : ""),
      sleeve_weights: sleeveW, insample_sharpe: +B.sr.toFixed(2), insample_t: +B.t.toFixed(2), insample_maxDD: +(100 * B.mdd).toFixed(0), insample_underwater_y: +B.uwY.toFixed(1),
      target_vol: +K.VOL_TARGET, confident_vol_note: "size at ~20% vol (real-path DD -46%); 40% vol is ruinous",
      honest_note: `DORMANT paper book, $0 at risk, NEVER auto-armed — arming is the operator's act after the staged gates. In-sample Sharpe ${B.sr.toFixed(2)} is DESCRIPTIVE (post-hoc sleeve subset; distress tail is squeeze-optimistic under flat 10% borrow); the forward clock ${K.PAPER_RULE} validates it. Claude never executes; manual fills only at MICRO.` };
    const ins = await fetch(`${OWNED}/trd_positions`, { method: "POST", headers: { ...wh, Prefer: "return=minimal" }, body: JSON.stringify({ book }) }); // plumbing-ok: audited — status checked next line
    console.log(`  PAPER SNAPSHOT -> trd_positions (DORMANT ${K.PAPER_SPEC}): ${ins.status}`);
  } else console.log(`  PAPER SNAPSHOT: ${K.PAPER_SPEC} already stood up (id ${existing[0].id}) — idempotent, not duplicated.`);
}
