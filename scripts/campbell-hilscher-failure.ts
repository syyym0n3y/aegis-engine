// D-941 — CAMPBELL-HILSCHER-SZILAGYI (2008) FAILURE PROBABILITY as a candidate short-sale-constrained sleeve.
// The one genuinely-untested member of the class (the accounting zoo — accruals/NOA/issuance/profitability/CF-to-price —
// is CLOSED and dead; distress-TEXT (D-930) and IVOL (D-939) are the survivors). CHS is a continuous fundamentals+price
// distress SCORE (not an event trigger), so it could catch distress more broadly/earlier than the filing-event sleeve.
// BUT by construction it contains SIGMA (~IVOL) and leverage/profitability (~distress) terms, so the decisive test is its
// CORRELATION to those sleeves and its BLEND contribution, not its standalone Sharpe. Held data, no fetch.
// Honors BENCHMARK (per-leg excess), LIQUIDITY (both halves), TURNOVER, breadth, point-in-time (effective_date), pseudo-
// replication (t on the monthly portfolio series). CHS logit coefficients: the paper's 12-month "best model".
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("campbell-hilscher-failure", [
  { name: "REBAL_D", def: "21" }, { name: "QUINTILE", def: "5" }, { name: "COST_BP", def: "20" },
  { name: "MAX_NAMES", def: "2500", note: "history-length cap (memory)" }, { name: "MIN_NAMES", def: "100" },
  { name: "RUN_ID", def: "D-941-chs-failure" }, { name: "DUMP", def: "0", note: "1 = write d941-chs-daily.json for the blend correlation test" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "chs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const day = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
const RB = +K.REBAL_D, QN = +K.QUINTILE, cost = +K.COST_BP / 1e4, MINN = +K.MIN_NAMES;
// 1) fundamentals (point-in-time by effective_date) for the CHS inputs
type Obs = { d: number; v: number };
const F: Record<string, Map<string, Obs[]>> = {}; const CONCEPTS = ["NetIncomeLoss", "Liabilities", "CashAndCashEquivalentsAtCarryingValue", "StockholdersEquity", "EntityCommonStockSharesOutstanding"];
for (const c of CONCEPTS) { F[c] = new Map();
  for (let off = 0; ; off += 10000) { const rows = await q(`trd_fundamentals?concept=eq.${c}&select=ticker,effective_date,value&order=ticker.asc,effective_date.asc&limit=10000&offset=${off}`) as { ticker: string; effective_date: string; value: number }[];
    if (!rows.length) break; for (const r of rows) { const t = r.ticker?.toUpperCase(); if (!t || r.value == null || !r.effective_date) continue; (F[c].get(t) ?? F[c].set(t, []).get(t)!).push({ d: day(r.effective_date), v: +r.value }); }
    if (rows.length < 10000) break; }
  for (const [, a] of F[c]) a.sort((x, y) => x.d - y.d); }
const asof = (c: string, t: string, d: number): number | null => { const a = F[c].get(t); if (!a) return null; let v: number | null = null; for (const o of a) { if (o.d <= d) v = o.v; else break; } return v; };
console.log(`fundamentals: ${CONCEPTS.map((c) => `${c.slice(0, 10)} ${F[c].size}`).join(", ")}`);
// 2) equity bars (capped by history)
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((m) => m.n_bars > 400).slice(0, +K.MAX_NAMES);
const names = meta.map((m) => m.symbol.toUpperCase()).filter((t) => F.EntityCommonStockSharesOutstanding.has(t) && F.Liabilities.has(t));
assertNonEmpty("names with CHS inputs", names, 50);
async function bars(sym: string) { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); }
type Bar = { d: number; c: number; r: number; dv: number };
const S = new Map<string, Bar[]>(); const idx = new Map<string, Map<number, number>>();
for (const t of names) { const b = await bars(t); if (b.length < 400) continue; const arr: Bar[] = []; const m = new Map<number, number>(); for (let j = 1; j < b.length; j++) { arr.push({ d: Math.floor(b[j][0] / 86400), c: b[j][4], r: Math.log(b[j][4] / b[j - 1][4]), dv: b[j][4] * b[j][5] }); } arr.forEach((x, i) => m.set(x.d, i)); S.set(t, arr); idx.set(t, m); }
console.log(`priced ${S.size}/${names.length} names`);
assertNonEmpty("priced", [...S.keys()], 50);
// market factor (equal-weight) + total ME per day for RSIZE
const allDays = new Set<number>(); for (const b of S.values()) for (const x of b) allDays.add(x.d);
const cal = [...allDays].sort((a, z) => a - z);
const mkt = new Map<number, number>(); for (const d of cal) { const rs: number[] = []; for (const [t, b] of S) { const i = idx.get(t)!.get(d); if (i !== undefined) rs.push(b[i].r); } if (rs.length >= 20) mkt.set(d, mean(rs)); }
const pxAt = (t: string, d: number): number | null => { const m = idx.get(t)!; for (let k = d; k >= d - 6; k--) { const i = m.get(k); if (i !== undefined) return S.get(t)![i].c; } return null; };
const dvTrail = (t: string, d: number): number => { const b = S.get(t)!, i = idx.get(t)!.get(d); if (i === undefined) return 0; const w = b.slice(Math.max(0, i - 60), i); return w.length ? mean(w.map((x) => x.dv)) : 0; };
// CHS score per name at day d (higher = higher failure probability). Coeffs: CHS 2008 Table IV 12-month model.
function chs(t: string, d: number, totME: number): number | null {
  const b = S.get(t)!, i = idx.get(t)!.get(d); if (i === undefined || i < 130) return null;
  const px = b[i].c; const sh = asof("EntityCommonStockSharesOutstanding", t, d); const li = asof("Liabilities", t, d);
  const ni = asof("NetIncomeLoss", t, d); const ca = asof("CashAndCashEquivalentsAtCarryingValue", t, d); const be = asof("StockholdersEquity", t, d);
  if (sh === null || li === null || sh <= 0) return null;
  const ME = sh * px; const MTA = ME + li; if (!(MTA > 0)) return null;
  const NIMTA = ni === null ? 0 : ni / MTA;                                   // profitability (annual NI as proxy for CHS's ttm)
  const TLMTA = li / MTA;                                                      // leverage
  const CASHMTA = ca === null ? 0 : ca / MTA;
  const win = b.slice(i - 63, i).map((x) => x.r); const SIGMA = sd(win) * Math.sqrt(252);        // 3-month annualized vol
  const exwin = b.slice(i - 252, i); const EXRET = exwin.length ? mean(exwin.map((x) => x.r - (mkt.get(x.d) ?? 0))) * 252 : 0; // trailing excess vs market
  const RSIZE = Math.log(ME / Math.max(1, totME));
  const MB = be && be > 0 ? ME / be : 5;                                       // market-to-book (cap missing at 5)
  const PRICE = Math.log(Math.min(px, 15));
  // CHS logit (higher LPFD => higher failure prob). Signs per the paper: distress rises with leverage, vol; falls with profitability, cash, size, price.
  return -20.26 * NIMTA + 1.42 * TLMTA - 7.13 * EXRET + 1.41 * SIGMA - 0.045 * RSIZE - 2.13 * CASHMTA + 0.075 * MB - 0.058 * PRICE - 9.16;
}
// 3) monthly cross-section: long LOW failure-prob / short HIGH failure-prob within liquid tercile
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
type Reb = { d: number; longs: string[]; shorts: string[]; liqN: number };
const rebs: Reb[] = [];
for (let ci = 260; ci < cal.length; ci += RB) { const d = cal[ci];
  const totME = [...S.keys()].reduce((s, tk) => { const p = pxAt(tk, d), ss = asof("EntityCommonStockSharesOutstanding", tk, d); return s + (p && ss && ss > 0 ? p * ss : 0); }, 0); // once per day, not per name
  const cand: { t: string; s: number; dv: number }[] = [];
  for (const t of S.keys()) { const sc = chs(t, d, totME); if (sc === null || !isFinite(sc)) continue; cand.push({ t, s: sc, dv: dvTrail(t, d) }); }
  if (cand.length < MINN) continue;
  const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)];
  const liq = cand.filter((c) => c.dv >= volMed); if (liq.length < 50) continue;
  liq.sort((a, z) => a.s - z.s); const k = Math.max(5, Math.floor(liq.length / QN));
  rebs.push({ d, longs: liq.slice(0, k).map((c) => c.t), shorts: liq.slice(-k).map((c) => c.t), liqN: liq.length });
}
console.log(`\n==> D-941 CHS FAILURE PROBABILITY — long LOW / short HIGH within liquid tercile; ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`   ${rebs.length} rebalances, mean liquid universe ${Math.round(mean(rebs.map((r) => r.liqN)))}, leg ${Math.round(mean(rebs.map((r) => r.longs.length)))}`);
assertNonEmpty("rebalances", rebs, 24);
// 4) forward returns + per-leg excess (BENCHMARK) + liquidity halves + turnover
const fwd = (t: string, d0: number, d1: number): number | null => { const p0 = pxAt(t, d0), p1 = pxAt(t, d1); return p0 && p1 ? Math.log(p1 / p0) : null; };
const lsRaw: number[] = [], lsNet: number[] = [], longEx: number[] = [], shortEx: number[] = [], turn: number[] = [];
let prev = new Set<string>();
for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d;
  const uni = [...rebs[r].longs, ...rebs[r].shorts]; const uniR = uni.map((t) => fwd(t, d0, d1)).filter((x): x is number => x !== null); if (!uniR.length) continue; const um = mean(uniR);
  const lr = rebs[r].longs.map((t) => fwd(t, d0, d1)).filter((x): x is number => x !== null);
  const sr = rebs[r].shorts.map((t) => fwd(t, d0, d1)).filter((x): x is number => x !== null);
  if (lr.length < 5 || sr.length < 5) continue;
  lsRaw.push(mean(lr) - mean(sr)); longEx.push(mean(lr) - um); shortEx.push(mean(sr) - um);
  const now = new Set(uni); const churn = prev.size ? [...now].filter((t) => !prev.has(t)).length / now.size : 1; turn.push(churn); prev = now;
  lsNet.push((mean(lr) - mean(sr)) - 2 * churn * cost);
}
const ann = 252 / RB;
const stat = (a: number[]) => { const mu = mean(a) * ann, s = sd(a) * Math.sqrt(ann); return { annPct: mu * 100, vol: s * 100, sr: mu / (s || 1), t: mean(a) / (sd(a) / Math.sqrt(a.length) || 1) }; };
const R = stat(lsRaw), N = stat(lsNet);
console.log(`  GROSS L-S: ${R.annPct.toFixed(1)}%/yr vol ${R.vol.toFixed(1)}% Sharpe ${R.sr.toFixed(2)} t ${R.t.toFixed(2)} (${lsRaw.length} rebs)`);
console.log(`  NET   L-S: ${N.annPct.toFixed(1)}%/yr Sharpe ${N.sr.toFixed(2)} t ${N.t.toFixed(2)} (cost ${K.COST_BP}bp, turnover ${(mean(turn)*100).toFixed(0)}%/reb)`);
console.log(`  BENCHMARK LAW: LONG(low-fail) ${(mean(longEx)*100).toFixed(2)}%/reb, SHORT(high-fail) ${(mean(shortEx)*100).toFixed(2)}%/reb (short should be NEGATIVE = high-failure names underperform)`);
console.log(`  CLEARS NET PAST CEILING: ${N.sr > 0 && Math.abs(N.t) > ceil.ceiling ? "YES" : "NO"} (net t ${N.t.toFixed(2)} vs ${ceil.ceiling.toFixed(2)}) — but for a SLEEVE, correlation to distress+IVOL decides`);
await spendTrials({ rest: OWNED, headers: hdr, family: "chs-failure", runId: K.RUN_ID, spent: 3 });
if (K.DUMP === "1") {
  const daily: { d: string; ret: number }[] = [];
  for (let r = 0; r < rebs.length - 1; r++) { const d0 = rebs[r].d, d1 = rebs[r + 1].d; const L = rebs[r].longs, Sh = rebs[r].shorts;
    for (let d = d0 + 1; d <= d1; d++) { const lr = L.map((t) => { const i = idx.get(t)!.get(d); return i !== undefined ? S.get(t)![i].r : null; }).filter((x): x is number => x !== null);
      const sr = Sh.map((t) => { const i = idx.get(t)!.get(d); return i !== undefined ? S.get(t)![i].r : null; }).filter((x): x is number => x !== null);
      if (lr.length < 5 || sr.length < 5) continue; daily.push({ d: new Date(d * 86400000).toISOString().slice(0, 10), ret: mean(lr) - mean(sr) }); } }
  await Deno.writeTextFile(new URL("../data/d941-chs-daily.json", import.meta.url), JSON.stringify(daily));
  console.log(`  dumped ${daily.length} daily L-S returns -> data/d941-chs-daily.json`);
}
console.log(`\n  READ: CHS shares SIGMA(~IVOL) + leverage/profitability(~distress) by construction — if its corr to ivol/gcshort is high it is REDUNDANT (spanned); it only matters if it adds to the blend beyond them.`);
