#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-decile-asset-class.ts (D-800) — clock #18's registered spec says "US equity liquid-decile … from the 12,300-symbol
// trd_bars_deep universe", but neither the scorer nor any in-sample benchmark (D-784/785/789/790/791) filters on
// asset_class, and the panel mixes classes: the refresher's decile audit found 111 of 1,230 (9%) non-equity — 37 crypto,
// 33 ETFs, 14 international indices, 13 sector ETFs, 5 commodity futures, 5 crypto-ex, 4 bare indices (^GSPC, ^DJI, ^RUT,
// ^IXIC — not tradeable instruments at all). This measures whether the words and the code disagree MATERIALLY:
//   A  unfiltered decile — exactly what the scorer computes today (the registered population)
//   B  the same decile with non-equity symbols removed (same cutoff; 1,119 names)
//   C  a decile RE-RANKED within asset_class=equity only (the spec read literally; a slightly different cutoff)
// Same cell (close < prior 20-day low → long K=5), net of the rule's 10bp, OOS 2023+, DAY-CLUSTERED t (≥1 signal/day, as
// the scorer), cross-symbol sign, era split. If B/C ≈ A the mismatch is cosmetic; if not, the clock's spec/code discrepancy is
// substantive and the operator decides (rule immutable → v2 registration or an amendment note). DESCRIPTIVE ONLY; 3 trials.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("eq-decile-asset-class", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" }, { name: "K_DAYS", def: "5" },
  { name: "N_LEVEL", def: "20" }, { name: "RT_BP", def: "10" }, { name: "MIN_INST", def: "20" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), NLEVEL = Number(K.N_LEVEL), RT = Number(K.RT_BP) / 1e4, MIN_INST = Number(K.MIN_INST);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "edac", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,asset_class&order=n_bars.desc`) as { symbol: string; asset_class: string }[];
assertNonEmpty("meta", meta, 1000);
interface Ev { day: string; net: number; year: number }
interface Sym { sym: string; cls: string; mdv: number; evs: Ev[] }
const syms: Sym[] = []; let loaded = 0;
for (const m of meta) {
  const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(m.symbol)}&select=bars`))?.[0];
  const b = ((row?.bars || []) as number[][]).filter((x) => Array.isArray(x) && x.length >= 5 && x[4] > 0).sort((a, c) => a[0] - c[0]);
  if (b.length < MIN_BARS + KK) continue;
  const dv: number[] = []; for (const x of b) { if (x[0] >= SPLIT_TS) break; dv.push(x[4] * (x[5] ?? 0)); }
  const mdv = dv.length ? dv.sort((a, c) => a - c)[Math.floor(dv.length / 2)] : 0;
  const evs: Ev[] = [];
  for (let i = NLEVEL; i < b.length - KK - 1; i++) {
    if (b[i][0] < SPLIT_TS) continue;
    let lo = Infinity; for (let j = i - NLEVEL; j < i; j++) if (b[j][3] < lo) lo = b[j][3];
    if (!(b[i][4] < lo)) continue;
    const d = new Date(b[i][0] * 1000).toISOString().slice(0, 10);
    evs.push({ day: d, net: Math.log(b[i + KK][4] / b[i][4]) - RT, year: Number(d.slice(0, 4)) });
  }
  syms.push({ sym: m.symbol, cls: m.asset_class, mdv, evs });
  if (++loaded % 2000 === 0) console.error(`  loaded ${loaded}/${meta.length}`);
}
function stats(xs: number[]) { const n = xs.length; if (!n) return { n: 0, mean: 0, t: 0 }; const m = xs.reduce((a, c) => a + c, 0) / n; const sd = Math.sqrt(n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0); return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 }; }
const bp = (x: number) => (x * 1e4).toFixed(1);
function report(label: string, set: Sym[]) {
  const byDay = new Map<string, number[]>(), byYear = new Map<number, Map<string, number[]>>(); let nEv = 0, pos = 0, tested = 0;
  for (const s of set) {
    const xs = s.evs.map((e) => e.net); if (xs.length >= MIN_INST) { tested++; if (stats(xs).mean > 0) pos++; }
    for (const e of s.evs) { nEv++; (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e.net);
      const y = byYear.get(e.year) ?? byYear.set(e.year, new Map()).get(e.year)!; (y.get(e.day) ?? y.set(e.day, []).get(e.day)!).push(e.net); }
  }
  const dm: number[] = []; for (const xs of byDay.values()) dm.push(xs.reduce((a, c) => a + c, 0) / xs.length);
  const s = stats(dm);
  const nonEq = set.filter((x) => x.cls !== "equity").length;
  console.log(`\n  ${label}: ${set.length} symbols (${nonEq} non-equity), ${nEv} events, ${dm.length} event-days`);
  console.log(`    day-clustered net ${bp(s.mean)}bp  day-t ${s.t.toFixed(2)}   cross-symbol sign ${pos}/${tested} = ${tested ? (100 * pos / tested).toFixed(1) : "-"}%`);
  const yrs = [...byYear.keys()].sort();
  console.log(`    by year: ` + yrs.map((y) => { const m2: number[] = []; for (const xs of byYear.get(y)!.values()) m2.push(xs.reduce((a, c) => a + c, 0) / xs.length); const st = stats(m2); return `${y} ${bp(st.mean)}bp t${st.t.toFixed(2)}`; }).join(" | "));
}
const ranked = [...syms].sort((a, c) => c.mdv - a.mdv);
const nDec = Math.floor(ranked.length * 0.1);
const A = ranked.slice(0, nDec);                                                   // unfiltered decile — the registered population
const B = A.filter((s) => s.cls === "equity");                                     // same cutoff, non-equity dropped
const eqOnly = syms.filter((s) => s.cls === "equity").sort((a, c) => c.mdv - a.mdv);
const C = eqOnly.slice(0, Math.floor(eqOnly.length * 0.1));                        // re-ranked within equities
console.log(`==> D-800 — does the "US equity" spec vs unfiltered code matter? universe ${syms.length} (equity ${eqOnly.length}); cutoffs A $${(A[A.length - 1].mdv / 1e6).toFixed(2)}M  C $${(C[C.length - 1].mdv / 1e6).toFixed(2)}M`);
report("A  unfiltered decile (as the scorer computes it)", A);
report("B  same decile, non-equity removed", B);
report("C  decile re-ranked within equity only (spec read literally)", C);
report("   the 111 non-equity members alone", A.filter((s) => s.cls !== "equity"));
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "eq-decile-asset-class", runId: `edac|${K.SPLIT}`, spent: 3 });
console.log(`\n  TRIALS 3 | ceiling ${spend.ceiling.toFixed(2)}. Reference (D-791, unfiltered, same series): 28.8bp day-t 1.40, 65% sign.`);
console.log(`  If B and C sit within ~0.2 of A's day-t and within a few bp, the mismatch is cosmetic; otherwise it is substantive and the operator decides.`);
