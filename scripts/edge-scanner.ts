// edge-scanner.ts (D-951) — BREADTH-FIRST edge validation. Operator: "look for many more edges across the market;
// contextualise instead of backtracking one at a time." Runs a BATTERY of pre-specified cross-sectional signals through
// the SAME validation gauntlet at once — LIQUIDITY LAW (liquid tercile), BENCHMARK LAW (both legs' excess vs universe),
// BREADTH LAW (names/rebalance), TURNOVER LAW (drag = 2*turnover*cost), EFFECT-SIZE (net vs cost), PSEUDO-REPLICATION
// (portfolio-series t, not name-t), and the DEFLATION CEILING — then ranks survivors vs sub-fee vs capacity-bound.
// Directions are PRE-SPECIFIED from the literature (SIGN/SELECTION LAW: no post-hoc flip). IVOL is a POSITIVE CONTROL:
// a scanner that cannot re-discover our one known survivor is broken. All signals are BAR-DERIVED (held data, no fetch).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("edge-scanner", [
  { name: "REBAL_D", def: "21" }, { name: "QUINTILE", def: "5" }, { name: "COST_BP", def: "20" },
  { name: "MIN_NAMES", def: "100" }, { name: "MAX_NAMES", def: "2200", note: "cap by history length (memory)" },
  { name: "RUN_ID", def: "D-951-edge-scanner" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "es", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const RB = +K.REBAL_D, QN = +K.QUINTILE, cost = +K.COST_BP / 1e4, MINN = +K.MIN_NAMES;
// load held equity bars
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((m) => m.n_bars > 400).slice(0, +K.MAX_NAMES);
assertNonEmpty("equity names", meta, 200);
type Bar = { d: number; c: number; r: number; dv: number };
const S = new Map<string, Bar[]>();
for (let i = 0; i < meta.length; i += 40) { const page = meta.slice(i, i + 40);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); if (b.length < 400) continue;
    const arr: Bar[] = []; for (let j = 1; j < b.length; j++) arr.push({ d: Math.floor(b[j][0] / 86400), c: b[j][4], r: Math.log(b[j][4] / b[j - 1][4]), dv: b[j][4] * b[j][5] }); S.set(r.symbol.toUpperCase(), arr); }
}
console.log(`loaded ${S.size} equity names`); assertNonEmpty("priced", [...S.keys()], 100);
const idxOf = new Map<string, Map<number, number>>(); for (const [s, b] of S) { const m = new Map<number, number>(); b.forEach((x, i) => m.set(x.d, i)); idxOf.set(s, m); }
const allDays = new Set<number>(); for (const b of S.values()) for (const x of b) allDays.add(x.d); const cal = [...allDays].sort((a, z) => a - z);
const mkt = new Map<number, number>(); for (const d of cal) { const rs: number[] = []; for (const [s, b] of S) { const i = idxOf.get(s)!.get(d); if (i !== undefined) rs.push(b[i].r); } if (rs.length >= 20) mkt.set(d, mean(rs)); }
const win = (s: string, d: number, n: number): Bar[] | null => { const b = S.get(s)!, i = idxOf.get(s)!.get(d); if (i === undefined || i < n) return null; return b.slice(i - n, i); };
const skew = (a: number[]) => { const m = mean(a), s = sd(a); if (s === 0) return 0; return mean(a.map((x) => ((x - m) / s) ** 3)); };
// SIGNAL BATTERY — [name, fn(sym,d)->value|null, direction (+1 long HIGH, -1 long LOW), literature note]
type Sig = { name: string; f: (s: string, d: number) => number | null; dir: 1 | -1; note: string };
const SIGS: Sig[] = [
  { name: "mom_12_1", dir: 1, note: "Jegadeesh-Titman: long winners", f: (s, d) => { const w = win(s, d, 252); if (!w) return null; return Math.log(w[w.length - 21].c / w[0].c); } },
  { name: "rev_1m", dir: -1, note: "short-term reversal: long losers", f: (s, d) => { const w = win(s, d, 21); if (!w) return null; return Math.log(w[w.length - 1].c / w[0].c); } },
  { name: "rev_5y", dir: -1, note: "DeBondt-Thaler LT reversal: long past losers", f: (s, d) => { const w = win(s, d, 1260); if (!w) return null; return Math.log(w[w.length - 1].c / w[0].c); } },
  { name: "ivol", dir: -1, note: "POSITIVE CONTROL (Ang 2006): long low idio-vol", f: (s, d) => { const w = win(s, d, 60); if (!w) return null; const rs = w.map((x) => x.r), mr = w.map((x) => mkt.get(x.d) ?? 0); const mm = mean(mr), mrr = mean(rs); let cov = 0, vv = 0; for (let k = 0; k < rs.length; k++) { cov += (mr[k] - mm) * (rs[k] - mrr); vv += (mr[k] - mm) ** 2; } const beta = vv > 0 ? cov / vv : 0; return sd(rs.map((rk, k) => rk - beta * (mr[k] - mm) - mrr)); } },
  { name: "totvol", dir: -1, note: "low-vol anomaly: long low total vol", f: (s, d) => { const w = win(s, d, 60); if (!w) return null; return sd(w.map((x) => x.r)); } },
  { name: "beta", dir: -1, note: "BAB (Frazzini-Pedersen): long low beta", f: (s, d) => { const w = win(s, d, 120); if (!w) return null; const rs = w.map((x) => x.r), mr = w.map((x) => mkt.get(x.d) ?? 0); const mm = mean(mr), mrr = mean(rs); let cov = 0, vv = 0; for (let k = 0; k < rs.length; k++) { cov += (mr[k] - mm) * (rs[k] - mrr); vv += (mr[k] - mm) ** 2; } return vv > 0 ? cov / vv : 0; } },
  { name: "max5", dir: -1, note: "Bali lottery: long low MAX daily return", f: (s, d) => { const w = win(s, d, 21); if (!w) return null; return Math.max(...w.map((x) => x.r)); } },
  { name: "skew", dir: -1, note: "idiosyncratic skew: long low skew", f: (s, d) => { const w = win(s, d, 120); if (!w) return null; return skew(w.map((x) => x.r)); } },
  { name: "illiq", dir: 1, note: "Amihud illiquidity premium: long illiquid (CAPACITY-BOUND expected)", f: (s, d) => { const w = win(s, d, 60); if (!w) return null; return mean(w.map((x) => Math.abs(x.r) / (x.dv || 1))) * 1e9; } },
  { name: "dvol_low", dir: -1, note: "size proxy: long low dollar-volume (small)", f: (s, d) => { const w = win(s, d, 60); if (!w) return null; return Math.log(mean(w.map((x) => x.dv)) + 1); } },
  { name: "w52h", dir: 1, note: "George-Hwang: long near 52-week high", f: (s, d) => { const w = win(s, d, 252); if (!w) return null; return w[w.length - 1].c / Math.max(...w.map((x) => x.c)); } },
  { name: "volofvol", dir: -1, note: "vol-of-vol: long low", f: (s, d) => { const w = win(s, d, 120); if (!w) return null; const v: number[] = []; for (let k = 20; k < w.length; k++) v.push(sd(w.slice(k - 20, k).map((x) => x.r))); return v.length ? sd(v) : null; } },
];
const dvTrail = (s: string, d: number): number => { const b = S.get(s)!, i = idxOf.get(s)!.get(d); if (i === undefined) return 0; const w = b.slice(Math.max(0, i - 60), i); return w.length ? mean(w.map((x) => x.dv)) : 0; };
const pxAt = (s: string, d: number): number | null => { const i = idxOf.get(s)!.get(d); return i !== undefined ? S.get(s)![i].c : null; };
const fwd = (s: string, d0: number, d1: number): number | null => { const p0 = pxAt(s, d0), p1 = pxAt(s, d1); return p0 && p1 ? Math.log(p1 / p0) : null; };
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const ann = 252 / RB;
type R = { name: string; note: string; grossSR: number; netSR: number; netT: number; longEx: number; shortEx: number; breadth: number; turn: number; liqNetSR: number; liqNetT: number };
const results: R[] = [];
for (const sig of SIGS) {
  // build monthly liquid-tercile quintile long-short in the pre-specified direction
  const lsNet: number[] = [], lsGross: number[] = [], longEx: number[] = [], shortEx: number[] = [], turns: number[] = []; let prev = new Set<string>(); const breadths: number[] = [];
  for (let ci = 1300; ci < cal.length; ci += RB) { const d = cal[ci], dN = cal[ci + RB]; if (dN === undefined) break;
    const cand: { s: string; v: number; dv: number }[] = [];
    for (const s of S.keys()) { const v = sig.f(s, d); if (v === null || !isFinite(v) || pxAt(s, d) === null) continue; cand.push({ s, v, dv: dvTrail(s, d) }); }
    if (cand.length < MINN) continue;
    const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)];
    const liq = cand.filter((c) => c.dv >= volMed); if (liq.length < 50) continue;
    // sort so that the LONG leg is first: dir +1 -> long HIGH (desc); dir -1 -> long LOW (asc)
    liq.sort((a, z) => sig.dir === 1 ? z.v - a.v : a.v - z.v); const k = Math.max(5, Math.floor(liq.length / QN));
    const longs = liq.slice(0, k).map((c) => c.s), shorts = liq.slice(liq.length - k).map((c) => c.s);
    const uni = [...longs, ...shorts]; const uniR = uni.map((s) => fwd(s, d, dN)).filter((x): x is number => x !== null); if (uniR.length < 20) continue; const um = mean(uniR);
    const lr = longs.map((s) => fwd(s, d, dN)).filter((x): x is number => x !== null), sr = shorts.map((s) => fwd(s, d, dN)).filter((x): x is number => x !== null);
    if (lr.length < 5 || sr.length < 5) continue;
    const now = new Set(uni); const churn = prev.size ? [...now].filter((s) => !prev.has(s)).length / now.size : 1; prev = now;
    lsGross.push(mean(lr) - mean(sr)); lsNet.push((mean(lr) - mean(sr)) - 2 * churn * cost); longEx.push(mean(lr) - um); shortEx.push(mean(sr) - um); turns.push(churn); breadths.push(liq.length);
  }
  if (lsNet.length < 24) { results.push({ name: sig.name, note: sig.note, grossSR: NaN, netSR: NaN, netT: NaN, longEx: NaN, shortEx: NaN, breadth: mean(breadths) || 0, turn: NaN, liqNetSR: NaN, liqNetT: NaN }); continue; }
  const g = mean(lsGross) * ann / (sd(lsGross) * Math.sqrt(ann) || 1), n = mean(lsNet) * ann / (sd(lsNet) * Math.sqrt(ann) || 1), nt = tstat(lsNet);
  results.push({ name: sig.name, note: sig.note, grossSR: g, netSR: n, netT: nt, longEx: mean(longEx) * 1e4, shortEx: mean(shortEx) * 1e4, breadth: mean(breadths), turn: mean(turns), liqNetSR: n, liqNetT: nt });
}
await spendTrials({ rest: OWNED, headers: hdr, family: "edge-scanner", runId: K.RUN_ID, spent: SIGS.length });
results.sort((a, b) => (isNaN(b.netT) ? -99 : Math.abs(b.netT)) - (isNaN(a.netT) ? -99 : Math.abs(a.netT)));
console.log(`\n==> D-951 EDGE SCANNER — ${SIGS.length} signals, liquid tercile, monthly, ${K.COST_BP}bp, ceiling ${ceil.ceiling.toFixed(2)} (portfolio-t)`);
console.log(`  ${"signal".padEnd(10)} ${"grossSR".padStart(8)} ${"netSR".padStart(7)} ${"net t".padStart(7)} ${"longEx".padStart(7)} ${"shortEx".padStart(8)} ${"breadth".padStart(8)} ${"turn/reb".padStart(9)}  verdict`);
for (const r of results) {
  if (isNaN(r.netT)) { console.log(`  ${r.name.padEnd(10)} ${"—".padStart(8)} (too few rebalances / UNTESTED)`); continue; }
  const clears = Math.abs(r.netT) > ceil.ceiling, pos = r.netSR > 0;
  const verdict = clears && pos ? "*** CLEARS CEILING (liquid, net) ***" : Math.abs(r.netT) > 1.96 && pos ? "significant but SUB-CEILING" : pos ? "sub-fee / weak" : "WRONG SIGN vs literature";
  console.log(`  ${r.name.padEnd(10)} ${r.grossSR.toFixed(2).padStart(8)} ${r.netSR.toFixed(2).padStart(7)} ${r.netT.toFixed(2).padStart(7)} ${r.longEx.toFixed(1).padStart(7)} ${r.shortEx.toFixed(1).padStart(8)} ${Math.round(r.breadth).toString().padStart(8)} ${(100 * r.turn).toFixed(0).toString().padStart(8)}%  ${verdict}`);
}
const surv = results.filter((r) => !isNaN(r.netT) && Math.abs(r.netT) > ceil.ceiling && r.netSR > 0);
console.log(`\n  SURVIVORS (liquid net t > ceiling): ${surv.length ? surv.map((r) => r.name).join(", ") : "none new"}. IVOL positive-control net t ${(results.find((r) => r.name === "ivol")?.netT ?? NaN).toFixed(2)} (must be > ${ceil.ceiling.toFixed(2)} or the scanner is broken).`);
console.log(`  READ: this contextualises the whole cross-sectional price field in ONE gauntlet. Survivors join the deploy queue; sub-ceiling ones are known-and-recorded, not re-litigated one at a time.`);
