// D-927 — cross-instrument lead-lag: does BTC's hour-t move predict an alt's hour-(t+1) move? (slow diffusion)
// The one variable class the accounting hadn't covered: lagged cross-instrument prediction. Positive control =
// contemporaneous BTC-beta must be strongly +. Deployable only if the lag-1 lead clears cost on the LIQUID tercile.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("crossinstrument-leadlag", [
  { name: "SPLIT", def: "2025-01-01" }, { name: "MIN_BARS", def: "2000" }, { name: "ROUNDTRIP_BP", def: "9" }, { name: "RUN_ID", def: "D-927-crossinstrument-leadlag" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
// bivariate OLS: y ~ b1*x1 + b2*x2 (+intercept); return b1 and its contribution
function ols2(y: number[], x1: number[], x2: number[]) {
  const n = y.length; const mx1 = mean(x1), mx2 = mean(x2), my = mean(y);
  let s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0; for (let i = 0; i < n; i++) { const a = x1[i]-mx1, b = x2[i]-mx2, c = y[i]-my; s11+=a*a; s12+=a*b; s22+=b*b; s1y+=a*c; s2y+=b*c; }
  const det = s11*s22 - s12*s12 || 1e-12; const b1 = (s22*s1y - s12*s2y)/det; const b2 = (s11*s2y - s12*s1y)/det; return { b1, b2, sdx1: Math.sqrt(s11/(n-1)) };
}
const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
const meta = (await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars >= +K.MIN_BARS);
async function bars(sym: string) { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1hSF&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); }
const btc = await bars("BTCUSDT"); assertNonEmpty("BTC bars", btc, 2000);
const btcRet = new Map<number, number>(); for (let i = 1; i < btc.length; i++) btcRet.set(btc[i][0], Math.log(btc[i][4] / btc[i - 1][4]));
type Obs = { ts: number; contemp: number; fwd: number; own: number; btc: number; vol: number };
const perName: { sym: string; vol: number; obs: Obs[] }[] = [];
for (const m of meta) {
  if (m.symbol === "BTCUSDT") continue;
  const b = await bars(m.symbol); if (b.length < +K.MIN_BARS) continue;
  const obs: Obs[] = []; let vs = 0, vn = 0;
  for (let i = 1; i + 1 < b.length; i++) {
    const bt = btcRet.get(b[i][0]); const btPrev = btcRet.get(b[i - 1][0]); if (bt === undefined || btPrev === undefined) continue;
    const own = Math.log(b[i][4] / b[i - 1][4]); const contemp = own; const fwd = Math.log(b[i + 1][4] / b[i][4]);
    obs.push({ ts: b[i][0], contemp, fwd, own, btc: bt, vol: b[i][5] * b[i][4] }); vs += b[i][5] * b[i][4]; vn++;
  }
  if (obs.length >= 500) perName.push({ sym: m.symbol, vol: vn ? vs / vn : 0, obs });
}
assertNonEmpty("alts", perName, 20);
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
function pooledLead(rows: { sym: string; obs: Obs[] }[], window: "all" | "train" | "test") {
  // per name: contemporaneous beta (control) and lag-1 lead b1 (fwd ~ btc_t + own_t)
  const day = new Map<number, number[]>(); let contempBeta: number[] = []; let leadBp: number[] = [];
  for (const nm of rows) {
    const o = nm.obs.filter((x) => window === "all" ? true : window === "train" ? x.ts < SPLIT : x.ts >= SPLIT);
    if (o.length < 200) continue;
    // control: contemp ~ btc
    const c = ols2(o.map((x) => x.contemp), o.map((x) => x.btc), o.map((x) => 1e-9 * x.ts)); contempBeta.push(c.b1);
    // lead: fwd ~ btc_t + own_t
    const L = ols2(o.map((x) => x.fwd), o.map((x) => x.btc), o.map((x) => x.own));
    leadBp.push(L.b1 * L.sdx1 * 1e4); // bp of fwd return per 1sd of BTC return, attributable to lead
    // day-cluster the lead signal's realized bp: sign(btc_t)*fwd, per day
    for (const x of o) { const d = Math.floor(x.ts / 86400); const v = Math.sign(x.btc) * x.fwd; (day.get(d) ?? day.set(d, []).get(d)!).push(v); }
  }
  const dayMeans = [...day.values()].map(mean);
  const netBp = mean(dayMeans) * 1e4; // realized bp/trade of the lead rule (long alt when BTC up, short when down)
  return { contempBeta: mean(contempBeta), leadBp: mean(leadBp), realizedBp: netBp, dayT: tstat(dayMeans), nNames: contempBeta.length, nDays: dayMeans.length };
}
const volMed = [...perName.map((n) => n.vol)].sort((a, b) => a - b)[Math.floor(perName.length / 2)];
const liquid = perName.filter((n) => n.vol >= volMed), illiquid = perName.filter((n) => n.vol < volMed);
console.log(`==> D-927 CROSS-INSTRUMENT LEAD-LAG (BTC -> alts, 1hSF panel, ${perName.length} alts) — round-trip ${K.ROUNDTRIP_BP}bp, ceiling ${ceil.ceiling.toFixed(2)}\n`);
console.log(`  ${"cohort".padEnd(14)} ${"contempBeta".padStart(11)} ${"leadBp/sd".padStart(10)} ${"realizedBp".padStart(10)} ${"day-t".padStart(7)} ${"names".padStart(6)}  verdict`);
for (const [nm, rows] of [["ALL", perName], ["LIQUID half", liquid], ["ILLIQUID half", illiquid]] as [string, typeof perName][]) {
  const s = pooledLead(rows, "all"); const netAfter = s.realizedBp - +K.ROUNDTRIP_BP;
  const v = Math.abs(s.dayT) < 2 ? "NULL (|t|<2)" : Math.abs(s.dayT) < ceil.ceiling ? "sig<ceiling" : netAfter > 0 ? "CLEARS?!" : `SUB-COST (net ${netAfter.toFixed(1)}bp)`;
  console.log(`  ${nm.padEnd(14)} ${s.contempBeta.toFixed(3).padStart(11)} ${s.leadBp.toFixed(2).padStart(10)} ${s.realizedBp.toFixed(2).padStart(10)} ${s.dayT.toFixed(2).padStart(7)} ${String(s.nNames).padStart(6)}  ${v}`);
}
// OOS: train-select nothing (the rule is fixed = follow BTC); just report test-window realized on the liquid half
const tr = pooledLead(liquid, "train"), te = pooledLead(liquid, "test");
console.log(`\n  LIQUID half train->test (rule is fixed 'follow BTC', no selection): train realizedBp ${tr.realizedBp.toFixed(2)} (t ${tr.dayT.toFixed(2)}) | test realizedBp ${te.realizedBp.toFixed(2)} (t ${te.dayT.toFixed(2)})`);
await spendTrials({ rest: OWNED, headers: hdr, family: "crossinstrument-leadlag", runId: K.RUN_ID, spent: 3 });
console.log(`\n  READ: contempBeta strongly + = control ok (BTC IS the factor). realizedBp = the lead rule's per-trade edge vs ${K.ROUNDTRIP_BP}bp cost; deployable only if LIQUID-half realizedBp > cost with day-t past ceiling AND holds test.`);
