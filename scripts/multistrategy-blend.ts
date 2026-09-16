#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// multistrategy-blend.ts (D-865) — PREREG: D-865-multistrategy-blend. The portfolio question: a Sharpe rises through
// diversification across UNCORRELATED books, not a better signal. Sleeves, all on the same 110-asset daily panel and
// OOS window as D-863: (a) TREND — the D-863 combo; (b) LONG — the vol-matched long-only basket; (c) CARRY — FX
// interest differentials from the held 3-month rates (long high-rate vs short low-rate, vol-scaled, monthly);
// (d) VALUE — 5-year return reversal, bottom quartile long / top quartile short within class, vol-scaled, monthly.
// Blend = risk parity (equal ex-ante vol weight, from trailing 60-day sleeve vol). No weight is optimised on OOS.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("multistrategy-blend", [{ name: "OOS_FROM", def: "2015-01-01" }, { name: "VOL_TARGET", def: "0.10" }, { name: "REBAL_D", def: "5" }, { name: "MIN_YEARS", def: "10" }, { name: "MAX_CRYPTO", def: "10" }, { name: "COST_MULT", def: "1", note: "2 = double every class cost (the retail-access question)" }, { name: "SLEEVES", def: "trend,long,carry,value", note: "the registered blend is all four; any subset is DESCRIPTIVE ONLY (a subset chosen after seeing OOS sleeve results is a pick made on the evaluation window, D-455)" }, { name: "RUN_ID", def: "D-865-multistrategy-blend" }, { name: "PAPER", def: "0", note: "1 = stand up the 3-factor blend on paper (DORMANT snapshot + forward mark for fwd-three-factor-blend)" }, { name: "PAPER_START", def: "2026-09-15" }, { name: "PAPER_RULE", def: "fwd-three-factor-blend" }, { name: "PAPER_SPEC", def: "three-factor-blend" }]);
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
if (_SLgc()) { const gc = JSON.parse(await Deno.readTextFile(new URL("../data/d931-gcshort-daily.json", import.meta.url))) as { d: string; ret: number }[]; OS.gcshort = new Map(gc.filter((x) => isOOS(x.d)).map((x) => [x.d, x.ret])); }
const days = [...OS.trend.keys()].filter((d) => OS.long.has(d)).sort();
const stats = (x: number[]) => { const mu = mean(x) * 252, vol = sd(x) * Math.sqrt(252); let eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0; for (const v of x) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak); } return { mu, vol, sr: vol ? mu / vol : 0, t: tstat(x), mdd, uwY: maxUw / 252, n: x.length }; };
const _SL = K.SLEEVES.split(","); const names = ["trend", "long", "carry", "value", ...(_SL.includes("cryptomom") ? ["cryptomom"] : []), ...(_SL.includes("gcshort") ? ["gcshort"] : [])]; const X: Record<string, number[]> = {}; for (const s of names) X[s] = days.map((d) => OS[s].get(d) ?? 0);
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
const blend: number[] = []; for (let i = 0; i < days.length; i++) { const w: number[] = names.map((s) => { const win = X[s].slice(Math.max(0, i - 60), i); const v = win.length > 20 ? sd(win) * Math.sqrt(252) : 0; return v > 0 && BL.includes(s) ? 1 / v : 0; }); const tot = w.reduce((a, b) => a + b, 0) || 1; let v = 0; names.forEach((s, j) => v += (w[j] / tot) * X[s][i]); blend.push(v); }
const bv = sd(blend) * Math.sqrt(252); const lev = +K.VOL_TARGET / (bv || 1); const B = stats(blend.map((v) => v * lev));
await spendTrials({ rest: OWNED, headers: hdr, family: "multistrategy", runId: K.RUN_ID, spent: names.length + 1 });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  RISK-PARITY BLEND at ${(100 * +K.VOL_TARGET).toFixed(0)}% vol: Sharpe ${B.sr.toFixed(2)}, t ${B.t.toFixed(2)}, ${(100 * B.mu).toFixed(1)}%/yr, maxDD ${(100 * B.mdd).toFixed(0)}%, underwater ${B.uwY.toFixed(1)}y; best single sleeve Sharpe ${Math.max(...names.map((s) => st[s].sr)).toFixed(2)}; max |corr| ${maxCorr.toFixed(2)}`);
console.log(`  LEVERAGE TABLE (blend): ` + [0.10, 0.20, 0.40].map((tv) => { const x = blend.map((v) => v * tv / (bv || 1)); const s2 = stats(x); const g = s2.mu - s2.vol * s2.vol / 2; return `${(100 * tv).toFixed(0)}% vol -> ${(100 * s2.mu).toFixed(1)}%/yr, DD ${(100 * s2.mdd).toFixed(0)}%, 10x in ${g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never"}`; }).join(" | "));
const ok = B.sr >= 1.0 && B.t >= ceil.ceiling && B.mdd > -0.25 && B.sr > Math.max(...names.map((s) => st[s].sr)) && maxCorr < 0.5;
console.log(`  ceiling ${ceil.ceiling.toFixed(3)}. VERDICT (D-865 rule): ${ok ? "SUPPORTED" : `NULL — ${[B.sr < 1.0 && `blend Sharpe ${B.sr.toFixed(2)} < 1.0`, B.t < ceil.ceiling && `t ${B.t.toFixed(2)} < ceiling`, B.mdd <= -0.25 && "maxDD worse than -25%", B.sr <= Math.max(...names.map((s) => st[s].sr)) && "does not beat the best sleeve", maxCorr >= 0.5 && "a sleeve pair correlates >= 0.5"].filter(Boolean).join("; ")}`}`);


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
    const decMap: Record<string, string> = { "four-factor-blend": "D-932", "distress-blend-combined": "D-936", "three-factor-blend": "D-924" };
    const book = { dormant: true, spec_id: K.PAPER_SPEC, decision: decMap[K.PAPER_SPEC] ?? "D-924", forward_rule: K.PAPER_RULE, inception: K.PAPER_START,
      construction: `risk-parity blend of ${names.join(" + ")}, equal-risk-parity from trailing 60d sleeve vol, ${(+K.VOL_TARGET*100)}% vol target, per-class costs, ${K.REBAL_D}-day rebalance` + (names.includes("gcshort") ? " — gcshort = the D-936 COMBINED distress short (going-concern UNION late-filing)" : ""),
      sleeve_weights: sleeveW, insample_sharpe: +B.sr.toFixed(2), insample_t: +B.t.toFixed(2), insample_maxDD: +(100 * B.mdd).toFixed(0), insample_underwater_y: +B.uwY.toFixed(1),
      target_vol: +K.VOL_TARGET, confident_vol_note: "size at ~20% vol (real-path DD -46%); 40% vol is ruinous",
      honest_note: `DORMANT paper book, $0 at risk, NEVER auto-armed — arming is the operator's act after the staged gates. In-sample Sharpe ${B.sr.toFixed(2)} is DESCRIPTIVE (post-hoc sleeve subset; distress tail is squeeze-optimistic under flat 10% borrow); the forward clock ${K.PAPER_RULE} validates it. Claude never executes; manual fills only at MICRO.` };
    const ins = await fetch(`${OWNED}/trd_positions`, { method: "POST", headers: { ...wh, Prefer: "return=minimal" }, body: JSON.stringify({ book }) }); // plumbing-ok: audited — status checked next line
    console.log(`  PAPER SNAPSHOT -> trd_positions (DORMANT ${K.PAPER_SPEC}): ${ins.status}`);
  } else console.log(`  PAPER SNAPSHOT: ${K.PAPER_SPEC} already stood up (id ${existing[0].id}) — idempotent, not duplicated.`);
}
