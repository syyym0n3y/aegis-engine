#!/usr/bin/env -S deno run --allow-net --allow-env
// release-hour-study.ts (D-877) — PREREG: D-877-release-hour-event-study. The first non-price question: the BLS
// calendar (bls:* in trd_macro_series, release hour as a UTC decimal) joined to the 24-instrument hourly panel.
// (a) POSITIVE CONTROL: the release hour must be LOUDER — |return| and range vs the same instrument's same-hour-of-day
//     average on non-release days; if the calendar is misaligned this fails and nothing else may be read.
// (b) POST-RELEASE CONTINUATION: sign of the release-hour return -> next 4h (lag-1 from the next open), OLS train
//     (<2023) / test (>=2023), effect per 1sd vs class cost, per-instrument agreement, ceiling for the id.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
import { decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("release-hour-study", [{ name: "RELEASES", def: "bls:consumer-price-index,bls:employment-situation,bls:producer-price-index,bls:job-openings-and-labor-turnover-survey" }, { name: "SPLIT", def: "2023-01-01" }, { name: "ONLY", def: "", note: "D-877b: comma list of instruments to restrict to (the FX/index set US data moves)" }, { name: "RUN_ID", def: "D-877-release-hour-event-study" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rhs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const ols = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); const res = y.map((v, i) => v - my - b * (x[i] - mx)); const se = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, x.length - 2) / (sxx || 1e-12)); return { b, t: b / (se || 1e-12) }; };
type B = { ts: number; o: number; h: number; l: number; c: number };
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"], IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
const cls = (s: string) => FX.includes(s) ? "fx" : IDX.includes(s) ? "idx" : "crypto"; const cost = (s: string) => cls(s) === "fx" ? 4 : cls(s) === "idx" ? 6 : 9;
async function load(sym: string): Promise<B[]> { if (FX.includes(sym) || IDX.includes(sym)) { const out: B[] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as (B & { vol: number })[]; if (!p.length) break; out.push(...p.filter((r) => r.h > r.l)); from = p.at(-1)!.ts; if (p.length < 20000) break; } return out; } const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).map(decodeBar).filter((b) => b.v > 0).map((b) => ({ ts: b.ts, o: b.o, h: b.h, l: b.l, c: b.c })).sort((x, y) => x.ts - y.ts); }
// release timestamps (UTC hour bucket)
const rel = new Map<number, string>(); for (const s of K.RELEASES.split(",")) { const rows = await q(`trd_macro_series?series=eq.${s}&select=d,v&order=d.asc&limit=5000`) as { d: string; v: number }[]; for (const r of rows) { const ts = Date.parse(r.d + "T00:00:00Z") / 1000 + Math.floor(r.v) * 3600; rel.set(ts, s); } }
assertNonEmpty("release hours", [...rel.keys()], 200);
const perps = (await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 10000).map((r) => r.symbol);
const U = K.ONLY ? K.ONLY.split(",") : [...perps, ...FX, ...IDX]; const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
console.log(`\n==> D-877 RELEASE-HOUR STUDY — ${rel.size} release hours (${K.RELEASES.split(",").length} series), ${U.length} instruments`);
console.log(`  ${"instrument".padEnd(14)} ${"n".padStart(5)} ${"|ret| x".padStart(8)} ${"range x".padStart(8)} ${"cont slope tr".padStart(13)} ${"te".padStart(6)} ${"t(te)".padStart(6)} ${"bp/1sd".padStart(7)} ${"cost".padStart(5)}`);
let trials = 0, ctlPass = 0, agree = 0, nInst = 0; const byCls: Record<string, number[]> = {};
for (const sym of U) {
  const b = await load(sym); if (b.length < 10000) continue; const pos = new Map(b.map((x, i) => [x.ts, i]));
  const hourAvgAbs = new Map<number, number[]>(), hourAvgRng = new Map<number, number[]>();
  for (let i = 1; i < b.length; i++) { const hr = new Date(b[i].ts * 1000).getUTCHours(); if (rel.has(b[i].ts)) continue; (hourAvgAbs.get(hr) ?? hourAvgAbs.set(hr, []).get(hr)!).push(Math.abs(Math.log(b[i].c / b[i - 1].c))); (hourAvgRng.get(hr) ?? hourAvgRng.set(hr, []).get(hr)!).push((b[i].h - b[i].l) / b[i].o); }
  const absR: number[] = [], rngR: number[] = [], xTr: number[] = [], yTr: number[] = [], xTe: number[] = [], yTe: number[] = [];
  for (const [ts] of rel) { const i = pos.get(ts); if (i === undefined || i < 1 || i + 6 >= b.length) continue; const hr = new Date(ts * 1000).getUTCHours(); const ba = mean(hourAvgAbs.get(hr) ?? [1]), br = mean(hourAvgRng.get(hr) ?? [1]); const r0 = Math.log(b[i].c / b[i - 1].c); absR.push(Math.abs(r0) / (ba || 1e-9)); rngR.push(((b[i].h - b[i].l) / b[i].o) / (br || 1e-9)); const fwd = Math.log(b[i + 5].o / b[i + 1].o); if (ts < SPLIT) { xTr.push(r0); yTr.push(fwd); } else { xTe.push(r0); yTe.push(fwd); } }
  if (absR.length < 100) continue; nInst++; trials++;
  const ctl = mean(absR) >= 1.5 && mean(rngR) >= 1.5; if (ctl) ctlPass++;
  const oTr = ols(xTr, yTr), oTe = ols(xTe, yTe); const per = oTe.b * sd(xTe) * 1e4; if (Math.sign(oTr.b) === Math.sign(oTe.b) && oTe.b > 0) agree++; (byCls[cls(sym)] ??= []).push(per);
  console.log(`  ${sym.padEnd(14)} ${String(absR.length).padStart(5)} ${mean(absR).toFixed(2).padStart(8)} ${mean(rngR).toFixed(2).padStart(8)} ${oTr.b.toFixed(3).padStart(13)} ${oTe.b.toFixed(3).padStart(6)} ${oTe.t.toFixed(2).padStart(6)} ${per.toFixed(1).padStart(7)} ${String(cost(sym)).padStart(5)}${ctl ? "" : "   <- control FAILED (release hour not louder)"}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "release-hour", runId: K.RUN_ID, spent: trials * 2 + 1 }); const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  (a) CONTROL: release hour louder (>=1.5x |ret| and range) on ${ctlPass}/${nInst} instruments ${ctlPass >= nInst / 2 ? "— PASSED, the calendar is aligned" : "— FAILED, misaligned; nothing else may be read"}`);
console.log(`  (b) continuation sign agreement (train=test, positive): ${agree}/${nInst}; effect per 1sd by class: ${Object.entries(byCls).map(([c, v]) => `${c} ${mean(v).toFixed(1)}bp`).join(", ")}; ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`  SUPPORTED only if a class's test t clears ${ceil.ceiling.toFixed(2)} with effect/1sd > cost and >= 60% agree — read the rows.`);
