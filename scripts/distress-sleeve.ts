// D-936 — the deployable DISTRESS short sleeve = going-concern (D-930) UNION late-filing (D-935).
// Single owner of data/d931-gcshort-daily.json (the "gcshort" sleeve the blend reads). Pure offline COMBINER:
// it fetches no EDGAR itself — goingconcern-test.ts and latefiling-test.ts each dump their panel events, and this
// script unions them, computes liquidity on the UNION (a name's liquid/illiquid status must not depend on which
// trigger set it sits in), and builds ONE market-neutral short. Reports gc-only vs combined so the marginal
// contribution of late-filing is measured, not assumed.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("distress-sleeve", [{ name: "BORROW", def: "0.10" }, { name: "WINDOW", def: "180" }, { name: "MINN", def: "3" }, { name: "STALE_H", def: "0", note: "if >0, refuse event dumps older than this many hours (upstream test scripts silently stopped)" }, { name: "WRITE", def: "combined", note: "which series to write to d931 (the deployable sleeve): combined | gconly — gconly is for the marginal-contribution isolation only" }, { name: "INCLUDE_AUDITOR", def: "0", note: "1 = fold D-937 auditor-resignation events (d937-auditor-events.json) in as a 3rd trigger — only after its marginal blend contribution is measured positive" }, { name: "CROWD_DC", def: "0", note: "D-946 SQUEEZE AVOID-FILTER: if >0, exclude a flagged name from the SHORT on any day its point-in-time days-to-cover >= this (crowded short = squeeze fuel; the D-945 Jan-2021 blowup was these names). With CROWD_DC>0 the series is NEVER written to d931 (writes to ALT_OUT) — measurement only until it clears." }, { name: "SI_LAG_D", def: "14", note: "publication lag: use SI with settlement <= d - SI_LAG_D (no look-ahead)" }, { name: "ALT_OUT", def: "d946-distress-crowdfilt-daily.json", note: "where the CROWD_DC>0 series is written (never d931, to protect the deployed sleeve)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ds", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const shp = (r: number[]) => { const mu = mean(r) * 252; const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean(r)) ** 2, 0) / Math.max(1, r.length - 1)) * Math.sqrt(252); return { annPct: mu * 100, volPct: sd * 100, sharpe: mu / (sd || 1) }; };
const BORROW_D = +K.BORROW / 252; const WIN = +K.WINDOW; const MINN = +K.MINN;
type Ev = { ticker: string; date: string };
// 1) read both event dumps; if STALE_H>0, refuse dumps older than that budget (upstream fetch silently stopped —
// the D-613 continuity failure: a frozen snapshot answers plausibly forever). Not "after my own start", because the
// test scripts legitimately write these just BEFORE this combiner runs in the same cycle.
const gcPath = new URL("../data/d930-gc-events.json", import.meta.url), ntPath = new URL("../data/d935-nt-events.json", import.meta.url);
const staleH = +K.STALE_H;
if (staleH > 0) for (const p of [gcPath.pathname, ntPath.pathname]) {
  const st = await Deno.stat(p).catch(() => null);
  const ageH = st?.mtime ? (Date.now() - st.mtime.getTime()) / 3.6e6 : Infinity;
  if (ageH > staleH) { console.error(`!! ${p} is ${ageH === Infinity ? "MISSING" : ageH.toFixed(1) + "h"} old (budget ${staleH}h) — upstream EDGAR dump did not refresh this cycle. Refusing to rebuild the sleeve from a frozen snapshot.`); Deno.exit(1); }
}
const gcEv = JSON.parse(await Deno.readTextFile(gcPath)) as Ev[];
const ntEv = JSON.parse(await Deno.readTextFile(ntPath)) as Ev[];
assertNonEmpty("going-concern events", gcEv, 50); assertNonEmpty("late-filing events", ntEv, 30);
let auEv: Ev[] = [];
if (K.INCLUDE_AUDITOR === "1") { auEv = JSON.parse(await Deno.readTextFile(new URL("../data/d937-auditor-events.json", import.meta.url))) as Ev[]; assertNonEmpty("auditor-resignation events", auEv, 30); }
console.log(`events: going-concern ${gcEv.length} (${new Set(gcEv.map(e=>e.ticker)).size} names), late-filing ${ntEv.length} (${new Set(ntEv.map(e=>e.ticker)).size} names)${K.INCLUDE_AUDITOR === "1" ? `, auditor-resign ${auEv.length} (${new Set(auEv.map(e=>e.ticker)).size} names)` : ""}`);
// tag each event with its source so we can build gc-only vs combined
const tagged = [...gcEv.map((e) => ({ ...e, src: "gc" as const })), ...ntEv.map((e) => ({ ...e, src: "nt" as const })), ...auEv.map((e) => ({ ...e, src: "au" as const }))];
const allTickers = [...new Set(tagged.map((e) => e.ticker))];
console.log(`combined distress universe: ${allTickers.length} unique names (gc ${new Set(gcEv.map(e=>e.ticker)).size} + nt ${new Set(ntEv.map(e=>e.ticker)).size}, overlap ${new Set(gcEv.map(e=>e.ticker)).size + new Set(ntEv.map(e=>e.ticker)).size - allTickers.length})`);
// 2) load bars + benchmark; liquidity on the UNION
async function bars(sym: string) { const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0).sort((a, c) => a[0] - c[0]); }
const iwm = await bars("IWM"); const iwmC = new Map<number, number>(); for (const b of iwm) iwmC.set(Math.floor(b[0] / 86400), b[4]);
const px = new Map<string, Map<number, number>>(); const vol = new Map<string, number>();
for (const t of allTickers) { const b = await bars(t); if (b.length < 100) continue; const m = new Map<number, number>(); let vs = 0; for (const x of b) { m.set(Math.floor(x[0] / 86400), x[4]); vs += x[4] * x[5]; } px.set(t, m); vol.set(t, vs / b.length); }
assertNonEmpty("priced names", [...px.keys()], 30);
const volMed = [...vol.values()].sort((a, b) => a - b)[Math.floor(vol.size / 2)];
const liqSet = new Set([...vol.entries()].filter(([, v]) => v >= volMed).map(([k]) => k));
console.log(`priced ${px.size}/${allTickers.length}; liquid tercile (>= median $vol) ${liqSet.size} names — LIQUIDITY LAW: only liquid names enter the sleeve`);
// D-946 squeeze avoid-filter: point-in-time days-to-cover for the flagged names, so the short can drop the crowded
// (squeeze-prone) distressed names on the days they are crowded — the same D-939c discipline the IVOL short already uses.
const CROWD = +K.CROWD_DC, SILAG = +K.SI_LAG_D; const siByName = new Map<string, { d: number; dc: number }[]>();
if (CROWD > 0) {
  const syms = [...px.keys()];
  for (let i = 0; i < syms.length; i += 60) {
    const rows = await q(`trd_short_interest?symbol=in.(${syms.slice(i, i + 60).map(encodeURIComponent).join(",")})&select=symbol,settlement,days_cover`) as { symbol: string; settlement: string; days_cover: number }[];
    for (const r of rows) { if (!r.settlement || r.days_cover == null) continue; const s = r.symbol.toUpperCase(); (siByName.get(s) ?? siByName.set(s, []).get(s)!).push({ d: Math.floor(Date.parse(r.settlement + "T00:00:00Z") / 86400000), dc: +r.days_cover }); }
  }
  for (const [, a] of siByName) a.sort((x, y) => x.d - y.d);
  console.log(`  D-946 AVOID-FILTER on: SI present for ${siByName.size}/${px.size} names; drop a name from the short on days its point-in-time days_cover >= ${CROWD} (lag ${SILAG}d). CROWD_DC>0 writes to ${K.ALT_OUT}, NEVER d931.`);
}
// borrowOK == "safe to short" == not a crowded squeeze target as of the lagged settlement (no SI on a name -> allowed, counted)
let siMissDays = 0;
const shortOK = (sym: string, dEpochDays: number): boolean => { if (CROWD <= 0) return true; const a = siByName.get(sym.toUpperCase()); if (!a || !a.length) { siMissDays++; return true; } let dc: number | null = null; for (const x of a) { if (x.d <= dEpochDays - SILAG) dc = x.dc; else break; } return dc === null ? true : dc < CROWD; };
// 3) build a daily short over the IWM calendar from a chosen event subset (liquid-only)
const iwmDays = [...iwmC.keys()].sort((a, b) => a - b);
function buildSleeve(evs: Ev[], win = WIN, flt = CROWD > 0): { d: string; ret: number }[] {
  const flagBy = new Map<string, number[]>();
  for (const h of evs) { if (!liqSet.has(h.ticker) || !px.has(h.ticker)) continue; const d0 = Math.floor(Date.parse(h.date + "T00:00:00Z") / 86400000); (flagBy.get(h.ticker) ?? flagBy.set(h.ticker, []).get(h.ticker)!).push(d0); }
  const out: { d: string; ret: number }[] = [];
  for (let k = 1; k < iwmDays.length; k++) { const tt = iwmDays[k], tp = iwmDays[k - 1]; const rIWM = Math.log(iwmC.get(tt)! / iwmC.get(tp)!); const shorts: number[] = [];
    for (const [tk, fds] of flagBy) { if (!fds.some((fd) => tt > fd && tt <= fd + win)) continue; if (flt && !shortOK(tk, tt)) continue; const m = px.get(tk)!; const p0 = m.get(tp), p1 = m.get(tt); if (p0 && p1) shorts.push(Math.log(p1 / p0)); }
    const ret = shorts.length >= MINN ? -mean(shorts) + rIWM - BORROW_D : 0;
    out.push({ d: new Date(tt * 86400000).toISOString().slice(0, 10), ret }); }
  return out;
}
if ((Deno.env.get("WIN_SWEEP") ?? "0") === "1") {
  // D-943: distress longer-horizon sweep — hold the short WINDOW days after each event. Longer window captures more of
  // the documented year-long distress drift (D-647: 369d median lead) but adds more diluted late-drift days. Read-only.
  const allEv = [...gcEv, ...ntEv, ...auEv];
  console.log(`\n  === DISTRESS HOLD-WINDOW SWEEP (combined gc+nt, ${allTickers.length}-name universe) ===`);
  console.log(`  ${"window".padStart(7)} ${"activeDays".padStart(10)} ${"%/yr".padStart(7)} ${"vol%".padStart(6)} ${"Sharpe".padStart(7)}  ${"SR-early".padStart(8)} ${"SR-late".padStart(8)}  (era-robust?)`);
  for (const win of [63, 90, 180, 252, 365, 540]) {
    const s = buildSleeve(allEv, win); const active = s.filter((x) => x.ret !== 0).length; const st = shp(s.map((x) => x.ret));
    // era split of the ACTIVE period only (events start 2016; pre-event days are all zero and would fake a "dead early era")
    const fa = s.findIndex((x) => x.ret !== 0); const act = fa >= 0 ? s.slice(fa) : s; const mid = Math.floor(act.length / 2);
    const e1 = shp(act.slice(0, mid).map((x) => x.ret)), e2 = shp(act.slice(mid).map((x) => x.ret));
    console.log(`  ${String(win).padStart(7)} ${String(active).padStart(10)} ${st.annPct.toFixed(1).padStart(7)} ${st.volPct.toFixed(1).padStart(6)} ${st.sharpe.toFixed(2).padStart(7)}  ${e1.sharpe.toFixed(2).padStart(8)} ${e2.sharpe.toFixed(2).padStart(8)}`);
  }
  console.log(`  READ: if Sharpe rises with the window in BOTH eras, the 365d deploy (D-943) is robust; if the gain is one-era-only it is a full-sample artifact and 180d should stand.`);
  Deno.exit(0); // read-only sweep — never overwrite the deployed d931
}
const gcOnly = buildSleeve(gcEv);
const combined = buildSleeve([...gcEv, ...ntEv, ...auEv]);
// dump the combined LIQUID names (with which trigger(s) flag each) so goingconcern-borrow.ts can price borrow on the
// FULL deployable universe — INSTRUMENT LAW for the NT-only names the D-931 gate never measured.
const gcNames = new Set(gcEv.map((e) => e.ticker)), ntNames = new Set(ntEv.map((e) => e.ticker));
const liqNames = [...liqSet].filter((s) => px.has(s)).map((sym) => ({ sym, avg_excess_126d: 0, dollar_vol: Math.round(vol.get(sym) ?? 0), src: [gcNames.has(sym) ? "gc" : null, ntNames.has(sym) ? "nt" : null].filter(Boolean).join("+") }));
await Deno.writeTextFile(new URL("../data/d936-distress-liquid-names.json", import.meta.url), JSON.stringify(liqNames));
const ntOnlyLiq = liqNames.filter((n) => n.src === "nt").length;
console.log(`  dumped ${liqNames.length} combined liquid names (${ntOnlyLiq} NT-only — borrow UNMEASURED by D-931) -> data/d936-distress-liquid-names.json`);
// 4) write the deployable sleeve (single owner of d931); report the marginal contribution of late-filing.
// WRITE=gconly writes the going-concern-only series instead, used ONLY to isolate late-filing's blend contribution.
const toWrite = K.WRITE === "gconly" ? gcOnly : combined;
// D-946 WRITE GUARD: with the squeeze avoid-filter on, this is a MEASUREMENT run — never overwrite the deployed d931.
const outName = CROWD > 0 ? K.ALT_OUT : "d931-gcshort-daily.json";
await Deno.writeTextFile(new URL(`../data/${outName}`, import.meta.url), JSON.stringify(toWrite));
console.log(`  wrote ${K.WRITE} series -> data/${outName}${K.WRITE === "gconly" ? "  (ISOLATION RUN — re-run with WRITE=combined to restore the deployable sleeve)" : CROWD > 0 ? "  (CROWD_DC MEASUREMENT — d931 untouched)" : ""}`);
if (CROWD > 0) {
  // D-946 A/B: does excluding crowded (squeeze-prone) distressed names cut the Jan-2021 blowup WITHOUT killing the edge?
  const unf = buildSleeve([...gcEv, ...ntEv, ...auEv], WIN, false); // same universe/window, filter OFF
  const winRet = (s: { d: string; ret: number }[], a: string, b: string) => 100 * s.filter((x) => x.d >= a && x.d <= b).reduce((t, x) => t + x.ret, 0);
  const su = shp(unf.map((x) => x.ret)), sf = shp(combined.map((x) => x.ret));
  const eps: [string, string, string][] = [["Jan-Feb 2021 meme squeeze", "2021-01-01", "2021-02-28"], ["full 2021", "2021-01-01", "2021-12-31"], ["Aug 2022 meme wave", "2022-08-01", "2022-08-31"]];
  console.log(`\n  === D-946 SQUEEZE AVOID-FILTER A/B (distress short, days_cover >= ${CROWD} excluded; ${siMissDays} name-days had no SI) ===`);
  console.log(`  full-sample:  UNFILTERED Sharpe ${su.sharpe.toFixed(2)} (${su.annPct.toFixed(1)}%/yr) -> FILTERED ${sf.sharpe.toFixed(2)} (${sf.annPct.toFixed(1)}%/yr)  [edge must survive]`);
  for (const [nm, a, b] of eps) console.log(`  ${nm.padEnd(26)} short return: UNFILTERED ${winRet(unf, a, b).toFixed(1)}% -> FILTERED ${winRet(combined, a, b).toFixed(1)}%  [squeeze windows must improve]`);
  console.log(`  READ: deploy the filter only if the squeeze windows improve AND the full-sample Sharpe survives (D-939c precedent: IVOL's did).`);
}
const aGc = gcOnly.filter((x) => x.ret !== 0).length, aCb = combined.filter((x) => x.ret !== 0).length;
const sGc = shp(gcOnly.map((x) => x.ret)), sCb = shp(combined.map((x) => x.ret));
console.log(`\n==> D-936 DISTRESS SLEEVE (going-concern UNION late-filing), net ${(+K.BORROW*100)}% borrow, ${WIN}d window, >=${MINN} names/day\n`);
console.log(`  ${"sleeve".padEnd(20)} ${"active-days".padStart(11)} ${"%/yr".padStart(8)} ${"vol%".padStart(7)} ${"Sharpe".padStart(7)}`);
console.log(`  ${"going-concern only".padEnd(20)} ${String(aGc).padStart(11)} ${sGc.annPct.toFixed(1).padStart(8)} ${sGc.volPct.toFixed(1).padStart(7)} ${sGc.sharpe.toFixed(2).padStart(7)}`);
console.log(`  ${"+ late-filing (D936)".padEnd(20)} ${String(aCb).padStart(11)} ${sCb.annPct.toFixed(1).padStart(8)} ${sCb.volPct.toFixed(1).padStart(7)} ${sCb.sharpe.toFixed(2).padStart(7)}`);
console.log(`  late-filing added ${aCb - aGc} active short-days (${((aCb-aGc)/Math.max(1,aGc)*100).toFixed(0)}% more coverage) -> data/d931-gcshort-daily.json`);
console.log(`\n  READ: more active days = the short is deployed more of the time (frees the sleeve from going-concern's once-a-year 10-K cadence). Judge the DEPLOYABLE number by the blended book, not this standalone sleeve.`);
