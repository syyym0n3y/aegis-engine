// D-936 — the deployable DISTRESS short sleeve = going-concern (D-930) UNION late-filing (D-935).
// Single owner of data/d931-gcshort-daily.json (the "gcshort" sleeve the blend reads). Pure offline COMBINER:
// it fetches no EDGAR itself — goingconcern-test.ts and latefiling-test.ts each dump their panel events, and this
// script unions them, computes liquidity on the UNION (a name's liquid/illiquid status must not depend on which
// trigger set it sits in), and builds ONE market-neutral short. Reports gc-only vs combined so the marginal
// contribution of late-filing is measured, not assumed.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("distress-sleeve", [{ name: "BORROW", def: "0.10" }, { name: "WINDOW", def: "180" }, { name: "MINN", def: "3" }, { name: "STALE_H", def: "0", note: "if >0, refuse event dumps older than this many hours (upstream test scripts silently stopped)" }, { name: "WRITE", def: "combined", note: "which series to write to d931 (the deployable sleeve): combined | gconly — gconly is for the marginal-contribution isolation only" }]);
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
console.log(`events: going-concern ${gcEv.length} (${new Set(gcEv.map(e=>e.ticker)).size} names), late-filing ${ntEv.length} (${new Set(ntEv.map(e=>e.ticker)).size} names)`);
// tag each event with its source so we can build gc-only vs combined
const tagged = [...gcEv.map((e) => ({ ...e, src: "gc" as const })), ...ntEv.map((e) => ({ ...e, src: "nt" as const }))];
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
// 3) build a daily short over the IWM calendar from a chosen event subset (liquid-only)
const iwmDays = [...iwmC.keys()].sort((a, b) => a - b);
function buildSleeve(evs: Ev[]): { d: string; ret: number }[] {
  const flagBy = new Map<string, number[]>();
  for (const h of evs) { if (!liqSet.has(h.ticker) || !px.has(h.ticker)) continue; const d0 = Math.floor(Date.parse(h.date + "T00:00:00Z") / 86400000); (flagBy.get(h.ticker) ?? flagBy.set(h.ticker, []).get(h.ticker)!).push(d0); }
  const out: { d: string; ret: number }[] = [];
  for (let k = 1; k < iwmDays.length; k++) { const tt = iwmDays[k], tp = iwmDays[k - 1]; const rIWM = Math.log(iwmC.get(tt)! / iwmC.get(tp)!); const shorts: number[] = [];
    for (const [tk, fds] of flagBy) { if (!fds.some((fd) => tt > fd && tt <= fd + WIN)) continue; const m = px.get(tk)!; const p0 = m.get(tp), p1 = m.get(tt); if (p0 && p1) shorts.push(Math.log(p1 / p0)); }
    const ret = shorts.length >= MINN ? -mean(shorts) + rIWM - BORROW_D : 0;
    out.push({ d: new Date(tt * 86400000).toISOString().slice(0, 10), ret }); }
  return out;
}
const gcOnly = buildSleeve(gcEv);
const combined = buildSleeve([...gcEv, ...ntEv]);
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
await Deno.writeTextFile(new URL("../data/d931-gcshort-daily.json", import.meta.url), JSON.stringify(toWrite));
console.log(`  wrote ${K.WRITE} series -> data/d931-gcshort-daily.json${K.WRITE === "gconly" ? "  (ISOLATION RUN — re-run with WRITE=combined to restore the deployable sleeve)" : ""}`);
const aGc = gcOnly.filter((x) => x.ret !== 0).length, aCb = combined.filter((x) => x.ret !== 0).length;
const sGc = shp(gcOnly.map((x) => x.ret)), sCb = shp(combined.map((x) => x.ret));
console.log(`\n==> D-936 DISTRESS SLEEVE (going-concern UNION late-filing), net ${(+K.BORROW*100)}% borrow, ${WIN}d window, >=${MINN} names/day\n`);
console.log(`  ${"sleeve".padEnd(20)} ${"active-days".padStart(11)} ${"%/yr".padStart(8)} ${"vol%".padStart(7)} ${"Sharpe".padStart(7)}`);
console.log(`  ${"going-concern only".padEnd(20)} ${String(aGc).padStart(11)} ${sGc.annPct.toFixed(1).padStart(8)} ${sGc.volPct.toFixed(1).padStart(7)} ${sGc.sharpe.toFixed(2).padStart(7)}`);
console.log(`  ${"+ late-filing (D936)".padEnd(20)} ${String(aCb).padStart(11)} ${sCb.annPct.toFixed(1).padStart(8)} ${sCb.volPct.toFixed(1).padStart(7)} ${sCb.sharpe.toFixed(2).padStart(7)}`);
console.log(`  late-filing added ${aCb - aGc} active short-days (${((aCb-aGc)/Math.max(1,aGc)*100).toFixed(0)}% more coverage) -> data/d931-gcshort-daily.json`);
console.log(`\n  READ: more active days = the short is deployed more of the time (frees the sleeve from going-concern's once-a-year 10-K cadence). Judge the DEPLOYABLE number by the blended book, not this standalone sleeve.`);
