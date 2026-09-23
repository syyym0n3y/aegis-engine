#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// gamma-regime-test.ts (D-961) — the two gamma/OI forced-flow forms D-820 did NOT test, on the same owned dataset
// (SPXW per-strike OI, ~5mo daily prior-close snapshots; USA500IDXUSD hourly CFD). PRE-SPECIFIED before running:
//  T1 GEX->VOL: dealer-gamma proxy vs NEXT-day realized vol. Convention (stated assumption, SqueezeMetrics-style):
//     dealers are long customer-sold calls and short customer-bought puts => GEX = sum[callOI*ker - putOI*ker],
//     ker = exp(-((K-S)/(BW*S))^2), S = prior close. Direction pre-registered: HIGH GEX -> LOWER next-day vol
//     (hedgers damp), LOW/negative -> HIGHER (hedgers amplify).
//  T2 REGIME TRADE (lag-1, net 4bp): GEX top tercile -> fade prior-day return next session (open->close);
//     bottom tercile -> follow it. Train first 2/3, test last 1/3.
//  T3 dOI FLOW: day-over-day change in near-spot OI (|K-S| < 2%S), top-vs-bottom quintile -> next-day realized vol
//     and open->close drift. Direction pre-registered: OI build-up near spot -> damped next day (when GEX >= 0).
// POWER, STATED UP FRONT: ~115 usable days; a daily-return effect needs ~19bp/day to reach |t|=2 => anything smaller
// lands UNDERPOWERED (not NULL, not edge). Variants: kernel BW {1%, 2%} x 3 tests = 6 trials, spent via the ledger.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("gamma-regime-test", [
  { name: "OI", def: "data/databento/spxw-oi.jsonl" }, { name: "SYM", def: "USA500IDXUSD" },
  { name: "FEE_BP", def: "4" }, { name: "RUN_ID", def: "D-961-gamma-regime" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gam", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const REPO = new URL("..", import.meta.url).pathname; const FEE = +K.FEE_BP / 1e4;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
// OI snapshots: rows [expiry, C|P, strike, oi], snapshot dated d = PRIOR-close positioning (lag inherent)
const oiDays = (await Deno.readTextFile(`${REPO}${K.OI}`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)) as { d: string; rows: [string, string, number, number][] }[];
assertNonEmpty("OI days", oiDays, 60); const oiByDay = new Map(oiDays.map((x) => [x.d, x.rows]));
// hourly price panel
const bars: { ts: number; o: number; c: number }[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${K.SYM}&select=ts,o,c&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; c: number }[]; for (const r of p) if (r.c > 0) bars.push(r); if (p.length < 50000) break; }
const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const byDay = new Map<string, { o: number; c: number; rv: number }>(); {
  const tmp = new Map<string, number[]>(); const opens = new Map<string, number>();
  for (const b of bars) { const d = dayOf(b.ts); if (!opens.has(d)) opens.set(d, b.o); (tmp.get(d) ?? tmp.set(d, []).get(d)!).push(b.c); }
  for (const [d, cs] of tmp) { let rv = 0; for (let i = 1; i < cs.length; i++) rv += Math.abs(Math.log(cs[i] / cs[i - 1])); byDay.set(d, { o: opens.get(d)!, c: cs[cs.length - 1], rv }); }
}
const days = [...byDay.keys()].sort();
type Row = { d: string; gex: number; nearOI: number; prevRet: number; nextOC: number; nextRV: number };
const build = (BW: number): Row[] => {
  const out: Row[] = [];
  for (let i = 1; i < days.length - 1; i++) {
    const d = days[i], oi = oiByDay.get(d); if (!oi) continue;
    const S = byDay.get(days[i - 1])!.c; if (!(S > 0)) continue;
    let gex = 0, near = 0;
    for (const r of oi) { if (r[0] < d) continue; const ker = Math.exp(-(((r[2] - S) / (BW * S)) ** 2)); gex += (r[1] === "C" ? 1 : -1) * r[3] * ker; if (Math.abs(r[2] - S) < 0.02 * S) near += r[3]; }
    const prevRet = Math.log(byDay.get(d)!.c / S);                       // day d itself is "prior day" for the NEXT session
    const nx = byDay.get(days[i + 1])!;
    out.push({ d, gex, nearOI: near, prevRet, nextOC: Math.log(nx.c / nx.o), nextRV: nx.rv });
  }
  return out;
};
const terc = (rows: Row[], f: (r: Row) => number, lo: number, hi: number) => { const s = [...rows].sort((a, b) => f(a) - f(b)); return { lo: s.slice(0, Math.floor(s.length * lo)), hi: s.slice(Math.floor(s.length * hi)) }; };
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "gamma-regime", runId: K.RUN_ID, spent: 6 });
console.log(`\n==> D-961 GAMMA/OI FORCED-FLOW REGIME — ${oiDays.length} OI days joined to ${days.length} price days. Trials 6 spent; ceiling ${T.ceiling.toFixed(3)} at N=${T.N.toLocaleString()}.`);
for (const BW of [0.01, 0.02]) {
  const rows = build(BW); if (rows.length < 60) { console.log(`  BW ${BW}: only ${rows.length} joined days — UNDERPOWERED, skipping`); continue; }
  // T1: GEX -> next-day realized vol (tercile contrast)
  const { lo, hi } = terc(rows, (r) => r.gex, 1 / 3, 2 / 3);
  const dv = mean(hi.map((r) => r.nextRV)) - mean(lo.map((r) => r.nextRV));
  const dvT = tstat([...hi.map((r) => r.nextRV - mean(lo.map((x) => x.nextRV)))]);
  // T2: regime trade, train/test
  const cut = Math.floor(rows.length * 2 / 3); const g1 = rows.slice(0, cut), g2 = rows.slice(cut);
  const trade = (rs: Row[]) => { const t3 = terc(rs, (r) => r.gex, 1 / 3, 2 / 3); const pnl: number[] = [];
    for (const r of t3.hi) pnl.push(-Math.sign(r.prevRet) * r.nextOC - FEE);          // high GEX: fade
    for (const r of t3.lo) pnl.push(Math.sign(r.prevRet) * r.nextOC - FEE);           // low GEX: follow
    return pnl; };
  const ptr = trade(g1), pte = trade(g2);
  // T3: dOI near spot -> next-day vol
  const withD = rows.map((r, i) => ({ ...r, dOI: i > 0 ? r.nearOI - rows[i - 1].nearOI : 0 })).slice(1);
  const q5 = terc(withD, (r) => (r as Row & { dOI: number }).dOI, 0.2, 0.8);
  const dvol3 = mean(q5.hi.map((r) => r.nextRV)) - mean(q5.lo.map((r) => r.nextRV));
  const dvol3T = tstat(q5.hi.map((r) => r.nextRV - mean(q5.lo.map((x) => x.nextRV))));
  console.log(`  BW ${(100 * BW).toFixed(0)}% (${rows.length} days):`);
  console.log(`    T1 GEX->vol: hi-minus-lo tercile next-day RV ${(1e4 * dv).toFixed(1)}bp/day (t ${dvT.toFixed(2)}) — prereg direction NEGATIVE ${dv < 0 ? "MATCHED" : "MISSED"}`);
  console.log(`    T2 regime trade net: TRAIN ${(1e4 * mean(ptr)).toFixed(1)}bp/d (t ${tstat(ptr).toFixed(2)}, n ${ptr.length}) -> TEST ${(1e4 * mean(pte)).toFixed(1)}bp/d (t ${tstat(pte).toFixed(2)}, n ${pte.length})`);
  console.log(`    T3 dOI(near-spot)->vol: hi-minus-lo quintile RV ${(1e4 * dvol3).toFixed(1)}bp (t ${dvol3T.toFixed(2)}) — prereg NEGATIVE ${dvol3 < 0 ? "MATCHED" : "MISSED"}`);
  // ERA DECOMPOSITION (D-967, not new trials — the same registered T1 statistic broken by calendar year, the D-963
  // pattern): the 5-year panel exists precisely to ask whether vol-damping held through the 2021 meme squeeze and
  // the 2022 bear, or is a 2026 artifact.
  const byYear = new Map<string, Row[]>(); for (const r of rows) { const y = r.d.slice(0, 4); (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(r); }
  for (const [y, yr] of [...byYear.entries()].sort()) {
    if (yr.length < 40) { console.log(`    ERA ${y}: n ${yr.length} — too thin`); continue; }
    const ty = terc(yr, (r) => r.gex, 1 / 3, 2 / 3);
    const dy = mean(ty.hi.map((r) => r.nextRV)) - mean(ty.lo.map((r) => r.nextRV));
    const dyT = tstat(ty.hi.map((r) => r.nextRV - mean(ty.lo.map((x) => x.nextRV))));
    console.log(`    ERA ${y} (n ${yr.length}): T1 hi-lo GEX -> next RV ${(1e4 * dy).toFixed(1)}bp (t ${dyT.toFixed(2)}) ${dy < 0 ? "matched" : "MISSED"}`);
  }
  // CONTROL (not a new claim — a diagnostic of T1): vol clusters, and calm markets carry high call OI, so GEX may
  // re-measure TODAY's vol. Double-sort: within each today-RV tercile, the hi-minus-lo GEX effect on NEXT-day RV.
  // If the effect dies within-tercile, T1 is vol clustering wearing a gamma costume.
  const withRV = rows.map((r, i) => ({ ...r, todayRV: byDay.get(r.d)!.rv }));
  const rvT = terc(withRV, (r) => (r as Row & { todayRV: number }).todayRV, 1 / 3, 2 / 3);
  const mid = withRV.filter((r) => !rvT.lo.includes(r) && !rvT.hi.includes(r));
  for (const [nm, bucket] of [["calm", rvT.lo], ["mid", mid], ["wild", rvT.hi]] as [string, Row[]][]) {
    if (bucket.length < 20) { console.log(`    CONTROL ${nm}: n ${bucket.length} — too thin`); continue; }
    const bb = terc(bucket, (r) => r.gex, 1 / 3, 2 / 3);
    const d2 = mean(bb.hi.map((r) => r.nextRV)) - mean(bb.lo.map((r) => r.nextRV));
    const d2T = tstat(bb.hi.map((r) => r.nextRV - mean(bb.lo.map((x) => x.nextRV))));
    console.log(`    CONTROL within today-RV ${nm.padEnd(4)} (n ${bucket.length}): hi-lo GEX -> next RV ${(1e4 * d2).toFixed(1)}bp (t ${d2T.toFixed(2)})`);
  }
}
console.log(`\n  READ: ~115 days total; |t|>=2 on T2 needs ~19bp/day. Below that the verdict is UNDERPOWERED (n needed stated), never NULL and never edge.`);
console.log(`  The GEX dealer-sign convention is an ASSUMPTION (customers sell calls / buy puts); a MISSED direction may mean the convention, not the mechanism, is wrong — that distinction stays open.`);
