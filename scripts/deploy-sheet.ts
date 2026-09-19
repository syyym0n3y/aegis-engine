// deploy-sheet.ts (D-953c) — the operator's EXECUTION SHEET for the hand-fillable deployable book. Prints WHAT TO HOLD
// TODAY (current IVOL long/short names + active distress shorts), sized at a given capital, with the live de-gross
// status and the cadence/gates runbook. Ready the moment capital is armed. Claude NEVER executes — this prints; the
// operator fills manually. Honest about the PRACTICAL minimum capital (per-name fillability, not name count, is the bind).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("deploy-sheet", [
  { name: "CAPITAL", def: "100000", note: "$ armed" }, { name: "VOL_TARGET", def: "0.20", note: "deployable book vol (quarter-Kelly-ish)" },
  { name: "NPL", def: "33", note: "IVOL names per leg (q20 = hand-fillable)" }, { name: "WINDOW", def: "365", note: "distress event hold window (days)" },
  { name: "FORM_D", def: "60" }, { name: "CROWD_DC", def: "5" }, { name: "SI_LAG_D", def: "14" }, { name: "MAX_NAMES", def: "3000" }, { name: "BASE_VOL", def: "0.048", note: "the blend's raw base vol -> leverage = VOL_TARGET/BASE_VOL" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ds", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const C = +K.CAPITAL, V = +K.VOL_TARGET, NPL = +K.NPL, FD = +K.FORM_D, CROWD = +K.CROWD_DC, SILAG = +K.SI_LAG_D, WIN = +K.WINDOW;
const LEV = V / +K.BASE_VOL;
// sleeve risk-parity weights from the deployed DORMANT snapshot
const snap = await q(`trd_positions?book->>spec_id=eq.distress-ivol-blend-5&select=book`) as { book: { sleeve_weights: { sleeve: string; inv_vol_weight: number }[] } }[];
const W = new Map((snap[0]?.book.sleeve_weights ?? []).map((s) => [s.sleeve, s.inv_vol_weight]));
// load equity bars for the current IVOL book
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((m) => m.n_bars > 400).slice(0, +K.MAX_NAMES);
type Bar = { d: number; c: number; r: number; dv: number };
const S = new Map<string, Bar[]>();
for (let i = 0; i < meta.length; i += 40) { const page = meta.slice(i, i + 40); const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); if (b.length < 400) continue; const arr: Bar[] = []; for (let j = 1; j < b.length; j++) arr.push({ d: Math.floor(b[j][0] / 86400), c: b[j][4], r: Math.log(b[j][4] / b[j - 1][4]), dv: b[j][4] * b[j][5] }); S.set(r.symbol.toUpperCase(), arr); } }
assertNonEmpty("priced", [...S.keys()], 100);
const idxOf = new Map<string, Map<number, number>>(); for (const [s, b] of S) { const m = new Map<number, number>(); b.forEach((x, i) => m.set(x.d, i)); idxOf.set(s, m); }
const allDays = new Set<number>(); for (const b of S.values()) for (const x of b) allDays.add(x.d); const cal = [...allDays].sort((a, z) => a - z); const today = cal[cal.length - 1];
const mkt = new Map<number, number>(); for (const d of cal.slice(-90)) { const rs: number[] = []; for (const [s, b] of S) { const i = idxOf.get(s)!.get(d); if (i !== undefined) rs.push(b[i].r); } if (rs.length >= 20) mkt.set(d, mean(rs)); }
// SI for the avoid-filter
const si = new Map<string, { d: number; dc: number }[]>(); { const syms = [...S.keys()]; for (let i = 0; i < syms.length; i += 60) { const rows = await q(`trd_short_interest?symbol=in.(${syms.slice(i, i + 60).map(encodeURIComponent).join(",")})&select=symbol,settlement,days_cover`) as { symbol: string; settlement: string; days_cover: number }[]; for (const r of rows) { if (!r.settlement || r.days_cover == null) continue; const s = r.symbol.toUpperCase(); (si.get(s) ?? si.set(s, []).get(s)!).push({ d: Math.floor(Date.parse(r.settlement + "T00:00:00Z") / 86400000), dc: +r.days_cover }); } } for (const [, a] of si) a.sort((x, y) => x.d - y.d); }
const borrowOK = (s: string) => { const a = si.get(s); if (!a || !a.length) return true; let dc: number | null = null; for (const x of a) { if (x.d <= today - SILAG) dc = x.dc; else break; } return dc === null ? true : dc < CROWD; };
const idio = (s: string): number | null => { const b = S.get(s)!, i0 = idxOf.get(s)!.get(today); if (i0 === undefined || i0 < FD) return null; const w = b.slice(i0 - FD, i0); const rs = w.map((x) => x.r), mr = w.map((x) => mkt.get(x.d) ?? 0); const mm = mean(mr), mrr = mean(rs); let cov = 0, vv = 0; for (let k = 0; k < rs.length; k++) { cov += (mr[k] - mm) * (rs[k] - mrr); vv += (mr[k] - mm) ** 2; } const beta = vv > 0 ? cov / vv : 0; return sd(rs.map((rk, k) => rk - beta * (mr[k] - mm) - mrr)); };
const dvTrail = (s: string) => { const b = S.get(s)!, i = idxOf.get(s)!.get(today); if (i === undefined) return 0; const w = b.slice(Math.max(0, i - 60), i); return w.length ? mean(w.map((x) => x.dv)) : 0; };
const cand = [...S.keys()].map((s) => ({ s, v: idio(s), dv: dvTrail(s) })).filter((c) => c.v !== null && isFinite(c.v!) && idxOf.get(c.s)!.get(today) !== undefined) as { s: string; v: number; dv: number }[];
const volMed = [...cand.map((c) => c.dv)].sort((a, z) => a - z)[Math.floor(cand.length / 2)]; const liq = cand.filter((c) => c.dv >= volMed);
liq.sort((a, z) => a.v - z.v); const ivLong = liq.slice(0, NPL).map((c) => c.s); const ivShort: string[] = []; for (let j = liq.length - 1; j >= 0 && ivShort.length < NPL; j--) if (borrowOK(liq[j].s)) ivShort.push(liq[j].s);
// current distress shorts: names with an event within WIN days of today, liquid
const gcEv = JSON.parse(await Deno.readTextFile(new URL("../data/d930-gc-events.json", import.meta.url))) as { ticker: string; date: string }[];
const ntEv = JSON.parse(await Deno.readTextFile(new URL("../data/d935-nt-events.json", import.meta.url))) as { ticker: string; date: string }[];
// use the distress sleeve's OWN liquid set (d936, 701 names on the distress-universe median), not the equity-wide volMed
const distRows = JSON.parse(await Deno.readTextFile(new URL("../data/d936-distress-liquid-names.json", import.meta.url))) as { sym: string; dollar_vol: number }[];
const distDv = new Map(distRows.map((x) => [x.sym.toUpperCase(), x.dollar_vol]));
const distActive = new Set<string>(); for (const e of [...gcEv, ...ntEv]) { const ed = Math.floor(Date.parse(e.date + "T00:00:00Z") / 86400000); if (today - ed >= 0 && today - ed <= WIN && distDv.has(e.ticker.toUpperCase())) distActive.add(e.ticker.toUpperCase()); }
// distress is event-binary (no continuous score) -> to make it hand-fillable, PRIORITISE the most-LIQUID active names
// (most fillable AND most borrowable). Deployed d931 still shorts all active names; concentrating the DEPLOYED sleeve to
// the top-N liquid (with measured edge retention, the IVOL precedent) is the flagged follow-up.
const distTop = [...distActive].sort((a, b) => (distDv.get(b) ?? 0) - (distDv.get(a) ?? 0)).slice(0, NPL);
// de-gross status: last 10 days of the (distress+ivol) short book from the deployed series
const rd = async (f: string) => JSON.parse(await Deno.readTextFile(new URL(`../data/${f}`, import.meta.url))) as { d: string; ret: number }[];
const gcS = await rd("d931-gcshort-daily.json"), ivS = await rd("d939-ivol-daily.json");
const gcM = new Map(gcS.map((x) => [x.d, x.ret])), ivM = new Map(ivS.map((x) => [x.d, x.ret]));
const cd = [...gcM.keys()].filter((d) => ivM.has(d)).sort().slice(-10); const bleed = cd.reduce((s, d) => s + (gcM.get(d)! + ivM.get(d)!) / 2, 0);
const degrossed = bleed < -0.01;
// sizing
const dollar = (sl: string) => (W.get(sl) ?? 0) * LEV * C;
console.log(`\n================ AEGIS DEPLOY SHEET — ${new Date(today * 86400000).toISOString().slice(0, 10)} — $${C.toLocaleString()} @ ${(100 * V).toFixed(0)}% vol (lev ${LEV.toFixed(1)}x) ================`);
console.log(`DORMANT — Claude does not execute. You fill these manually, at MICRO size first, only after arming the kill-switch.\n`);
console.log(`SLEEVE ALLOCATIONS (risk-parity, gross notional):`);
for (const [sl, nm] of [["trend", "TREND (110-asset trend / managed-futures)"], ["long", "LONG equity (SPY/VTI, vol-scaled)"], ["cryptomom", "CRYPTO MOMENTUM (top coins by 3-12m momentum)"], ["gcshort", "DISTRESS SHORT (name-level)"], ["ivol", "IVOL long-short (name-level)"]] as [string, string][]) console.log(`  ${nm.padEnd(44)} ${(100 * (W.get(sl) ?? 0)).toFixed(1).padStart(5)}%  ~$${Math.round(dollar(sl)).toLocaleString()}`);
console.log(`\n${degrossed ? "*** DE-GROSS ACTIVE ***" : "DE-GROSS: OFF"} — 10-day short-book bleed ${(100 * bleed).toFixed(2)}% (threshold -1.0%). ${degrossed ? "HOLD the distress+ivol shorts FLAT (to cash) until the bleed recovers above -1.0%." : "Distress+ivol shorts are ON."}`);
const ivDol = dollar("ivol") / 2, perIvL = ivDol / Math.max(1, ivLong.length), perIvS = ivDol / Math.max(1, ivShort.length), gcDol = dollar("gcshort"), perGc = gcDol / Math.max(1, distTop.length);
console.log(`\nIVOL LONG (${ivLong.length} lowest idio-vol, ~$${Math.round(perIvL)}/name):\n  ${ivLong.join(" ")}`);
console.log(`IVOL SHORT (${ivShort.length} highest idio-vol, borrow-OK, ~$${Math.round(perIvS)}/name):\n  ${ivShort.join(" ")}${degrossed ? "   [FLAT while de-gross active]" : ""}`);
console.log(`DISTRESS SHORT — ${distActive.size} names active (deployed sleeve shorts ALL; blend excess 2.08).`);
console.log(`  FULL EDGE needs a BASKET order (${distActive.size} names) — distress is a BREADTH anomaly (D-954: concentration HURTS it, unlike IVOL).`);
console.log(`  HAND-FILL COMPROMISE: the ${distTop.length} most-liquid (~$${Math.round(perGc)}/name) — but capping to 50 costs the blend 2.08 -> 1.79. Prefer a basket if your broker supports it:\n  ${distTop.join(" ")}${degrossed ? "   [FLAT while de-gross active]" : ""}`);
console.log(`\nPRACTICAL MINIMUM CAPITAL: distress+ivol are low-weight sleeves, so per-name $ is small — at $${C.toLocaleString()} the IVOL names are ~$${Math.round(perIvL)} each. For fillable per-name size (~$300-500), the name-level shorts need ~$100-150k. Below that you can only run trend+long+crypto (excess ~0.89, D-950).`);
console.log(`\nCADENCE: IVOL + DISTRESS rebalance MONTHLY (re-run this sheet); TREND weekly; CRYPTO weekly. GATES: paper -> MICRO (this, tiny) -> SMALL, each rung only after a clean kill-switch record. KILL-SWITCH: durable row; if the book draws down past your rung's limit, flatten and step down a rung. Never let Claude place an order.`);
